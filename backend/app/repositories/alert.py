from datetime import datetime, timezone

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant_denorm import tenant_for_obra
from app.models.alert import DEFAULT_SEVERITY, Alert, AlertSeverity, AlertType
from app.repositories.base import BaseRepository


def _resolved_now() -> dict[str, object]:
    """Valores del UPDATE que resuelve una alerta.

    `resolved_at` acompaña siempre a `is_read=True` para que la métrica de
    velocidad de reacción (insights, etapa 2) tenga el CUÁNDO, no solo el SI.
    """
    return {"is_read": True, "resolved_at": datetime.now(timezone.utc)}


class AlertRepository(BaseRepository[Alert]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(Alert, session)

    async def create_alert(
        self,
        alert_type: AlertType,
        message: str,
        obra_id: int | None = None,
        task_id: int | None = None,
        severity: AlertSeverity | None = None,
    ) -> Alert:
        """Crea la alerta y la emite por Socket.IO.

        `severity` es opcional: si no se pasa, se usa la severidad por defecto del
        tipo (DEFAULT_SEVERITY en models/alert.py). Solo las reglas que calculan un
        peso dinámico —por ejemplo baseline_deviation, que escala con los días de
        desvío— necesitan pasarla explícitamente.
        """
        from app.core.socket_manager import emit_alert_created
        alert = Alert(
            type=alert_type,
            message=message,
            obra_id=obra_id,
            task_id=task_id,
            severity=(severity or DEFAULT_SEVERITY.get(alert_type, AlertSeverity.MEDIA)).value,
            tenant_id=await tenant_for_obra(self.session, obra_id),
        )
        alert = await self.create(alert)
        await emit_alert_created(alert)
        return alert

    async def exists_unread_for_task(
        self,
        task_id: int,
        alert_type: AlertType,
        message: str,
    ) -> bool:
        """Return True if an unread alert with this exact task/type/message already exists."""
        result = await self.session.execute(
            select(Alert).where(
                Alert.task_id == task_id,
                Alert.type == alert_type,
                Alert.message == message,
                Alert.is_read == False,  # noqa: E712
            )
        )
        return result.scalar_one_or_none() is not None

    async def exists_unread_for_obra(
        self,
        obra_id: int,
        alert_type: AlertType,
        message: str,
    ) -> bool:
        """Return True if an unread obra-level (task_id IS NULL) alert already exists."""
        result = await self.session.execute(
            select(Alert).where(
                Alert.obra_id == obra_id,
                Alert.task_id.is_(None),
                Alert.type == alert_type,
                Alert.message == message,
                Alert.is_read == False,  # noqa: E712
            )
        )
        return result.scalar_one_or_none() is not None

    async def exists_for_task(
        self,
        task_id: int,
        alert_type: AlertType,
        message: str,
    ) -> bool:
        """Return True if ANY alert (read or unread) with this exact task/type/message exists.
        Used to prevent re-creating delay_risk alerts for chronic unresolved conditions."""
        result = await self.session.execute(
            select(Alert).where(
                Alert.task_id == task_id,
                Alert.type == alert_type,
                Alert.message == message,
            )
        )
        return result.scalar_one_or_none() is not None

    async def exists_for_obra(
        self,
        obra_id: int,
        alert_type: AlertType,
        message: str,
    ) -> bool:
        """Return True if ANY obra-level alert (read or unread) with this exact obra/type/message exists."""
        result = await self.session.execute(
            select(Alert).where(
                Alert.obra_id == obra_id,
                Alert.task_id.is_(None),
                Alert.type == alert_type,
                Alert.message == message,
            )
        )
        return result.scalar_one_or_none() is not None

    async def mark_read_by_task_and_type(
        self, task_id: int, alert_type: AlertType, tenant_id: int | None = None
    ) -> None:
        """Mark all unread alerts of a given type for a task as read (auto-resolve).

        `tenant_id` es opcional pero se recomienda pasarlo siempre desde el caller:
        acota el UPDATE al tenant dueño de la tarea (docs/auditoria/06-alertas.md,
        hallazgo 7.5/8.7). Hoy todos los callers son internos y ya validaron acceso
        a la obra antes de llegar acá, pero esto evita que un futuro endpoint que
        reciba task_id directamente pueda tocar alertas de otro tenant.
        """
        stmt = update(Alert).where(
            Alert.task_id == task_id,
            Alert.type == alert_type,
            Alert.is_read == False,  # noqa: E712
        )
        if tenant_id is not None:
            stmt = stmt.where(Alert.tenant_id == tenant_id)
        await self.session.execute(stmt.values(**_resolved_now()))

    async def mark_read_by_task_and_fragment(
        self, task_id: int, alert_type: AlertType, fragment: str, tenant_id: int | None = None
    ) -> None:
        """Mark unread alerts as read for a task where message contains fragment.

        Used for targeted auto-resolve: resolves only the sub-condition that was fixed
        (e.g. 'responsable' for missing-responsible alerts) without touching unrelated
        alerts for the same task. See mark_read_by_task_and_type() for the tenant_id note.
        """
        stmt = update(Alert).where(
            Alert.task_id == task_id,
            Alert.type == alert_type,
            Alert.message.ilike(f"%{fragment}%"),
            Alert.is_read == False,  # noqa: E712
        )
        if tenant_id is not None:
            stmt = stmt.where(Alert.tenant_id == tenant_id)
        await self.session.execute(stmt.values(**_resolved_now()))

    async def mark_read_by_task(self, task_id: int, tenant_id: int | None = None) -> None:
        """Mark all unread alerts for a task as read. Called before task deletion."""
        stmt = update(Alert).where(Alert.task_id == task_id, Alert.is_read == False)  # noqa: E712
        if tenant_id is not None:
            stmt = stmt.where(Alert.tenant_id == tenant_id)
        await self.session.execute(stmt.values(**_resolved_now()))

    async def mark_all_read(self, obra_id: int | None = None, tenant_id: int | None = None) -> list[Alert]:
        """Mark every unread alert as read (optionally scoped to an obra). Returns the updated rows."""
        stmt = select(Alert).where(Alert.is_read == False)  # noqa: E712
        if obra_id is not None:
            stmt = stmt.where(Alert.obra_id == obra_id)
        if tenant_id is not None:
            stmt = stmt.where(Alert.tenant_id == tenant_id)
        alerts = list((await self.session.execute(stmt)).scalars().all())
        resolved = _resolved_now()
        for alert in alerts:
            alert.is_read = True
            alert.resolved_at = resolved["resolved_at"]  # type: ignore[assignment]
        await self.session.flush()
        return alerts

    async def list_all(
        self,
        unread_only: bool = False,
        tenant_id: int | None = None,
        obra_id: int | None = None,
        limit: int | None = None,
    ) -> list[Alert]:
        stmt = select(Alert)
        if unread_only:
            stmt = stmt.where(Alert.is_read == False)  # noqa: E712
        if obra_id is not None:
            stmt = stmt.where(Alert.obra_id == obra_id)
        if tenant_id is not None:
            stmt = stmt.where(Alert.tenant_id == tenant_id)
        stmt = stmt.order_by(Alert.created_at.desc())
        if limit is not None:
            stmt = stmt.limit(limit)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())
