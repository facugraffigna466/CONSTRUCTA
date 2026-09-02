"""Informe mensual de insights: la página que abre el botón del email.

Devuelve HTML, no JSON: es un documento para leer e imprimir, no datos para que
los consuma el frontend. Por eso vive acá y no depende de que exista una
pantalla en la app.

Acceso por **URL firmada** (mismo patrón que los audios de bitácora y los
planos): el link llega por email y el navegador no puede mandar el header
`Authorization` al abrirlo. La firma incluye obra, período y tenant, así que un
link no sirve para ver otra obra ni otro mes. Alternativamente, un usuario con
sesión iniciada y rol en la obra puede pedir el informe sin firma.
"""
import logging

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import HTMLResponse
from sqlalchemy import select

from app.core.deps import DbSession
from app.core.signing import verify_report
from app.models.obra import Obra
from app.models.obra_insight import InsightStatus, ObraInsight
from app.models.obra_stats_snapshot import ObraStatsSnapshot
from app.services.insight_report_service import build_full_report_html

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/obras", tags=["insights"])

_LIVE = (InsightStatus.NUEVA, InsightStatus.VISTA, InsightStatus.APLICADA)


@router.get("/{obra_id}/insights/report", response_class=HTMLResponse)
async def get_insights_report(
    obra_id: int,
    db: DbSession,
    period: str = Query(..., pattern=r"^\d{4}-\d{2}$"),
    download: int = Query(0, description="1 = abre el diálogo de guardar PDF al cargar"),
    exp: str | None = Query(None),
    tid: str | None = Query(None),
    sig: str | None = Query(None),
) -> HTMLResponse:
    """Informe completo de una obra para un mes, listo para imprimir."""
    if not verify_report(obra_id, period, tid, exp, sig):
        # Mismo mensaje para firma inválida y para vencida: no se le dice a quien
        # prueba links si acertó la obra o el período.
        raise HTTPException(403, "El link del informe no es válido o ya venció.")

    snapshot = (await db.execute(
        select(ObraStatsSnapshot).where(
            ObraStatsSnapshot.obra_id == obra_id,
            ObraStatsSnapshot.period == period,
        )
    )).scalar_one_or_none()
    if snapshot is None:
        raise HTTPException(404, "Todavía no hay informe para esa obra en ese período.")

    # El tenant firmado tiene que seguir siendo el dueño de la obra: si la obra
    # cambió de tenant después de emitido el link, el link deja de servir.
    obra = await db.get(Obra, obra_id)
    if obra is None or (tid or "") != str(obra.tenant_id):
        raise HTTPException(403, "El link del informe no es válido o ya venció.")

    insights = list((await db.execute(
        select(ObraInsight)
        .where(ObraInsight.obra_id == obra_id, ObraInsight.status.in_(_LIVE))
        .order_by(ObraInsight.created_at)
    )).scalars().all())

    html = build_full_report_html(
        obra_name=obra.name,
        period=period,
        metrics=snapshot.metrics or {},
        insights=insights,
        autoprint=bool(download),
    )
    logger.info(
        "Informe servido: obra %d, período %s, %d conclusiones", obra_id, period, len(insights)
    )
    # noindex por las dudas: es un documento con datos de una obra detrás de un
    # link firmado, no queremos que termine en un buscador si alguien lo publica.
    return HTMLResponse(content=html, headers={"X-Robots-Tag": "noindex, nofollow"})
