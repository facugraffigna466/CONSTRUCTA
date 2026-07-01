from datetime import date, datetime
from sqlalchemy import case, cast, DateTime as SADateTime, delete, func, literal, select, Time as SATime, update
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.obra import Obra
from app.models.task import Task, TaskStatus, task_dependencies_table
from app.models.task_material import TaskMaterial
from app.repositories.base import BaseRepository


class TaskRepository(BaseRepository[Task]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(Task, session)

    async def list_by_obra(self, obra_id: int) -> list[Task]:
        result = await self.session.execute(
            select(Task)
            .where(Task.obra_id == obra_id)
            .order_by(Task.order_index, Task.id)
        )
        return list(result.scalars().all())

    async def list_by_responsible(self, responsible_id: int) -> list[Task]:
        result = await self.session.execute(
            select(Task)
            .where(
                Task.responsible_id == responsible_id,
                Task.status.notin_([TaskStatus.COMPLETADA, TaskStatus.CANCELADA]),
            )
            .order_by(Task.due_date.nulls_last())
        )
        return list(result.scalars().all())

    async def list_due_soon_for_manager(
        self, manager_id: int, today: date, deadline: date
    ) -> list[Task]:
        result = await self.session.execute(
            select(Task)
            .join(Obra, Task.obra_id == Obra.id)
            .where(
                Obra.manager_id == manager_id,
                Task.due_date >= today,
                Task.due_date <= deadline,
                Task.status.notin_([TaskStatus.COMPLETADA, TaskStatus.CANCELADA]),
            )
            .order_by(Task.due_date, Task.id)
        )
        return list(result.scalars().all())

    async def list_due_in_window(
        self, window_start: datetime, window_end: datetime
    ) -> list[Task]:
        """Tasks whose due datetime (due_date + due_time, Argentina tz) falls within the UTC window.
        Tasks with no due_time are treated as due at 23:59 local time."""
        local_naive = cast(Task.due_date, SADateTime) + func.coalesce(
            Task.due_time,
            cast(literal("23:59:00"), SATime),
        )
        utc_dt = func.timezone("America/Argentina/Buenos_Aires", local_naive)
        result = await self.session.execute(
            select(Task)
            .where(
                Task.due_date.isnot(None),
                utc_dt >= window_start,
                utc_dt < window_end,
                Task.status.notin_([TaskStatus.COMPLETADA, TaskStatus.CANCELADA]),
            )
            .order_by(Task.due_date, Task.id)
        )
        return list(result.scalars().all())

    async def list_due_soon_all(self, today: date, deadline: date) -> list[Task]:
        """All tasks due within [today, deadline] across all obras (used by NotificationService)."""
        result = await self.session.execute(
            select(Task)
            .where(
                Task.due_date >= today,
                Task.due_date <= deadline,
                Task.status.notin_([TaskStatus.COMPLETADA, TaskStatus.CANCELADA]),
            )
            .order_by(Task.due_date, Task.id)
        )
        return list(result.scalars().all())

    async def list_overdue(self, as_of: date) -> list[Task]:
        result = await self.session.execute(
            select(Task).where(
                Task.due_date < as_of,
                Task.status.notin_([TaskStatus.COMPLETADA, TaskStatus.CANCELADA]),
            )
        )
        return list(result.scalars().all())

    async def unassign_active_tasks_by_responsible(
        self, responsible_id: int
    ) -> list[Task]:
        result = await self.session.execute(
            select(Task).where(
                Task.responsible_id == responsible_id,
                Task.status.notin_([TaskStatus.COMPLETADA, TaskStatus.CANCELADA]),
            )
        )
        tasks = list(result.scalars().all())
        if tasks:
            task_ids = [t.id for t in tasks]
            await self.session.execute(
                update(Task)
                .where(Task.id.in_(task_ids))
                .values(responsible_id=None)
            )
            for task in tasks:
                await self.session.refresh(task)
        return tasks

    async def update_status(
        self,
        task_id: int,
        status: TaskStatus,
        progress: int,
        completed_date: date | None = None,
    ) -> Task | None:
        fields: dict = {"status": status, "estimated_progress": progress}
        if completed_date is not None:
            fields["completed_date"] = completed_date
        return await self.update_fields(task_id, **fields)

    async def get_dependency_ids(self, task_id: int) -> list[int]:
        """Return IDs of tasks that task_id depends on."""
        result = await self.session.execute(
            select(task_dependencies_table.c.depends_on_id)
            .where(task_dependencies_table.c.task_id == task_id)
        )
        return [row[0] for row in result.fetchall()]

    async def get_dependency_links(self, task_id: int) -> list[dict]:
        """Return full dependency link data (id, type, lag) for a single task."""
        result = await self.session.execute(
            select(
                task_dependencies_table.c.depends_on_id,
                task_dependencies_table.c.dependency_type,
                task_dependencies_table.c.lag_days,
            ).where(task_dependencies_table.c.task_id == task_id)
        )
        return [
            {"depends_on_id": r[0], "dependency_type": r[1], "lag_days": r[2]}
            for r in result.fetchall()
        ]

    async def get_all_dependency_links_by_obra(self, obra_id: int) -> dict[int, list[dict]]:
        """Batch-load all dependency links for all tasks in an obra. Returns {task_id: [links]}."""
        task_ids_result = await self.session.execute(
            select(Task.id).where(Task.obra_id == obra_id)
        )
        task_ids = [r[0] for r in task_ids_result.fetchall()]
        if not task_ids:
            return {}
        result = await self.session.execute(
            select(
                task_dependencies_table.c.task_id,
                task_dependencies_table.c.depends_on_id,
                task_dependencies_table.c.dependency_type,
                task_dependencies_table.c.lag_days,
            ).where(task_dependencies_table.c.task_id.in_(task_ids))
        )
        links_by_task: dict[int, list[dict]] = {}
        for tid, dep_id, dep_type, lag in result.fetchall():
            links_by_task.setdefault(tid, []).append(
                {"depends_on_id": dep_id, "dependency_type": dep_type, "lag_days": lag}
            )
        return links_by_task

    async def materials_summary_by_obra(self, obra_id: int) -> dict[int, dict]:
        """Resumen de materiales por tarea: cantidad de ítems, costo estimado total
        (Σ cantidad×precio) y cuántos aún no fueron recibidos. Una sola query."""
        result = await self.session.execute(
            select(
                TaskMaterial.task_id,
                func.count(TaskMaterial.id),
                func.coalesce(func.sum(TaskMaterial.quantity * TaskMaterial.unit_price), 0),
                func.coalesce(func.sum(case((TaskMaterial.status != "recibido", 1), else_=0)), 0),
            )
            .join(Task, Task.id == TaskMaterial.task_id)
            .where(Task.obra_id == obra_id)
            .group_by(TaskMaterial.task_id)
        )
        out: dict[int, dict] = {}
        for task_id, count, cost, pending in result.fetchall():
            out[task_id] = {
                "count": int(count or 0),
                "cost": float(cost or 0),
                "pending": int(pending or 0),
            }
        return out

    async def set_dependencies(self, task_id: int, links: list[dict]) -> None:
        """Replace the full dependency set for task_id (each link has depends_on_id, dependency_type, lag_days)."""
        await self.session.execute(
            delete(task_dependencies_table).where(task_dependencies_table.c.task_id == task_id)
        )
        for link in links:
            await self.session.execute(
                task_dependencies_table.insert().values(
                    task_id=task_id,
                    depends_on_id=link["depends_on_id"],
                    dependency_type=link.get("dependency_type", "FS"),
                    lag_days=link.get("lag_days", 0),
                )
            )
        await self.session.commit()
