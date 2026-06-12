from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.orm import selectinload

from app.core.deps import AdminUser, CurrentUserId, DbSession
from app.models.obra_team_member import ObraTeamMember
from app.models.responsible import Responsible
from app.services.responsible_service import ResponsibleService

router = APIRouter(prefix="/obras", tags=["obra-team"])


class ObraTeamMemberRead(BaseModel):
    responsible_id: int
    full_name: str
    whatsapp_number: str
    role: str | None
    is_active: bool

    model_config = {"from_attributes": True}


class AddTeamMemberPayload(BaseModel):
    responsible_id: int | None = None   # existing responsible
    full_name: str | None = None        # new responsible fields
    whatsapp_number: str | None = None
    role: str | None = None             # role in this obra


class UpdateTeamMemberRolePayload(BaseModel):
    role: str | None = None


@router.get("/{obra_id}/team", response_model=list[ObraTeamMemberRead])
async def list_team(obra_id: int, db: DbSession, _: CurrentUserId):
    result = await db.execute(
        select(ObraTeamMember)
        .where(ObraTeamMember.obra_id == obra_id)
        .options(selectinload(ObraTeamMember.responsible))
        .order_by(ObraTeamMember.id)
    )
    members = result.scalars().all()
    return [
        ObraTeamMemberRead(
            responsible_id=m.responsible_id,
            full_name=m.responsible.full_name,
            whatsapp_number=m.responsible.whatsapp_number,
            role=m.role,
            is_active=m.responsible.is_active,
        )
        for m in members
    ]


@router.post("/{obra_id}/team", response_model=ObraTeamMemberRead, status_code=status.HTTP_201_CREATED)
async def add_team_member(obra_id: int, payload: AddTeamMemberPayload, db: DbSession, current_user: AdminUser):
    if payload.responsible_id:
        resp = await db.get(Responsible, payload.responsible_id)
        if not resp:
            raise HTTPException(status_code=404, detail="Responsible not found")
    elif payload.full_name and payload.whatsapp_number:
        from app.schemas.responsible import ResponsibleCreate
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

    member = ObraTeamMember(obra_id=obra_id, responsible_id=resp.id, role=payload.role)
    db.add(member)
    await db.commit()

    return ObraTeamMemberRead(
        responsible_id=resp.id,
        full_name=resp.full_name,
        whatsapp_number=resp.whatsapp_number,
        role=payload.role,
        is_active=resp.is_active,
    )


@router.patch("/{obra_id}/team/{responsible_id}", response_model=ObraTeamMemberRead)
async def update_team_member_role(obra_id: int, responsible_id: int, payload: UpdateTeamMemberRolePayload, db: DbSession, _: AdminUser):
    result = await db.execute(
        select(ObraTeamMember)
        .where(ObraTeamMember.obra_id == obra_id, ObraTeamMember.responsible_id == responsible_id)
        .options(selectinload(ObraTeamMember.responsible))
    )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=404, detail="Not in this obra's team")
    member.role = payload.role
    await db.commit()
    return ObraTeamMemberRead(
        responsible_id=member.responsible_id,
        full_name=member.responsible.full_name,
        whatsapp_number=member.responsible.whatsapp_number,
        role=member.role,
        is_active=member.responsible.is_active,
    )


@router.delete("/{obra_id}/team/{responsible_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_team_member(obra_id: int, responsible_id: int, db: DbSession, _: AdminUser):
    await db.execute(
        delete(ObraTeamMember).where(
            ObraTeamMember.obra_id == obra_id,
            ObraTeamMember.responsible_id == responsible_id,
        )
    )
    await db.commit()
