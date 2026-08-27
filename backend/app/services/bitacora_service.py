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
from app.models.task import Task, TaskStatus
from app.repositories.historial import HistorialRepository
from app.schemas.task import TaskCreate, TaskStatusUpdate, TaskUpdate
from app.services.task_service import TaskService

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
                    "new_start_date": {"type": ["string", "null"], "description": "YYYY-MM-DD"},
                    "new_due_date": {"type": ["string", "null"], "description": "YYYY-MM-DD"},
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
        o la modificaron). Trazabilidad tarea → audio."""
        obra_id = (await self.session.execute(
            select(Task.obra_id).where(Task.id == task_id)
        )).scalar_one_or_none()
        if obra_id is None:
            return []
        entries = await self.list_entries(
            tenant_id=tenant_id, user_id=user_id, obra_id=obra_id, limit=500
        )
        return [
            e for e in entries
            if any(
                s.get("applied") and s.get("result_task_id") == task_id
                for s in (e.suggestions or [])
            )
        ]

    async def pending_suggestions_count(
        self,
        *,
        tenant_id: int | None = None,
        user_id: int | None = None,
        obra_id: int | None = None,
    ) -> int:
        """Cantidad de sugerencias sin aplicar ni descartar (lo que espera el Sí/No
        del jefe). Scopeado por tenant y, si se pasa obra_id, por esa obra (el badge
        es por obra). Alimenta el badge del menú de cada obra."""
        q = select(BitacoraEntry.suggestions).where(BitacoraEntry.status == "procesado")
        if obra_id is not None:
            q = q.where(BitacoraEntry.obra_id == obra_id)
        if tenant_id is not None:
            q = q.outerjoin(Obra, BitacoraEntry.obra_id == Obra.id).where(
                or_(
                    Obra.tenant_id == tenant_id,
                    and_(BitacoraEntry.obra_id.is_(None), BitacoraEntry.created_by == user_id),
                )
            )
        rows = (await self.session.execute(q)).scalars().all()
        total = 0
        for suggestions in rows:
            if suggestions:
                total += sum(
                    1 for s in suggestions if not s.get("applied") and not s.get("dismissed")
                )
        return total

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
            "- Solo sugerí acciones que el audio respalde claramente; en 'reason' citá la frase que lo justifica.\n"
            "- Si una tarea mencionada no matchea ninguna de la lista, usá create_task (no inventes task_id).\n"
            "- Para reschedule_task completá SOLO la fecha que se discutió: si se habló de la entrega/fin, mandá "
            "new_due_date y dejá new_start_date en null; si se habló del inicio, mandá new_start_date y dejá "
            "new_due_date en null. No completes una fecha que el audio no mencionó.\n"
            "- Las fechas que propongas (inicio o fin) deben caer en días laborales según el calendario del contexto: "
            "evitá sábados, domingos y feriados.\n"
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
                entry.suggestions = [
                    {**s, "applied": False, "dismissed": False, "result_task_id": None, "result_note": None}
                    for s in (analysis.get("suggestions") or [])
                ]
                entry.status = "procesado"
                entry.error = None
                entry.processed_at = datetime.now(timezone.utc)

                if entry.obra_id:
                    n = len([s for s in entry.suggestions if s["type"] != "note"])
                    await self.historial.log(
                        event_type="bitacora_procesada",
                        description=(
                            f"Bitácora #{entry.id} procesada: {entry.summary[:140] if entry.summary else 'sin resumen'}"
                            + (f" ({n} acción{'es' if n != 1 else ''} sugerida{'s' if n != 1 else ''})" if n else "")
                        ),
                        obra_id=entry.obra_id,
                        payload={"entry_id": entry.id, "suggestions_count": len(entry.suggestions or [])},
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

    # ── Aplicar sugerencias ───────────────────────────────────────────────────

    async def _assert_task_in_entry_obra(self, task_id: int, entry_obra_id: int | None) -> None:
        """`apply_suggestion` delega en TaskService, que solo valida tenant —
        nunca el rol por-obra del usuario. Si la sugerencia quedó apuntando a
        una tarea de OTRA obra (p. ej. la entrada se reasignó con assign_obra
        y las sugerencias no se limpiaron), alguien con acceso solo a la obra
        de la entrada podría mutar una tarea de una obra en la que no tiene
        ningún rol. Ver audit 08-bitácora, hallazgo N2."""
        task_obra_id = (await self.session.execute(
            select(Task.obra_id).where(Task.id == task_id)
        )).scalar_one_or_none()
        if task_obra_id is not None and task_obra_id != entry_obra_id:
            raise UnprocessableError(
                "Esta sugerencia quedó desactualizada — la tarea que referencia ya no "
                "pertenece a la obra de esta nota. Reprocesá la entrada para generar "
                "sugerencias al día."
            )

    def _parse_edit_date(self, value: str | None, label: str) -> date | None:
        """`date.fromisoformat` sin capturar dejaba un `ValueError` sin manejar
        —500 opaco— cuando el jefe editaba la sugerencia con una fecha mal
        escrita antes de aplicarla. Ver audit 08-bitácora, hallazgo N5."""
        if not value:
            return None
        try:
            return date.fromisoformat(value)
        except ValueError:
            raise UnprocessableError(f"'{value}' no es una fecha válida para {label} (formato AAAA-MM-DD).")

    def _parse_edit_status(self, value: str) -> TaskStatus:
        try:
            return TaskStatus(value)
        except ValueError:
            valid = ", ".join(t.value for t in TaskStatus)
            raise UnprocessableError(f"'{value}' no es un estado válido de tarea (opciones: {valid}).")

    async def apply_suggestion(
        self, entry_id: int, index: int, manager_id: int, actor: dict | None = None,
        edits: dict | None = None,
    ) -> BitacoraEntry:
        entry = await self.get_or_raise(entry_id)
        suggestions = list(entry.suggestions or [])
        if index < 0 or index >= len(suggestions):
            raise NotFoundError("Sugerencia", index)
        s = dict(suggestions[index])
        if s.get("applied"):
            return entry
        if not entry.obra_id:
            raise UnprocessableError("Asigná la entrada a una obra antes de aplicar sugerencias.")

        # El jefe puede ajustar la sugerencia antes de aplicarla (la IA propone, él decide).
        if edits:
            for k in ("new_start_date", "new_due_date", "new_status", "title", "responsible_name", "description"):
                if k in edits:
                    s[k] = edits[k]

        task_service = TaskService(self.session)
        stype = s.get("type")

        if stype == "reschedule_task":
            if not s.get("task_id"):
                raise UnprocessableError("La sugerencia no referencia una tarea válida.")
            await self._assert_task_in_entry_obra(s["task_id"], entry.obra_id)
            update = TaskUpdate(
                start_date=self._parse_edit_date(s.get("new_start_date"), "la fecha de inicio"),
                due_date=self._parse_edit_date(s.get("new_due_date"), "la fecha de fin"),
            )
            # cascade_dates=True: si la tarea tiene dependientes, se corren en cadena
            updated = await task_service.update(s["task_id"], update, manager_id, actor=actor, cascade_dates=True)
            s["result_task_id"] = s["task_id"]
            if getattr(updated, "_date_adjustment", None):
                s["result_note"] = updated._date_adjustment

        elif stype == "create_task":
            responsible_id = None
            if s.get("responsible_name"):
                # Responsible es global por tenant (ya no tiene obra_id): matchear por
                # nombre dentro del tenant de la obra. Si no hay match, la tarea se crea
                # sin responsable (no es un error).
                obra_tenant = (await self.session.execute(
                    select(Obra.tenant_id).where(Obra.id == entry.obra_id)
                )).scalar_one_or_none()
                q = select(Responsible).where(
                    Responsible.is_active == True,  # noqa: E712
                    Responsible.full_name.ilike(f"%{s['responsible_name']}%"),
                )
                if obra_tenant is not None:
                    q = q.where(Responsible.tenant_id == obra_tenant)
                resp = (await self.session.execute(q)).scalars().first()
                responsible_id = resp.id if resp else None
            created = await task_service.create(
                TaskCreate(
                    obra_id=entry.obra_id,
                    title=s.get("title") or "Tarea desde bitácora",
                    description=(s.get("description") or "") + f"\n\n[Origen: bitácora #{entry.id}]",
                    start_date=self._parse_edit_date(s.get("new_start_date"), "la fecha de inicio"),
                    due_date=self._parse_edit_date(s.get("new_due_date"), "la fecha de fin"),
                    responsible_id=responsible_id,
                ),
                manager_id,
                actor=actor,
            )
            s["result_task_id"] = created.id
            if getattr(created, "_date_adjustment", None):
                s["result_note"] = created._date_adjustment

        elif stype == "update_status":
            if not s.get("task_id") or not s.get("new_status"):
                raise UnprocessableError("La sugerencia no tiene tarea o estado válido.")
            await self._assert_task_in_entry_obra(s["task_id"], entry.obra_id)
            await task_service.apply_status_update_checked(
                s["task_id"],
                TaskStatusUpdate(
                    status=self._parse_edit_status(s["new_status"]),
                    triggered_by="user",
                    reason=f"Bitácora #{entry.id}: {s.get('reason', '')[:200]}",
                ),
                manager_id,
            )
            s["result_task_id"] = s["task_id"]

        elif stype == "note":
            await self.historial.log(
                event_type="bitacora_nota",
                description=s.get("reason") or s.get("description") or "Nota de bitácora",
                obra_id=entry.obra_id,
                payload={"entry_id": entry.id},
                triggered_by="user",
            )

        s["applied"] = True
        suggestions[index] = s
        entry.suggestions = suggestions  # reasignar para que SQLAlchemy detecte el cambio
        await self.session.flush()
        # Cierra el loop: avisa por WhatsApp al que mandó la nota que su reporte se aplicó.
        await self._notify_reporter(entry, self._confirmation_text(s, (actor or {}).get("name")), manager_id)
        return entry

    async def dismiss_suggestion(self, entry_id: int, index: int) -> BitacoraEntry:
        entry = await self.get_or_raise(entry_id)
        suggestions = list(entry.suggestions or [])
        if index < 0 or index >= len(suggestions):
            raise NotFoundError("Sugerencia", index)
        s = dict(suggestions[index])
        s["dismissed"] = True
        suggestions[index] = s
        entry.suggestions = suggestions
        await self.session.flush()
        return entry

    def _fmt_date(self, iso: str | None) -> str:
        if not iso:
            return ""
        try:
            return date.fromisoformat(iso).strftime("%d/%m/%Y")
        except ValueError:
            return iso

    def _confirmation_text(self, s: dict, actor_name: str | None) -> str:
        who = f"{actor_name} " if actor_name else ""
        t = s.get("type")
        if t == "reschedule_task":
            ref = s.get("task_title") or f"tarea #{s.get('task_id')}"
            partes = []
            if s.get("new_start_date"):
                partes.append(f"inicio {self._fmt_date(s['new_start_date'])}")
            if s.get("new_due_date"):
                partes.append(f"fin {self._fmt_date(s['new_due_date'])}")
            extra = f": {' · '.join(partes)}" if partes else ""
            return f"✅ {who}reprogramó «{ref}»{extra} a partir de tu nota de voz."
        if t == "create_task":
            return f"✅ {who}creó la tarea «{s.get('title') or 'nueva tarea'}» a partir de tu nota de voz."
        if t == "update_status":
            ref = s.get("task_title") or f"tarea #{s.get('task_id')}"
            estado = (s.get("new_status") or "").replace("_", " ")
            return f"✅ {who}marcó «{ref}» como {estado} a partir de tu nota de voz."
        return f"✅ {who}registró tu nota en la bitácora de la obra. ¡Gracias!"

    async def _notify_reporter(self, entry: BitacoraEntry, text: str, manager_id: int | None) -> None:
        """Avisa por WhatsApp a quien mandó la nota (salvo que sea quien está aplicando).
        Nunca rompe el flujo si el envío falla."""
        from app.integrations.twilio.client import send_whatsapp_message
        from app.models.obra import Obra
        from app.models.tenant_membership import TenantMembership
        number = None
        if entry.responsible_id is not None:
            number = (await self.session.execute(
                select(Responsible.whatsapp_number).where(Responsible.id == entry.responsible_id)
            )).scalar_one_or_none()
        elif entry.created_by is not None and entry.created_by != manager_id:
            # whatsapp_number vive en TenantMembership (Fase 3) — resolvemos
            # la membership de la obra de la entrada si la tiene; si no,
            # cualquiera de sus membership sirve para este best-effort.
            stmt = select(TenantMembership.whatsapp_number).where(
                TenantMembership.user_id == entry.created_by
            )
            if entry.obra_id is not None:
                obra_tenant_id = (await self.session.execute(
                    select(Obra.tenant_id).where(Obra.id == entry.obra_id)
                )).scalar_one_or_none()
                if obra_tenant_id is not None:
                    stmt = stmt.where(TenantMembership.tenant_id == obra_tenant_id)
            number = (await self.session.execute(stmt)).scalars().first()
        if not number:
            return
        try:
            await send_whatsapp_message(number, text)
        except Exception:
            logger.exception("No se pudo notificar al emisor de la bitácora %s", entry.id)
