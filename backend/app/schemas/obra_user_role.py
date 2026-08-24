"""Schemas del rol que un usuario (con login) tiene en una obra.

Ver docs/roles-redesign/fase-1-modelo.md para la semántica de cada rol.
Los endpoints que consuman estos schemas los expone la Fase 3 (routers +
UI); esta fase solo deja el contrato de datos listo.
"""
from datetime import datetime

from pydantic import BaseModel

from app.models.obra_user_role import ObraUserRoleType


class ObraUserRoleCreate(BaseModel):
    """Payload para asignar un rol a un usuario en una obra. tenant_id se toma
    de la obra (no del cliente) para evitar inconsistencias."""

    obra_id: int
    user_id: int
    role: ObraUserRoleType


class ObraUserRoleUpdate(BaseModel):
    """Solo se puede cambiar el rol. Reasignar el user_id o cambiar de obra
    equivale a borrar la fila y crear otra — la política deliberada es no
    permitir mutar la relación (obra, user) para que el histórico quede
    limpio."""

    role: ObraUserRoleType


class ObraUserRoleRead(BaseModel):
    id: int
    obra_id: int
    user_id: int
    tenant_id: int
    role: ObraUserRoleType
    created_at: datetime

    model_config = {"from_attributes": True}
