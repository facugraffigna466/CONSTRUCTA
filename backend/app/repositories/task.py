from datetime import date, datetime, timezone
from sqlalchemy import case, delete, func, select, update
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

    async def list_due_on_date(self, target: date) -> list[Task]:
        """Tareas activas cuyo vencimiento cae exactamente en `target` (fecha local).

        Comparación por fecha, sin aritmética de horas: los recordatorios son
        "N días antes", no "N horas antes". Antes se usaba una ventana de ±30 min
        sobre due_date+due_time, y como casi ninguna tarea tiene hora cargada el
        default de 23:59 dejaba el recordatorio fuera del horario laboral — nunca
        se enviaba (ver docs/features/recordatorio-vencimiento.md).
        """
        result = await self.session.execute(
            select(Task)
            .where(
                Task.due_date == target,
                Task.status.notin_([TaskStatus.COMPLETADA, TaskStatus.CANCELADA]),
            )
            .order_by(Task.id)
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

    async def list_overdue(self, as_of: date, tenant_id: int | None = None) -> list[Task]:
        stmt = select(Task).where(
            Task.due_date < as_of,
            Task.status.notin_([TaskStatus.COMPLETADA, TaskStatus.CANCELADA]),
        )
        if tenant_id is not None:
            stmt = stmt.where(Task.tenant_id == tenant_id)
        result = await self.session.execute(stmt)
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

    async def update_fields(self, id: int, **fields):  # type: ignore[override]
        """Igual que el genérico, pero sella `last_progress_at` cuando cambia el avance.

        Se hace acá y no en cada call site del service porque `estimated_progress`
        se toca desde varios lados (edición manual, cambio de estado, pipeline del
        chatbot) y todos pasan por update_fields(). Solo se sella si el valor
        realmente cambió: reguardar la tarea con el mismo avance no debería
        resetear el reloj de la regla `progress_stalled`.
        """
        if "estimated_progress" in fields:
            current = await self.session.get(Task, id)
            if current is not None and current.estimated_progress != fields["estimated_progress"]:
                fields["last_progress_at"] = datetime.now(timezone.utc)
        return await super().update_fields(id, **fields)

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
