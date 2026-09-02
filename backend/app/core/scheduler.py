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


async def _job_evaluate_delay_risk() -> None:
    """docs/auditoria/06-alertas.md, hallazgo 7.2/8.4 — cobertura para obras
    sin visitas: evaluate_task_risks_for_obra() antes solo corría al abrir el
    tab Tareas/Gantt de esa obra puntual."""
    logger.info("Scheduler: evaluate_delay_risk")
    from app.services.alert_service import AlertService
    async with _db() as db:
        count = await AlertService(db).evaluate_task_risks_for_all_obras()
    logger.info("Scheduler: evaluate_delay_risk → %d alerts", count)


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


async def _job_obra_stats_snapshots() -> None:
    """Insights etapa 2: foto mensual de estadísticas por obra activa.

    Corre el día 1 de cada mes y cubre el mes que acaba de cerrar. Es cálculo
    determinístico (SQL/Python) — no llama a ninguna IA.
    """
    from app.services.obra_stats_service import ObraStatsService, previous_period

    from app.services.obra_insight_service import ObraInsightService

    period = previous_period()
    logger.info("Scheduler: obra_stats_snapshots(period=%s)", period)
    async with _db() as db:
        snapshots = await ObraStatsService(db).snapshot_all_active(period)
    logger.info(
        "Scheduler: obra_stats_snapshots(period=%s) → %d obras", period, len(snapshots)
    )

    # Etapa 3: redacción con IA sobre los snapshots recién calculados. Va en su
    # propia transacción para que un fallo de la IA no invalide las estadísticas,
    # que son el dato duro y ya quedaron guardadas.
    async with _db() as db:
        insights = await ObraInsightService(db).generate_for_all_active(period)
    logger.info(
        "Scheduler: obra_insights(period=%s) → %d conclusiones", period, insights
    )


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

    # Evaluar DELAY_RISK para todas las obras activas cada 4 horas (cubre obras
    # sin tráfico, que antes nunca disparaban el chequeo reactivo).
    scheduler.add_job(
        _job_evaluate_delay_risk,
        CronTrigger(hour="*/4", minute=30),
        id="evaluate_delay_risk",
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

    # Estadísticas mensuales por obra (insights, etapa 2) — día 1 a las 4 AM,
    # después de la limpieza de sesiones y fuera de horario de obra.
    scheduler.add_job(
        _job_obra_stats_snapshots,
        CronTrigger(day=1, hour=4, minute=0),
        id="obra_stats_snapshots",
        replace_existing=True,
        misfire_grace_time=6 * 3600,
    )

    scheduler.start()
    logger.info("Scheduler started — reminder windows: %s hours ahead", hours_list)


def stop_scheduler() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("Scheduler stopped")
