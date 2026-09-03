"""Resumen semanal por WhatsApp para el staff que maneja obras (lunes).

Distinto del resumen que reciben los responsables: a ellos les importa "mis
tareas de esta semana"; a quien maneja la obra le importa "cómo vienen mis
obras" — qué está trabado, qué se atrasó y dónde meter mano. **Los responsables
no reciben este mensaje.**

Destinatario: el `manager_id` de cada obra activa. Cada persona recibe **un solo
mensaje** con todas las obras que maneja.

Como en el motor de insights, **la IA redacta pero no calcula**: los números se
computan acá con SQL/Python y el modelo solo recibe ese resumen ya hecho. Todo
número que escriba se valida contra los datos antes de mandarlo, y si no pasa la
validación (o si la IA no está disponible) se manda igual una versión armada por
código — un lunes sin mensaje es peor que un mensaje sin adornos.
"""
import json
import logging
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.alert import Alert
from app.models.obra import Obra, ObraStatus
from app.models.task import Task, TaskStatus, task_dependencies_table
from app.models.user import User
from app.repositories.settings import SettingsRepository
from app.services.calendar_service import is_within_send_window
from app.services.obra_insight_service import (
    collect_numbers,
    _number_is_supported,
    _numbers_in_text,
    collect_strings,
)

logger = logging.getLogger(__name__)

_AR_TZ = ZoneInfo("America/Argentina/Buenos_Aires")

# Tope de caracteres del mensaje: es un WhatsApp que se lee en el teléfono un
# lunes a la mañana, no un informe. Si la IA se pasa, se cae al texto de código.
MAX_CHARS = 900

SYSTEM_PROMPT = """\
Escribís el mensaje de WhatsApp que recibe el lunes a la mañana quien maneja una \
o varias obras de construcción (el arquitecto o el dueño de la empresa). Lo lee \
en el teléfono, entre dos cosas, y tiene que saber en diez segundos dónde meter \
mano esta semana.

REGLA MÁS IMPORTANTE: vos redactás, NO calculás. Cada número que escribas tiene \
que estar literalmente en el JSON que te paso. No sumes, no promedies, no saques \
porcentajes por tu cuenta. Un número inventado invalida el mensaje entero.

CÓMO ESCRIBIR:
- Es un WhatsApp, no un informe: MÁXIMO 8 líneas en total, sin encabezados largos.
- Arrancá con "👋 ¡Buen lunes, {nombre}!" y una línea en blanco.
- Una línea por obra con lo esencial, usando emojis como viñeta (🔴 trabado, \
⏰ vencido, 📅 vence esta semana).
- Cerrá con UNA línea sobre lo más urgente de todo: qué conviene destrabar primero \
y por qué. Si hay un cuello de botella (una tarea trabada que frena a varias), ese \
es el cierre.
- Español rioplatense, directo. Nada de "es importante destacar" ni jerga de consultora.
- No expliques cómo se calculó nada.
- Si una obra no tiene nada para reportar, no la menciones.

No uses formato markdown (nada de ** o #): WhatsApp no lo renderiza.
"""

_SCHEMA = {
    "type": "object",
    "properties": {
        "message": {
            "type": "string",
            "description": "El mensaje completo de WhatsApp, listo para enviar",
        }
    },
    "required": ["message"],
    "additionalProperties": False,
}


class StaffDigestService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.settings_repo = SettingsRepository(session)

    # ── API pública ───────────────────────────────────────────────────────────

    async def send_weekly_digests(self) -> int:
        """Manda el resumen a cada manager con obras activas. Devuelve cuántos salieron."""
        from app.services.notification_service import NotificationService

        now = datetime.now(timezone.utc)
        hoy = now.astimezone(_AR_TZ).date()
        lunes = hoy - timedelta(days=hoy.weekday())
        domingo = lunes + timedelta(days=6)

        notifier = NotificationService(self.session)
        enviados = 0

        for user, obras in (await self._managers_con_obras()).items():
            if not user.whatsapp_number or not user.is_active:
                continue

            ultimo = user.last_weekly_digest_at
            if ultimo is not None:
                ultimo_utc = ultimo if ultimo.tzinfo else ultimo.replace(tzinfo=timezone.utc)
                if ultimo_utc.astimezone(_AR_TZ).date() >= lunes:
                    continue

            if user.tenant_id is None:
                continue
            cfg = await self.settings_repo.get_or_create(user.tenant_id)
            if not cfg.chatbot_enabled:
                logger.debug("staff digest: chatbot apagado para el tenant %s", user.tenant_id)
                continue
            if not is_within_send_window(cfg.send_hour_from, cfg.send_hour_to, now):
                continue

            datos = await self._recolectar(obras, hoy, domingo)
            if not datos["obras"]:
                continue    # nada que reportar en ninguna de sus obras

            body = await self._redactar(user.full_name, datos)
            try:
                await notifier.notify_staff(user, body, notification_type="staff_weekly_digest")
                user.last_weekly_digest_at = now
                enviados += 1
                logger.info(
                    "Resumen semanal de staff enviado a %s (%d obras)",
                    user.whatsapp_number, len(datos["obras"]),
                )
            except Exception:
                logger.exception("Falló el resumen de staff de %s", user.whatsapp_number)

        await self.session.flush()
        return enviados

    # ── Datos (determinístico) ────────────────────────────────────────────────

    async def _managers_con_obras(self) -> dict[User, list[Obra]]:
        """Cada manager con la lista de obras activas que maneja."""
        obras = list((await self.session.execute(
            select(Obra).where(Obra.status.notin_([ObraStatus.COMPLETADA, ObraStatus.CANCELADA]))
        )).scalars().all())

        por_manager: dict[int, list[Obra]] = defaultdict(list)
        for o in obras:
            if o.manager_id:
                por_manager[o.manager_id].append(o)

        out: dict[User, list[Obra]] = {}
        for manager_id, lista in por_manager.items():
            user = await self.session.get(User, manager_id)
            if user is not None:
                out[user] = lista
        return out

    async def _recolectar(
        self, obras: list[Obra], hoy: date, domingo: date
    ) -> dict[str, Any]:
        """Los números de la semana, calculados acá. Es el único input de la IA."""
        resumen: list[dict[str, Any]] = []

        for obra in obras:
            tareas = list((await self.session.execute(
                select(Task).where(
                    Task.obra_id == obra.id,
                    Task.status.notin_([TaskStatus.COMPLETADA, TaskStatus.CANCELADA]),
                )
            )).scalars().all())

            bloqueadas = [t for t in tareas if t.status == TaskStatus.BLOQUEADA]
            vencidas = [t for t in tareas if t.due_date and t.due_date < hoy
                        and t.status != TaskStatus.BLOQUEADA]
            esta_semana = [t for t in tareas if t.due_date and hoy <= t.due_date <= domingo
                           and t.status != TaskStatus.BLOQUEADA]

            alertas = (await self.session.execute(
                select(Alert).where(Alert.obra_id == obra.id, Alert.is_read.is_(False))
            )).scalars().all()

            if not (bloqueadas or vencidas or esta_semana):
                continue    # esta obra no tiene nada para contar

            cuello = await self._cuello_de_botella(bloqueadas + vencidas)
            resumen.append({
                "obra": obra.name,
                "bloqueadas": len(bloqueadas),
                "vencidas": len(vencidas),
                "vencen_esta_semana": len(esta_semana),
                "alertas_sin_resolver": len(alertas),
                "cuello_de_botella": cuello,
            })

        return {"obras": resumen}

    async def _cuello_de_botella(self, candidatas: list[Task]) -> dict[str, Any] | None:
        """La tarea trabada que más tareas frena. None si ninguna frena a otra.

        Se mide por dependientes directas: una tarea atrasada que bloquea a tres
        vale mucho más que una aislada con el mismo atraso.
        """
        mejor = None
        for t in candidatas:
            dependientes = (await self.session.execute(
                select(task_dependencies_table.c.task_id)
                .where(task_dependencies_table.c.depends_on_id == t.id)
            )).scalars().all()
            n = len({d for d in dependientes if d is not None})
            if n and (mejor is None or n > mejor["frena"]):
                mejor = {
                    "tarea": t.title,
                    "frena": n,
                    "estado": t.status.value,
                    "vencio": t.due_date.isoformat() if t.due_date else None,
                }
        return mejor

    # ── Redacción ─────────────────────────────────────────────────────────────

    async def _redactar(self, nombre: str, datos: dict[str, Any]) -> str:
        """Texto del mensaje. Intenta con IA; si falla o no valida, usa el de código."""
        respaldo = self._texto_de_respaldo(nombre, datos)

        if not settings.ANTHROPIC_API_KEY:
            logger.info("staff digest: sin ANTHROPIC_API_KEY, se manda el texto de código")
            return respaldo

        try:
            texto = await self._call_model(nombre, datos)
        except Exception:
            logger.exception("staff digest: falló la IA, se manda el texto de código")
            return respaldo

        problema = self._validar(texto, datos)
        if problema:
            logger.warning(
                "staff digest: el texto de la IA no pasó la validación (%s) — se manda el de código",
                problema,
            )
            return respaldo
        return texto

    async def _call_model(self, nombre: str, datos: dict[str, Any]) -> str:
        import anthropic

        client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        user_msg = (
            f"El destinatario se llama {nombre}.\n\n"
            "Estos son los números de sus obras, ya calculados. Es tu única fuente:\n\n"
            + json.dumps(datos, ensure_ascii=False, indent=2)
        )
        response = await client.messages.create(
            model=settings.CLAUDE_MODEL,
            max_tokens=1024,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_msg}],
            output_config={"format": {"type": "json_schema", "schema": _SCHEMA}},
        )
        if response.stop_reason in ("refusal", "max_tokens"):
            raise RuntimeError(f"el modelo cortó por {response.stop_reason}")
        text = next((b.text for b in response.content if b.type == "text"), None)
        if not text:
            raise RuntimeError("el modelo no devolvió texto")
        return json.loads(text)["message"].strip()

    def _validar(self, texto: str, datos: dict[str, Any]) -> str | None:
        """Motivo del descarte, o None si el texto es válido.

        Mismo criterio que el motor de insights: todo número del texto tiene que
        existir en los datos que se le pasaron. Acá importa incluso más, porque
        esto sale por WhatsApp y nadie lo revisa antes.
        """
        if not texto:
            return "vacío"
        if len(texto) > MAX_CHARS:
            return f"demasiado largo ({len(texto)} caracteres)"

        numeros = collect_numbers(datos)
        strings = collect_strings(datos)
        for valor in _numbers_in_text(texto, strings):
            if not _number_is_supported(valor, numeros):
                return f"cita {valor:g}, que no está en los datos"
        return None

    def _texto_de_respaldo(self, nombre: str, datos: dict[str, Any]) -> str:
        """El mismo mensaje, armado por código. Se usa si la IA no está o falla."""
        lineas = [f"👋 ¡Buen lunes, {nombre}!", ""]
        for o in datos["obras"]:
            partes = []
            if o["bloqueadas"]:
                partes.append(f"🔴 {o['bloqueadas']} trabada/s")
            if o["vencidas"]:
                partes.append(f"⏰ {o['vencidas']} vencida/s")
            if o["vencen_esta_semana"]:
                partes.append(f"📅 {o['vencen_esta_semana']} vence/n esta semana")
            lineas.append(f"{o['obra']}: " + " · ".join(partes))

        cuellos = [o["cuello_de_botella"] for o in datos["obras"] if o["cuello_de_botella"]]
        if cuellos:
            peor = max(cuellos, key=lambda c: c["frena"])
            lineas += ["", f"Lo más urgente: «{peor['tarea']}» frena {peor['frena']} tarea/s."]
        return "\n".join(lineas)


# ── Disparo manual (consola / tests) ──────────────────────────────────────────

async def run_staff_weekly_digest() -> int:
    """Manda los resúmenes de staff abriendo su propia sesión."""
    from sqlalchemy.ext.asyncio import AsyncSession as _Session

    from app.core.database import engine

    async with _Session(engine, expire_on_commit=False) as session:
        n = await StaffDigestService(session).send_weekly_digests()
        await session.commit()
        return n
