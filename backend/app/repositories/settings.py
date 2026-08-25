from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.settings import SystemSettings


def _defaults() -> SystemSettings:
    """Return an unsaved SystemSettings instance with all default values.
    Used as fallback when no settings row exists for a tenant yet."""
    return SystemSettings(
        tenant_id=0,
        chatbot_enabled=True,
        send_hour_from=8,
        send_hour_to=20,
        max_response_hours=24,
        auto_reminders=True,
        reminder_3days=True,
        reminder_1day=True,
        alert_overdue=True,
        alert_no_response=True,
        retry_failed=True,
        notify_task_overdue=True,
        notify_task_blocked=True,
        notify_no_response=True,
        notify_rescheduled=True,
    )


class SettingsRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_by_tenant(self, tenant_id: int) -> SystemSettings | None:
        result = await self.session.execute(
            select(SystemSettings).where(SystemSettings.tenant_id == tenant_id)
        )
        return result.scalar_one_or_none()

    async def get_or_create(self, tenant_id: int) -> SystemSettings:
        obj = await self.get_by_tenant(tenant_id)
        if obj:
            return obj
        obj = SystemSettings(tenant_id=tenant_id)
        self.session.add(obj)
        await self.session.commit()
        await self.session.refresh(obj)
        return obj

    async def update(self, tenant_id: int, data: dict) -> SystemSettings:
        obj = await self.get_or_create(tenant_id)
        for field, value in data.items():
            setattr(obj, field, value)
        await self.session.commit()
        await self.session.refresh(obj)
        return obj

    async def get_for_responsible(self, responsible_id: int) -> SystemSettings:
        """Return settings for the tenant of this responsible.
        Falls back to defaults if no settings row exists yet."""
        from app.models.responsible import Responsible

        result = await self.session.execute(
            select(SystemSettings)
            .join(Responsible, SystemSettings.tenant_id == Responsible.tenant_id)
            .where(Responsible.id == responsible_id)
        )
        return result.scalar_one_or_none() or _defaults()

    async def get_for_obra(self, obra_id: int) -> SystemSettings:
        """Return settings for the tenant that owns the given obra.
        Falls back to defaults if no settings row exists yet."""
        from app.models.obra import Obra

        result = await self.session.execute(
            select(SystemSettings)
            .join(Obra, SystemSettings.tenant_id == Obra.tenant_id)
            .where(Obra.id == obra_id)
        )
        return result.scalar_one_or_none() or _defaults()
