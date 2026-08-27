from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status

from app.core.deps import AdminUser, CurrentUser, DbSession
from app.schemas.responsible import (
    ActiveTaskBrief,
    ResponsibleCreate,
    ResponsibleRead,
    ResponsibleUpdate,
    ResponsibleWithTasksRead,
)
from app.services.responsible_service import ResponsibleService

router = APIRouter(prefix="/responsibles", tags=["responsibles"])


def _actor(current_user) -> dict:
    return {
        "id": current_user.id,
        "name": current_user.full_name or current_user.email,
        "role": current_user.role,
        "channel": "web",
    }


@router.post("", response_model=ResponsibleRead, status_code=status.HTTP_201_CREATED)
async def create_responsible(
    data: ResponsibleCreate, db: DbSession, current_user: AdminUser
):
    resp = await ResponsibleService(db).create(
        data, tenant_id=current_user.tenant_id, actor=_actor(current_user)
    )
    # Rediseño identidad WhatsApp — parte C: al crear un responsable nuevo
    # se dispara el WhatsApp de bienvenida. No lo hacemos dentro del service
    # para que los tests que crean responsables directo no toquen Twilio.
    from app.services.responsible_confirmation import send_welcome_confirmation
    await send_welcome_confirmation(resp)
    return resp


@router.get("", response_model=list[ResponsibleRead])
async def list_responsibles(
    db: DbSession,
    current_user: CurrentUser,
    active_only: Annotated[bool, Query()] = False,
):
    return await ResponsibleService(db).list_all(active_only=active_only, tenant_id=current_user.tenant_id)


@router.get("/lookup", response_model=ResponsibleWithTasksRead)
async def lookup_responsible_by_whatsapp(
    whatsapp: Annotated[str, Query(description="E.164 format: +5493511234567")],
    db: DbSession,
    current_user: CurrentUser,
):
    """Find a responsible by WhatsApp number and return their active tasks. Used by n8n.

    Hallazgo 6.1 auditoría 04: el lookup ahora está scopeado al tenant del
    usuario. Un usuario del tenant A no ve responsables del tenant B — devuelve 404.
    """
    result = await ResponsibleService(db).lookup_by_whatsapp(
        whatsapp, tenant_id=current_user.tenant_id
    )
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
    responsible_id: int, db: DbSession, current_user: CurrentUser
):
    return await ResponsibleService(db).get_or_raise(responsible_id, current_user.tenant_id)


@router.patch("/{responsible_id}", response_model=ResponsibleRead)
async def update_responsible(
    responsible_id: int, data: ResponsibleUpdate, db: DbSession, current_user: AdminUser
):
    # Capturamos el número anterior ANTES del update para saber si cambió
    # (el service resetea confirmed_at internamente, pero el envío del
    # WhatsApp de bienvenida es un side-effect HTTP que no debe vivir en el
    # service — mismo patrón que en POST /responsibles y POST /obras/{id}/team).
    svc = ResponsibleService(db)
    before = await svc.get_or_raise(responsible_id, current_user.tenant_id)
    old_number = before.whatsapp_number
    updated = await svc.update(responsible_id, data, current_user.tenant_id, actor=_actor(current_user))
    if updated.whatsapp_number != old_number:
        # Editar el whatsapp es "estrenar canal": el nuevo dueño no sabe que
        # fue agregado y confirmed_at ya está en None (reseteado por el service).
        # send_welcome_confirmation es idempotente y fire-and-forget.
        from app.services.responsible_confirmation import send_welcome_confirmation
        await send_welcome_confirmation(updated)
    return updated


@router.patch("/{responsible_id}/reactivate", response_model=ResponsibleRead)
async def reactivate_responsible(responsible_id: int, db: DbSession, current_user: AdminUser):
    """Re-activate an inactive responsible. No task reassignment is performed."""
    return await ResponsibleService(db).reactivate(
        responsible_id, current_user.tenant_id, actor=_actor(current_user)
    )


@router.delete("/{responsible_id}", response_model=ResponsibleRead)
async def deactivate_responsible(responsible_id: int, db: DbSession, current_user: AdminUser):
    """Soft-delete: sets is_active=False. Does not remove from DB."""
    return await ResponsibleService(db).deactivate(
        responsible_id, actor=_actor(current_user), tenant_id=current_user.tenant_id
    )
