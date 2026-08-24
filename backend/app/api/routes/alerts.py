from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.core.deps import CurrentUser, DbSession
from app.core.obra_permissions import (
    assert_obra_access,
    require_alert_obra_role,
    visible_obra_ids,
)
from app.models.obra_user_role import ObraUserRoleType
from app.models.user import User
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
    service = AlertService(db)
    if obra_id is not None:
        # Un obra_id específico: exigimos rol SL o superior en esa obra.
        await assert_obra_access(db, current_user, obra_id, ObraUserRoleType.SOLO_LECTURA)
        return await service.list_all(
            unread_only=unread_only,
            tenant_id=current_user.tenant_id,
            obra_id=obra_id,
            limit=limit,
        )
    # Sin obra_id: admin ve todo el tenant; non-admin solo alertas de sus obras.
    visible = await visible_obra_ids(db, current_user)
    alerts = await service.list_all(
        unread_only=unread_only,
        tenant_id=current_user.tenant_id,
        obra_id=None,
        limit=limit,
    )
    if visible is None:
        return alerts
    return [a for a in alerts if a.obra_id in visible]


@router.patch("/mark-all-read", response_model=list[AlertRead])
async def mark_all_alerts_read(
    db: DbSession,
    current_user: CurrentUser,
    obra_id: Annotated[int | None, Query()] = None,
):
    """Marca todas las alertas no leídas como leídas en una sola operación."""
    service = AlertService(db)
    if obra_id is not None:
        # Marcar en una obra específica: rol COL o superior.
        await assert_obra_access(db, current_user, obra_id, ObraUserRoleType.COLABORADOR)
        return await service.mark_all_read(
            obra_id=obra_id, tenant_id=current_user.tenant_id
        )
    # Sin obra_id: admin marca todo el tenant; non-admin marca solo las de sus obras.
    visible = await visible_obra_ids(db, current_user)
    if visible is None:
        return await service.mark_all_read(obra_id=None, tenant_id=current_user.tenant_id)
    # Non-admin sin obra_id explícito: iteramos las obras donde tiene rol.
    updated: list = []
    for oid in visible:
        updated.extend(
            await service.mark_all_read(obra_id=oid, tenant_id=current_user.tenant_id)
        )
    return updated


@router.patch("/{alert_id}/read", response_model=AlertRead)
async def mark_alert_read(
    alert_id: int,
    db: DbSession,
    current_user: Annotated[User, Depends(require_alert_obra_role(ObraUserRoleType.COLABORADOR))],
):
    return await AlertService(db).mark_read(alert_id, tenant_id=current_user.tenant_id)
