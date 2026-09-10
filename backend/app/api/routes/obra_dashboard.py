from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.core.deps import DbSession
from app.core.obra_permissions import require_obra_role
from app.models.obra_user_role import ObraUserRoleType
from app.models.user import User
from app.schemas.obra_dashboard import CurvaSRead, MonthlyInsightsRead, ObraDashboardRead
from app.services.obra_dashboard_service import ObraDashboardService

router = APIRouter(prefix="/obras", tags=["obra-dashboard"])


@router.get("/{obra_id}/dashboard", response_model=ObraDashboardRead)
async def get_obra_dashboard(
    obra_id: int,
    db: DbSession,
    current_user: Annotated[User, Depends(require_obra_role(ObraUserRoleType.SOLO_LECTURA))],
):
    """Indicadores P0/P1 del dashboard de obra: avance real ponderado, avance
    planificado, SPI, fin proyectado, alertas por severidad, cuello de
    botella, línea base, ruta crítica, hitos y materiales.
    docs/features/dashboard-indicadores-obra.md, sección 6."""
    return await ObraDashboardService(db).get_dashboard(obra_id)


@router.get("/{obra_id}/dashboard/curva-s", response_model=CurvaSRead)
async def get_curva_s(
    obra_id: int,
    db: DbSession,
    current_user: Annotated[User, Depends(require_obra_role(ObraUserRoleType.SOLO_LECTURA))],
    from_: Annotated[date | None, Query(alias="from")] = None,
    to_: Annotated[date | None, Query(alias="to")] = None,
):
    """I-05 — avance planificado vs. real por semana. `real` es `None` antes
    de que arrancara el tracking diario (`tracking_since`)."""
    return await ObraDashboardService(db).get_curva_s(obra_id, from_, to_)


@router.get("/{obra_id}/dashboard/monthly-insights", response_model=MonthlyInsightsRead)
async def get_monthly_insights(
    obra_id: int,
    db: DbSession,
    current_user: Annotated[User, Depends(require_obra_role(ObraUserRoleType.SOLO_LECTURA))],
):
    """I-12/I-13 — último snapshot mensual: concentración de retraso 80/20 y
    precisión de estimación por disciplina. El ranking por responsable
    (D-01) solo viaja para usuarios admin."""
    return await ObraDashboardService(db).get_monthly_insights(obra_id, current_user.role)
