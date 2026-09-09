from typing import Annotated

from fastapi import APIRouter, Depends

from app.core.deps import DbSession
from app.core.obra_permissions import require_obra_role
from app.models.obra_user_role import ObraUserRoleType
from app.models.user import User
from app.schemas.obra_dashboard import ObraDashboardRead
from app.services.obra_dashboard_service import ObraDashboardService

router = APIRouter(prefix="/obras", tags=["obra-dashboard"])


@router.get("/{obra_id}/dashboard", response_model=ObraDashboardRead)
async def get_obra_dashboard(
    obra_id: int,
    db: DbSession,
    current_user: Annotated[User, Depends(require_obra_role(ObraUserRoleType.SOLO_LECTURA))],
):
    """Indicadores P0 del dashboard de obra: avance real ponderado, avance
    planificado, SPI, fecha de fin proyectada, alertas por severidad y cuello
    de botella. docs/features/dashboard-indicadores-obra.md, sección 6."""
    return await ObraDashboardService(db).get_dashboard(obra_id)
