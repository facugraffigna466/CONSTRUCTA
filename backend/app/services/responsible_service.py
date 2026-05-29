from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ConflictError, NotFoundError
from app.models.responsible import Responsible
from app.models.task import Task
from app.repositories.historial import HistorialRepository
from app.repositories.responsible import ResponsibleRepository
from app.repositories.task import TaskRepository
from app.schemas.responsible import ResponsibleCreate, ResponsibleUpdate


class ResponsibleService:
    def __init__(self, session: AsyncSession) -> None:
        self.repo = ResponsibleRepository(session)
        self.task_repo = TaskRepository(session)
        self.historial = HistorialRepository(session)

    async def create(self, data: ResponsibleCreate) -> Responsible:
        existing = await self.repo.get_by_whatsapp(data.whatsapp_number)
        if existing:
            raise ConflictError(
                f"A responsible with number {data.whatsapp_number} already exists"
            )
        responsible = Responsible(**data.model_dump())
        return await self.repo.create(responsible)

    async def get_or_raise(self, responsible_id: int) -> Responsible:
        responsible = await self.repo.get(responsible_id)
        if not responsible:
            raise NotFoundError("Responsible", responsible_id)
        return responsible

    async def lookup_by_whatsapp(
        self, phone: str
    ) -> tuple[Responsible, list[Task]] | None:
        responsible = await self.repo.get_by_whatsapp(phone)
        if not responsible:
            return None
        tasks = await self.task_repo.list_by_responsible(responsible.id)
        return responsible, tasks

    async def list_all(self, active_only: bool = False) -> list[Responsible]:
        if active_only:
            return await self.repo.list_active()
        return await self.repo.list_all()

    async def update(self, responsible_id: int, data: ResponsibleUpdate) -> Responsible:
        await self.get_or_raise(responsible_id)
        changes = data.model_dump(exclude_none=True)
        if not changes:
            return await self.get_or_raise(responsible_id)
        updated = await self.repo.update_fields(responsible_id, **changes)
        return updated  # type: ignore[return-value]

    async def reactivate(self, responsible_id: int) -> Responsible:
        """Re-activate an inactive responsible.

        No task reassignment is done — the responsible becomes available
        for new task assignments but existing tasks are unchanged.
        """
        responsible = await self.get_or_raise(responsible_id)
        if responsible.is_active:
            return responsible
        updated = await self.repo.update_fields(responsible_id, is_active=True)
        return updated  # type: ignore[return-value]

    async def deactivate(self, responsible_id: int, actor: dict | None = None) -> Responsible:
        await self.get_or_raise(responsible_id)
        updated = await self.repo.update_fields(responsible_id, is_active=False)
        affected_tasks = await self.task_repo.unassign_active_tasks_by_responsible(
            responsible_id
        )
        for task in affected_tasks:
            payload: dict = {
                "field": "responsible_id",
                "from": responsible_id,
                "to": None,
                "reason": "responsible_deactivated",
            }
            if actor is not None:
                payload["actor"] = actor
            await self.historial.log(
                obra_id=task.obra_id,
                task_id=task.id,
                event_type="task_updated",
                description="Responsable desasignado porque fue desactivado",
                payload=payload,
                triggered_by="user",
            )
        return updated  # type: ignore[return-value]
