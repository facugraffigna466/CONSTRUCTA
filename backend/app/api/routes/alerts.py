from typing import Annotated

from fastapi import APIRouter, Query

from app.core.deps import CurrentUser, CurrentUserId, DbSession
from app.schemas.alert import AlertRead
from app.services.alert_service import AlertService

router = APIRouter(prefix="/alerts", tags=["alerts"])


@router.get("", response_model=list[AlertRead])
async def list_alerts(
    db: DbSession,
    current_user: CurrentUser,
    unread_only: Annotated[bool, Query()] = False,
    obra_id: Annotated[int | None, Query()] = None,
    limit: Annotated[int | None, Query(ge=1, le=500)] = None,
):
    """Filtra por obra en el servidor (obra_id) para no traer todas las alertas
    del tenant y filtrar en el cliente. `limit` acota el volumen a escala."""
    return await AlertService(db).list_all(
        unread_only=unread_only,
        tenant_id=current_user.tenant_id,
        obra_id=obra_id,
        limit=limit,
    )


@router.patch("/mark-all-read", response_model=list[AlertRead])
async def mark_all_alerts_read(
    db: DbSession,
    current_user: CurrentUser,
    obra_id: Annotated[int | None, Query()] = None,
):
    """Marca todas las alertas no leídas como leídas en una sola operación."""
    return await AlertService(db).mark_all_read(obra_id=obra_id, tenant_id=current_user.tenant_id)


@router.patch("/{alert_id}/read", response_model=AlertRead)
async def mark_alert_read(alert_id: int, db: DbSession, current_user: CurrentUser):
    return await AlertService(db).mark_read(alert_id, tenant_id=current_user.tenant_id)
