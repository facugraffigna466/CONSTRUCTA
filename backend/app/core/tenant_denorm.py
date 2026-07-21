"""Mantener denormalizado el `tenant_id` de las tablas hijas de obra.

Al crear una fila hija (tarea, alerta, calendario, baseline, solicitud, evento de
historial, miembro de obra, material) se copia el `tenant_id` de la obra padre para
que las consultas puedan filtrar por tenant sin join. Los sitios de creación están
centralizados (uno o dos por tabla), así que basta con setearlo ahí.
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.obra import Obra


async def tenant_for_obra(session: AsyncSession, obra_id: int | None) -> int | None:
    """tenant_id de la obra `obra_id` (o None si no hay obra / no tiene tenant)."""
    if obra_id is None:
        return None
    return (
        await session.execute(select(Obra.tenant_id).where(Obra.id == obra_id))
    ).scalar_one_or_none()
