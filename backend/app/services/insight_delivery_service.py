"""Entrega del informe mensual de insights (etapa 5) + orquestador del pipeline.

Cierra el motor completo: disparo → estadísticas (etapa 2) → redacción con IA
(etapa 3) → render (etapa 4) → entrega (esta etapa).

Destinatario: el **owner del tenant** (`Tenant.owner_user_id`) — la persona que
contrató la cuenta, no cualquier usuario con rol admin. Si además tiene
`whatsapp_number`, se le manda un aviso corto por WhatsApp con el link,
respetando `chatbot_enabled` y la ventana horaria como el resto de las
comunicaciones automáticas.

Idempotencia: el snapshot ya es único por (obra, period), así que alcanza con
mirar su `email_status`. Si ya está en "sent", una segunda corrida del mismo mes
no reenvía nada.

Fallos: un error de envío deja el registro en "failed" con el detalle y **no
corta el job** — las demás obras se siguen procesando. Queda trazado para
reintentar a mano o en el próximo ciclo.
"""
import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.obra import Obra, ObraStatus
from app.models.obra_insight import InsightStatus, ObraInsight
from app.models.obra_stats_snapshot import ObraStatsSnapshot
from app.models.tenant import Tenant
from app.models.user import User
from app.repositories.settings import SettingsRepository
from app.services.calendar_service import is_within_send_window
from app.services.email_service import _period_label, send_insights_email
from app.services.obra_insight_service import ObraInsightService
from app.services.obra_stats_service import ObraStatsService

logger = logging.getLogger(__name__)

# Estados de conclusión que se muestran en el informe (las descartadas no van).
_LIVE = (InsightStatus.NUEVA, InsightStatus.VISTA, InsightStatus.APLICADA)

EMAIL_SENT = "sent"
EMAIL_FAILED = "failed"
EMAIL_SKIPPED = "skipped"


class InsightDeliveryService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # ── Entrega ───────────────────────────────────────────────────────────────

    async def deliver_for_obra(
        self, obra_id: int, period: str, *, force: bool = False
    ) -> dict[str, Any]:
        """Manda el informe de una obra. Devuelve el resultado, no lanza.

        `force=True` reenvía aunque ya figure como enviado (para reintentos
        manuales de un envío que quedó a medias).
        """
        snapshot = (await self.session.execute(
            select(ObraStatsSnapshot).where(
                ObraStatsSnapshot.obra_id == obra_id,
                ObraStatsSnapshot.period == period,
            )
        )).scalar_one_or_none()

        if snapshot is None:
            logger.warning(
                "Insights entrega: no hay snapshot de la obra %d para %s", obra_id, period
            )
            return {"status": "no_snapshot", "obra_id": obra_id, "period": period}

        # ── Idempotencia ──
        if snapshot.email_status == EMAIL_SENT and not force:
            logger.info(
                "Insights entrega: la obra %d ya tenía el informe de %s enviado a %s — no se reenvía",
                obra_id, period, snapshot.email_recipient,
            )
            return {
                "status": "already_sent", "obra_id": obra_id, "period": period,
                "recipient": snapshot.email_recipient, "sent_at": snapshot.email_sent_at,
            }

        obra = await self.session.get(Obra, obra_id)
        recipient, reason = await self._resolve_recipient(obra)
        if recipient is None:
            snapshot.email_status = EMAIL_SKIPPED
            snapshot.email_error = reason
            logger.warning(
                "Insights entrega: obra %d (%s) sin destinatario — %s", obra_id, period, reason
            )
            await self.session.flush()
            return {"status": EMAIL_SKIPPED, "obra_id": obra_id, "period": period, "reason": reason}

        insights = list((await self.session.execute(
            select(ObraInsight)
            .where(ObraInsight.obra_id == obra_id, ObraInsight.status.in_(_LIVE))
            .order_by(ObraInsight.created_at)
        )).scalars().all())

        # ── Email (canal principal) ──
        try:
            ok = await send_insights_email(
                recipient.email,
                obra_id=obra_id,
                obra_name=obra.name if obra else f"Obra {obra_id}",
                period=period,
                insights=insights,
                tenant_id=obra.tenant_id if obra else None,
            )
        except Exception as exc:
            # Fire-and-forget del caller: el fallo se traza, no se propaga.
            ok = False
            snapshot.email_error = f"{type(exc).__name__}: {exc}"
            logger.exception("Insights entrega: excepción enviando el email de la obra %d", obra_id)
        else:
            snapshot.email_error = None if ok else "Brevo rechazó el envío (ver logs del email_service)"

        snapshot.email_recipient = recipient.email
        if ok:
            snapshot.email_status = EMAIL_SENT
            snapshot.email_sent_at = datetime.now(timezone.utc)
            logger.info(
                "Insights entrega: informe de la obra %d (%s) enviado a %s — %d conclusiones",
                obra_id, period, recipient.email, len(insights),
            )
        else:
            snapshot.email_status = EMAIL_FAILED
            logger.error(
                "Insights entrega: falló el envío del informe de la obra %d (%s) a %s — %s",
                obra_id, period, recipient.email, snapshot.email_error,
            )

        # ── WhatsApp (complementario) ──
        whatsapp = await self._maybe_send_whatsapp(snapshot, obra, recipient, period)

        await self.session.flush()
        return {
            "status": EMAIL_SENT if ok else EMAIL_FAILED,
            "obra_id": obra_id, "period": period,
            "recipient": recipient.email,
            "insights": len(insights),
            "whatsapp": whatsapp,
            "error": snapshot.email_error,
        }

    async def _resolve_recipient(self, obra: Obra | None) -> tuple[User | None, str | None]:
        """El owner del tenant de la obra — quien contrató la cuenta.

        No es "cualquier admin": es específicamente `Tenant.owner_user_id`.
        Ver la decisión abierta sobre notificar a más admins en
        docs/features/insights-etapa-5-entrega.md.
        """
        if obra is None:
            return None, "la obra no existe"
        if obra.tenant_id is None:
            return None, "la obra no tiene tenant"

        tenant = await self.session.get(Tenant, obra.tenant_id)
        if tenant is None or tenant.owner_user_id is None:
            return None, f"el tenant {obra.tenant_id} no tiene owner_user_id"

        owner = await self.session.get(User, tenant.owner_user_id)
        if owner is None:
            return None, f"el owner {tenant.owner_user_id} no existe"
        if not owner.is_active:
            return None, f"el owner {owner.email} está inactivo"
        if not owner.email:
            return None, f"el owner {tenant.owner_user_id} no tiene email"
        return owner, None

    async def _maybe_send_whatsapp(
        self, snapshot: ObraStatsSnapshot, obra: Obra | None, owner: User, period: str
    ) -> str:
        """Aviso corto por WhatsApp, si el owner tiene número cargado.

        Es complementario al email: si no sale, el informe igual se considera
        entregado. Respeta `chatbot_enabled` y la ventana horaria como el resto
        de las comunicaciones automáticas del sistema.
        """
        if not owner.whatsapp_number:
            return "sin_numero"

        try:
            cfg = await SettingsRepository(self.session).get_or_create(owner.tenant_id) \
                if owner.tenant_id else None
            if cfg is not None:
                if not cfg.chatbot_enabled:
                    snapshot.whatsapp_status = "skipped_chatbot_off"
                    return "skipped_chatbot_off"
                if not is_within_send_window(cfg.send_hour_from, cfg.send_hour_to):
                    # No se encola para más tarde: el email ya salió y es el canal
                    # principal. Mandar el aviso a las 3 AM sería peor que no mandarlo.
                    snapshot.whatsapp_status = "skipped_fuera_de_ventana"
                    return "skipped_fuera_de_ventana"

            from app.integrations.twilio.client import send_whatsapp_message

            from app.services.email_service import insights_report_url

            link = insights_report_url(
                snapshot.obra_id, period, obra.tenant_id if obra else None
            )
            name = obra.name if obra else f"obra {snapshot.obra_id}"
            body = (
                f"📊 Tu informe mensual de la obra {name} ya está listo. "
                f"Mirálo acá: {link}"
            )
            await send_whatsapp_message(owner.whatsapp_number, body)
        except Exception:
            # El WhatsApp nunca puede tumbar la entrega: el email es el canal principal.
            snapshot.whatsapp_status = "failed"
            logger.exception(
                "Insights entrega: falló el aviso de WhatsApp de la obra %d (%s)",
                snapshot.obra_id, period,
            )
            return "failed"

        snapshot.whatsapp_status = "sent"
        snapshot.whatsapp_sent_at = datetime.now(timezone.utc)
        return "sent"


def settings_frontend_url() -> str:
    from app.core.config import settings
    return settings.FRONTEND_URL.rstrip("/")


# ── Orquestador del pipeline completo ─────────────────────────────────────────

async def run_pipeline_for_obra(
    session: AsyncSession, obra_id: int, period: str, *, force: bool = False
) -> dict[str, Any]:
    """Encadena las 4 etapas para una obra: estadísticas → IA → render → envío.

    Si una etapa intermedia falla, el pipeline se corta ahí para esa obra y NO
    se manda un email a medio armar.
    """
    try:
        await ObraStatsService(session).snapshot(obra_id, period)
    except Exception as exc:
        logger.exception("Pipeline insights: falló el cálculo de la obra %d (%s)", obra_id, period)
        return {"status": "stats_failed", "obra_id": obra_id, "period": period, "error": str(exc)}

    try:
        insights = await ObraInsightService(session).generate_for_obra(obra_id, period)
    except Exception as exc:
        logger.exception("Pipeline insights: falló la redacción de la obra %d (%s)", obra_id, period)
        return {"status": "insights_failed", "obra_id": obra_id, "period": period, "error": str(exc)}

    result = await InsightDeliveryService(session).deliver_for_obra(obra_id, period, force=force)
    result["insights_generated"] = len(insights)
    return result


async def run_pipeline_for_all_active(
    session: AsyncSession, period: str, *, force: bool = False
) -> list[dict[str, Any]]:
    """El pipeline por cada obra activa. Una obra que falla no corta el resto."""
    obras = list((await session.execute(
        select(Obra).where(Obra.status.notin_([ObraStatus.COMPLETADA, ObraStatus.CANCELADA]))
    )).scalars().all())

    results: list[dict[str, Any]] = []
    for obra in obras:
        try:
            results.append(await run_pipeline_for_obra(session, obra.id, period, force=force))
        except Exception as exc:
            logger.exception("Pipeline insights: error inesperado en la obra %d", obra.id)
            results.append({
                "status": "unexpected_error", "obra_id": obra.id,
                "period": period, "error": str(exc),
            })
    return results


# ── Disparo manual (consola / tests, sin endpoint HTTP) ───────────────────────

async def run_monthly_insights(period: str | None = None, *, force: bool = False) -> list[dict]:
    """Pipeline mensual completo, abriendo su propia sesión.

        python -c "import asyncio; from app.services.insight_delivery_service import \\
                   run_monthly_insights; print(asyncio.run(run_monthly_insights('2026-09')))"
    """
    from sqlalchemy.ext.asyncio import AsyncSession as _Session

    from app.core.database import engine
    from app.services.obra_stats_service import previous_period

    period = period or previous_period()
    async with _Session(engine, expire_on_commit=False) as session:
        results = await run_pipeline_for_all_active(session, period, force=force)
        await session.commit()
        return results


async def run_obra_pipeline(obra_id: int, period: str, *, force: bool = False) -> dict:
    """Pipeline completo de UNA obra, abriendo su propia sesión."""
    from sqlalchemy.ext.asyncio import AsyncSession as _Session

    from app.core.database import engine

    async with _Session(engine, expire_on_commit=False) as session:
        result = await run_pipeline_for_obra(session, obra_id, period, force=force)
        await session.commit()
        return result


def period_label(period: str) -> str:
    """Reexport para consumidores que solo importan este módulo."""
    return _period_label(period)
