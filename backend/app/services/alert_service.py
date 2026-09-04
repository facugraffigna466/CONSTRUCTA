from datetime import date, datetime, timezone
from typing import Any
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.models.alert import Alert, AlertSeverity, AlertType
from app.models.obra import ObraStatus
from app.models.task import TaskStatus
from app.repositories.alert import AlertRepository
from app.repositories.historial import HistorialRepository
from app.repositories.obra import ObraRepository
from app.repositories.settings import SettingsRepository
from app.repositories.task import TaskRepository


class AlertService:
    def __init__(self, session: AsyncSession) -> None:
        self.repo = AlertRepository(session)
        self.task_repo = TaskRepository(session)
        self.obra_repo = ObraRepository(session)
        self.historial = HistorialRepository(session)
        self.settings_repo = SettingsRepository(session)

    # ── Public API ────────────────────────────────────────────────────────────

    async def list_all(
        self,
        unread_only: bool = False,
        tenant_id: int | None = None,
        obra_id: int | None = None,
        limit: int | None = None,
    ) -> list[Alert]:
        return await self.repo.list_all(
            unread_only=unread_only, tenant_id=tenant_id, obra_id=obra_id, limit=limit
        )

    async def mark_read(self, alert_id: int, tenant_id: int | None = None) -> Alert:
        alert = await self.repo.get(alert_id)
        if not alert:
            raise NotFoundError("Alert", alert_id)
        # Aislamiento multi-tenant: la alerta debe pertenecer a una obra del tenant.
        if tenant_id is not None and alert.obra_id is not None:
            from app.models.obra import Obra
            obra = await self.repo.session.get(Obra, alert.obra_id)
            if obra is not None and obra.tenant_id is not None and obra.tenant_id != tenant_id:
                raise NotFoundError("Alert", alert_id)
        if alert.is_read:
            return alert
        # resolved_at junto con is_read: sin el timestamp no se puede medir la
        # velocidad de reacción (insights, etapa 2).
        updated = await self.repo.update_fields(
            alert_id, is_read=True, resolved_at=datetime.now(timezone.utc)
        )
        return updated  # type: ignore[return-value]

    async def mark_all_read(self, obra_id: int | None = None, tenant_id: int | None = None) -> list[Alert]:
        return await self.repo.mark_all_read(obra_id=obra_id, tenant_id=tenant_id)

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
        # notify_task_overdue/alert_overdue eran decorativos para este chequeo:
        # esta función corre en cada carga del dashboard de la obra y creaba la
        # alerta de "vencida" (DELAY_RISK) sin importar el setting — el toggle
        # solo apagaba la vía del cron/simulate-overdue (TASK_OVERDUE), un
        # chequeo DISTINTO sobre la misma condición (docs/auditoria/
        # 11-panel-configuracion.md, hallazgo 2).
        cfg = await self.settings_repo.get_for_obra(obra_id)
        overdue_check_enabled = cfg.alert_overdue and cfg.notify_task_overdue

        created = 0
        overdue_tasks = []

        # ── Task-level checks ─────────────────────────────────────────────────
        for task in active_tasks:

            # 1. Overdue task — requires due_date
            if task.due_date and task.due_date < today:
                overdue_tasks.append(task)
                if overdue_check_enabled:
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

    async def evaluate_task_risks_for_all_obras(self) -> int:
        """Corre evaluate_task_risks_for_obra() para todas las obras activas.

        docs/auditoria/06-alertas.md, hallazgo 7.2/8.4: la evaluación de DELAY_RISK
        era puramente reactiva (solo corría al abrir el tab Tareas/Gantt de una obra),
        así que una obra sin visitas nunca generaba alertas aunque tuviera tareas
        vencidas o bloqueadas. Pensado para correr desde un job periódico
        (scheduler.py), NO desde un request — por eso itera todo el sistema.
        Una obra que falla no debe frenar el resto.
        """
        _inactive_obras = {ObraStatus.COMPLETADA, ObraStatus.CANCELADA}
        obras = await self.obra_repo.list_all()
        created = 0
        for obra in obras:
            if obra.status in _inactive_obras:
                continue
            try:
                created += await self.evaluate_task_risks_for_obra(obra.id)
            except Exception:
                import logging
                logging.getLogger(__name__).exception(
                    "evaluate_task_risks_for_obra failed for obra_id=%d", obra.id
                )
        return created

    # ── Emisor genérico ───────────────────────────────────────────────────────

    async def emit(
        self,
        *,
        obra_id: int,
        alert_type: AlertType,
        message: str,
        reason: str,
        task_id: int | None = None,
        severity: AlertSeverity | None = None,
        extra: dict[str, Any] | None = None,
    ) -> int:
        """Crea una alerta salvo que ya exista una idéntica sin leer. Devuelve 0 o 1.

        Único punto de emisión de alertas de riesgo: garantiza las dos invariantes
        que la propuesta pide sostener para toda regla nueva —dedup por
        (task_id/obra_id, tipo, mensaje) contra alertas NO leídas, y exactamente un
        evento en historial por alerta creada.

        La dedup contra no-leídas (y no contra todas) es deliberada: junto con el
        auto-resolve de TaskService cierra el ciclo condición activa → alerta →
        condición resuelta → alerta leída → condición reaparece → alerta nueva.
        Por eso los mensajes de las reglas NO deben incluir contadores volátiles
        tipo "faltan N días": cambiarían todos los días y cada corrida crearía una
        alerta nueva en vez de deduplicar.
        """
        if task_id is not None:
            already = await self.repo.exists_unread_for_task(task_id, alert_type, message)
        else:
            already = await self.repo.exists_unread_for_obra(obra_id, alert_type, message)
        if already:
            return 0

        await self.repo.create_alert(
            alert_type, message, obra_id=obra_id, task_id=task_id, severity=severity
        )
        payload: dict[str, Any] = {"alert_type": alert_type.value, "reason": reason}
        if severity is not None:
            payload["severity"] = severity.value
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

    # ── Private helpers ───────────────────────────────────────────────────────

    async def _task_alert(
        self,
        obra_id: int,
        task_id: int,
        message: str,
        reason: str,
        extra: dict[str, Any] | None = None,
    ) -> int:
        """Alerta DELAY_RISK a nivel tarea. Ver emit() para dedup e historial."""
        return await self.emit(
            obra_id=obra_id,
            task_id=task_id,
            alert_type=AlertType.DELAY_RISK,
            message=message,
            reason=reason,
            extra=extra,
        )

    async def _obra_alert(
        self,
        obra_id: int,
        message: str,
        reason: str,
        extra: dict[str, Any] | None = None,
    ) -> int:
        """Alerta DELAY_RISK a nivel obra (task_id NULL). Ver emit()."""
        return await self.emit(
            obra_id=obra_id,
            alert_type=AlertType.DELAY_RISK,
            message=message,
            reason=reason,
            extra=extra,
        )
