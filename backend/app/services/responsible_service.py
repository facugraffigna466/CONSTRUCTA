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

    async def create(self, data: ResponsibleCreate, tenant_id: int | None = None) -> Responsible:
        # Chequeo de conflicto SIN filtrar por is_active — dos responsables
        # activos o uno desactivado y otro nuevo con el mismo whatsapp son
        # igualmente inválidos (el número es unique global).
        existing = await self.repo.get_by_whatsapp_any(data.whatsapp_number)
        if existing:
            raise ConflictError(
                f"A responsible with number {data.whatsapp_number} already exists"
            )
        # Nuevo responsable → confirmed_at queda NULL (default). El bot lo
        # trata como "pendiente confirmación" hasta que responda SI.
        # El WhatsApp de bienvenida lo dispara el caller (route de team o de
        # responsibles) — la creación acá es en la misma transacción y no
        # queremos side-effects HTTP en el service para tests que mockean.
        responsible = Responsible(**data.model_dump(), tenant_id=tenant_id)
        return await self.repo.create(responsible)

    async def get_or_raise(self, responsible_id: int, tenant_id: int | None = None) -> Responsible:
        responsible = await self.repo.get(responsible_id)
        if not responsible:
            raise NotFoundError("Responsible", responsible_id)
        # Aislamiento multi-tenant.
        if tenant_id is not None and responsible.tenant_id is not None and responsible.tenant_id != tenant_id:
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

    async def list_all(self, active_only: bool = False, tenant_id: int | None = None) -> list[Responsible]:
        if active_only:
            return await self.repo.list_active(tenant_id=tenant_id)
        return await self.repo.list_all(tenant_id=tenant_id)

    async def update(self, responsible_id: int, data: ResponsibleUpdate, tenant_id: int | None = None) -> Responsible:
        await self.get_or_raise(responsible_id, tenant_id)
        changes = data.model_dump(exclude_none=True)
        if not changes:
            return await self.get_or_raise(responsible_id, tenant_id)
        if "whatsapp_number" in changes:
            # Chequeo de conflicto contra cualquier responsable (activo o
            # desactivado): el número es unique global.
            existing = await self.repo.get_by_whatsapp_any(changes["whatsapp_number"])
            if existing and existing.id != responsible_id:
                raise ConflictError(f"A responsible with number {changes['whatsapp_number']} already exists")
        updated = await self.repo.update_fields(responsible_id, **changes)
        return updated  # type: ignore[return-value]

    async def reactivate(self, responsible_id: int, tenant_id: int | None = None) -> Responsible:
        """Re-activate an inactive responsible.

        No task reassignment is done — the responsible becomes available
        for new task assignments but existing tasks are unchanged.
        """
        responsible = await self.get_or_raise(responsible_id, tenant_id)
        if responsible.is_active:
            return responsible
        updated = await self.repo.update_fields(responsible_id, is_active=True)
        return updated  # type: ignore[return-value]

    async def deactivate(self, responsible_id: int, actor: dict | None = None, tenant_id: int | None = None) -> Responsible:
        await self.get_or_raise(responsible_id, tenant_id)
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
