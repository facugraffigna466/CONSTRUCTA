from typing import Any
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.historial import HistorialEvento
from app.repositories.base import BaseRepository


class HistorialRepository(BaseRepository[HistorialEvento]):
    def __init__(self, session: AsyncSession):
        super().__init__(HistorialEvento, session)

    async def log(
        self,
        event_type: str,
        description: str,
        obra_id: int | None = None,
        task_id: int | None = None,
        payload: dict[str, Any] | None = None,
        triggered_by: str = "system",
    ) -> HistorialEvento:
        event = HistorialEvento(
            obra_id=obra_id,
            task_id=task_id,
            event_type=event_type,
            description=description,
            payload=payload,
            triggered_by=triggered_by,
        )
        return await self.create(event)

    async def list_by_task(self, task_id: int) -> list[HistorialEvento]:
        result = await self.session.execute(
            select(HistorialEvento)
            .where(HistorialEvento.task_id == task_id)
            .order_by(HistorialEvento.created_at.desc())
        )
        return list(result.scalars().all())

    async def list_by_obra(self, obra_id: int) -> list[HistorialEvento]:
        result = await self.session.execute(
            select(HistorialEvento)
            .where(HistorialEvento.obra_id == obra_id)
            .order_by(HistorialEvento.created_at.desc())
        )
        return list(result.scalars().all())
