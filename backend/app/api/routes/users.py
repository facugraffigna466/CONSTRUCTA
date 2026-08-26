from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from app.core.config import settings
from app.core.deps import AdminUser, CurrentUser, DbSession
from app.core.exceptions import ConflictError
from app.core.membership_context import AuthenticatedUser
from app.core.plan_limits import check_plan_limit
from app.core.security import hash_password, verify_password
from app.models.obra import Obra
from app.models.obra_user_role import ObraUserRole
from app.models.user import User
from app.repositories.tenant_membership import TenantMembershipRepository
from app.repositories.user import UserRepository
from app.schemas.user import (
    ChangePasswordRequest,
    InviteRequest,
    InviteResponse,
    ObraAssignmentInvite,
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
    # Empresas donde esta identidad tiene membership activa (Fase 4: alimenta
    # el switcher del Sidebar cuando hay más de una).
    from app.models.tenant import Tenant
    from app.schemas.user import TenantOption
    memberships = await TenantMembershipRepository(db).list_active_for_user(current_user.id)
    tenant_names = dict((await db.execute(
        select(Tenant.id, Tenant.name).where(Tenant.id.in_([m.tenant_id for m in memberships]))
    )).all())
    available_tenants = [
        TenantOption(id=m.tenant_id, name=tenant_names.get(m.tenant_id, "?"))
        for m in memberships
    ]
    return out.model_copy(update={"obra_roles": roles, "available_tenants": available_tenants})


@router.patch("/me", response_model=UserRead)
async def update_profile(data: UpdateProfileRequest, current_user: CurrentUser, db: DbSession):
    fields = {k: v for k, v in data.model_dump().items() if v is not None}
    if not fields:
        return UserRead.model_validate(current_user)
    whatsapp_number = fields.pop("whatsapp_number", None)
    if whatsapp_number is not None:
        # Hallazgo 6.4 auditoría 04: si el usuario intenta setear un whatsapp_number
        # que ya existe como Responsible del mismo tenant, el bot no puede resolver
        # cuál es el emisor real. Rechazamos con 409 antes de guardar.
        from app.repositories.responsible import ResponsibleRepository
        colision = await ResponsibleRepository(db).get_by_whatsapp_in_tenant(
            whatsapp_number, current_user.tenant_id
        )
        if colision is not None:
            raise HTTPException(
                status_code=409,
                detail=(
                    "Ese número ya está registrado como responsable en tu empresa. "
                    "Usá un número distinto o eliminá primero al responsable."
                ),
            )
        # whatsapp_number vive en TenantMembership (Fase 3) — es por-empresa,
        # no por-identidad.
        membership_id = getattr(current_user, "membership_id", None)
        if membership_id is not None:
            await TenantMembershipRepository(db).update_fields(
                membership_id, whatsapp_number=whatsapp_number
            )
    if fields:
        await UserRepository(db).update_fields(current_user.id, **fields)
    # current_user envuelve las mismas instancias trackeadas por `db` — los
    # update_fields de arriba ya quedaron reflejados ahí (mismo session
    # identity map), no hace falta releer nada.
    out = UserRead.model_validate(current_user)
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
    membership_repo = TenantMembershipRepository(db)
    memberships = await membership_repo.list_for_tenant(current_user.tenant_id)
    user_ids = [m.user_id for m in memberships]
    users_by_id: dict[int, User] = {}
    if user_ids:
        rows = await db.execute(select(User).where(User.id.in_(user_ids)))
        users_by_id = {u.id: u for u in rows.scalars().all()}
    roles_by_user = await _obra_roles_for_users(db, user_ids)
    out: list[UserRead] = []
    for m in memberships:
        u = users_by_id.get(m.user_id)
        if u is None:
            continue
        base = UserRead.model_validate(AuthenticatedUser(u, m))
        out.append(base.model_copy(update={"obra_roles": roles_by_user.get(m.user_id, [])}))
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
    email_sent = await send_invite_email(data.email, invite_url, data.role)
    return InviteResponse(
        invite_token=token,
        invite_url=invite_url,
        obra_assignments=effective_assignments,
        email_sent=email_sent,
    )


@router.post("/{user_id}/resend-invite", response_model=InviteResponse)
async def resend_invite(user_id: int, current_user: AdminUser, db: DbSession):
    """Renueva el token de una invitación pendiente (ej. si venció) y reenvía el
    email — evita tener que borrar y volver a invitar a mano."""
    try:
        user, token = await AuthService(db).resend_invite(user_id, tenant_id=current_user.tenant_id)
    except ConflictError as e:
        raise HTTPException(status_code=409, detail=str(e))
    membership = await TenantMembershipRepository(db).get_by_user_and_tenant(
        user_id, current_user.tenant_id
    )
    invite_url = f"{settings.FRONTEND_URL}/invite/{token}"
    email_sent = await send_invite_email(
        user.email, invite_url, membership.role if membership else "collaborator"
    )
    obra_assignments = [
        ObraAssignmentInvite(**a)
        for a in ((membership.pending_obra_assignments if membership else None) or [])
    ]
    return InviteResponse(
        invite_token=token,
        invite_url=invite_url,
        obra_assignments=obra_assignments,
        email_sent=email_sent,
    )


@router.patch("/{user_id}/role", response_model=UserRead)
async def update_member_role(user_id: int, data: RoleUpdateRequest, current_user: AdminUser, db: DbSession):
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="No podés cambiar tu propio rol")
    membership_repo = TenantMembershipRepository(db)
    # Aislamiento por tenant: un admin solo opera sobre miembros de SU empresa.
    # "no existe" y "es de otro tenant" se colapsan en el mismo 404.
    target_membership = await membership_repo.get_by_user_and_tenant(user_id, current_user.tenant_id)
    if target_membership is None:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    updated_membership = await membership_repo.update_fields(target_membership.id, role=data.role)
    target_user = await UserRepository(db).get(user_id)
    out = UserRead.model_validate(AuthenticatedUser(target_user, updated_membership))
    roles = (await _obra_roles_for_users(db, [user_id])).get(user_id, [])
    return out.model_copy(update={"obra_roles": roles})


@router.delete("/{user_id}", status_code=204)
async def remove_member(user_id: int, current_user: AdminUser, db: DbSession):
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="No podés eliminarte a vos mismo")
    membership_repo = TenantMembershipRepository(db)
    target_membership = await membership_repo.get_by_user_and_tenant(user_id, current_user.tenant_id)
    if target_membership is None:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    if target_membership.role == "admin":
        raise HTTPException(status_code=400, detail="No se puede eliminar a otro administrador")
    # Borra solo la membership de ESTA empresa — si la persona pertenece a
    # otro tenant, su cuenta (identidad) sigue intacta ahí.
    await membership_repo.delete(target_membership.id)
