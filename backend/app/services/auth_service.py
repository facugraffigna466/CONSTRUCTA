import secrets
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ConflictError
from app.core.security import create_access_token, hash_password, verify_password
from app.models.user import User
from app.repositories.user import UserRepository
from app.schemas.user import AcceptInviteRequest, InviteRequest, UserCreate

INVITE_TTL_HOURS = 72


class AuthService:
    def __init__(self, session: AsyncSession) -> None:
        self.repo = UserRepository(session)

    async def register(self, data: UserCreate) -> User:
        if await self.repo.get_by_email(data.email):
            raise ConflictError("Email already registered")
        # First user ever becomes admin
        role = "admin" if await self.repo.count() == 0 else "collaborator"
        user = User(
            email=data.email,
            hashed_password=hash_password(data.password),
            full_name=data.full_name,
            role=role,
            is_active=True,
        )
        return await self.repo.create(user)

    async def login(self, email: str, password: str) -> str:
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
        return create_access_token(user.id)

    async def invite(self, data: InviteRequest) -> tuple[User, str]:
        if await self.repo.get_by_email(data.email):
            raise ConflictError("Este email ya tiene una cuenta registrada")
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
        )
        created = await self.repo.create(user)
        return created, token

    async def accept_invite(self, data: AcceptInviteRequest) -> str:
        user = await self.repo.get_by_invitation_token(data.token)
        if not user:
            raise HTTPException(status_code=400, detail="Invitación inválida")
        if user.invitation_expires_at and user.invitation_expires_at < datetime.now(timezone.utc):
            raise HTTPException(status_code=400, detail="La invitación expiró")
        await self.repo.update_fields(
            user.id,
            full_name=data.full_name,
            hashed_password=hash_password(data.password),
            is_active=True,
            invitation_token=None,
            invitation_expires_at=None,
        )
        return create_access_token(user.id)
