"""
Proactive notification service.

Endpoints (called by n8n on schedule):
  send_reminders(days)   – WhatsApp reminders for tasks due within N days
  mark_overdue_tasks()   – TASK_OVERDUE alerts for tasks past due_date
  mark_no_response()     – NO_RESPONSE alerts for unanswered reminders

All operations respect the per-tenant SystemSettings configured in the UI.
"""
import logging
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.twilio.client import send_whatsapp_message
from app.models.alert import AlertType
from app.models.message import Message, MessageDirection, MessageProcessingStatus, MessageType
from app.models.responsible import Responsible
from app.models.task import Task
from app.repositories.alert import AlertRepository
from app.repositories.calendar import CalendarRepository
from app.repositories.historial import HistorialRepository
from app.repositories.message import MessageRepository
from app.repositories.obra import ObraRepository
from app.repositories.responsible import ResponsibleRepository
from app.repositories.settings import SettingsRepository
from app.repositories.task import TaskRepository
from app.services.calendar_service import is_within_working_hours
from app.services.conversation_service import ConversationService
from app.services.message_templates import fmt_date

logger = logging.getLogger(__name__)

_AR_TZ = ZoneInfo("America/Argentina/Buenos_Aires")


def _ar_today(now: datetime | None = None) -> date:
    """Hoy en hora argentina. Cerca de medianoche UTC la fecha local es la de
    ayer, y los vencimientos se cargan en fecha local — compararlos contra la
    fecha UTC corría el recordatorio un día."""
    return (now or datetime.now(timezone.utc)).astimezone(_AR_TZ).date()


class NotificationService:
    def __init__(self, session: AsyncSession) -> None:
        self.db = session
        self.task_repo = TaskRepository(session)
        self.obra_repo = ObraRepository(session)
        self.resp_repo = ResponsibleRepository(session)
        self.msg_repo = MessageRepository(session)
        self.alert_repo = AlertRepository(session)
        self.historial = HistorialRepository(session)
        self.settings_repo = SettingsRepository(session)
        self.calendar_repo = CalendarRepository(session)
        self.conv_service = ConversationService(session)

    # ── public methods ─────────────────────────────────────────────────────────

    async def send_reminders(self, hours_ahead: int = 24) -> int:
        """Recordatorio de WhatsApp a los responsables de las tareas que vencen
        en `hours_ahead` horas, redondeado a días (24h → 1 día, 72h → 3 días).

        **Por día, no por hora exacta.** El job corre cada hora y manda el
        recordatorio en la primera corrida del día que caiga dentro del horario
        laboral de la obra; la deduplicación evita que se repita. La versión
        anterior buscaba tareas cuyo vencimiento cayera en una ventana de ±30 min
        alrededor de `ahora + N horas`: como las tareas sin `due_time` se toman
        como que vencen 23:59, ese instante caía siempre fuera del horario
        laboral y el recordatorio no se enviaba nunca (ver
        docs/features/recordatorio-vencimiento.md).
        """
        days_ahead = max(1, round(hours_ahead / 24))
        now = datetime.now(timezone.utc)
        target_date = _ar_today(now) + timedelta(days=days_ahead)

        tasks = await self.task_repo.list_due_on_date(target_date)

        count = 0
        for task in tasks:
            if not task.responsible_id:
                continue
            responsible = await self.resp_repo.get(task.responsible_id)
            if not responsible or not responsible.is_active:
                continue

            cfg = await self.settings_repo.get_for_obra(task.obra_id)

            if not cfg.chatbot_enabled:
                logger.debug("chatbot disabled for obra %d — skipping task %d", task.obra_id, task.id)
                continue
            if not cfg.auto_reminders:
                logger.debug("auto_reminders disabled for obra %d — skipping task %d", task.obra_id, task.id)
                continue
            if days_ahead <= 1 and not cfg.reminder_1day:
                logger.debug("reminder_1day disabled — skipping task %d", task.id)
                continue
            if days_ahead > 1 and not cfg.reminder_3days:
                logger.debug("reminder_3days disabled — skipping task %d", task.id)
                continue

            cal = await self.calendar_repo.get_for_obra(task.obra_id)
            if not is_within_working_hours(cal, now):
                # Todavía no es horario laboral: la próxima corrida horaria del
                # mismo día lo vuelve a intentar, así que no se pierde.
                logger.debug("fuera de horario laboral para obra %d — task %d espera", task.obra_id, task.id)
                continue

            # Un solo recordatorio por tarea y por ventana: si ya salió hoy, no repite.
            dedup_since = now - timedelta(hours=max(12, hours_ahead * 0.9))
            if await self.msg_repo.has_recent_reminder_for_task(
                task.id, task.responsible_id, dedup_since
            ):
                logger.debug("Reminder already sent recently for task %d — skipping", task.id)
                continue

            obra = await self.obra_repo.get(task.obra_id)
            obra_name = obra.name if obra else f"Obra #{task.obra_id}"

            try:
                msg_text = await self.conv_service.seed_for_task(responsible, task, obra_name)
                await self.notify_responsible(
                    responsible, msg_text, task=task, awaits_response=True,
                )
                count += 1
                logger.info(
                    "Recordatorio de %d día/s enviado a %s por la tarea %d",
                    days_ahead, responsible.whatsapp_number, task.id,
                )
            except Exception:
                logger.exception(
                    "Failed to send reminder for task %d to %s",
                    task.id, responsible.whatsapp_number,
                )

        return count

    async def notify_responsible(
        self,
        responsible: Responsible,
        body: str,
        *,
        task: Task | None = None,
        notification_type: str = "reminder",
        awaits_response: bool = False,
    ) -> str | None:
        """Manda un WhatsApp a un responsable y lo deja registrado en `messages`.

        Punto único de salida para las notificaciones proactivas: envía por
        Twilio y persiste el saliente con su SID. **No** chequea configuración
        ni horario — eso lo decide quien llama, que es el que sabe qué flag de
        `SystemSettings` le corresponde. Devuelve el SID de Twilio (o None si el
        envío quedó deshabilitado por falta de credenciales).
        """
        sid = await send_whatsapp_message(responsible.whatsapp_number, body)
        await self._save_outbound(
            responsible=responsible,
            task=task,
            body=body,
            external_sid=sid,
            awaits_response=awaits_response,
            notification_type=notification_type,
        )
        return sid

    async def can_notify_obra(self, obra_id: int) -> tuple[bool, str]:
        """¿Se le puede mandar un WhatsApp automático a esta obra ahora mismo?

        Reúne los tres chequeos que comparten todas las notificaciones
        proactivas (chatbot prendido, envíos automáticos prendidos, y estar
        dentro del horario laboral de la obra) para que un flujo nuevo no tenga
        que redescubrirlos ni olvidarse de alguno. Devuelve el motivo cuando da
        que no, para poder loguearlo.
        """
        cfg = await self.settings_repo.get_for_obra(obra_id)
        if not cfg.chatbot_enabled:
            return False, "chatbot_enabled=False"
        if not cfg.auto_reminders:
            return False, "auto_reminders=False"
        cal = await self.calendar_repo.get_for_obra(obra_id)
        if not is_within_working_hours(cal, datetime.now(timezone.utc)):
            return False, "fuera del horario laboral de la obra"
        return True, ""

    async def mark_overdue_tasks(self, tenant_id: int | None = None) -> int:
        """Create TASK_OVERDUE alerts for tasks past their due_date.

        Skips tasks whose tenant has disabled alert_overdue o notify_task_overdue.
        `tenant_id=None` (uso normal del scheduler) procesa TODO el sistema, una
        corrida por cron para todas las empresas; pasar un tenant_id puntual es
        para el endpoint de testing (/settings/simulate-overdue), que no debe
        tocar otras empresas.
        """
        today = date.today()
        tasks = await self.task_repo.list_overdue(today, tenant_id=tenant_id)
        count = 0
        for task in tasks:
            cfg = await self.settings_repo.get_for_obra(task.obra_id)

            if not cfg.alert_overdue or not cfg.notify_task_overdue:
                logger.debug(
                    "alert_overdue/notify_task_overdue disabled for obra %d — skipping task %d",
                    task.obra_id, task.id,
                )
                continue

            msg = (
                f"La tarea '{task.title}' está vencida "
                f"(venció el {fmt_date(task.due_date)})."
            )
            if not await self.alert_repo.exists_for_task(task.id, AlertType.TASK_OVERDUE, msg):
                await self.alert_repo.create_alert(
                    alert_type=AlertType.TASK_OVERDUE,
                    message=msg,
                    obra_id=task.obra_id,
                    task_id=task.id,
                )
                await self.historial.log(
                    obra_id=task.obra_id,
                    task_id=task.id,
                    event_type="alert_created",
                    description=msg,
                    payload={"alert_type": "task_overdue"},
                    triggered_by="system",
                )
                count += 1
        return count

    async def mark_no_response(self, timeout_hours: int | None = None) -> int:
        """Create NO_RESPONSE alerts for unanswered reminders.

        If retry_failed is enabled, also resends the reminder to the responsible
        (once per original reminder, respecting auto_reminders and send hours).
        Uses max_response_hours from SystemSettings unless timeout_hours is given.
        """
        now = datetime.now(timezone.utc)
        # Look back far enough to catch all pending reminders
        look_back = timedelta(hours=max(timeout_hours or 0, 72) * 2)
        outbound_msgs = await self.msg_repo.list_recent_outbound(since=now - look_back)

        notifications = [
            m for m in outbound_msgs
            if m.ai_interpretation and m.ai_interpretation.get("awaits_response")
            # ignore retries so we don't chain-retry forever
            and m.ai_interpretation.get("notification_type") == "reminder"
        ]

        count = 0
        for outbound in notifications:
            if not outbound.responsible_id or not outbound.task_id:
                continue

            task = await self.task_repo.get(outbound.task_id)
            if not task:
                continue

            cfg = await self.settings_repo.get_for_obra(task.obra_id)

            effective_hours = timeout_hours if timeout_hours is not None else cfg.max_response_hours
            cutoff = now - timedelta(hours=effective_hours)

            msg_created = outbound.created_at.replace(tzinfo=timezone.utc)
            if msg_created >= cutoff:
                continue

            has_reply = await self.msg_repo.has_inbound_after(
                outbound.responsible_id, outbound.created_at
            )
            if has_reply:
                continue

            responsible = await self.resp_repo.get(outbound.responsible_id)
            resp_name = responsible.full_name if responsible else f"Responsable #{outbound.responsible_id}"

            # ── Create NO_RESPONSE alert ───────────────────────────────────────
            if cfg.alert_no_response and cfg.notify_no_response:
                msg = f"Sin respuesta de {resp_name} para la tarea '{task.title}'."
                if not await self.alert_repo.exists_for_task(task.id, AlertType.NO_RESPONSE, msg):
                    await self.alert_repo.create_alert(
                        alert_type=AlertType.NO_RESPONSE,
                        message=msg,
                        obra_id=task.obra_id,
                        task_id=task.id,
                    )
                    await self.historial.log(
                        obra_id=task.obra_id,
                        task_id=task.id,
                        event_type="alert_created",
                        description=msg,
                        payload={"alert_type": "no_response"},
                        triggered_by="system",
                    )
                    count += 1

            # ── Resend reminder to responsible ─────────────────────────────────
            if cfg.retry_failed and cfg.auto_reminders and responsible and responsible.is_active:
                retry_cal = await self.calendar_repo.get_for_obra(task.obra_id)
                if not is_within_working_hours(retry_cal, now):
                    logger.debug("Outside working hours/day for obra %d — skipping retry for task %d", task.obra_id, task.id)
                    continue

                already_retried = await self.msg_repo.has_recent_reminder_for_task(
                    task.id, outbound.responsible_id, since=outbound.created_at
                )
                if already_retried:
                    continue

                obra = await self.obra_repo.get(task.obra_id)
                obra_name = obra.name if obra else f"Obra #{task.obra_id}"
                try:
                    msg_text = await self.conv_service.seed_for_task(responsible, task, obra_name)
                    outbound_sid = await send_whatsapp_message(
                        responsible.whatsapp_number, msg_text
                    )
                    await self._save_outbound(
                        responsible=responsible,
                        task=task,
                        body=msg_text,
                        external_sid=outbound_sid,
                        awaits_response=False,  # don't chain retries
                        notification_type="reminder_retry",
                    )
                    logger.info("Retry reminder sent to %s for task %d", responsible.whatsapp_number, task.id)
                except Exception:
                    logger.exception("Failed to send retry reminder for task %d", task.id)

        return count

    @staticmethod
    def _within_send_hours(now: datetime, hour_from: int, hour_to: int) -> bool:
        """Check if current time in Argentina is within the configured send window."""
        from zoneinfo import ZoneInfo
        local_hour = now.astimezone(ZoneInfo("America/Argentina/Buenos_Aires")).hour
        return hour_from <= local_hour < hour_to

    # ── helpers ────────────────────────────────────────────────────────────────

    async def _save_outbound(
        self,
        responsible: Responsible,
        task: Task | None,
        body: str,
        external_sid: str | None,
        awaits_response: bool = False,
        notification_type: str = "reminder",
    ) -> Message:
        from app.core.config import settings

        msg = Message(
            direction=MessageDirection.OUTBOUND,
            message_type=MessageType.TEXT,
            from_number=settings.TWILIO_WHATSAPP_NUMBER,
            to_number=responsible.whatsapp_number,
            body=body,
            responsible_id=responsible.id,
            task_id=task.id if task else None,
            external_message_id=external_sid,
            processing_status=MessageProcessingStatus.PROCESSED,
            ai_interpretation={"notification_type": notification_type, "awaits_response": awaits_response},
        )
        return await self.msg_repo.create(msg)
