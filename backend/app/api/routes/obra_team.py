from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.orm import selectinload

from app.core.deps import DbSession
from app.core.obra_permissions import require_obra_role
from app.models.obra_team_member import ObraTeamMember
from app.models.obra_user_role import ObraUserRoleType
from app.models.responsible import Responsible
from app.models.user import User
from app.services.responsible_service import ResponsibleService

router = APIRouter(prefix="/obras", tags=["obra-team"])


class ObraTeamMemberRead(BaseModel):
    responsible_id: int
    full_name: str
    whatsapp_number: str
    role: str | None
    is_active: bool
    plan_disciplines: list[str] | None  # null = ve todos los planos

    model_config = {"from_attributes": True}


class AddTeamMemberPayload(BaseModel):
    responsible_id: int | None = None
    full_name: str | None = None
    whatsapp_number: str | None = None
    role: str | None = None
    plan_disciplines: list[str] | None = None  # null = acceso total


class UpdateTeamMemberPayload(BaseModel):
    role: str | None = None
    plan_disciplines: list[str] | None = None


def _to_read(m: ObraTeamMember, resp: Responsible) -> ObraTeamMemberRead:
    return ObraTeamMemberRead(
        responsible_id=resp.id,
        full_name=resp.full_name,
        whatsapp_number=resp.whatsapp_number,
        role=m.role,
        is_active=resp.is_active,
        plan_disciplines=m.plan_disciplines,
    )


@router.get("/{obra_id}/team", response_model=list[ObraTeamMemberRead])
async def list_team(
    obra_id: int,
    db: DbSession,
    current_user: Annotated[User, Depends(require_obra_role(ObraUserRoleType.SOLO_LECTURA))],
):
    result = await db.execute(
        select(ObraTeamMember)
        .where(ObraTeamMember.obra_id == obra_id)
        .options(selectinload(ObraTeamMember.responsible))
        .order_by(ObraTeamMember.id)
    )
    return [_to_read(m, m.responsible) for m in result.scalars().all()]


@router.post("/{obra_id}/team", response_model=ObraTeamMemberRead, status_code=status.HTTP_201_CREATED)
async def add_team_member(
    obra_id: int,
    payload: AddTeamMemberPayload,
    db: DbSession,
    current_user: Annotated[User, Depends(require_obra_role(ObraUserRoleType.JEFE_OBRA))],
):
    if payload.responsible_id:
        resp = await db.get(Responsible, payload.responsible_id)
        if not resp:
            raise HTTPException(status_code=404, detail="Responsible not found")
        # Hallazgo 6.2 auditoría 04: sin este chequeo, un admin de tenant A podía
        # inyectar responsables de tenant B a su equipo (y ver sus datos + hacer
        # que el bot les hable de sus obras). 404 sin revelar existencia.
        if (
            resp.tenant_id is not None
            and current_user.tenant_id is not None
            and resp.tenant_id != current_user.tenant_id
        ):
            raise HTTPException(status_code=404, detail="Responsible not found")
    elif payload.full_name and payload.whatsapp_number:
        from app.repositories.responsible import ResponsibleRepository
        from app.schemas.responsible import ResponsibleCreate
        # Reusar responsable existente (activo o desactivado) que ya tenga el
        # mismo número — no queremos crear duplicados.
        resp = await ResponsibleRepository(db).get_by_whatsapp_any(payload.whatsapp_number)
        if not resp:
            resp = await ResponsibleService(db).create(
                ResponsibleCreate(full_name=payload.full_name, whatsapp_number=payload.whatsapp_number, role=None),
                tenant_id=current_user.tenant_id,
            )
    else:
        raise HTTPException(status_code=422, detail="Provide responsible_id or full_name + whatsapp_number")

    existing = await db.execute(
        select(ObraTeamMember).where(
            ObraTeamMember.obra_id == obra_id,
            ObraTeamMember.responsible_id == resp.id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Already in this obra's team")

    member = ObraTeamMember(
        obra_id=obra_id,
        tenant_id=current_user.tenant_id,
        responsible_id=resp.id,
        role=payload.role,
        # `or None` acá rompía el caso "sin acceso": [] es falsy, así que un alta
        # con plan_disciplines=[] terminaba guardando None — o sea, acceso total,
        # exactamente lo contrario de lo pedido. El default del schema ya es None.
        plan_disciplines=payload.plan_disciplines,
    )
    db.add(member)
    await db.commit()

    # Rediseño identidad WhatsApp — parte C: si el responsable todavía no
    # confirmó (nuevo o creado en el paso anterior), disparamos el WhatsApp
    # de bienvenida. Fire-and-forget: no bloquea el 201 si Twilio no responde.
    from app.services.responsible_confirmation import send_welcome_confirmation
    from app.models.obra import Obra
    obra_row = await db.get(Obra, obra_id)
    await send_welcome_confirmation(
        resp, obra_name=(obra_row.name if obra_row else None)
    )

    return _to_read(member, resp)


@router.patch("/{obra_id}/team/{responsible_id}", response_model=ObraTeamMemberRead)
async def update_team_member(
    obra_id: int,
    responsible_id: int,
    payload: UpdateTeamMemberPayload,
    db: DbSession,
    current_user: Annotated[User, Depends(require_obra_role(ObraUserRoleType.JEFE_OBRA))],
):
    result = await db.execute(
        select(ObraTeamMember)
        .where(ObraTeamMember.obra_id == obra_id, ObraTeamMember.responsible_id == responsible_id)
        .options(selectinload(ObraTeamMember.responsible))
    )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=404, detail="Not in this obra's team")
    member.role = payload.role
    # lista vacía [] = sin acceso; None = acceso total
    member.plan_disciplines = payload.plan_disciplines
    await db.commit()
    return _to_read(member, member.responsible)


@router.delete("/{obra_id}/team/{responsible_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_team_member(
    obra_id: int,
    responsible_id: int,
    db: DbSession,
    current_user: Annotated[User, Depends(require_obra_role(ObraUserRoleType.JEFE_OBRA))],
):
    await db.execute(
        delete(ObraTeamMember).where(
            ObraTeamMember.obra_id == obra_id,
            ObraTeamMember.responsible_id == responsible_id,
        )
    )
    await db.commit()
