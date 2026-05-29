from datetime import date
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.task import Task, TaskStatus
from app.repositories.task import TaskRepository
from app.repositories.obra import ObraRepository
from app.repositories.historial import HistorialRepository
from app.schemas.task import TaskCreate, TaskUpdate, TaskStatusUpdate
from app.core.exceptions import NotFoundError, ForbiddenError, UnprocessableError


# Transitions the system allows. AI pipeline uses apply_status_update.
VALID_TRANSITIONS: dict[TaskStatus, set[TaskStatus]] = {
    TaskStatus.PENDIENTE:   {TaskStatus.EN_PROGRESO, TaskStatus.CANCELADA},
    TaskStatus.EN_PROGRESO: {TaskStatus.BLOQUEADA, TaskStatus.COMPLETADA, TaskStatus.CANCELADA},
    TaskStatus.BLOQUEADA:   {TaskStatus.EN_PROGRESO, TaskStatus.CANCELADA},
    TaskStatus.COMPLETADA:  set(),
    TaskStatus.CANCELADA:   set(),
}


class TaskService:
    def __init__(self, session: AsyncSession):
        self.repo = TaskRepository(session)
        self.obra_repo = ObraRepository(session)
        self.historial = HistorialRepository(session)

    async def _assert_obra_access(self, obra_id: int, manager_id: int) -> None:
        obra = await self.obra_repo.get(obra_id)
        if not obra:
            raise NotFoundError("Obra", obra_id)
        if obra.manager_id != manager_id:
            raise ForbiddenError()

    async def create(self, data: TaskCreate, manager_id: int) -> Task:
        await self._assert_obra_access(data.obra_id, manager_id)
        task = Task(**data.model_dump())
        task = await self.repo.create(task)
        await self.historial.log(
            obra_id=task.obra_id,
            task_id=task.id,
            event_type="task_created",
            description=f"Task '{task.title}' created",
            triggered_by="user",
        )
        return task

    async def get_or_raise(self, task_id: int) -> Task:
        task = await self.repo.get(task_id)
        if not task:
            raise NotFoundError("Task", task_id)
        return task

    async def list_by_obra(self, obra_id: int, manager_id: int) -> list[Task]:
        await self._assert_obra_access(obra_id, manager_id)
        return await self.repo.list_by_obra(obra_id)

    async def update(self, task_id: int, data: TaskUpdate, manager_id: int) -> Task:
        task = await self.get_or_raise(task_id)
        await self._assert_obra_access(task.obra_id, manager_id)

        changes = data.model_dump(exclude_none=True)
        if not changes:
            return task

        updated = await self.repo.update_fields(task_id, **changes)
        await self.historial.log(
            obra_id=task.obra_id,
            task_id=task_id,
            event_type="task_updated",
            description=f"Task updated: {list(changes.keys())}",
            payload=changes,
            triggered_by="user",
        )
        return updated

    async def delete(self, task_id: int, manager_id: int) -> None:
        task = await self.get_or_raise(task_id)
        await self._assert_obra_access(task.obra_id, manager_id)
        await self.repo.delete(task_id)

    async def apply_status_update(self, task_id: int, update: TaskStatusUpdate) -> Task:
        """Called by the AI pipeline after Claude interprets a message."""
        task = await self.get_or_raise(task_id)

        allowed = VALID_TRANSITIONS.get(task.status, set())
        if update.status not in allowed and update.status != task.status:
            raise UnprocessableError(
                f"Transition {task.status} → {update.status} is not allowed"
            )

        completed_date = None
        if update.status == TaskStatus.COMPLETADA:
            completed_date = update.completed_date or date.today()

        updated = await self.repo.update_status(
            task_id, update.status, update.estimated_progress, completed_date
        )

        if update.status != task.status:
            await self.historial.log(
                obra_id=task.obra_id,
                task_id=task_id,
                event_type="task_status_changed",
                description=f"Status changed: {task.status} → {update.status}",
                payload={
                    "from": task.status,
                    "to": update.status,
                    "progress": update.estimated_progress,
                    "reason": update.reason,
                },
                triggered_by=update.triggered_by,
            )

        return updated
