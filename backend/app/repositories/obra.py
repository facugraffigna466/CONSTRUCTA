from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from app.models.obra import Obra
from app.repositories.base import BaseRepository


class ObraRepository(BaseRepository[Obra]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(Obra, session)

    async def list_by_manager(self, manager_id: int) -> list[Obra]:
        result = await self.session.execute(
            select(Obra)
            .where(Obra.manager_id == manager_id)
            .order_by(Obra.created_at.desc())
        )
        return list(result.scalars().all())

    async def list_all(self) -> list[Obra]:
        result = await self.session.execute(
            select(Obra)
            .options(selectinload(Obra.tasks))
            .order_by(Obra.created_at.desc())
        )
        return list(result.scalars().all())

    async def get_with_tasks(self, obra_id: int) -> Obra | None:
        result = await self.session.execute(
            select(Obra)
            .where(Obra.id == obra_id)
            .options(selectinload(Obra.tasks))
        )
        return result.scalar_one_or_none()
