"""
Bitácora de obra — pipeline de IA.

Flujo: audio (WhatsApp/web) → transcripción (Whisper, opcional) →
análisis con Claude (resumen + puntos clave + sugerencias accionables) →
el usuario revisa y aplica las sugerencias (reprogramar/crear/cambiar estado).

Degradación con gracia:
- Sin OPENAI_API_KEY  → la entrada queda "pendiente_transcripcion"; el usuario
  puede pegar el texto a mano y el análisis sigue.
- Sin ANTHROPIC_API_KEY → la entrada queda "pendiente_analisis" con la
  transcripción visible; sin sugerencias.
"""
import asyncio
import json
import logging
from datetime import date, datetime, timezone

import requests
from fastapi import HTTPException, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import NotFoundError, UnprocessableError
from app.models.bitacora import BitacoraEntry
from app.models.obra import Obra
from app.models.responsible import Responsible
from app.models.suggestion import Suggestion, SuggestionStatus, SuggestionType
from app.models.task import Task
from app.repositories.historial import HistorialRepository
from app.services.suggestion_service import SuggestionService

logger = logging.getLogger(__name__)

# Control de costo de IA: cota mensual de análisis de bitácora por tenant, según
# el plan. Cada entrada procesada dispara transcripción (Whisper) + análisis
# (Claude), que cuestan; sin cota, un usuario podría gastar sin límite.
_BITACORA_MONTHLY_LIMITS: dict[str, int | None] = {
    "basico": 50,
    "pro": 300,
    "enterprise": None,  # ilimitado
}
_BITACORA_DEFAULT_LIMIT = 20  # tenant sin plan asignado

# Schema de salida estricto para el análisis (structured outputs → JSON garantizado)
_ANALYSIS_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string", "description": "Resumen de 2-4 oraciones de lo conversado"},
        "key_points": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Puntos importantes acordados o discutidos, uno por ítem",
        },
        "suggestions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "type": {"type": "string", "enum": ["reschedule_task", "create_task", "update_status", "note"]},
                    "task_id": {"type": ["integer", "null"]},
                    "task_title": {"type": ["string", "null"]},
                    "new_start_date": {"type": ["string", "null"], "description": "YYYY-MM-DD, SOLO si el audio nombra una fecha concreta"},
                    "new_due_date": {"type": ["string", "null"], "description": "YYYY-MM-DD, SOLO si el audio nombra una fecha concreta"},
                    "shift_working_days": {
                        "type": ["integer", "null"],
                        "description": (
                            "Corrimiento en DÍAS LABORALES cuando el audio habla en relativo "
                            "('dos días', 'una semana'). Positivo = más tarde, negativo = más temprano. "
                            "El backend calcula la fecha resultante con el calendario de la obra."
                        ),
                    },
                    "shift_target": {
                        "anyOf": [
                            {"type": "string", "enum": ["start", "due", "both"]},
                            {"type": "null"},
                        ],
                        "description": "Qué fecha corre el shift: el inicio, el fin, o ambas.",
                    },
                    "new_status": {
                        # la API de structured outputs no acepta enum sobre tipo union — usar anyOf
                        "anyOf": [
                            {"type": "string", "enum": ["pendiente", "en_progreso", "bloqueada", "completada", "cancelada"]},
                            {"type": "null"},
                        ],
                    },
                    "title": {"type": ["string", "null"]},
                    "description": {"type": ["string", "null"]},
                    "responsible_name": {"type": ["string", "null"]},
                    "reason": {"type": "string", "description": "Cita o referencia a lo dicho en el audio que justifica la acción"},
                },
                "required": ["type", "task_id", "task_title", "new_start_date", "new_due_date",
                             "shift_working_days", "shift_target",
                             "new_status", "title", "description", "responsible_name", "reason"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["summary", "key_points", "suggestions"],
    "additionalProperties": False,
}


class BitacoraService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.historial = HistorialRepository(session)
        # La bitácora genera sugerencias; resolverlas es de SuggestionService.
        self.suggestions = SuggestionService(session)

    # ── Control de costo de IA ────────────────────────────────────────────────

    async def assert_within_ai_quota(self, tenant_id: int | None) -> None:
        """Cota mensual de análisis de bitácora por tenant (control de costo de IA).

        Cuenta las entradas creadas este mes por usuarios del tenant. Si se
        alcanzó el límite del plan, lanza 429. `enterprise` (o límite None) es
        ilimitado. Se chequea al CREAR una entrada nueva (audio/texto), que es el
        vector de crecimiento no acotado; reprocesar existentes está acotado por
        la cantidad de entradas ya creadas."""
        if tenant_id is None:
            return

        from app.models.plan import Plan
        from app.models.tenant import Tenant

        limit: int | None = _BITACORA_DEFAULT_LIMIT
        tenant = await self.session.get(Tenant, tenant_id)
        if tenant and tenant.plan_id:
            plan = await self.session.get(Plan, tenant.plan_id)
            if plan:
                limit = _BITACORA_MONTHLY_LIMITS.get(plan.name, _BITACORA_DEFAULT_LIMIT)
        if limit is None:
            return  # plan ilimitado

        month_start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        # Join por Obra.tenant_id, no por created_by: las entradas de WhatsApp
        # (creadas por staff, pero también en teoría por un Responsible) no
        # deberían depender de quién figura como autor para contar — cuentan
        # todas las entradas de una obra de este tenant, sea cual sea el canal
        # o si created_by quedó NULL. Entradas sin obra_id (WhatsApp con
        # múltiples obras, todavía sin resolver) no cuentan acá; se controlan
        # aparte antes de disparar el análisis, cuando se les asigna la obra.
        used = (await self.session.execute(
            select(func.count())
            .select_from(BitacoraEntry)
            .join(Obra, BitacoraEntry.obra_id == Obra.id)
            .where(Obra.tenant_id == tenant_id, BitacoraEntry.created_at >= month_start)
        )).scalar_one()

        if used >= limit:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=(
                    f"Alcanzaste el límite de {limit} análisis de bitácora con IA de este mes. "
                    "Podés seguir cargando texto a mano o subir de plan para más."
                ),
            )

    # ── CRUD básico ───────────────────────────────────────────────────────────

    async def get_or_raise(self, entry_id: int) -> BitacoraEntry:
        entry = (await self.session.execute(
            select(BitacoraEntry).where(BitacoraEntry.id == entry_id)
        )).scalar_one_or_none()
        if not entry:
            raise NotFoundError("BitacoraEntry", entry_id)
        return entry

    async def get_scoped(
        self, entry_id: int, tenant_id: int | None, user_id: int | None = None
    ) -> BitacoraEntry:
        """Como get_or_raise pero aísla por tenant: una entrada de otra empresa se
        reporta como inexistente (404, no 403). Las entradas sin obra (audios de
        WhatsApp pendientes) solo las maneja quien las creó."""
        entry = await self.get_or_raise(entry_id)
        if tenant_id is None:
            return entry
        if entry.obra_id is None:
            # Entrada sin obra: aislar por creador (staff) o por responsable.
            if entry.created_by is not None:
                if entry.created_by != user_id:
                    raise NotFoundError("BitacoraEntry", entry_id)
                return entry
            if entry.responsible_id is not None:
                resp_tenant = (await self.session.execute(
                    select(Responsible.tenant_id).where(Responsible.id == entry.responsible_id)
                )).scalar_one_or_none()
                if resp_tenant is not None and resp_tenant != tenant_id:
                    raise NotFoundError("BitacoraEntry", entry_id)
            return entry
        obra_tenant = (await self.session.execute(
            select(Obra.tenant_id).where(Obra.id == entry.obra_id)
        )).scalar_one_or_none()
        if obra_tenant is not None and obra_tenant != tenant_id:
            raise NotFoundError("BitacoraEntry", entry_id)
        return entry

    async def list_entries(
        self,
        *,
        tenant_id: int | None = None,
        user_id: int | None = None,
        obra_id: int | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[BitacoraEntry]:
        q = select(BitacoraEntry).order_by(BitacoraEntry.created_at.desc())
        if obra_id is not None:
            q = q.where(BitacoraEntry.obra_id == obra_id)
        if tenant_id is not None:
            # Aislamiento multi-tenant: solo entradas de obras de este tenant. Las
            # entradas sin obra (audios de WhatsApp pendientes de asignar) las ve
            # únicamente quien las creó.
            q = q.outerjoin(Obra, BitacoraEntry.obra_id == Obra.id).where(
                or_(
                    Obra.tenant_id == tenant_id,
                    and_(BitacoraEntry.obra_id.is_(None), BitacoraEntry.created_by == user_id),
                )
            )
        q = q.limit(limit).offset(offset)
        return list((await self.session.execute(q)).scalars().all())

    async def list_unassigned(
        self, *, tenant_id: int | None = None, user_id: int | None = None
    ) -> list[BitacoraEntry]:
        """Notas de voz pendientes de asignar obra (obra_id NULL), scopeadas por tenant
        vía el responsable o el creador. Para que el jefe las asigne a mano si el emisor
        nunca respondió por WhatsApp."""
        from app.models.user import User

        q = (
            select(BitacoraEntry)
            .where(BitacoraEntry.status == "pendiente_obra", BitacoraEntry.obra_id.is_(None))
            .order_by(BitacoraEntry.created_at.desc())
        )
        if tenant_id is not None:
            q = (
                q.outerjoin(Responsible, BitacoraEntry.responsible_id == Responsible.id)
                .outerjoin(User, BitacoraEntry.created_by == User.id)
                .where(or_(Responsible.tenant_id == tenant_id, User.tenant_id == tenant_id))
            )
        return list((await self.session.execute(q)).scalars().all())

    async def list_for_task(
        self, *, task_id: int, tenant_id: int | None = None, user_id: int | None = None
    ) -> list[BitacoraEntry]:
        """Notas de voz cuyas sugerencias aplicadas afectaron a esta tarea (la originaron
        o la modificaron). Trazabilidad tarea → audio.

        Con las sugerencias en tabla propia esto es un join directo; antes había
        que traer todas las entradas de la obra y filtrar el blob en Python.
        """
        obra_id = (await self.session.execute(
            select(Task.obra_id).where(Task.id == task_id)
        )).scalar_one_or_none()
        if obra_id is None:
            return []
        entry_ids = set((await self.session.execute(
            select(Suggestion.source_entry_id).where(
                Suggestion.result_task_id == task_id,
                Suggestion.status == SuggestionStatus.APLICADA,
                Suggestion.source_entry_id.is_not(None),
            )
        )).scalars().all())
        if not entry_ids:
            return []
        entries = await self.list_entries(
            tenant_id=tenant_id, user_id=user_id, obra_id=obra_id, limit=500
        )
        return [e for e in entries if e.id in entry_ids]

    async def pending_suggestions_count(
        self,
        *,
        tenant_id: int | None = None,
        user_id: int | None = None,
        obra_id: int | None = None,
    ) -> int:
        """Sugerencias sin resolver (lo que espera el Sí/No del jefe). Alimenta el
        badge del menú de cada obra.

        Delega en SuggestionService: desde 0072 es un COUNT sobre la tabla, no
        una suma en memoria sobre los blobs de todas las entradas. `user_id`
        queda en la firma porque las entradas sin obra ya no aportan al badge
        —siempre se pide por obra— pero los llamadores lo siguen pasando.
        """
        return await self.suggestions.pending_count(tenant_id=tenant_id, obra_id=obra_id)

    async def create_entry(
        self,
        *,
        obra_id: int | None,
        source: str,
        audio_path: str | None = None,
        transcript: str | None = None,
        responsible_id: int | None = None,
        created_by: int | None = None,
    ) -> BitacoraEntry:
        tenant_id = await self._resolve_tenant_id(obra_id, created_by, responsible_id)
        entry = BitacoraEntry(
            tenant_id=tenant_id,
            obra_id=obra_id,
            source=source,
            audio_path=audio_path,
            transcript=transcript,
            responsible_id=responsible_id,
            created_by=created_by,
            status="pendiente_analisis" if transcript else "pendiente_transcripcion",
        )
        self.session.add(entry)
        await self.session.flush()
        await self.session.refresh(entry)
        return entry

    async def _resolve_tenant_id(
        self, obra_id: int | None, created_by: int | None, responsible_id: int | None
    ) -> int | None:
        """tenant_id para denormalizar en una entrada nueva: de la obra si ya
        tiene una, si no del creador o del responsable (notas de WhatsApp
        todavía sin obra asignada)."""
        from app.core.tenant_denorm import tenant_for_obra

        if obra_id is not None:
            return await tenant_for_obra(self.session, obra_id)
        if created_by is not None:
            from app.models.user import User
            return (await self.session.execute(
                select(User.tenant_id).where(User.id == created_by)
            )).scalar_one_or_none()
        if responsible_id is not None:
            return (await self.session.execute(
                select(Responsible.tenant_id).where(Responsible.id == responsible_id)
            )).scalar_one_or_none()
        return None

    async def transcribe_audio(self, audio_bytes: bytes, filename: str) -> str | None:
        """Wrapper público: transcribe sin analizar (para el flujo de WhatsApp con
        obra pendiente — primero se transcribe, después se elige obra y se analiza).
        Corre en un thread para no bloquear el event loop."""
        return await asyncio.to_thread(self._transcribe, audio_bytes, filename)

    # ── Transcripción (Whisper vía OpenAI API — opcional) ────────────────────

    def _transcribe(self, audio_bytes: bytes, filename: str) -> str | None:
        """Devuelve el texto, o None si Whisper no está configurado."""
        if not settings.OPENAI_API_KEY:
            logger.warning("OPENAI_API_KEY no configurada — transcripción pendiente")
            return None
        resp = requests.post(
            "https://api.openai.com/v1/audio/transcriptions",
            headers={"Authorization": f"Bearer {settings.OPENAI_API_KEY}"},
            files={"file": (filename, audio_bytes)},
            data={"model": settings.WHISPER_MODEL, "language": "es"},
            timeout=120,
        )
        if not resp.ok and filename.lower().endswith(".amr"):
            # docs/auditoria/08-bitacora.md, hallazgo 8.7: WhatsApp en Android
            # viejos manda audio en AMR, que Whisper rechaza. Sin esto el error
            # quedaba genérico ("Error en el procesamiento: ...") sin ninguna
            # pista de qué hacer.
            raise UnprocessableError(
                "Este audio llegó en formato AMR (típico de WhatsApp en celulares Android viejos), "
                "que la transcripción automática no soporta. Pedile al emisor que lo vuelva a mandar, "
                "o cargá el texto a mano con 'Cargar texto'."
            )
        resp.raise_for_status()
        return resp.json().get("text", "").strip() or None

    # ── Análisis con Claude ───────────────────────────────────────────────────

    async def _build_obra_context(self, obra_id: int) -> str:
        """Contexto de la obra para que la IA pueda referenciar tareas reales."""
        obra = (await self.session.execute(select(Obra).where(Obra.id == obra_id))).scalar_one_or_none()
        tasks = (await self.session.execute(
            select(Task).where(Task.obra_id == obra_id).order_by(Task.order_index, Task.id)
        )).scalars().all()
        resp_names: dict[int, str] = {}
        if tasks:
            rids = {t.responsible_id for t in tasks if t.responsible_id}
            if rids:
                for r in (await self.session.execute(
                    select(Responsible).where(Responsible.id.in_(rids))
                )).scalars().all():
                    resp_names[r.id] = r.full_name

        lines = [f"Obra: {obra.name if obra else obra_id}", "Tareas actuales:"]
        for t in tasks:
            lines.append(
                f"- id={t.id} | {t.title} | estado={t.status.value} | "
                f"inicio={t.start_date or '—'} | fin={t.due_date or '—'} | "
                f"responsable={resp_names.get(t.responsible_id, 'sin asignar')}"
            )
        if not tasks:
            lines.append("(sin tareas cargadas)")
        lines.append(await self._calendar_hint(obra_id))
        return "\n".join(lines)

    async def _calendar_hint(self, obra_id: int) -> str:
        """Describe el calendario laboral para que la IA proponga fechas en días hábiles."""
        from app.repositories.calendar import CalendarRepository

        cal = await CalendarRepository(self.session).get_for_obra(obra_id)
        wd = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
        working = [wd[i] for i in range(7) if cal.working_days & (1 << i)]
        today = date.today()
        hols = sorted(
            (e for e in (getattr(cal, "exceptions", []) or []) if not e.is_working and e.date >= today),
            key=lambda e: e.date,
        )[:8]
        hol_str = ", ".join(
            e.date.strftime("%d/%m/%Y") + (f" ({e.label})" if e.label else "") for e in hols
        ) or "ninguno cargado"
        return (
            f"Calendario laboral: se trabaja {', '.join(working) or '—'}. "
            "Las fechas que propongas (inicio o fin) deben caer en días laborales — "
            f"no fines de semana ni feriados. Feriados próximos: {hol_str}."
        )

    async def _analyze(self, transcript: str, obra_id: int | None) -> dict:
        """Llama a Claude con structured output. Lanza si no hay API key."""
        if not settings.ANTHROPIC_API_KEY:
            raise UnprocessableError(
                "ANTHROPIC_API_KEY no está configurada. Agregala al .env del backend para habilitar el análisis con IA."
            )
        import anthropic

        context = await self._build_obra_context(obra_id) if obra_id else "Sin obra asociada — no hay tareas para referenciar."
        today = date.today().isoformat()

        system = (
            "Sos el asistente de bitácora de obra de CONSTRUCTA, una app de gestión de obras de construcción. "
            "Recibís la transcripción de un audio de WhatsApp grabado por el jefe de obra en la obra, donde se "
            "discuten y acuerdan cosas (avances, demoras, problemas, nuevos trabajos, fechas).\n\n"
            "Tu trabajo:\n"
            "1. Resumir lo conversado en 2-4 oraciones claras (español rioplatense, tono profesional).\n"
            "2. Extraer los puntos clave acordados (decisiones, compromisos, problemas detectados).\n"
            "3. Detectar acciones concretas sobre el plan de obra y proponerlas como sugerencias:\n"
            "   - reschedule_task: si se habló de mover/atrasar/adelantar fechas de una tarea EXISTENTE "
            "(usá el id exacto de la lista de tareas; calculá fechas concretas YYYY-MM-DD a partir de hoy).\n"
            "   - create_task: si se acordó un trabajo nuevo que no está en la lista.\n"
            "   - update_status: si se dijo que una tarea está terminada, empezada, frenada o cancelada.\n"
            "   - note: para acuerdos importantes que no mapean a una tarea (quedan como registro).\n\n"
            "Reglas:\n"
            f"- Hoy es {today}. Interpretá expresiones relativas ('la semana que viene', 'el lunes') contra esa fecha.\n"
            "- DIRECCIÓN DEL MOVIMIENTO: en obra, 'correr/mover la fecha para atrás', 'para adelante', 'patearla' "
            "y 'adelantarla' se usan de forma ambigua y contradictoria según quién habla. NO decidas la dirección "
            "por esas palabras: decidila por la CAUSA que se menciona. Si la causa es un problema o una demora "
            "(lluvia, material que no llegó, proveedor atrasado, falta de personal, una tarea previa sin terminar), "
            "la fecha se va MÁS TARDE — nunca más temprano. Solo proponé una fecha ANTERIOR a la actual si el audio "
            "dice explícitamente que algo se terminó antes, se liberó el frente o se quiere ganar tiempo. "
            "Si la dirección sigue sin quedar clara, no propongas reschedule_task: dejá una 'note' con lo que se dijo.\n"
            "- En el resumen y los puntos clave NO uses 'adelantar', 'para adelante' ni 'para atrás': son las "
            "palabras ambiguas. Describí el efecto sobre el cronograma — 'se corre N días más tarde', "
            "'pasa del X al Y', 'se termina antes' — para que el texto no contradiga a la sugerencia.\n"
            "- No propongas cambios que dejen la tarea como ya está (p. ej. marcar 'completada' una tarea que el "
            "contexto ya muestra completada), ni reprogrames una tarea ya completada o cancelada: en esos casos "
            "dejá una 'note' con lo que se dijo.\n"
            "- Solo sugerí acciones que el audio respalde claramente; en 'reason' citá la frase que lo justifica "
            "Y, si proponés mover una fecha, nombrá la causa que fija la dirección.\n"
            "- Si una tarea mencionada no matchea ninguna de la lista, NUNCA inventes un task_id. Qué hacer "
            "depende de lo que afirme el audio: si propone un trabajo NUEVO ('arrancamos una tarea de...', "
            "'hay que sumar...'), usá create_task; si habla de la tarea como si ya existiera ('hay que correr "
            "la tarea de ascensores'), dejá una 'note' diciendo que no se encontró — puede ser que la tarea "
            "esté con otro nombre o que falte cargarla, y adivinar cuál es sería peor que preguntar.\n"
            "- Para reschedule_task completá SOLO la fecha que se discutió: si se habló de la entrega/fin, mandá "
            "new_due_date y dejá new_start_date en null; si se habló del inicio, mandá new_start_date y dejá "
            "new_due_date en null. No completes una fecha que el audio no mencionó.\n"
            "- NO CALCULES DÍAS HÁBILES. Si el audio habla en relativo ('dos días', 'una semana', "
            "'para el lunes que viene'), NO devuelvas una fecha: devolvé `shift_working_days` con el "
            "corrimiento en días laborales y `shift_target` "
            "con la fecha que se corre. Lo que decide `shift_target` es QUÉ PUNTA NOMBRA el audio. "
            "Preguntate: ¿el audio dijo 'inicio' o 'fin'? Si no dijo ninguno, es 'both'.\n"
            "    · 'both' — POR DEFECTO. El audio habla de la tarea, no de una de sus fechas: 'el revoque se "
            "atrasa dos días', 'esto se corre una semana', 'se demora porque no llegó el material'. La tarea "
            "se mueve entera y conserva su duración. Ante la duda, 'both'.\n"
            "    · 'start' — el audio nombra el arranque: 'empieza tres días después', 'lo arrancamos antes', "
            "'se demora el comienzo'. Se mueve el inicio; el vencimiento QUEDA COMO ESTÁ.\n"
            "    · 'due' — el audio nombra la entrega o el vencimiento: 'lo entregamos dos días más tarde', "
            "'la fecha de fin se corre'. Se mueve el fin; el inicio QUEDA COMO ESTÁ. Ojo: esto afirma que la "
            "tarea DURA MÁS, que es distinto de que se atrase.\n"
            "Nunca muevas una punta que el audio no nombró: la persona espera encontrar intacta la fecha de la "
            "que nadie habló. El backend calcula la fecha resultante con "
            "el calendario real de la obra, que es el único que conoce los feriados. "
            "Una semana son 5 días laborales; una quincena, 10.\n"
            "- EL SIGNO DE `shift_working_days` LO FIJA LA CAUSA, igual que la dirección: si el motivo es una "
            "demora o un problema, el signo es POSITIVO (la fecha se va más tarde) por más que la frase diga "
            "'para atrás'. Solo usá signo negativo cuando el audio dice que algo se terminó antes, se liberó "
            "el frente o se quiere ganar tiempo. Ante la duda, positivo si hay una causa de atraso; y si no "
            "hay causa clara, no propongas reschedule_task.\n"
            "- Devolvé `new_start_date`/`new_due_date` SOLO cuando el audio nombra una fecha concreta "
            "('el 20 de julio', 'el 3 del mes que viene'). En ese caso dejá `shift_working_days` en null. "
            "Nunca completes las dos cosas para la misma fecha. Y completá solo la fecha que el audio nombra: la que no se menciona NO se toca, la tarea la conserva.\n"
            "- Si igualmente proponés una fecha concreta, que caiga en día laboral según el calendario del "
            "contexto: evitá sábados, domingos y feriados.\n"
            "- Si el audio no contiene nada accionable, devolvé suggestions vacío — no fuerces sugerencias."
        )

        user_msg = f"CONTEXTO DE LA OBRA:\n{context}\n\nTRANSCRIPCIÓN DEL AUDIO:\n{transcript}"

        client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        response = await client.messages.create(
            model=settings.CLAUDE_MODEL,
            max_tokens=4096,
            system=system,
            messages=[{"role": "user", "content": user_msg}],
            output_config={"format": {"type": "json_schema", "schema": _ANALYSIS_SCHEMA}},
        )
        if response.stop_reason == "refusal":
            raise UnprocessableError("El modelo rechazó el análisis de este audio.")
        if response.stop_reason == "max_tokens":
            raise UnprocessableError(
                "El audio es demasiado largo para analizarlo de una sola vez. "
                "Probá dividirlo en notas más cortas."
            )
        text = next((b.text for b in response.content if b.type == "text"), None)
        if not text:
            raise UnprocessableError("El modelo no devolvió un análisis.")
        return json.loads(text)

    # ── Generación de sugerencias ─────────────────────────────────────────────

    @staticmethod
    def _iso_date(value) -> date | None:
        """La IA devuelve fechas como texto. Lo que no parsea se descarta acá y
        no llega a la fila — la sugerencia queda sin esa fecha en vez de romper
        el análisis entero."""
        if not value or not isinstance(value, str):
            return None
        try:
            return date.fromisoformat(value[:10])
        except ValueError:
            logger.warning("La IA propuso una fecha inválida: %r", value)
            return None

    async def _resolve_dates(
        self, s: dict, obra_id: int | None
    ) -> tuple[date | None, date | None]:
        """Convierte el corrimiento relativo que propuso la IA en fechas concretas.

        Contar días hábiles salteando feriados no es algo que un modelo de
        lenguaje haga bien: en una prueba, "dos días" sobre un viernes dio tres
        días laborales. Ahora el modelo declara la INTENCIÓN
        (`shift_working_days` + `shift_target`) y la cuenta la hace el backend
        con el calendario real de la obra, que además es el único que conoce
        sus feriados y sus días no laborables propios.

        Si el audio nombró una fecha concreta, el modelo la manda directo y acá
        no hay nada que calcular.
        """
        inicio = self._iso_date(s.get("new_start_date"))
        fin = self._iso_date(s.get("new_due_date"))

        shift = s.get("shift_working_days")
        if not isinstance(shift, int) or shift == 0 or not obra_id or not s.get("task_id"):
            return inicio, fin
        # Una fecha explícita gana: es más específica que un corrimiento.
        target = s.get("shift_target") or "due"
        if (inicio and target in ("start", "both")) and (fin and target in ("due", "both")):
            return inicio, fin

        task = (await self.session.execute(
            select(Task).where(Task.id == s["task_id"])
        )).scalar_one_or_none()
        if task is None:
            return inicio, fin

        from app.repositories.calendar import CalendarRepository
        from app.services.calendar_service import add_working_days

        cal = await CalendarRepository(self.session).get_for_obra(obra_id)
        if target in ("start", "both") and inicio is None and task.start_date:
            inicio = add_working_days(cal, task.start_date, shift)
        if target in ("due", "both") and fin is None and task.due_date:
            fin = add_working_days(cal, task.due_date, shift)
        return inicio, fin

    async def _replace_pending_suggestions(
        self, entry: BitacoraEntry, payload: list[dict]
    ) -> list[Suggestion]:
        """Reemplaza las sugerencias sin resolver por las del análisis nuevo.

        Las ya aplicadas o descartadas NO se tocan: son el registro de una
        decisión que se tomó (y, si se aplicó, de un cambio real en la obra).
        Reprocesar reemplazaba el blob entero y borraba ese rastro — es el
        hallazgo N6 de docs/auditoria/08-bitacora.md, que la ruta cubre con un
        guard; acá queda cubierto también en el modelo.
        """
        conservadas = [
            r for r in entry.suggestion_rows if r.status != SuggestionStatus.PENDIENTE
        ]
        # delete-orphan: sacarlas de la colección las borra de la base.
        entry.suggestion_rows[:] = conservadas

        nuevas: list[Suggestion] = []
        for i, s in enumerate(payload):
            try:
                stype = SuggestionType(s.get("type"))
            except ValueError:
                logger.warning("La IA propuso un tipo desconocido: %r", s.get("type"))
                continue
            inicio, fin = await self._resolve_dates(s, entry.obra_id)
            nuevas.append(
                Suggestion(
                    tenant_id=entry.tenant_id,
                    obra_id=entry.obra_id,
                    source="bitacora",
                    order_index=len(conservadas) + i,
                    type=stype,
                    task_id=s.get("task_id"),
                    task_title=s.get("task_title"),
                    new_start_date=inicio,
                    new_due_date=fin,
                    new_status=s.get("new_status"),
                    title=s.get("title"),
                    description=s.get("description"),
                    responsible_name=s.get("responsible_name"),
                    reason=s.get("reason") or "",
                    status=SuggestionStatus.PENDIENTE,
                )
            )
        entry.suggestion_rows.extend(nuevas)
        await self.session.flush()
        return nuevas

    # ── Pipeline completo ─────────────────────────────────────────────────────

    async def process_entry(
        self, entry: BitacoraEntry, audio_bytes: bytes | None = None, filename: str = "audio.ogg"
    ) -> BitacoraEntry:
        """Transcribe (si hay audio y falta texto) y analiza. Nunca lanza:
        deja el estado y el error en la entrada."""
        try:
            if not entry.transcript and audio_bytes:
                text = await asyncio.to_thread(self._transcribe, audio_bytes, filename)
                if text:
                    entry.transcript = text
                    entry.status = "pendiente_analisis"
                else:
                    entry.status = "pendiente_transcripcion"
                    entry.error = (
                        "Transcripción automática no disponible (falta OPENAI_API_KEY). "
                        "Podés escribir el texto a mano con 'Cargar texto'."
                    )
                    await self.session.flush()
                    return entry

            if entry.transcript:
                analysis = await self._analyze(entry.transcript, entry.obra_id)
                entry.summary = analysis.get("summary")
                entry.key_points = analysis.get("key_points") or []
                nuevas = await self._replace_pending_suggestions(
                    entry, analysis.get("suggestions") or []
                )
                entry.status = "procesado"
                entry.error = None
                entry.processed_at = datetime.now(timezone.utc)

                if entry.obra_id:
                    n = len([s for s in nuevas if s.type != SuggestionType.NOTE])
                    await self.historial.log(
                        event_type="bitacora_procesada",
                        description=(
                            f"Bitácora #{entry.id} procesada: {entry.summary[:140] if entry.summary else 'sin resumen'}"
                            + (f" ({n} acción{'es' if n != 1 else ''} sugerida{'s' if n != 1 else ''})" if n else "")
                        ),
                        obra_id=entry.obra_id,
                        payload={"entry_id": entry.id, "suggestions_count": len(nuevas)},
                        triggered_by="system",
                    )
                    # Aviso en tiempo real al jefe (toast): llegó una nota de voz.
                    reporter = None
                    if entry.responsible_id:
                        reporter = (await self.session.execute(
                            select(Responsible.full_name).where(Responsible.id == entry.responsible_id)
                        )).scalar_one_or_none()
                    from app.core.socket_manager import emit_bitacora_created
                    await emit_bitacora_created(
                        obra_id=entry.obra_id,
                        entry_id=entry.id,
                        summary=entry.summary,
                        reporter_name=reporter,
                        actor_id=entry.created_by,
                        source=entry.source,
                    )
        except UnprocessableError as exc:
            entry.status = "pendiente_analisis" if entry.transcript else entry.status
            entry.error = str(exc.detail) if hasattr(exc, "detail") else str(exc)
        except Exception as exc:
            logger.exception("Error procesando bitácora %s", entry.id)
            entry.status = "error"
            entry.error = f"Error en el procesamiento: {exc}"

        await self.session.flush()
        return entry

    # ── Sugerencias: la bitácora las genera, SuggestionService las resuelve ───
    #
    # Estos dos métodos existen para las rutas legacy por índice
    # (`/bitacora/{id}/suggestions/{idx}/...`). La lógica de aplicar vive en
    # SuggestionService, que es a donde apuntan las rutas nuevas por id.

    async def apply_suggestion(
        self, entry_id: int, index: int, manager_id: int, actor: dict | None = None,
        edits: dict | None = None,
    ) -> BitacoraEntry:
        entry = await self.get_or_raise(entry_id)
        suggestion = await self.suggestions.get_by_entry_index(entry_id, index)
        await self.suggestions.apply(suggestion, manager_id, actor=actor, edits=edits)
        await self.session.refresh(entry)
        return entry

    async def dismiss_suggestion(
        self, entry_id: int, index: int, user_id: int | None = None
    ) -> BitacoraEntry:
        entry = await self.get_or_raise(entry_id)
        suggestion = await self.suggestions.get_by_entry_index(entry_id, index)
        await self.suggestions.dismiss(suggestion, user_id)
        await self.session.refresh(entry)
        return entry

    async def reassign_obra(self, entry: BitacoraEntry, obra_id: int, tenant_id: int | None) -> None:
        """Al mover la nota de obra, las sugerencias sin resolver se mueven con
        ella. Si quedaran apuntando a la obra vieja, el guard por obra de la ruta
        las dejaría inaccesibles desde la nota."""
        for row in entry.suggestion_rows:
            if row.status == SuggestionStatus.PENDIENTE:
                row.obra_id = obra_id
                row.tenant_id = tenant_id
        await self.session.flush()
