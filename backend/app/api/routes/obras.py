from fastapi import APIRouter, Query, status
from typing import Annotated

from app.core.deps import CurrentUser, CurrentUserId, DbSession
from app.repositories.historial import HistorialRepository
from app.schemas.historial import HistorialEventoRead
from app.schemas.obra import ObraCreate, ObraRead, ObraSummary, ObraUpdate
from app.services.obra_service import ObraService

router = APIRouter(prefix="/obras", tags=["obras"])


@router.post("", response_model=ObraRead, status_code=status.HTTP_201_CREATED)
async def create_obra(data: ObraCreate, db: DbSession, current_user: CurrentUser):
    actor = {
        "id": current_user.id,
        "name": current_user.full_name or current_user.email,
        "role": current_user.role,
        "channel": "web",
    }
    return await ObraService(db).create(data, current_user.id, actor=actor)


@router.get("", response_model=list[ObraSummary])
async def list_obras(db: DbSession, _: CurrentUserId):
    return await ObraService(db).list_all()


@router.get("/{obra_id}", response_model=ObraRead)
async def get_obra(obra_id: int, db: DbSession, _: CurrentUserId):
    return await ObraService(db).get_or_raise(obra_id)


@router.patch("/{obra_id}", response_model=ObraRead)
async def update_obra(
    obra_id: int, data: ObraUpdate, db: DbSession, current_user: CurrentUser
):
    actor = {
        "id": current_user.id,
        "name": current_user.full_name or current_user.email,
        "role": current_user.role,
        "channel": "web",
    }
    return await ObraService(db).update(obra_id, data, current_user.id, actor=actor)


@router.delete("/{obra_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_obra(obra_id: int, db: DbSession, user_id: CurrentUserId):
    await ObraService(db).delete(obra_id, user_id)


@router.get("/{obra_id}/historial", response_model=list[HistorialEventoRead])
async def get_obra_historial(
    obra_id: int,
    db: DbSession,
    _: CurrentUserId,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
):
    """Return the latest historial events for an obra, ordered by created_at DESC."""
    await ObraService(db).get_or_raise(obra_id)
    return await HistorialRepository(db).list_by_obra_limited(obra_id, limit)
