from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.alert import Alert, AlertType
from app.repositories.base import BaseRepository


class AlertRepository(BaseRepository[Alert]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(Alert, session)

    async def create_alert(
        self,
        alert_type: AlertType,
        message: str,
        obra_id: int | None = None,
        task_id: int | None = None,
    ) -> Alert:
        from app.core.socket_manager import emit_alert_created
        alert = Alert(
            type=alert_type,
            message=message,
            obra_id=obra_id,
            task_id=task_id,
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
        self, task_id: int, alert_type: AlertType
    ) -> None:
        """Mark all unread alerts of a given type for a task as read (auto-resolve)."""
        await self.session.execute(
            update(Alert)
            .where(
                Alert.task_id == task_id,
                Alert.type == alert_type,
                Alert.is_read == False,  # noqa: E712
            )
            .values(is_read=True)
        )

    async def mark_read_by_task_and_fragment(
        self, task_id: int, alert_type: AlertType, fragment: str
    ) -> None:
        """Mark unread alerts as read for a task where message contains fragment.

        Used for targeted auto-resolve: resolves only the sub-condition that was fixed
        (e.g. 'responsable' for missing-responsible alerts) without touching unrelated
        alerts for the same task.
        """
        await self.session.execute(
            update(Alert)
            .where(
                Alert.task_id == task_id,
                Alert.type == alert_type,
                Alert.message.ilike(f"%{fragment}%"),
                Alert.is_read == False,  # noqa: E712
            )
            .values(is_read=True)
        )

    async def mark_read_by_task(self, task_id: int) -> None:
        """Mark all unread alerts for a task as read. Called before task deletion."""
        await self.session.execute(
            update(Alert)
            .where(Alert.task_id == task_id, Alert.is_read == False)  # noqa: E712
            .values(is_read=True)
        )

    async def list_all(self, unread_only: bool = False) -> list[Alert]:
        stmt = select(Alert)
        if unread_only:
            stmt = stmt.where(Alert.is_read == False)  # noqa: E712
        stmt = stmt.order_by(Alert.created_at.desc())
        result = await self.session.execute(stmt)
        return list(result.scalars().all())
