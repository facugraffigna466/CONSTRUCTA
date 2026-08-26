from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tenant_membership import TenantMembership
from app.repositories.base import BaseRepository


class TenantMembershipRepository(BaseRepository[TenantMembership]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(TenantMembership, session)

    async def get_by_user_and_tenant(
        self, user_id: int, tenant_id: int
    ) -> TenantMembership | None:
        result = await self.session.execute(
            select(TenantMembership).where(
                TenantMembership.user_id == user_id,
                TenantMembership.tenant_id == tenant_id,
            )
        )
        return result.scalar_one_or_none()

    async def list_active_for_user(self, user_id: int) -> list[TenantMembership]:
        result = await self.session.execute(
            select(TenantMembership).where(
                TenantMembership.user_id == user_id,
                TenantMembership.is_active.is_(True),
            )
        )
        return list(result.scalars().all())

    async def get_by_invitation_token(self, token: str) -> TenantMembership | None:
        result = await self.session.execute(
            select(TenantMembership).where(TenantMembership.invitation_token == token)
        )
        return result.scalar_one_or_none()

    async def get_by_refresh_token(self, token: str) -> TenantMembership | None:
        result = await self.session.execute(
            select(TenantMembership).where(TenantMembership.refresh_token == token)
        )
        return result.scalar_one_or_none()

    async def list_for_tenant(self, tenant_id: int) -> list[TenantMembership]:
        result = await self.session.execute(
            select(TenantMembership)
            .where(TenantMembership.tenant_id == tenant_id)
            .order_by(TenantMembership.created_at)
        )
        return list(result.scalars().all())
