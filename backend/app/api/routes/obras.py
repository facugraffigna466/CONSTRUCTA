from fastapi import APIRouter, Depends, Query, status
from typing import Annotated

from app.core.deps import AdminUser, CurrentUser, DbSession
from app.core.obra_permissions import (
    require_obra_role,
    visible_obra_ids,
)
from app.core.plan_limits import check_plan_limit
from app.models.obra_user_role import ObraUserRoleType
from app.models.user import User
from app.repositories.historial import HistorialRepository
from app.schemas.historial import HistorialEventoRead
from app.schemas.obra import ObraCreate, ObraRead, ObraSummary, ObraUpdate
from app.services.obra_service import ObraService

router = APIRouter(prefix="/obras", tags=["obras"])


@router.post("", response_model=ObraRead, status_code=status.HTTP_201_CREATED)
async def create_obra(data: ObraCreate, db: DbSession, current_user: AdminUser):
    await check_plan_limit(db, current_user.tenant_id, "obras")
    actor = {
        "id": current_user.id,
        "name": current_user.full_name or current_user.email,
        "role": current_user.role,
        "channel": "web",
    }
    return await ObraService(db).create(data, current_user.id, actor=actor, tenant_id=current_user.tenant_id)


@router.get("", response_model=list[ObraSummary])
async def list_obras(db: DbSession, current_user: CurrentUser):
    """Portfolio del user.

    - Admin de empresa: ve todas las obras del tenant (como venía siendo).
    - Non-admin: solo las obras donde tiene fila en ObraUserRole (cualquier rol).
      Si no está asignado a ninguna, devuelve [].
    """
    all_obras = await ObraService(db).list_all(tenant_id=current_user.tenant_id)
    visible = await visible_obra_ids(db, current_user)
    if visible is None:
        return all_obras
    return [o for o in all_obras if o["id"] in visible]


@router.get("/{obra_id}", response_model=ObraRead)
async def get_obra(
    obra_id: int,
    db: DbSession,
    current_user: Annotated[User, Depends(require_obra_role(ObraUserRoleType.SOLO_LECTURA))],
):
    return await ObraService(db).get_or_raise(obra_id, tenant_id=current_user.tenant_id)


@router.patch("/{obra_id}", response_model=ObraRead)
async def update_obra(
    obra_id: int, data: ObraUpdate, db: DbSession, current_user: AdminUser
):
    actor = {
        "id": current_user.id,
        "name": current_user.full_name or current_user.email,
        "role": current_user.role,
        "channel": "web",
    }
    return await ObraService(db).update(obra_id, data, current_user.id, actor=actor)


@router.delete("/{obra_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_obra(obra_id: int, db: DbSession, current_user: AdminUser):
    actor = {
        "id": current_user.id,
        "name": current_user.full_name or current_user.email,
        "role": current_user.role,
        "channel": "web",
    }
    await ObraService(db).delete(obra_id, current_user.id, actor=actor)


@router.get("/{obra_id}/historial", response_model=list[HistorialEventoRead])
async def get_obra_historial(
    obra_id: int,
    db: DbSession,
    current_user: Annotated[User, Depends(require_obra_role(ObraUserRoleType.SOLO_LECTURA))],
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
):
    """Return the latest historial events for an obra, ordered by created_at DESC."""
    await ObraService(db).get_or_raise(obra_id, tenant_id=current_user.tenant_id)
    return await HistorialRepository(db).list_by_obra_limited(obra_id, limit)


@router.get("/historial/global", response_model=list[HistorialEventoRead])
async def get_global_historial(
    db: DbSession,
    current_user: AdminUser,
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
):
    """Eventos de la empresa sin una obra puntual: obras eliminadas (snapshot
    previo al borrado) y gestión del directorio de responsables. docs/
    auditoria/07-historial.md, hallazgos 7.1/8.1 y 7.3/8.2."""
    return await HistorialRepository(db).list_global_by_tenant(current_user.tenant_id, limit)
