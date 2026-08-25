import logging
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ConflictError
from app.core.plan_limits import check_plan_limit
from app.core.security import create_access_token, create_refresh_token, hash_password, verify_password
from app.models.obra import Obra
from app.models.obra_user_role import ObraUserRole, ObraUserRoleType
from app.models.user import User
from app.repositories.user import UserRepository
from app.schemas.user import (
    AcceptInviteRequest,
    InviteRequest,
    ObraAssignmentInvite,
    UserCreate,
)

logger = logging.getLogger(__name__)

INVITE_TTL_HOURS = 72
RESET_TTL_HOURS = 1
VERIFY_TTL_HOURS = 48


class AuthService:
    def __init__(self, session: AsyncSession) -> None:
        self.repo = UserRepository(session)

    async def register(self, data: UserCreate) -> User:
        if await self.repo.get_by_email(data.email):
            raise ConflictError("Email already registered")
        # Quien se registra crea su propia empresa → es admin de ese espacio.
        # (Los colaboradores entran por invitación, no por registro.)
        user = User(
            email=data.email,
            hashed_password=hash_password(data.password),
            full_name=data.full_name,
            role="admin",
            is_active=True,
            is_verified=False,
            verification_token=secrets.token_urlsafe(32),
            verification_expires=datetime.now(timezone.utc) + timedelta(hours=VERIFY_TTL_HOURS),
        )
        user = await self.repo.create(user)

        # Cada registro nuevo arranca con su propia empresa en plan Básico.
        # (Los invitados NO pasan por acá — heredan el tenant del que invita.)
        from sqlalchemy import select
        from app.models.plan import Plan
        from app.models.tenant import Tenant
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
        user.tenant_id = tenant.id
        await self.repo.session.flush()
        return user

    async def login(self, email: str, password: str) -> tuple[str, str]:
        user = await self.repo.get_by_email(email)
        if not user or not verify_password(password, user.hashed_password):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid credentials",
            )
        if not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Account is inactive",
            )
        refresh_token, refresh_expires = create_refresh_token()
        await self.repo.update_fields(
            user.id,
            refresh_token=refresh_token,
            refresh_token_expires_at=refresh_expires,
        )
        return create_access_token(user.id), refresh_token

    async def invite(
        self, data: InviteRequest, tenant_id: int | None = None
    ) -> tuple[User, str, list[ObraAssignmentInvite]]:
        """Emite una invitación. Si el payload incluye obra_assignments, valida
        que cada obra sea del tenant del que invita y guarda las asignaciones
        válidas en `pending_obra_assignments` (JSON) para materializarlas cuando
        el invitado acepte.

        Devuelve (user_creado, token, asignaciones_efectivas). La lista de
        asignaciones efectivas puede diferir del input si alguna obra_id era
        inválida — esas se descartan silenciosamente (con warning log) y no
        rompen la invitación."""
        if await self.repo.get_by_email(data.email):
            raise ConflictError("Este email ya tiene una cuenta registrada")

        effective_assignments = await self._validate_assignments(
            data.obra_assignments, tenant_id
        )

        token = secrets.token_urlsafe(32)
        expires_at = datetime.now(timezone.utc) + timedelta(hours=INVITE_TTL_HOURS)
        user = User(
            email=data.email,
            hashed_password="",  # set when the invite is accepted
            full_name="",
            role=data.role,
            is_active=False,
            invitation_token=token,
            invitation_expires_at=expires_at,
            tenant_id=tenant_id,  # hereda la empresa del admin que invita
            pending_obra_assignments=(
                [a.model_dump(mode="json") for a in effective_assignments]
                if effective_assignments else None
            ),
        )
        created = await self.repo.create(user)
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
        Solo aplica a invitados que todavía no aceptaron (`is_active=False`)."""
        from app.core.exceptions import NotFoundError
        user = await self.repo.get(user_id)
        # Mismo criterio de aislamiento que update_member_role/remove_member:
        # "no existe" y "es de otro tenant" se colapsan en el mismo 404.
        if not user or (tenant_id is not None and user.tenant_id != tenant_id):
            raise NotFoundError("User", user_id)
        if user.is_active:
            raise ConflictError("Este usuario ya aceptó la invitación")
        token = secrets.token_urlsafe(32)
        expires_at = datetime.now(timezone.utc) + timedelta(hours=INVITE_TTL_HOURS)
        updated = await self.repo.update_fields(
            user.id, invitation_token=token, invitation_expires_at=expires_at
        )
        return updated, token

    async def get_invite_context(self, token: str) -> dict:
        """Contexto de una invitación pendiente (sin consumir el token): a qué
        empresa, con qué email y rol se une el invitado, y qué obras se le van
        a asignar al aceptar. Lanza si es inválida/expiró."""
        user = await self.repo.get_by_invitation_token(token)
        if not user or user.is_active:
            raise HTTPException(status_code=400, detail="Invitación inválida")
        exp = user.invitation_expires_at
        if exp is not None:
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            if exp < datetime.now(timezone.utc):
                raise HTTPException(status_code=400, detail="La invitación expiró")
        company_name = None
        if user.tenant_id:
            from app.models.tenant import Tenant
            tenant = await self.repo.session.get(Tenant, user.tenant_id)
            company_name = tenant.name if tenant else None
        # Hidratamos las asignaciones pendientes con el nombre de cada obra
        # (para que el frontend muestre "vas a entrar a estas obras").
        obra_assignments: list[dict] = []
        if user.pending_obra_assignments:
            obra_ids = [a["obra_id"] for a in user.pending_obra_assignments]
            names = dict((await self.repo.session.execute(
                select(Obra.id, Obra.name).where(Obra.id.in_(obra_ids))
            )).all())
            for a in user.pending_obra_assignments:
                if a["obra_id"] in names:
                    obra_assignments.append({
                        "obra_id": a["obra_id"],
                        "obra_name": names[a["obra_id"]],
                        "role": a["role"],
                    })
        return {
            "email": user.email,
            "role": user.role,
            "company_name": company_name,
            "obra_assignments": obra_assignments,
        }

    async def accept_invite(self, data: AcceptInviteRequest) -> tuple[str, str]:
        user = await self.repo.get_by_invitation_token(data.token)
        if not user:
            raise HTTPException(status_code=400, detail="Invitación inválida")
        exp = user.invitation_expires_at
        if exp is not None:
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            if exp < datetime.now(timezone.utc):
                raise HTTPException(status_code=400, detail="La invitación expiró")
        # Doble candado: si desde que se emitió la invitación el tenant bajó de plan
        # (o el conteo se corrió por otra vía), no dejamos que esta acceptación empuje
        # el tenant por encima del límite. requested=0 porque este usuario ya está
        # contado como "invitación viva" desde el momento del invite.
        await check_plan_limit(self.repo.session, user.tenant_id, "users", requested=0)
        # Snapshot de las asignaciones pendientes ANTES de update_fields
        # (update_fields limpia la columna y refresca la instancia).
        pending = list(user.pending_obra_assignments or [])
        refresh_token, refresh_expires = create_refresh_token()
        await self.repo.update_fields(
            user.id,
            full_name=data.full_name,
            hashed_password=hash_password(data.password),
            is_active=True,
            invitation_token=None,
            invitation_expires_at=None,
            refresh_token=refresh_token,
            refresh_token_expires_at=refresh_expires,
            pending_obra_assignments=None,
        )
        # Materializar las asignaciones en la misma transacción. Re-validamos
        # que cada obra siga existiendo/perteneciendo al tenant (defensive: en
        # el hueco entre invite y accept el admin podría haber borrado una
        # obra); las inválidas se descartan silenciosamente para no romper el
        # accept. Ver docs/roles-redesign/fase-3-invitacion.md §Edge cases.
        if pending and user.tenant_id is not None:
            obra_ids = [a["obra_id"] for a in pending]
            rows = await self.repo.session.execute(
                select(Obra.id).where(
                    Obra.id.in_(obra_ids), Obra.tenant_id == user.tenant_id
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
                    tenant_id=user.tenant_id,
                    role=role_enum,
                ))
            await self.repo.session.flush()
        return create_access_token(user.id), refresh_token

    async def request_password_reset(self, email: str) -> tuple[User, str] | None:
        """Genera un token de reset para un usuario activo. Devuelve (user, token) o None
        si el email no existe / está inactivo (el caller NO revela cuál es el caso)."""
        user = await self.repo.get_by_email(email)
        if not user or not user.is_active:
            return None
        token = secrets.token_urlsafe(32)
        expires = datetime.now(timezone.utc) + timedelta(hours=RESET_TTL_HOURS)
        await self.repo.update_fields(user.id, reset_token=token, reset_token_expires=expires)
        return user, token

    async def reset_password(self, token: str, new_password: str) -> tuple[str, str]:
        """Valida el token, setea la nueva contraseña y devuelve access + refresh token."""
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
        refresh_token, refresh_expires = create_refresh_token()
        await self.repo.update_fields(
            user.id,
            hashed_password=hash_password(new_password),
            reset_token=None,
            reset_token_expires=None,
            refresh_token=refresh_token,
            refresh_token_expires_at=refresh_expires,
        )
        return create_access_token(user.id), refresh_token

    async def refresh(self, token: str) -> tuple[str, str]:
        """Rota el refresh token: invalida el viejo, emite access + nuevo refresh token."""
        user = await self.repo.get_by_refresh_token(token)
        if not user or not user.is_active:
            raise HTTPException(status_code=401, detail="Refresh token inválido")
        exp = user.refresh_token_expires_at
        if exp is not None:
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            if exp < datetime.now(timezone.utc):
                raise HTTPException(status_code=401, detail="Refresh token expirado")
        new_refresh, new_expires = create_refresh_token()
        await self.repo.update_fields(
            user.id,
            refresh_token=new_refresh,
            refresh_token_expires_at=new_expires,
        )
        return create_access_token(user.id), new_refresh

    async def logout(self, token: str) -> None:
        """Invalida el refresh token en DB. Si no existe, no hace nada (idempotente)."""
        user = await self.repo.get_by_refresh_token(token)
        if user:
            await self.repo.update_fields(
                user.id,
                refresh_token=None,
                refresh_token_expires_at=None,
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
