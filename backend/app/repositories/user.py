from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.user import User
from app.repositories.base import BaseRepository


class UserRepository(BaseRepository[User]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(User, session)

    async def get_by_email(self, email: str) -> User | None:
        result = await self.session.execute(
            select(User).where(User.email == email)
        )
        return result.scalar_one_or_none()

    async def get_by_invitation_token(self, token: str) -> User | None:
        result = await self.session.execute(
            select(User).where(User.invitation_token == token)
        )
        return result.scalar_one_or_none()

    async def get_by_reset_token(self, token: str) -> User | None:
        result = await self.session.execute(
            select(User).where(User.reset_token == token)
        )
        return result.scalar_one_or_none()

    async def get_by_whatsapp(self, number: str) -> User | None:
        result = await self.session.execute(
            select(User).where(User.whatsapp_number == number, User.is_active.is_(True))
        )
        return result.scalars().first()

    async def list_all(self, tenant_id: int | None = None) -> list[User]:
        stmt = select(User).order_by(User.created_at)
        if tenant_id is not None:
            stmt = stmt.where(User.tenant_id == tenant_id)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def count(self) -> int:
        from sqlalchemy import func
        result = await self.session.execute(select(func.count()).select_from(User))
        return result.scalar_one()
