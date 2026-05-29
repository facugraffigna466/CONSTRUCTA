from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status

from app.core.deps import CurrentUser, CurrentUserId, DbSession
from app.schemas.responsible import (
    ActiveTaskBrief,
    ResponsibleCreate,
    ResponsibleRead,
    ResponsibleUpdate,
    ResponsibleWithTasksRead,
)
from app.services.responsible_service import ResponsibleService

router = APIRouter(prefix="/responsibles", tags=["responsibles"])


@router.post("", response_model=ResponsibleRead, status_code=status.HTTP_201_CREATED)
async def create_responsible(
    data: ResponsibleCreate, db: DbSession, _: CurrentUserId
):
    return await ResponsibleService(db).create(data)


@router.get("", response_model=list[ResponsibleRead])
async def list_responsibles(
    db: DbSession,
    _: CurrentUserId,
    active_only: Annotated[bool, Query()] = False,
):
    return await ResponsibleService(db).list_all(active_only=active_only)


@router.get("/lookup", response_model=ResponsibleWithTasksRead)
async def lookup_responsible_by_whatsapp(
    whatsapp: Annotated[str, Query(description="E.164 format: +5493511234567")],
    db: DbSession,
    _: CurrentUserId,
):
    """Find a responsible by WhatsApp number and return their active tasks. Used by n8n."""
    result = await ResponsibleService(db).lookup_by_whatsapp(whatsapp)
    if not result:
        raise HTTPException(status_code=404, detail="Responsible not found")
    responsible, tasks = result
    return ResponsibleWithTasksRead(
        id=responsible.id,
        full_name=responsible.full_name,
        whatsapp_number=responsible.whatsapp_number,
        role=responsible.role,
        is_active=responsible.is_active,
        created_at=responsible.created_at,
        active_tasks=[ActiveTaskBrief.model_validate(t) for t in tasks],
    )


@router.get("/{responsible_id}", response_model=ResponsibleRead)
async def get_responsible(
    responsible_id: int, db: DbSession, _: CurrentUserId
):
    return await ResponsibleService(db).get_or_raise(responsible_id)


@router.patch("/{responsible_id}", response_model=ResponsibleRead)
async def update_responsible(
    responsible_id: int, data: ResponsibleUpdate, db: DbSession, _: CurrentUserId
):
    return await ResponsibleService(db).update(responsible_id, data)


@router.patch("/{responsible_id}/reactivate", response_model=ResponsibleRead)
async def reactivate_responsible(responsible_id: int, db: DbSession, _: CurrentUserId):
    """Re-activate an inactive responsible. No task reassignment is performed."""
    return await ResponsibleService(db).reactivate(responsible_id)


@router.delete("/{responsible_id}", response_model=ResponsibleRead)
async def deactivate_responsible(responsible_id: int, db: DbSession, current_user: CurrentUser):
    """Soft-delete: sets is_active=False. Does not remove from DB."""
    actor = {
        "id": current_user.id,
        "name": current_user.full_name or current_user.email,
        "role": current_user.role,
        "channel": "web",
    }
    return await ResponsibleService(db).deactivate(responsible_id, actor=actor)
