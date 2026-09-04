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

from app.core.config import settings
from app.core.database import engine
from app.services.notification_service import NotificationService

logger = logging.getLogger(__name__)


class RiskCadence:
    """Espejo de las constantes de risk_service. Se duplican acá a propósito: el
    resto de los jobs importa su servicio dentro de la función para no encadenar
    imports pesados al arranque, y esto mantiene esa regla."""

    FREQUENT = "frequent"
    DAILY = "daily"
    WEEKLY = "weekly"

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


async def _job_evaluate_risk_rules(cadence: str) -> None:
    """Reglas de detección de riesgo (docs/propuesta-reglas-riesgo.md).

    Separado de _job_evaluate_delay_risk a propósito: aquel corre además en cada
    carga del dashboard y tiene que ser barato, mientras que estas reglas
    recalculan el CPM y leen línea base, materiales, calendario e historial.

    Un job por cadencia (ver RiskService.RULES): las reglas que comparan contra un
    snapshot del día anterior no cambian de resultado entre corridas de la misma
    jornada, y las de patrón miran meses de historial.
    """
    logger.info("Scheduler: evaluate_risk_rules(%s)", cadence)
    from app.services.risk_service import RiskService
    async with _db() as db:
        count = await RiskService(db).evaluate_all_obras(cadence=cadence)
    logger.info("Scheduler: evaluate_risk_rules(%s) → %d alerts", cadence, count)


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


async def _job_weekly_digest() -> None:
    """Resumen semanal de WhatsApp a cada responsable activo, los lunes.

    Corre **cada hora** los lunes, no una sola vez a las 8: la ventana horaria
    es configurable por tenant, así que una empresa que arranca a las 9 nunca
    recibiría un envío agendado a las 8 en punto. El servicio manda en la primera
    corrida que caiga dentro de la ventana y marca `last_weekly_digest_at` para
    no repetir.
    """
    logger.info("Scheduler: weekly_digest")
    async with _db() as db:
        count = await NotificationService(db).send_weekly_digest()
    logger.info("Scheduler: weekly_digest → %d resúmenes enviados", count)


async def _job_staff_weekly_digest() -> None:
    """Resumen semanal de WhatsApp para quien maneja obras (arquitecto/admin).

    Los responsables NO reciben este mensaje: el suyo es `_job_weekly_digest`,
    con sus tareas. Este es la mirada de quien gestiona: cómo vienen sus obras.
    Corre cada hora los lunes por el mismo motivo que el otro — esperar a que
    abra la ventana horaria del tenant.
    """
    from app.services.staff_digest_service import StaffDigestService

    logger.info("Scheduler: staff_weekly_digest")
    async with _db() as db:
        count = await StaffDigestService(db).send_weekly_digests()
    logger.info("Scheduler: staff_weekly_digest → %d resúmenes enviados", count)


async def _job_monthly_insights() -> None:
    """Motor de insights, pipeline mensual completo (etapas 1 a 5).

    Corre el día 1 y cubre el mes que cerró. Por cada obra activa encadena:
    estadísticas (determinísticas) → conclusiones con IA → render del email →
    envío al owner del tenant + aviso por WhatsApp. Una obra que falla no corta
    el resto, y el envío es idempotente por (obra, período): reintentar el job
    no reenvía informes ya mandados.
    """
    from app.services.insight_delivery_service import run_pipeline_for_all_active
    from app.services.obra_stats_service import previous_period

    period = previous_period()
    logger.info("Scheduler: monthly_insights(period=%s)", period)
    async with _db() as db:
        results = await run_pipeline_for_all_active(db, period)

    sent = sum(1 for r in results if r.get("status") == "sent")
    already = sum(1 for r in results if r.get("status") == "already_sent")
    failed = [r for r in results if r.get("status") not in ("sent", "already_sent")]
    logger.info(
        "Scheduler: monthly_insights(period=%s) → %d obras | %d enviados, %d ya enviados, %d con problema",
        period, len(results), sent, already, len(failed),
    )
    for r in failed:
        logger.warning(
            "Scheduler: monthly_insights obra %s → %s (%s)",
            r.get("obra_id"), r.get("status"), r.get("error") or r.get("reason") or "",
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

    # Reglas de detección de riesgo, una corrida por cadencia.
    # Frecuentes: cada 4 h, desfasadas de delay_risk (:30) para no solaparse.
    scheduler.add_job(
        _job_evaluate_risk_rules,
        CronTrigger(hour="*/4", minute=45),
        args=[RiskCadence.FREQUENT],
        id="evaluate_risk_rules_frequent",
        replace_existing=True,
        misfire_grace_time=600,
    )
    # Diarias: temprano, antes de que el equipo entre a la app.
    scheduler.add_job(
        _job_evaluate_risk_rules,
        CronTrigger(hour=6, minute=15),
        args=[RiskCadence.DAILY],
        id="evaluate_risk_rules_daily",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    # Semanales: lunes a la mañana, para que el patrón llegue al arrancar la semana.
    scheduler.add_job(
        _job_evaluate_risk_rules,
        CronTrigger(day_of_week="mon", hour=6, minute=45),
        args=[RiskCadence.WEEKLY],
        id="evaluate_risk_rules_weekly",
        replace_existing=True,
        misfire_grace_time=3600,
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

    # Resumen semanal a los responsables — lunes, cada hora entre las 6 y las 12.
    # El rango cubre cualquier ventana horaria razonable que configure un tenant;
    # el servicio decide en qué hora concreta enviar y no repite.
    scheduler.add_job(
        _job_weekly_digest,
        CronTrigger(day_of_week="mon", hour="6-12", minute=10),
        id="weekly_digest",
        replace_existing=True,
        misfire_grace_time=3600,
    )

    # Resumen semanal para quien maneja obras (staff) — lunes, mismo criterio.
    scheduler.add_job(
        _job_staff_weekly_digest,
        CronTrigger(day_of_week="mon", hour="6-12", minute=20),
        id="staff_weekly_digest",
        replace_existing=True,
        misfire_grace_time=3600,
    )

    # Motor de insights completo (etapas 1-5) — día 1 a las 4 AM, después de la
    # limpieza de sesiones y fuera de horario de obra.
    #
    # Apagado por defecto (INSIGHTS_ENABLED): el job manda emails reales y gasta
    # una llamada a Claude por obra activa. En local eso es puro costo — el link
    # del informe apunta a localhost y no le sirve a nadie. Se enciende en el
    # .env del servidor cuando se despliega.
    if settings.INSIGHTS_ENABLED:
        scheduler.add_job(
            _job_monthly_insights,
            CronTrigger(day=1, hour=4, minute=0),
            id="monthly_insights",
            replace_existing=True,
            misfire_grace_time=6 * 3600,
        )
        logger.info("Scheduler: monthly_insights ACTIVO (día 1, 4 AM)")
    else:
        logger.info(
            "Scheduler: monthly_insights APAGADO (INSIGHTS_ENABLED=false). "
            "El disparo manual sigue disponible: run_monthly_insights() / run_obra_pipeline()."
        )

    scheduler.start()
    logger.info("Scheduler started — reminder windows: %s hours ahead", hours_list)


def stop_scheduler() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("Scheduler stopped")
