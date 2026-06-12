from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.responsible import Responsible
from app.repositories.base import BaseRepository


class ResponsibleRepository(BaseRepository[Responsible]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(Responsible, session)

    async def get_by_whatsapp(self, number: str) -> Responsible | None:
        """Primary lookup for the chatbot pipeline (Phase 2)."""
        result = await self.session.execute(
            select(Responsible).where(Responsible.whatsapp_number == number)
        )
        return result.scalar_one_or_none()

    async def list_active(self, tenant_id: int | None = None) -> list[Responsible]:
        stmt = (
            select(Responsible)
            .where(Responsible.is_active.is_(True))
            .order_by(Responsible.full_name)
        )
        if tenant_id is not None:
            stmt = stmt.where(Responsible.tenant_id == tenant_id)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def list_all(self, tenant_id: int | None = None) -> list[Responsible]:
        stmt = select(Responsible).order_by(Responsible.full_name)
        if tenant_id is not None:
            stmt = stmt.where(Responsible.tenant_id == tenant_id)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())
