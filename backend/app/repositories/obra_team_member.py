"""Repositorio de ObraTeamMember — fuente de verdad de "en qué obras y con
qué tipo de membresía participa un Responsible" (rediseño WhatsApp).

Antes de este rediseño, la respuesta a "qué obras puede ver un responsable
por WhatsApp" se derivaba de `Task.responsible_id` (historial de tareas
asignadas alguna vez). Consecuencias:
  - Un responsable con tareas viejas en obras donde ya no participa mantenía
    acceso — sin criterio de expiración ni de baja.
  - Un responsable recién agregado al equipo pero sin tareas asignadas
    todavía no tenía acceso, aunque intuitivamente debería.
  - El bypass en `PlanoService.allowed_disciplines_for_responsible`
    (audit 05) se colaba porque el flujo llegaba a esa función aunque
    el responsable no estuviera en el equipo real de la obra.

Este repo centraliza el lookup para que TODOS los servicios que necesitan
"obras accesibles del responsable" (plano, bitácora, ruteo del bot,
validación en task_service) miren la misma tabla y no discrepen.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.obra_team_member import ObraTeamMember
from app.repositories.base import BaseRepository


class ObraTeamMemberRepository(BaseRepository[ObraTeamMember]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(ObraTeamMember, session)

    async def list_obra_ids_for_responsible(self, responsible_id: int) -> list[int]:
        """Ids de obras donde el responsable tiene una fila vigente en
        `obra_team_members`. Usar como la lista definitiva de "obras a las
        que este responsable tiene acceso HOY"."""
        rows = (await self.session.execute(
            select(ObraTeamMember.obra_id)
            .where(ObraTeamMember.responsible_id == responsible_id)
        )).scalars().all()
        return list(rows)

    async def get_for_pair(
        self, obra_id: int, responsible_id: int
    ) -> ObraTeamMember | None:
        """Fila `(obra, responsible)` si existe. Uso: chequear
        plan_disciplines o si está o no en el equipo de la obra."""
        result = await self.session.execute(
            select(ObraTeamMember).where(
                ObraTeamMember.obra_id == obra_id,
                ObraTeamMember.responsible_id == responsible_id,
            )
        )
        return result.scalar_one_or_none()
