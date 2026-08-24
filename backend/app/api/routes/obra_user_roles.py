"""Endpoints de gestión de asignaciones (User × Obra × Rol) después del alta.

Fase 4 del rediseño de roles. Complementa el flujo de invitación (Fase 3):
al invitar se pueden setear asignaciones iniciales; estos endpoints permiten
modificarlas cuando el user ya existe.

Política de guards (matriz de fase-1-modelo.md §2):
  - Admin de empresa: puede todo en cualquier obra del tenant.
  - Jefe de obra: puede asignar/mutar `colaborador` y `solo_lectura` en su obra;
    NO puede promover a otro usuario a `jefe_obra` (esa promoción es admin).
  - Colaborador / solo_lectura: solo LEER la lista de asignaciones (útil para
    que la UI muestre quién más está en la obra).

Los endpoints no permiten crear asignaciones para el propio admin de empresa
(no tiene sentido — el admin es superset absoluto).
"""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select

from app.core.deps import DbSession
from app.core.obra_permissions import require_obra_role
from app.models.obra_user_role import ObraUserRoleType
from app.models.user import User
from app.repositories.obra_user_role import ObraUserRoleRepository

router = APIRouter(prefix="/obras", tags=["obra-user-roles"])


class ObraUserRoleAssignRequest(BaseModel):
    user_id: int
    role: ObraUserRoleType


class ObraUserRoleUpdateRequest(BaseModel):
    role: ObraUserRoleType


class ObraUserRoleReadItem(BaseModel):
    user_id: int
    user_full_name: str
    user_email: str
    role: ObraUserRoleType

    model_config = {"from_attributes": True}


def _assert_can_assign_role(current_user: User, target_role: ObraUserRoleType) -> None:
    """Regla de escalación: solo admin de empresa puede setear rol JEFE_OBRA."""
    if target_role == ObraUserRoleType.JEFE_OBRA and current_user.role != "admin":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Solo un admin de empresa puede asignar el rol de jefe_obra",
        )


async def _load_target_or_404(
    db: DbSession, current_user: User, user_id: int
) -> User:
    """Valida que el target user exista, sea del mismo tenant, y NO sea admin
    de empresa (no tiene sentido darle rol por-obra al admin)."""
    target = await db.get(User, user_id)
    if target is None or target.tenant_id != current_user.tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Usuario no encontrado")
    if target.role == "admin":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "El admin de empresa tiene acceso total — no se le asigna rol por-obra",
        )
    return target


@router.get("/{obra_id}/user-roles", response_model=list[ObraUserRoleReadItem])
async def list_user_roles(
    obra_id: int,
    db: DbSession,
    current_user: Annotated[
        User, Depends(require_obra_role(ObraUserRoleType.SOLO_LECTURA))
    ],
):
    """Lista las asignaciones de user-roles en esta obra. Cualquier miembro
    (incluso solo_lectura) puede ver quién más está en el equipo."""
    repo = ObraUserRoleRepository(db)
    rows = await repo.list_by_obra(obra_id)
    if not rows:
        return []
    user_ids = [r.user_id for r in rows]
    users_by_id = {
        u.id: u for u in (await db.execute(
            select(User).where(User.id.in_(user_ids))
        )).scalars().all()
    }
    return [
        ObraUserRoleReadItem(
            user_id=r.user_id,
            user_full_name=users_by_id[r.user_id].full_name if r.user_id in users_by_id else "",
            user_email=users_by_id[r.user_id].email if r.user_id in users_by_id else "",
            role=r.role,
        )
        for r in rows if r.user_id in users_by_id
    ]


@router.post("/{obra_id}/user-roles", response_model=ObraUserRoleReadItem, status_code=status.HTTP_201_CREATED)
async def assign_user_role(
    obra_id: int,
    payload: ObraUserRoleAssignRequest,
    db: DbSession,
    current_user: Annotated[
        User, Depends(require_obra_role(ObraUserRoleType.JEFE_OBRA))
    ],
):
    """Asigna un rol a un usuario en la obra (upsert). El caller debe ser al
    menos jefe_obra en esta obra; solo admin de empresa puede setear
    JEFE_OBRA (esa promoción está reservada)."""
    _assert_can_assign_role(current_user, payload.role)
    target = await _load_target_or_404(db, current_user, payload.user_id)
    repo = ObraUserRoleRepository(db)
    row = await repo.set_role(
        obra_id=obra_id,
        user_id=target.id,
        tenant_id=current_user.tenant_id,
        role=payload.role,
    )
    return ObraUserRoleReadItem(
        user_id=target.id,
        user_full_name=target.full_name,
        user_email=target.email,
        role=row.role,
    )


@router.patch("/{obra_id}/user-roles/{user_id}", response_model=ObraUserRoleReadItem)
async def update_user_role(
    obra_id: int,
    user_id: int,
    payload: ObraUserRoleUpdateRequest,
    db: DbSession,
    current_user: Annotated[
        User, Depends(require_obra_role(ObraUserRoleType.JEFE_OBRA))
    ],
):
    """Cambia el rol de una asignación existente. Mismas reglas de escalación
    que POST: JEFE_OBRA solo lo asigna admin de empresa."""
    _assert_can_assign_role(current_user, payload.role)
    target = await _load_target_or_404(db, current_user, user_id)
    repo = ObraUserRoleRepository(db)
    existing = await repo.get_by_pair(obra_id, user_id)
    if existing is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "El usuario no está asignado a esta obra"
        )
    row = await repo.set_role(
        obra_id=obra_id,
        user_id=user_id,
        tenant_id=current_user.tenant_id,
        role=payload.role,
    )
    return ObraUserRoleReadItem(
        user_id=user_id,
        user_full_name=target.full_name,
        user_email=target.email,
        role=row.role,
    )


@router.delete("/{obra_id}/user-roles/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_user_role(
    obra_id: int,
    user_id: int,
    db: DbSession,
    current_user: Annotated[
        User, Depends(require_obra_role(ObraUserRoleType.JEFE_OBRA))
    ],
):
    """Quita a un usuario de la obra. El caller debe ser jefe_obra o admin.
    Idempotente: si no había fila, devuelve 204 igual (para simplificar el
    frontend cuando la lista quedó vieja)."""
    await _load_target_or_404(db, current_user, user_id)
    repo = ObraUserRoleRepository(db)
    await repo.remove(obra_id, user_id)
