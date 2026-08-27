from typing import Any
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.tenant_denorm import tenant_for_obra
from app.models.historial import HistorialEvento
from app.repositories.base import BaseRepository


class HistorialRepository(BaseRepository[HistorialEvento]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(HistorialEvento, session)

    async def log(
        self,
        event_type: str,
        description: str,
        obra_id: int | None = None,
        task_id: int | None = None,
        payload: dict[str, Any] | None = None,
        triggered_by: str = "system",
        tenant_id: int | None = None,
    ) -> HistorialEvento:
        """`tenant_id` es opcional y solo hace falta pasarlo explícito cuando
        `obra_id` es None (ej. eventos de responsables, que son del directorio
        global de la empresa, no de una obra puntual) — sin obra no hay forma
        de derivarlo con tenant_for_obra() (docs/auditoria/07-historial.md,
        hallazgo 7.3/8.2). Con obra_id, se sigue derivando como siempre."""
        resolved_tenant_id = (
            tenant_id if tenant_id is not None else await tenant_for_obra(self.session, obra_id)
        )
        event = HistorialEvento(
            obra_id=obra_id,
            task_id=task_id,
            tenant_id=resolved_tenant_id,
            event_type=event_type,
            description=description,
            payload=payload,
            triggered_by=triggered_by,
        )
        event = await self.create(event)
        from app.core.socket_manager import emit_historial_created
        await emit_historial_created(event)
        return event

    async def list_by_obra_limited(
        self, obra_id: int, limit: int = 50
    ) -> list[HistorialEvento]:
        result = await self.session.execute(
            select(HistorialEvento)
            .where(HistorialEvento.obra_id == obra_id)
            .order_by(HistorialEvento.created_at.desc())
            .limit(limit)
        )
        return list(result.scalars().all())

    async def list_by_obra(self, obra_id: int) -> list[HistorialEvento]:
        result = await self.session.execute(
            select(HistorialEvento)
            .where(HistorialEvento.obra_id == obra_id)
            .order_by(HistorialEvento.created_at.desc())
        )
        return list(result.scalars().all())

    async def list_global_by_tenant(
        self, tenant_id: int, limit: int = 100
    ) -> list[HistorialEvento]:
        """Eventos sin obra (obra_id IS NULL) de un tenant: el snapshot de
        `obra_deleted` (la obra ya no existe, pero tenant_id sobrevive porque
        es una columna propia, no derivada de la FK) y los eventos del
        directorio global de responsables. docs/auditoria/07-historial.md,
        hallazgos 7.1/8.1 y 7.3/8.2."""
        result = await self.session.execute(
            select(HistorialEvento)
            .where(HistorialEvento.obra_id.is_(None), HistorialEvento.tenant_id == tenant_id)
            .order_by(HistorialEvento.created_at.desc())
            .limit(limit)
        )
        return list(result.scalars().all())

    async def list_by_task(self, task_id: int) -> list[HistorialEvento]:
        result = await self.session.execute(
            select(HistorialEvento)
            .where(HistorialEvento.task_id == task_id)
            .order_by(HistorialEvento.created_at.desc())
        )
        return list(result.scalars().all())
