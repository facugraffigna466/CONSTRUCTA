from fastapi import APIRouter, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.deps import AdminUser, CurrentUser, DbSession
from app.core.exceptions import ConflictError
from app.core.plan_limits import check_plan_limit
from app.core.security import hash_password, verify_password
from app.models.obra import Obra
from app.models.obra_user_role import ObraUserRole
from app.models.user import User
from app.repositories.user import UserRepository
from app.schemas.user import (
    ChangePasswordRequest,
    InviteRequest,
    InviteResponse,
    ObraRoleForUserRead,
    RoleUpdateRequest,
    UpdateProfileRequest,
    UserRead,
)
from app.services.auth_service import AuthService
from app.services.email_service import send_invite_email

router = APIRouter(prefix="/users", tags=["users"])


async def _obra_roles_for_users(db: DbSession, user_ids: list[int]) -> dict[int, list[ObraRoleForUserRead]]:
    """Batched lookup: para cada user_id devuelve su lista de (obra_id, obra_name, role).
    Una sola query con join a obras — evita N+1 al listar users."""
    if not user_ids:
        return {}
    rows = await db.execute(
        select(ObraUserRole.user_id, ObraUserRole.obra_id, Obra.name, ObraUserRole.role)
        .join(Obra, Obra.id == ObraUserRole.obra_id)
        .where(ObraUserRole.user_id.in_(user_ids))
        .order_by(ObraUserRole.user_id, ObraUserRole.created_at)
    )
    out: dict[int, list[ObraRoleForUserRead]] = {uid: [] for uid in user_ids}
    for uid, obra_id, obra_name, role in rows.all():
        out.setdefault(uid, []).append(
            ObraRoleForUserRead(obra_id=obra_id, obra_name=obra_name, role=role)
        )
    return out


@router.get("/me", response_model=UserRead)
async def me(current_user: CurrentUser, db: DbSession):
    out = UserRead.model_validate(current_user)
    if current_user.tenant_id:
        from app.models.tenant import Tenant
        tenant = await db.get(Tenant, current_user.tenant_id)
        if tenant:
            out = out.model_copy(update={"tenant_name": tenant.name})
    roles = (await _obra_roles_for_users(db, [current_user.id])).get(current_user.id, [])
    return out.model_copy(update={"obra_roles": roles})


@router.patch("/me", response_model=UserRead)
async def update_profile(data: UpdateProfileRequest, current_user: CurrentUser, db: DbSession):
    fields = {k: v for k, v in data.model_dump().items() if v is not None}
    if not fields:
        return UserRead.model_validate(current_user)
    updated = await UserRepository(db).update_fields(current_user.id, **fields)
    out = UserRead.model_validate(updated)
    roles = (await _obra_roles_for_users(db, [current_user.id])).get(current_user.id, [])
    return out.model_copy(update={"obra_roles": roles})


@router.post("/me/password", status_code=204)
async def change_password(data: ChangePasswordRequest, current_user: CurrentUser, db: DbSession):
    if not verify_password(data.current_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="La contraseña actual es incorrecta")
    await UserRepository(db).update_fields(
        current_user.id,
        hashed_password=hash_password(data.new_password),
    )


@router.get("", response_model=list[UserRead])
async def list_members(current_user: AdminUser, db: DbSession):
    members = await UserRepository(db).list_all(tenant_id=current_user.tenant_id)
    roles_by_user = await _obra_roles_for_users(db, [m.id for m in members])
    out: list[UserRead] = []
    for m in members:
        base = UserRead.model_validate(m)
        out.append(base.model_copy(update={"obra_roles": roles_by_user.get(m.id, [])}))
    return out


@router.post("/invite", response_model=InviteResponse, status_code=201)
async def invite_member(data: InviteRequest, current_user: AdminUser, db: DbSession):
    await check_plan_limit(db, current_user.tenant_id, "users")
    try:
        _, token, effective_assignments = await AuthService(db).invite(
            data, tenant_id=current_user.tenant_id
        )
    except ConflictError as e:
        raise HTTPException(status_code=409, detail=str(e))
    invite_url = f"{settings.FRONTEND_URL}/invite/{token}"
    await send_invite_email(data.email, invite_url, data.role)
    return InviteResponse(
        invite_token=token,
        invite_url=invite_url,
        obra_assignments=effective_assignments,
    )


@router.patch("/{user_id}/role", response_model=UserRead)
async def update_member_role(user_id: int, data: RoleUpdateRequest, current_user: AdminUser, db: DbSession):
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="No podés cambiar tu propio rol")
    repo = UserRepository(db)
    target = await repo.get(user_id)
    # Aislamiento por tenant: un admin solo opera sobre miembros de SU empresa.
    # Se colapsa el caso cross-tenant en el mismo 404 para no filtrar existencia.
    if not target or (
        current_user.tenant_id is not None and target.tenant_id != current_user.tenant_id
    ):
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    updated = await repo.update_fields(user_id, role=data.role)
    out = UserRead.model_validate(updated)
    roles = (await _obra_roles_for_users(db, [user_id])).get(user_id, [])
    return out.model_copy(update={"obra_roles": roles})


@router.delete("/{user_id}", status_code=204)
async def remove_member(user_id: int, current_user: AdminUser, db: DbSession):
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="No podés eliminarte a vos mismo")
    repo = UserRepository(db)
    target = await repo.get(user_id)
    # Aislamiento por tenant: un admin solo opera sobre miembros de SU empresa.
    if not target or (
        current_user.tenant_id is not None and target.tenant_id != current_user.tenant_id
    ):
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    if target.role == "admin":
        raise HTTPException(status_code=400, detail="No se puede eliminar a otro administrador")
    await repo.delete(user_id)
