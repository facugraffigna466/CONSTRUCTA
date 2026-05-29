from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ForbiddenError, NotFoundError
from app.models.obra import Obra
from app.models.task import TaskStatus
from app.repositories.historial import HistorialRepository
from app.repositories.obra import ObraRepository
from app.schemas.obra import ObraCreate, ObraUpdate


class ObraService:
    def __init__(self, session: AsyncSession) -> None:
        self.repo = ObraRepository(session)
        self.historial = HistorialRepository(session)

    async def create(self, data: ObraCreate, manager_id: int, actor: dict | None = None) -> Obra:
        obra = Obra(**data.model_dump(), manager_id=manager_id)
        obra = await self.repo.create(obra)
        await self.historial.log(
            obra_id=obra.id,
            event_type="obra_created",
            description=f"Obra '{obra.name}' created",
            payload={"actor": actor} if actor else None,
            triggered_by="user",
        )
        return obra

    async def get_or_raise(self, obra_id: int) -> Obra:
        obra = await self.repo.get(obra_id)
        if not obra:
            raise NotFoundError("Obra", obra_id)
        return obra

    async def get_for_manager(self, obra_id: int, manager_id: int) -> Obra:
        obra = await self.get_or_raise(obra_id)
        if obra.manager_id != manager_id:
            raise ForbiddenError("You are not the manager of this obra")
        return obra

    async def list_mine(self, manager_id: int) -> list[Obra]:
        return await self.repo.list_by_manager(manager_id)

    async def list_all(self) -> list[dict]:
        obras = await self.repo.list_all()
        result = []
        for o in obras:
            non_cancelled = [t for t in o.tasks if t.status != TaskStatus.CANCELADA]
            completed     = [t for t in o.tasks if t.status == TaskStatus.COMPLETADA]
            result.append({
                "id": o.id, "name": o.name, "status": o.status,
                "location": o.location, "image_url": o.image_url,
                "start_date": o.start_date, "expected_end_date": o.expected_end_date,
                "actual_end_date": o.actual_end_date, "manager_id": o.manager_id,
                "completed_tasks": len(completed),
                "total_tasks": len(non_cancelled),
            })
        return result

    async def update(self, obra_id: int, data: ObraUpdate, manager_id: int, actor: dict | None = None) -> Obra:
        obra = await self.get_for_manager(obra_id, manager_id)

        # Two dumps: SQLAlchemy needs native Python types (e.g. date objects),
        # but the historial JSON column requires JSON-serializable values.
        # Using mode="json" on the second dump converts date → ISO string,
        # preventing "date is not JSON serializable" TypeError on commit.
        changes      = data.model_dump(exclude_unset=True)
        changes_json = data.model_dump(exclude_unset=True, mode="json")
        if not changes:
            return obra

        updated = await self.repo.update_fields(obra_id, **changes)
        if actor is not None:
            changes_json["actor"] = actor
        await self.historial.log(
            obra_id=obra_id,
            event_type="obra_updated",
            description=f"Fields updated: {list(changes.keys())}",
            payload=changes_json,
            triggered_by="user",
        )
        return updated  # type: ignore[return-value]

    async def delete(self, obra_id: int, manager_id: int) -> None:
        await self.get_for_manager(obra_id, manager_id)
        await self.repo.delete(obra_id)
