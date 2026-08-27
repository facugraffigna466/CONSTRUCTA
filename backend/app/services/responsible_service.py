from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ConflictError, NotFoundError
from app.models.responsible import Responsible
from app.models.task import Task
from app.repositories.historial import HistorialRepository
from app.repositories.responsible import ResponsibleRepository
from app.repositories.task import TaskRepository
from app.repositories.user import UserRepository
from app.schemas.responsible import ResponsibleCreate, ResponsibleUpdate


class ResponsibleService:
    def __init__(self, session: AsyncSession) -> None:
        self.repo = ResponsibleRepository(session)
        self.task_repo = TaskRepository(session)
        self.user_repo = UserRepository(session)
        self.historial = HistorialRepository(session)

    async def _assert_no_user_collision(self, whatsapp: str, tenant_id: int | None) -> None:
        """Hallazgo 6.4 auditoría 04: si el número ya está tomado por un User
        del mismo tenant, no podemos crear/editar un Responsible con ese número —
        el bot no puede resolver quién es el emisor (Responsible siempre ganaba
        silenciosamente).
        """
        user_col = await self.user_repo.get_by_whatsapp_in_tenant(whatsapp, tenant_id)
        if user_col is not None:
            raise ConflictError(
                f"El número {whatsapp} ya está registrado como usuario en tu empresa."
            )

    async def create(
        self, data: ResponsibleCreate, tenant_id: int | None = None, actor: dict | None = None
    ) -> Responsible:
        # Hallazgo 6.3 auditoría 04: unique(tenant_id, whatsapp_number) — el
        # chequeo se scopea al tenant del caller. Otro tenant puede tener el
        # mismo número (mismo contratista trabajando para varias empresas).
        existing = await self.repo.get_by_whatsapp_in_tenant(
            data.whatsapp_number, tenant_id
        )
        if existing:
            raise ConflictError(
                f"A responsible with number {data.whatsapp_number} already exists"
            )
        await self._assert_no_user_collision(data.whatsapp_number, tenant_id)
        # Nuevo responsable → confirmed_at queda NULL (default). El bot lo
        # trata como "pendiente confirmación" hasta que responda SI.
        # El WhatsApp de bienvenida lo dispara el caller (route de team o de
        # responsibles) — la creación acá es en la misma transacción y no
        # queremos side-effects HTTP en el service para tests que mockean.
        responsible = Responsible(**data.model_dump(), tenant_id=tenant_id)
        responsible = await self.repo.create(responsible)
        # docs/auditoria/07-historial.md, hallazgo 7.3/8.2: el directorio de
        # responsables no dejaba ningún rastro de quién agregó a quién.
        # obra_id=None porque es global de la empresa, no de una obra puntual
        # — sin obra no hay forma de derivar tenant_id, así que se pasa explícito.
        await self.historial.log(
            obra_id=None,
            event_type="responsible_created",
            description=(
                f"{actor.get('name') if actor else 'Alguien'} agregó a "
                f"{responsible.full_name} al directorio de responsables."
            ),
            payload={"responsible_id": responsible.id, **({"actor": actor} if actor else {})},
            triggered_by="user",
            tenant_id=tenant_id,
        )
        return responsible

    async def get_or_raise(self, responsible_id: int, tenant_id: int | None = None) -> Responsible:
        responsible = await self.repo.get(responsible_id)
        if not responsible:
            raise NotFoundError("Responsible", responsible_id)
        # Aislamiento multi-tenant.
        if tenant_id is not None and responsible.tenant_id is not None and responsible.tenant_id != tenant_id:
            raise NotFoundError("Responsible", responsible_id)
        return responsible

    async def lookup_by_whatsapp(
        self, phone: str, tenant_id: int | None = None
    ) -> tuple[Responsible, list[Task]] | None:
        """Buscar responsable por número de WhatsApp.

        Hallazgo 6.1 de docs/auditoria/04-responsables.md: sin filtro de tenant,
        cualquier usuario logueado podía consultar responsables + tareas activas
        de otro tenant. Ahora si el número existe en otra empresa se devuelve
        None (mismo comportamiento que "no existe") para no filtrar información.
        """
        responsible = await self.repo.get_by_whatsapp(phone)
        if not responsible:
            return None
        if (
            tenant_id is not None
            and responsible.tenant_id is not None
            and responsible.tenant_id != tenant_id
        ):
            return None
        tasks = await self.task_repo.list_by_responsible(responsible.id)
        return responsible, tasks

    async def list_all(self, active_only: bool = False, tenant_id: int | None = None) -> list[Responsible]:
        if active_only:
            return await self.repo.list_active(tenant_id=tenant_id)
        return await self.repo.list_all(tenant_id=tenant_id)

    async def update(
        self, responsible_id: int, data: ResponsibleUpdate, tenant_id: int | None = None,
        actor: dict | None = None,
    ) -> Responsible:
        current = await self.get_or_raise(responsible_id, tenant_id)
        changes = data.model_dump(exclude_none=True)
        if not changes:
            return current
        if "whatsapp_number" in changes:
            # Chequeo dentro del tenant (6.3 auditoría 04).
            existing = await self.repo.get_by_whatsapp_in_tenant(
                changes["whatsapp_number"], tenant_id
            )
            if existing and existing.id != responsible_id:
                raise ConflictError(f"A responsible with number {changes['whatsapp_number']} already exists")
            await self._assert_no_user_collision(changes["whatsapp_number"], tenant_id)
            # Editar el whatsapp_number es "estrenar canal": el dueño anterior
            # queda sin acceso y el nuevo dueño no sabe que fue agregado.
            # Reseteamos confirmed_at para que send_welcome_confirmation
            # (disparado desde la ruta) mande el WhatsApp de bienvenida al
            # número nuevo. Sin esto, el bot procesaría comandos del nuevo
            # dueño sin que haya confirmado con "SI" nunca.
            if changes["whatsapp_number"] != current.whatsapp_number:
                changes["confirmed_at"] = None
        updated = await self.repo.update_fields(responsible_id, **changes)
        await self.historial.log(
            obra_id=None,
            event_type="responsible_updated",
            description=(
                f"{actor.get('name') if actor else 'Alguien'} editó a "
                f"{updated.full_name if updated else current.full_name}."
            ),
            payload={
                "responsible_id": responsible_id, "changes": list(changes.keys()),
                **({"actor": actor} if actor else {}),
            },
            triggered_by="user",
            tenant_id=tenant_id,
        )
        return updated  # type: ignore[return-value]

    async def reactivate(
        self, responsible_id: int, tenant_id: int | None = None, actor: dict | None = None
    ) -> Responsible:
        """Re-activate an inactive responsible.

        No task reassignment is done — the responsible becomes available
        for new task assignments but existing tasks are unchanged.
        """
        responsible = await self.get_or_raise(responsible_id, tenant_id)
        if responsible.is_active:
            return responsible
        updated = await self.repo.update_fields(responsible_id, is_active=True)
        await self.historial.log(
            obra_id=None,
            event_type="responsible_reactivated",
            description=(
                f"{actor.get('name') if actor else 'Alguien'} reactivó a "
                f"{responsible.full_name}."
            ),
            payload={"responsible_id": responsible_id, **({"actor": actor} if actor else {})},
            triggered_by="user",
            tenant_id=tenant_id,
        )
        return updated  # type: ignore[return-value]

    async def deactivate(self, responsible_id: int, actor: dict | None = None, tenant_id: int | None = None) -> Responsible:
        await self.get_or_raise(responsible_id, tenant_id)
        updated = await self.repo.update_fields(responsible_id, is_active=False)
        # Hallazgo 6.7 auditoría 04: sin esta limpieza, las filas de
        # obra_team_members quedaban zombie después del soft-delete. Al
        # reactivar el responsable después, aparecía "mágicamente" en obras
        # donde ya no debía estar. Coherente con el hard-delete de
        # DELETE /obras/{id}/team.
        from sqlalchemy import delete as sql_delete
        from app.models.obra_team_member import ObraTeamMember
        await self.repo.session.execute(
            sql_delete(ObraTeamMember).where(
                ObraTeamMember.responsible_id == responsible_id
            )
        )
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
