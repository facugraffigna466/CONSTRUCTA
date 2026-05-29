from datetime import date
from typing import Any
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.models.alert import Alert, AlertType
from app.models.task import TaskStatus
from app.repositories.alert import AlertRepository
from app.repositories.historial import HistorialRepository
from app.repositories.task import TaskRepository


class AlertService:
    def __init__(self, session: AsyncSession) -> None:
        self.repo = AlertRepository(session)
        self.task_repo = TaskRepository(session)
        self.historial = HistorialRepository(session)

    # ── Public API ────────────────────────────────────────────────────────────

    async def list_all(self, unread_only: bool = False) -> list[Alert]:
        return await self.repo.list_all(unread_only=unread_only)

    async def mark_read(self, alert_id: int) -> Alert:
        alert = await self.repo.get(alert_id)
        if not alert:
            raise NotFoundError("Alert", alert_id)
        if alert.is_read:
            return alert
        updated = await self.repo.update_fields(alert_id, is_read=True)
        return updated  # type: ignore[return-value]

    async def evaluate_task_risks_for_obra(self, obra_id: int) -> int:
        """
        Proactive risk scan called on every obra dashboard load.
        Evaluates five conditions and creates delay_risk alerts when needed.
        All deduplication is by (key fields + message) against unread alerts only.
        Returns the number of new alerts created.
        """
        _inactive = {TaskStatus.COMPLETADA, TaskStatus.CANCELADA}
        today = date.today()

        tasks = await self.task_repo.list_by_obra(obra_id)
        active_tasks = [t for t in tasks if t.status not in _inactive]

        created = 0
        overdue_tasks = []

        # ── Task-level checks ─────────────────────────────────────────────────
        for task in active_tasks:

            # 1. Overdue task — requires due_date
            if task.due_date and task.due_date < today:
                overdue_tasks.append(task)
                fmt = task.due_date.strftime("%d/%m/%Y")
                msg = f"La tarea \u00ab{task.title}\u00bb est\u00e1 vencida desde el {fmt}."
                created += await self._task_alert(
                    obra_id, task.id, msg, "overdue",
                )

            # 2. Missing responsible
            if task.responsible_id is None:
                msg = f"La tarea \u00ab{task.title}\u00bb no tiene responsable asignado."
                created += await self._task_alert(
                    obra_id, task.id, msg, "missing_responsible",
                )

        # ── Obra-level checks ─────────────────────────────────────────────────

        # 4. Many blocked tasks (>= 3)
        blocked_count = sum(
            1 for t in active_tasks if t.status == TaskStatus.BLOQUEADA
        )
        if blocked_count >= 3:
            msg = (
                f"La obra tiene {blocked_count} tareas bloqueadas. "
                "Requiere revisi\u00f3n del cronograma."
            )
            created += await self._obra_alert(
                obra_id, msg, "many_blocked_tasks",
                extra={"blocked_count": blocked_count},
            )

        # 5. High overdue percentage (>= 30 % of active tasks)
        active_count = len(active_tasks)
        overdue_count = len(overdue_tasks)
        if active_count > 0 and overdue_count / active_count >= 0.3:
            percentage = round(overdue_count / active_count * 100)
            msg = (
                f"El {percentage}% de las tareas activas de la obra est\u00e1n vencidas."
            )
            created += await self._obra_alert(
                obra_id, msg, "high_overdue_percentage",
                extra={
                    "overdue_count": overdue_count,
                    "active_count": active_count,
                    "percentage": percentage,
                },
            )

        return created

    # ── Private helpers ───────────────────────────────────────────────────────

    async def _task_alert(
        self,
        obra_id: int,
        task_id: int,
        message: str,
        reason: str,
        extra: dict[str, Any] | None = None,
    ) -> int:
        """Create a task-level delay_risk alert unless an identical unread one exists.

        Dedup is against unread alerts only. Auto-resolve in TaskService.update() marks
        alerts as read when the underlying condition is fixed, so the cycle is:
        condition active → unread alert created → condition fixed → alert auto-resolved
        → condition recurs → new unread alert created (correct recurrence detection).
        """
        already = await self.repo.exists_unread_for_task(
            task_id, AlertType.DELAY_RISK, message
        )
        if already:
            return 0
        await self.repo.create_alert(
            AlertType.DELAY_RISK, message, obra_id=obra_id, task_id=task_id
        )
        payload: dict[str, Any] = {"alert_type": "delay_risk", "reason": reason}
        if extra:
            payload.update(extra)
        await self.historial.log(
            obra_id=obra_id,
            task_id=task_id,
            event_type="alert_created",
            description=message,
            payload=payload,
            triggered_by="system",
        )
        return 1

    async def _obra_alert(
        self,
        obra_id: int,
        message: str,
        reason: str,
        extra: dict[str, Any] | None = None,
    ) -> int:
        """Create an obra-level delay_risk alert unless an identical unread one exists.

        Obra-level messages embed counts, so a severity change produces a different message
        and correctly bypasses dedup. Unread-only dedup is sufficient here — obra-level
        conditions do not have a direct auto-resolve path (no single task update fixes them).
        """
        already = await self.repo.exists_unread_for_obra(
            obra_id, AlertType.DELAY_RISK, message
        )
        if already:
            return 0
        await self.repo.create_alert(
            AlertType.DELAY_RISK, message, obra_id=obra_id, task_id=None
        )
        payload: dict[str, Any] = {"alert_type": "delay_risk", "reason": reason}
        if extra:
            payload.update(extra)
        await self.historial.log(
            obra_id=obra_id,
            task_id=None,
            event_type="alert_created",
            description=message,
            payload=payload,
            triggered_by="system",
        )
        return 1
