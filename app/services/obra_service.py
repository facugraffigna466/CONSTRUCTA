from sqlalchemy.ext.asyncio import AsyncSession
from app.models.obra import Obra, ObraStatus
from app.repositories.obra import ObraRepository
from app.repositories.historial import HistorialRepository
from app.schemas.obra import ObraCreate, ObraUpdate
from app.core.exceptions import NotFoundError, ForbiddenError


class ObraService:
    def __init__(self, session: AsyncSession):
        self.repo = ObraRepository(session)
        self.historial = HistorialRepository(session)

    async def create(self, data: ObraCreate, manager_id: int) -> Obra:
        obra = Obra(**data.model_dump(), manager_id=manager_id)
        obra = await self.repo.create(obra)
        await self.historial.log(
            obra_id=obra.id,
            event_type="obra_created",
            description=f"Obra '{obra.name}' created",
            triggered_by="user",
        )
        return obra

    async def get_or_raise(self, obra_id: int) -> Obra:
        obra = await self.repo.get(obra_id)
        if not obra:
            raise NotFoundError("Obra", obra_id)
        return obra

    async def list_mine(self, manager_id: int) -> list[Obra]:
        return await self.repo.list_by_manager(manager_id)

    async def update(self, obra_id: int, data: ObraUpdate, manager_id: int) -> Obra:
        obra = await self.get_or_raise(obra_id)
        if obra.manager_id != manager_id:
            raise ForbiddenError("You are not the manager of this obra")

        changes = data.model_dump(exclude_none=True)
        if not changes:
            return obra

        updated = await self.repo.update_fields(obra_id, **changes)
        await self.historial.log(
            obra_id=obra_id,
            event_type="obra_updated",
            description=f"Obra updated: {list(changes.keys())}",
            payload=changes,
            triggered_by="user",
        )
        return updated

    async def delete(self, obra_id: int, manager_id: int) -> None:
        obra = await self.get_or_raise(obra_id)
        if obra.manager_id != manager_id:
            raise ForbiddenError("You are not the manager of this obra")
        await self.repo.delete(obra_id)

    async def get_with_tasks(self, obra_id: int, manager_id: int) -> Obra:
        obra = await self.repo.get_with_tasks(obra_id)
        if not obra:
            raise NotFoundError("Obra", obra_id)
        if obra.manager_id != manager_id:
            raise ForbiddenError()
        return obra
