"""Repositorio de ObraUserRole.

Mismo estilo que ResponsibleRepository: hereda de BaseRepository (get/create/
update_fields/delete) y agrega los lookups específicos que la Fase 2 va a
necesitar para el guard por-obra (get_role) y las Fase 3 para las pantallas
de gestión de equipo (list_by_obra / list_by_user).

`set_role` es un upsert por (obra_id, user_id) — pattern común en asignaciones
donde el consumidor no quiere pensar si la fila existía; se apoya en el
UniqueConstraint del modelo para garantizar consistencia.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.obra_user_role import ObraUserRole, ObraUserRoleType
from app.repositories.base import BaseRepository


class ObraUserRoleRepository(BaseRepository[ObraUserRole]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(ObraUserRole, session)

    async def get_role(self, obra_id: int, user_id: int) -> ObraUserRoleType | None:
        """Rol del usuario en la obra, o None si no está asignado.
        Este es el lookup que la Fase 2 va a usar en el guard permite_editar_obra(...)."""
        result = await self.session.execute(
            select(ObraUserRole.role).where(
                ObraUserRole.obra_id == obra_id,
                ObraUserRole.user_id == user_id,
            )
        )
        return result.scalar_one_or_none()

    async def get_by_pair(self, obra_id: int, user_id: int) -> ObraUserRole | None:
        """Fila completa. Útil cuando se necesita el id para PATCH/DELETE."""
        result = await self.session.execute(
            select(ObraUserRole).where(
                ObraUserRole.obra_id == obra_id,
                ObraUserRole.user_id == user_id,
            )
        )
        return result.scalar_one_or_none()

    async def list_by_obra(self, obra_id: int) -> list[ObraUserRole]:
        result = await self.session.execute(
            select(ObraUserRole)
            .where(ObraUserRole.obra_id == obra_id)
            .order_by(ObraUserRole.created_at)
        )
        return list(result.scalars().all())

    async def list_by_user(self, user_id: int) -> list[ObraUserRole]:
        """Obras a las que el usuario está asignado (con el rol en cada una).
        La Fase 3 usa esto para filtrar el portfolio de un collaborator."""
        result = await self.session.execute(
            select(ObraUserRole)
            .where(ObraUserRole.user_id == user_id)
            .order_by(ObraUserRole.created_at)
        )
        return list(result.scalars().all())

    async def set_role(
        self,
        *,
        obra_id: int,
        user_id: int,
        tenant_id: int,
        role: ObraUserRoleType,
    ) -> ObraUserRole:
        """Upsert por (obra_id, user_id): si ya existe una asignación para ese par,
        actualiza el rol; si no, la crea. `tenant_id` es el de la obra — el caller
        es responsable de leerlo de la obra antes de invocar (no confiar en input
        del cliente para no cross-tenant."""
        existing = await self.get_by_pair(obra_id, user_id)
        if existing is not None:
            existing.role = role
            await self.session.flush()
            await self.session.refresh(existing)
            return existing
        new_row = ObraUserRole(
            obra_id=obra_id,
            user_id=user_id,
            tenant_id=tenant_id,
            role=role,
        )
        return await self.create(new_row)

    async def remove(self, obra_id: int, user_id: int) -> bool:
        """Quita al usuario de la obra. Devuelve True si había una fila; False si no."""
        existing = await self.get_by_pair(obra_id, user_id)
        if existing is None:
            return False
        await self.session.delete(existing)
        await self.session.flush()
        return True
