from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ForbiddenError, NotFoundError
from app.models.obra import Obra
from app.models.task import TaskStatus
from app.repositories.historial import HistorialRepository
from app.repositories.obra import ObraRepository
from app.schemas.obra import ObraCreate, ObraUpdate


class ObraService:
    def __init__(self, session: AsyncSession) -> None:
        self.repo = ObraRepository(session)
        self.historial = HistorialRepository(session)

    async def create(
        self, data: ObraCreate, manager_id: int, actor: dict | None = None,
        tenant_id: int | None = None,
    ) -> Obra:
        obra = Obra(**data.model_dump(), manager_id=manager_id, tenant_id=tenant_id)
        obra = await self.repo.create(obra)
        await self.historial.log(
            obra_id=obra.id,
            event_type="obra_created",
            description=f"Obra '{obra.name}' created",
            payload={"actor": actor} if actor else None,
            triggered_by="user",
        )
        return obra

    async def get_or_raise(self, obra_id: int, tenant_id: int | None = None) -> Obra:
        obra = await self.repo.get(obra_id)
        if not obra:
            raise NotFoundError("Obra", obra_id)
        # Aislamiento multi-tenant: una obra de otra empresa se reporta como
        # inexistente (404, no 403 — no filtrar qué ids existen)
        if tenant_id is not None and obra.tenant_id is not None and obra.tenant_id != tenant_id:
            raise NotFoundError("Obra", obra_id)
        return obra

    async def get_for_manager(self, obra_id: int, manager_id: int) -> Obra:
        obra = await self.get_or_raise(obra_id)
        # Acceso por TENANT (no por creador): cualquier miembro de la empresa puede
        # operar la obra. manager_id se conserva solo para auditoría/creador.
        if obra.tenant_id is not None:
            from app.repositories.user import UserRepository
            user = await UserRepository(self.repo.session).get(manager_id)
            if user is not None and user.tenant_id is not None and obra.tenant_id != user.tenant_id:
                raise NotFoundError("Obra", obra_id)   # 404 cross-tenant
        return obra

    async def list_mine(self, manager_id: int) -> list[Obra]:
        return await self.repo.list_by_manager(manager_id)

    async def list_all(self, tenant_id: int | None = None) -> list[dict]:
        obras = await self.repo.list_all(tenant_id=tenant_id)
        result = []
        for o in obras:
            non_cancelled = [t for t in o.tasks if t.status != TaskStatus.CANCELADA]
            completed     = [t for t in o.tasks if t.status == TaskStatus.COMPLETADA]
            result.append({
                "id": o.id, "name": o.name, "status": o.status,
                "location": o.location, "image_url": o.image_url,
                "start_date": o.start_date, "expected_end_date": o.expected_end_date,
                "actual_end_date": o.actual_end_date, "manager_id": o.manager_id,
                "client_name": o.client_name, "client_email": o.client_email,
                "client_phone": o.client_phone,
                "completed_tasks": len(completed),
                "total_tasks": len(non_cancelled),
            })
        return result

    async def update(self, obra_id: int, data: ObraUpdate, manager_id: int, actor: dict | None = None) -> Obra:
        obra = await self.get_for_manager(obra_id, manager_id)

        # Two dumps: SQLAlchemy needs native Python types (e.g. date objects),
        # but the historial JSON column requires JSON-serializable values.
        # Using mode="json" on the second dump converts date → ISO string,
        # preventing "date is not JSON serializable" TypeError on commit.
        changes      = data.model_dump(exclude_unset=True)
        changes_json = data.model_dump(exclude_unset=True, mode="json")
        if not changes:
            return obra

        updated = await self.repo.update_fields(obra_id, **changes)
        if actor is not None:
            changes_json["actor"] = actor
        await self.historial.log(
            obra_id=obra_id,
            event_type="obra_updated",
            description=f"Fields updated: {list(changes.keys())}",
            payload=changes_json,
            triggered_by="user",
        )
        # Si el cambio manual devolvió la obra al tramo automático (reactivar/reabrir),
        # recalcular al toque el estado derivado (sin re-completar en el mismo acto)
        # y devolver la obra ya recalculada.
        if "status" in changes:
            from app.services.task_service import TaskService
            await TaskService(self.repo.session).recompute_obra_status(obra_id, allow_complete=False)
            return await self.get_for_manager(obra_id, manager_id)
        return updated  # type: ignore[return-value]

    async def delete(self, obra_id: int, manager_id: int) -> None:
        await self.get_for_manager(obra_id, manager_id)
        await self._cleanup_plano_files(obra_id)
        await self.repo.delete(obra_id)

    async def _cleanup_plano_files(self, obra_id: int) -> None:
        """El FK de Plano.obra_id es ON DELETE CASCADE — borra las filas solo, así
        que hay que borrar los archivos físicos ANTES o quedan huérfanos en uploads/."""
        from sqlalchemy import select
        from app.models.plano import Plano
        from app.services.plano_service import UPLOADS_DIR
        paths = (await self.repo.session.execute(
            select(Plano.file_path).where(Plano.obra_id == obra_id)
        )).scalars().all()
        for path in paths:
            (UPLOADS_DIR / path).unlink(missing_ok=True)
