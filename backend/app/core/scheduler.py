"""
APScheduler jobs for proactive WhatsApp notifications.

Schedule (configurable via env vars):
  REMINDER_HOURS_AHEAD — comma-separated hour windows, e.g. "24,72" (default: "24,72")

The reminder job runs every hour. For each configured window it checks whether any
task is due in exactly that many hours (±30 min) and sends a WhatsApp reminder.
"""
import logging
import os
from contextlib import asynccontextmanager

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import engine
from app.services.notification_service import NotificationService

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler(timezone="America/Argentina/Buenos_Aires")


@asynccontextmanager
async def _db():
    async with AsyncSession(engine, expire_on_commit=False) as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def _job_send_reminders(hours_ahead: int) -> None:
    logger.info("Scheduler: send_reminders(hours_ahead=%d)", hours_ahead)
    async with _db() as db:
        count = await NotificationService(db).send_reminders(hours_ahead)
    logger.info("Scheduler: send_reminders(hours_ahead=%d) → %d sent", hours_ahead, count)


async def _job_mark_overdue() -> None:
    logger.info("Scheduler: mark_overdue_tasks")
    async with _db() as db:
        count = await NotificationService(db).mark_overdue_tasks()
    logger.info("Scheduler: mark_overdue_tasks → %d alerts", count)


async def _job_check_no_response() -> None:
    logger.info("Scheduler: mark_no_response")
    async with _db() as db:
        count = await NotificationService(db).mark_no_response()
    logger.info("Scheduler: mark_no_response → %d alerts", count)


async def _job_remind_bitacora_obra() -> None:
    logger.info("Scheduler: remind_bitacora_obra")
    from app.services.message_service import MessageService
    async with _db() as db:
        count = await MessageService(db).remind_pending_bitacora_obra()
    logger.info("Scheduler: remind_bitacora_obra → %d sent", count)


async def _job_cleanup_expired_sessions() -> None:
    """Borra conversation_sessions cuyo expires_at ya pasó.

    Las sesiones vencidas no tienen utilidad funcional (el chatbot las ignora
    porque valida expires_at al leerlas) pero acumulan filas indefinidamente.
    Se corre una vez por día en un horario de bajo tráfico.
    """
    from datetime import datetime, timezone
    from sqlalchemy import delete
    from app.models.conversation_session import ConversationSession

    logger.info("Scheduler: cleanup_expired_sessions")
    async with _db() as db:
        result = await db.execute(
            delete(ConversationSession).where(
                ConversationSession.expires_at < datetime.now(timezone.utc)
            )
        )
        count = result.rowcount
    logger.info("Scheduler: cleanup_expired_sessions → %d filas eliminadas", count)


def _parse_hours() -> list[int]:
    raw = os.getenv("REMINDER_HOURS_AHEAD", "24,72")
    return [int(h.strip()) for h in raw.split(",") if h.strip().isdigit()]


def start_scheduler() -> None:
    hours_list = _parse_hours()

    # Reminder jobs run every hour — the service uses a ±30 min window internally
    for hours in hours_list:
        scheduler.add_job(
            _job_send_reminders,
            CronTrigger(minute=0),
            args=[hours],
            id=f"send_reminders_{hours}h",
            replace_existing=True,
            misfire_grace_time=600,
        )

    # Mark overdue once per hour (cheap query, no messages sent)
    scheduler.add_job(
        _job_mark_overdue,
        CronTrigger(minute=5),
        id="mark_overdue",
        replace_existing=True,
        misfire_grace_time=600,
    )

    # Check no-response every 2 hours
    scheduler.add_job(
        _job_check_no_response,
        CronTrigger(minute=0, hour="*/2"),
        id="check_no_response",
        replace_existing=True,
        misfire_grace_time=600,
    )

    # Recordatorio de notas de voz pendientes de asignar obra — cada 15 min
    # (el servicio aplica la cadencia de 30 min y el tope de 48 h internamente).
    scheduler.add_job(
        _job_remind_bitacora_obra,
        CronTrigger(minute="*/15"),
        id="remind_bitacora_obra",
        replace_existing=True,
        misfire_grace_time=300,
    )

    # Limpieza de sesiones de conversación de WhatsApp vencidas — 1 vez por día a las 3 AM.
    scheduler.add_job(
        _job_cleanup_expired_sessions,
        CronTrigger(hour=3, minute=0),
        id="cleanup_expired_sessions",
        replace_existing=True,
        misfire_grace_time=3600,
    )

    scheduler.start()
    logger.info("Scheduler started — reminder windows: %s hours ahead", hours_list)


def stop_scheduler() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("Scheduler stopped")
