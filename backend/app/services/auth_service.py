import logging
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ConflictError
from app.core.plan_limits import check_plan_limit
from app.core.security import (
    create_access_token,
    create_pre_auth_token,
    create_refresh_token,
    decode_access_token,
    hash_password,
    verify_password,
)
from app.models.obra import Obra
from app.models.obra_user_role import ObraUserRole, ObraUserRoleType
from app.models.tenant import Tenant
from app.models.tenant_membership import TenantMembership
from app.models.user import User
from app.repositories.tenant_membership import TenantMembershipRepository
from app.repositories.user import UserRepository
from app.schemas.user import (
    AcceptInviteRequest,
    InviteRequest,
    LoginResponse,
    ObraAssignmentInvite,
    TenantOption,
    UserCreate,
)

logger = logging.getLogger(__name__)

INVITE_TTL_HOURS = 72
RESET_TTL_HOURS = 1
VERIFY_TTL_HOURS = 48


class AuthService:
    def __init__(self, session: AsyncSession) -> None:
        self.repo = UserRepository(session)
        self.membership_repo = TenantMembershipRepository(session)

    async def register(self, data: UserCreate) -> User:
        if await self.repo.get_by_email(data.email):
            raise ConflictError("Email already registered")
        # Quien se registra crea su propia empresa → es admin de ese espacio.
        # (Los colaboradores entran por invitación, no por registro.)
        user = User(
            email=data.email,
            hashed_password=hash_password(data.password),
            full_name=data.full_name,
            is_verified=False,
            verification_token=secrets.token_urlsafe(32),
            verification_expires=datetime.now(timezone.utc) + timedelta(hours=VERIFY_TTL_HOURS),
        )
        user = await self.repo.create(user)

        # Cada registro nuevo arranca con su propia empresa en plan Básico.
        # (Los invitados NO pasan por acá — heredan el tenant del que invita.)
        from app.models.plan import Plan
        basico = (await self.repo.session.execute(
            select(Plan).where(Plan.name == "basico")
        )).scalar_one_or_none()
        tenant = Tenant(
            name=data.company_name or f"Empresa de {data.full_name or data.email}",
            plan_id=basico.id if basico else None,
            owner_user_id=user.id,
        )
        self.repo.session.add(tenant)
        await self.repo.session.flush()
        # tenant_id en User: puntero de conveniencia a la "última empresa
        # activa" (lo usa deps.py como fallback cuando el JWT no trae el
        # claim explícito). La fuente de verdad de la membership es la fila
        # de TenantMembership de abajo.
        user.tenant_id = tenant.id
        await self.repo.session.flush()
        membership = await self.membership_repo.create(TenantMembership(
            user_id=user.id, tenant_id=tenant.id, role="admin", is_active=True,
        ))
        from app.core.membership_context import AuthenticatedUser
        return AuthenticatedUser(user, membership)  # type: ignore[return-value]

    async def login(self, email: str, password: str) -> LoginResponse:
        user = await self.repo.get_by_email(email)
        if not user or not verify_password(password, user.hashed_password):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid credentials",
            )
        return await self._finish_login(user)

    async def _finish_login(self, user: User) -> LoginResponse:
        """Resuelve la sesión según cuántas membership activas tiene la
        identidad. 0 → cuenta inactiva (igual que el chequeo viejo de
        User.is_active). 1 → login normal. >1 → pre-auth + lista de empresas
        para elegir en /auth/select-tenant. Compartido por login() y
        reset_password() — ambos "dejan a la persona logueada" al final."""
        memberships = await self.membership_repo.list_active_for_user(user.id)
        if not memberships:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Account is inactive",
            )
        if len(memberships) == 1:
            access, refresh = await self._issue_tokens(user, memberships[0])
            return LoginResponse(access_token=access, refresh_token=refresh)

        tenant_rows = (await self.repo.session.execute(
            select(Tenant.id, Tenant.name).where(
                Tenant.id.in_([m.tenant_id for m in memberships])
            )
        )).all()
        names = dict(tenant_rows)
        return LoginResponse(
            requires_tenant_selection=True,
            pre_auth_token=create_pre_auth_token(user.id),
            tenants=[
                TenantOption(id=m.tenant_id, name=names.get(m.tenant_id, "?"))
                for m in memberships
            ],
        )

    async def _issue_tokens(self, user: User, membership: TenantMembership) -> tuple[str, str]:
        """Emite access+refresh para una membership puntual y actualiza el
        puntero de "última empresa activa" en User (fallback de deps.py)."""
        refresh_token, refresh_expires = create_refresh_token()
        await self.membership_repo.update_fields(
            membership.id,
            refresh_token=refresh_token,
            refresh_token_expires_at=refresh_expires,
        )
        await self.repo.update_fields(user.id, tenant_id=membership.tenant_id)
        access_token = create_access_token(user.id, tenant_id=membership.tenant_id)
        return access_token, refresh_token

    async def select_tenant(self, pre_auth_token: str, tenant_id: int) -> tuple[str, str]:
        """Canjea un pre_auth_token (emitido por login/_finish_login cuando
        había más de una empresa) por una sesión real en la empresa elegida."""
        try:
            payload = decode_access_token(pre_auth_token)
            if payload.get("typ") != "pre_auth":
                raise ValueError("not a pre-auth token")
            user_id = int(payload["sub"])
        except Exception:
            raise HTTPException(status_code=401, detail="Token de selección inválido o expirado")
        user = await self.repo.get(user_id)
        membership = await self.membership_repo.get_by_user_and_tenant(user_id, tenant_id)
        if user is None or membership is None or not membership.is_active:
            raise HTTPException(status_code=404, detail="No pertenecés a esa empresa")
        return await self._issue_tokens(user, membership)

    async def switch_tenant(self, user_id: int, tenant_id: int) -> tuple[str, str]:
        """Variante autenticada de select_tenant: cambiar de empresa sin
        volver a loguearse (switcher del Sidebar, Fase 4). Requiere un Bearer
        de sesión vigente en vez de un pre_auth_token."""
        user = await self.repo.get(user_id)
        membership = await self.membership_repo.get_by_user_and_tenant(user_id, tenant_id)
        if user is None or membership is None or not membership.is_active:
            raise HTTPException(status_code=404, detail="No pertenecés a esa empresa")
        return await self._issue_tokens(user, membership)

    async def invite(
        self, data: InviteRequest, tenant_id: int | None = None
    ) -> tuple[User, str, list[ObraAssignmentInvite]]:
        """Emite una invitación. Si el email ya tiene una identidad (cuenta en
        otra empresa), NO se crea un User nuevo — se agrega una membership más
        a la identidad existente. Si el payload incluye obra_assignments,
        valida que cada obra sea del tenant del que invita y guarda las
        asignaciones válidas en `pending_obra_assignments` (JSON) para
        materializarlas cuando el invitado acepte.

        Devuelve (user, token, asignaciones_efectivas). La lista de
        asignaciones efectivas puede diferir del input si alguna obra_id era
        inválida — esas se descartan silenciosamente (con warning log) y no
        rompen la invitación."""
        effective_assignments = await self._validate_assignments(
            data.obra_assignments, tenant_id
        )
        token = secrets.token_urlsafe(32)
        expires_at = datetime.now(timezone.utc) + timedelta(hours=INVITE_TTL_HOURS)
        pending_json = (
            [a.model_dump(mode="json") for a in effective_assignments]
            if effective_assignments else None
        )

        user = await self.repo.get_by_email(data.email)
        if user is not None:
            if tenant_id is not None:
                existing = await self.membership_repo.get_by_user_and_tenant(user.id, tenant_id)
                if existing is not None:
                    raise ConflictError(
                        "Esta persona ya es miembro (o tiene una invitación pendiente) de esta empresa"
                    )
            await self.membership_repo.create(TenantMembership(
                user_id=user.id, tenant_id=tenant_id, role=data.role, is_active=False,
                invitation_token=token, invitation_expires_at=expires_at,
                pending_obra_assignments=pending_json,
            ))
            return user, token, effective_assignments

        user = User(email=data.email, hashed_password="", full_name="", tenant_id=tenant_id)
        created = await self.repo.create(user)
        if tenant_id is not None:
            await self.membership_repo.create(TenantMembership(
                user_id=created.id, tenant_id=tenant_id, role=data.role, is_active=False,
                invitation_token=token, invitation_expires_at=expires_at,
                pending_obra_assignments=pending_json,
            ))
        return created, token, effective_assignments

    async def _validate_assignments(
        self,
        assignments: list[ObraAssignmentInvite] | None,
        tenant_id: int | None,
    ) -> list[ObraAssignmentInvite]:
        """Filtra la lista de asignaciones a las obras que existen y pertenecen
        al tenant del que invita. Deduplica por obra_id manteniendo la ÚLTIMA
        aparición (permite override si el frontend manda la misma obra dos veces).

        Las obras inválidas (no existen o son de otro tenant) se ignoran
        silenciosamente con un warning log — Fase 3 no rompe el flujo por una
        obra vieja/inválida; ver docs/roles-redesign/fase-3-invitacion.md."""
        if not assignments or tenant_id is None:
            return []
        # Deduplicar (obra_id → assignment): última asignación gana si viene
        # repetida en el payload.
        by_obra: dict[int, ObraAssignmentInvite] = {}
        for a in assignments:
            by_obra[a.obra_id] = a
        if not by_obra:
            return []
        # Una sola query por todas las obras del payload (evita N+1).
        obra_ids = list(by_obra.keys())
        rows = await self.repo.session.execute(
            select(Obra.id).where(
                Obra.id.in_(obra_ids), Obra.tenant_id == tenant_id
            )
        )
        valid_ids = set(rows.scalars().all())
        effective: list[ObraAssignmentInvite] = []
        for obra_id, a in by_obra.items():
            if obra_id in valid_ids:
                effective.append(a)
            else:
                logger.warning(
                    "Invite dropped invalid obra_assignment: obra_id=%s not in tenant_id=%s",
                    obra_id, tenant_id,
                )
        return effective

    async def resend_invite(self, user_id: int, tenant_id: int | None) -> tuple[User, str]:
        """Renueva una invitación pendiente: nuevo token, nuevo TTL de 72h. No
        toca `pending_obra_assignments` (se mantienen las asignaciones originales).
        Solo aplica a invitados que todavía no aceptaron (membership is_active=False)."""
        from app.core.exceptions import NotFoundError
        user = await self.repo.get(user_id)
        membership = (
            await self.membership_repo.get_by_user_and_tenant(user_id, tenant_id)
            if tenant_id is not None else None
        )
        # Mismo criterio de aislamiento que update_member_role/remove_member:
        # "no existe" y "es de otro tenant" se colapsan en el mismo 404.
        if not user or membership is None:
            raise NotFoundError("User", user_id)
        if membership.is_active:
            raise ConflictError("Este usuario ya aceptó la invitación")
        token = secrets.token_urlsafe(32)
        expires_at = datetime.now(timezone.utc) + timedelta(hours=INVITE_TTL_HOURS)
        await self.membership_repo.update_fields(
            membership.id, invitation_token=token, invitation_expires_at=expires_at
        )
        return user, token

    async def get_invite_context(self, token: str) -> dict:
        """Contexto de una invitación pendiente (sin consumir el token): a qué
        empresa, con qué email y rol se une el invitado, y qué obras se le van
        a asignar al aceptar. Lanza si es inválida/expiró."""
        membership = await self.membership_repo.get_by_invitation_token(token)
        if membership is None or membership.is_active:
            raise HTTPException(status_code=400, detail="Invitación inválida")
        exp = membership.invitation_expires_at
        if exp is not None:
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            if exp < datetime.now(timezone.utc):
                raise HTTPException(status_code=400, detail="La invitación expiró")
        user = await self.repo.get(membership.user_id)
        tenant = await self.repo.session.get(Tenant, membership.tenant_id)
        # Hidratamos las asignaciones pendientes con el nombre de cada obra
        # (para que el frontend muestre "vas a entrar a estas obras").
        obra_assignments: list[dict] = []
        if membership.pending_obra_assignments:
            obra_ids = [a["obra_id"] for a in membership.pending_obra_assignments]
            names = dict((await self.repo.session.execute(
                select(Obra.id, Obra.name).where(Obra.id.in_(obra_ids))
            )).all())
            for a in membership.pending_obra_assignments:
                if a["obra_id"] in names:
                    obra_assignments.append({
                        "obra_id": a["obra_id"],
                        "obra_name": names[a["obra_id"]],
                        "role": a["role"],
                    })
        return {
            "email": user.email if user else "",
            "role": membership.role,
            "company_name": tenant.name if tenant else None,
            "existing_account": bool(user and user.hashed_password),
            "obra_assignments": obra_assignments,
        }

    async def accept_invite(self, data: AcceptInviteRequest) -> tuple[str, str]:
        membership = await self.membership_repo.get_by_invitation_token(data.token)
        if membership is None:
            raise HTTPException(status_code=400, detail="Invitación inválida")
        exp = membership.invitation_expires_at
        if exp is not None:
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            if exp < datetime.now(timezone.utc):
                raise HTTPException(status_code=400, detail="La invitación expiró")
        user = await self.repo.get(membership.user_id)
        if user is None:
            raise HTTPException(status_code=400, detail="Invitación inválida")
        # Doble candado: si desde que se emitió la invitación el tenant bajó de plan
        # (o el conteo se corrió por otra vía), no dejamos que esta acceptación empuje
        # el tenant por encima del límite. requested=0 porque este usuario ya está
        # contado como "invitación viva" desde el momento del invite.
        await check_plan_limit(self.repo.session, membership.tenant_id, "users", requested=0)

        is_new_identity = not user.hashed_password
        if is_new_identity:
            if not data.full_name:
                raise HTTPException(status_code=422, detail="full_name es requerido para una cuenta nueva")
            await self.repo.update_fields(
                user.id, full_name=data.full_name, hashed_password=hash_password(data.password),
            )
        else:
            # Identidad existente sumando una empresa más: confirmamos que
            # quien acepta es el dueño de la cuenta con su contraseña actual
            # — no se pisa el hash ni el full_name.
            if not verify_password(data.password, user.hashed_password):
                raise HTTPException(status_code=401, detail="Contraseña incorrecta")

        # Snapshot de las asignaciones pendientes ANTES de update_fields
        # (update_fields limpia la columna y refresca la instancia).
        pending = list(membership.pending_obra_assignments or [])
        await self.membership_repo.update_fields(
            membership.id,
            is_active=True,
            invitation_token=None,
            invitation_expires_at=None,
            pending_obra_assignments=None,
        )
        # Materializar las asignaciones en la misma transacción. Re-validamos
        # que cada obra siga existiendo/perteneciendo al tenant (defensive: en
        # el hueco entre invite y accept el admin podría haber borrado una
        # obra); las inválidas se descartan silenciosamente para no romper el
        # accept. Ver docs/roles-redesign/fase-3-invitacion.md §Edge cases.
        if pending:
            obra_ids = [a["obra_id"] for a in pending]
            rows = await self.repo.session.execute(
                select(Obra.id).where(
                    Obra.id.in_(obra_ids), Obra.tenant_id == membership.tenant_id
                )
            )
            valid_ids = set(rows.scalars().all())
            for a in pending:
                if a["obra_id"] not in valid_ids:
                    logger.warning(
                        "Accept: dropped invalid pending assignment obra_id=%s for user_id=%s",
                        a["obra_id"], user.id,
                    )
                    continue
                try:
                    role_enum = ObraUserRoleType(a["role"])
                except ValueError:
                    logger.warning(
                        "Accept: dropped pending assignment with unknown role=%r for user_id=%s",
                        a["role"], user.id,
                    )
                    continue
                self.repo.session.add(ObraUserRole(
                    obra_id=a["obra_id"],
                    user_id=user.id,
                    tenant_id=membership.tenant_id,
                    role=role_enum,
                ))
            await self.repo.session.flush()
        return await self._issue_tokens(user, membership)

    async def request_password_reset(self, email: str) -> tuple[User, str] | None:
        """Genera un token de reset para una identidad existente. Devuelve
        (user, token) o None si el email no existe (el caller NO revela cuál
        es el caso). Ya no exige membership activa: resetear la contraseña es
        sobre demostrar dueño del email, no sobre el estado de una empresa
        puntual — login() sigue gateando el acceso real por membership."""
        user = await self.repo.get_by_email(email)
        if not user:
            return None
        token = secrets.token_urlsafe(32)
        expires = datetime.now(timezone.utc) + timedelta(hours=RESET_TTL_HOURS)
        await self.repo.update_fields(user.id, reset_token=token, reset_token_expires=expires)
        return user, token

    async def reset_password(self, token: str, new_password: str) -> LoginResponse:
        """Valida el token, setea la nueva contraseña y deja a la persona
        logueada (misma resolución multi-tenant que login)."""
        user = await self.repo.get_by_reset_token(token)
        if not user:
            raise HTTPException(status_code=400, detail="El enlace de recuperación es inválido")
        exp = user.reset_token_expires
        if exp is not None:
            # SQLite devuelve datetimes naive; normalizar a UTC-aware antes de comparar.
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            if exp < datetime.now(timezone.utc):
                raise HTTPException(status_code=400, detail="El enlace de recuperación expiró")
        await self.repo.update_fields(
            user.id,
            hashed_password=hash_password(new_password),
            reset_token=None,
            reset_token_expires=None,
        )
        return await self._finish_login(user)

    async def refresh(self, token: str) -> tuple[str, str]:
        """Rota el refresh token: invalida el viejo, emite access + nuevo
        refresh para la MISMA membership (Fase 3: el refresh token vive en
        TenantMembership, no en User — cada empresa es una sesión aparte)."""
        membership = await self.membership_repo.get_by_refresh_token(token)
        if membership is None or not membership.is_active:
            raise HTTPException(status_code=401, detail="Refresh token inválido")
        exp = membership.refresh_token_expires_at
        if exp is not None:
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            if exp < datetime.now(timezone.utc):
                raise HTTPException(status_code=401, detail="Refresh token expirado")
        user = await self.repo.get(membership.user_id)
        return await self._issue_tokens(user, membership)

    async def logout(self, token: str) -> None:
        """Invalida el refresh token en DB. Si no existe, no hace nada (idempotente)."""
        membership = await self.membership_repo.get_by_refresh_token(token)
        if membership:
            await self.membership_repo.update_fields(
                membership.id, refresh_token=None, refresh_token_expires_at=None,
            )

    async def verify_email(self, token: str) -> None:
        user = await self.repo.get_by_verification_token(token)
        if not user:
            raise HTTPException(status_code=400, detail="El enlace de verificación es inválido")
        exp = user.verification_expires
        if exp is not None:
            if exp.tzinfo is None:  # SQLite devuelve naive
                exp = exp.replace(tzinfo=timezone.utc)
            if exp < datetime.now(timezone.utc):
                raise HTTPException(status_code=400, detail="El enlace de verificación expiró")
        await self.repo.update_fields(
            user.id,
            is_verified=True,
            verification_token=None,
            verification_expires=None,
        )
