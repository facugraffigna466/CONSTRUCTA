"""Guards de permiso por-obra (Fase 2 del rediseño de roles).

Semántica implementada:
  - Admin de empresa (users.role == "admin") pasa siempre en cualquier obra
    de su tenant. No requiere fila en ObraUserRole (superset absoluto).
  - Non-admin necesita fila en ObraUserRole para la obra. Si no la tiene:
    404 (mismo criterio de aislamiento que ya usa el resto del sistema —
    no revela que la obra existe).
  - Si tiene fila pero su rol es más bajo que el mínimo pedido: 403
    (rol insuficiente en la obra).

Ver docs/roles-redesign/fase-1-modelo.md §2 para la matriz completa de
capacidades por rol.

Convención de retorno de las dependencies: siempre `User` (el actor
autenticado). Los handlers reciben
`current_user: Annotated[User, Depends(...)]` como reemplazo del viejo
`CurrentUser`.
"""
from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser, DbSession
from app.models.alert import Alert
from app.models.bitacora import BitacoraEntry
from app.models.budget import Budget
from app.models.obra import Obra
from app.models.obra_user_role import ObraUserRole, ObraUserRoleType
from app.models.plano import Plano
from app.models.purchase_order import PurchaseOrder
from app.models.solicitud_cotizacion import SolicitudCotizacion
from app.models.task import Task
from app.models.user import User


# ─────────────────────────────────────────────────────────────
# Niveles y helpers de rango
# ─────────────────────────────────────────────────────────────

# Mayor número = más capacidad. jefe_obra puede todo lo del colaborador,
# colaborador todo lo del solo_lectura.
_ROLE_LEVEL: dict[ObraUserRoleType, int] = {
    ObraUserRoleType.SOLO_LECTURA: 1,
    ObraUserRoleType.COLABORADOR: 2,
    ObraUserRoleType.JEFE_OBRA: 3,
}


def _is_admin(user: User) -> bool:
    return user.role == "admin"


# ─────────────────────────────────────────────────────────────
# Helpers callable-directamente desde handlers
# ─────────────────────────────────────────────────────────────

async def assert_obra_access(
    db: AsyncSession,
    user: User,
    obra_id: int,
    min_role: ObraUserRoleType,
) -> Obra:
    """Devuelve la Obra si el user tiene el rol mínimo. Levanta 404 o 403.

    Usar directamente cuando el obra_id no viene de la URL sino del body
    del request (ej. TaskCreate.obra_id, BitacoraAssignObra.obra_id).
    """
    obra = await db.get(Obra, obra_id)
    if obra is None or obra.tenant_id != user.tenant_id:
        # Aislamiento: no distinguimos "no existe" de "de otro tenant".
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Obra no encontrada")
    if _is_admin(user):
        return obra
    row = await db.execute(
        select(ObraUserRole.role).where(
            ObraUserRole.obra_id == obra_id,
            ObraUserRole.user_id == user.id,
        )
    )
    role = row.scalar_one_or_none()
    if role is None:
        # Non-admin sin fila = no ve la obra.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Obra no encontrada")
    if _ROLE_LEVEL[role] < _ROLE_LEVEL[min_role]:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Tu rol en esta obra no alcanza para esta acción",
        )
    return obra


async def visible_obra_ids(
    db: AsyncSession, user: User
) -> set[int] | None:
    """Ids de obras que el user puede ver.

    - Admin de empresa: devuelve None (significa "todas las del tenant" — el
      caller aplica el filtro por tenant como venía haciendo).
    - Non-admin: set con los obra_id donde tiene fila en ObraUserRole. Puede
      estar vacío (colaborator sin asignaciones = no ve ninguna).
    """
    if _is_admin(user):
        return None
    result = await db.execute(
        select(ObraUserRole.obra_id).where(ObraUserRole.user_id == user.id)
    )
    return set(result.scalars().all())


# ─────────────────────────────────────────────────────────────
# Helper interno para resolver un obra_id desde otra tabla
# ─────────────────────────────────────────────────────────────

async def _resolve_and_assert(
    db: AsyncSession,
    user: User,
    model: type,
    row_id: int,
    min_role: ObraUserRoleType,
    *,
    allow_null_obra: bool = False,
) -> User:
    """Carga la fila indicada, valida tenant + acceso a la obra dueña.

    Args:
        allow_null_obra: si True y row.obra_id es NULL, permite acceso solo a
            admins de empresa (para Budget y BitacoraEntry sin asignar).

    El chequeo de tenant se hace acá si el modelo tiene columna tenant_id
    (denormalizado). Si no la tiene, `assert_obra_access(obra_id)` lo cubre
    igual porque valida `Obra.tenant_id == user.tenant_id` — no perdemos
    aislamiento.
    """
    row = await db.get(model, row_id)
    if row is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, f"{model.__name__} no encontrado"
        )
    # Chequeo de tenant SOLO si el modelo tiene tenant_id denormalizado.
    tenant_id_val = getattr(row, "tenant_id", None)
    if hasattr(row, "tenant_id") and tenant_id_val is not None and tenant_id_val != user.tenant_id:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, f"{model.__name__} no encontrado"
        )
    obra_id_val = getattr(row, "obra_id", None)
    if obra_id_val is None:
        if not allow_null_obra:
            # Modelo raro sin obra_id — bug del wiring, no del user.
            raise HTTPException(500, f"{model.__name__} sin obra_id")
        if not _is_admin(user):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Este recurso no está asignado a una obra — solo admin de empresa",
            )
        return user
    await assert_obra_access(db, user, obra_id_val, min_role)
    return user


# ─────────────────────────────────────────────────────────────
# Factory principal: obra_id viene de la URL como `{obra_id}`
# ─────────────────────────────────────────────────────────────

def require_obra_role(min_role: ObraUserRoleType):
    """FastAPI dependency: resuelve `{obra_id}` de la URL y valida rol."""
    async def _dep(
        obra_id: int,
        db: DbSession,
        current_user: CurrentUser,
    ) -> User:
        await assert_obra_access(db, current_user, obra_id, min_role)
        return current_user
    return _dep


# ─────────────────────────────────────────────────────────────
# Factories para obra_id indirecto
# Uno por tipo de path param, para que FastAPI lo inyecte con el nombre correcto.
# ─────────────────────────────────────────────────────────────

def require_task_obra_role(min_role: ObraUserRoleType):
    async def _dep(
        task_id: int, db: DbSession, current_user: CurrentUser
    ) -> User:
        return await _resolve_and_assert(db, current_user, Task, task_id, min_role)
    return _dep


def require_plano_obra_role(min_role: ObraUserRoleType):
    async def _dep(
        plano_id: int, db: DbSession, current_user: CurrentUser
    ) -> User:
        return await _resolve_and_assert(db, current_user, Plano, plano_id, min_role)
    return _dep


def require_alert_obra_role(min_role: ObraUserRoleType):
    """Alert.obra_id es técnicamente nullable — si NULL, solo admin de empresa."""
    async def _dep(
        alert_id: int, db: DbSession, current_user: CurrentUser
    ) -> User:
        return await _resolve_and_assert(
            db, current_user, Alert, alert_id, min_role, allow_null_obra=True
        )
    return _dep


def require_bitacora_obra_role(min_role: ObraUserRoleType):
    """BitacoraEntry.obra_id puede ser NULL (nota de WhatsApp sin asignar).
    En ese caso solo admin de empresa pasa."""
    async def _dep(
        entry_id: int, db: DbSession, current_user: CurrentUser
    ) -> User:
        return await _resolve_and_assert(
            db, current_user, BitacoraEntry, entry_id, min_role, allow_null_obra=True
        )
    return _dep


def require_purchase_order_obra_role(min_role: ObraUserRoleType):
    async def _dep(
        order_id: int, db: DbSession, current_user: CurrentUser
    ) -> User:
        return await _resolve_and_assert(
            db, current_user, PurchaseOrder, order_id, min_role
        )
    return _dep


def require_solicitud_obra_role(min_role: ObraUserRoleType):
    async def _dep(
        solicitud_id: int, db: DbSession, current_user: CurrentUser
    ) -> User:
        return await _resolve_and_assert(
            db, current_user, SolicitudCotizacion, solicitud_id, min_role
        )
    return _dep


def require_budget_obra_role(min_role: ObraUserRoleType):
    """Budget.obra_id es nullable — si NULL, es global del tenant y requiere admin."""
    async def _dep(
        budget_id: int, db: DbSession, current_user: CurrentUser
    ) -> User:
        return await _resolve_and_assert(
            db, current_user, Budget, budget_id, min_role, allow_null_obra=True
        )
    return _dep


# task_materials usa `task_id` (mismo path param) — comparte lógica con require_task_obra_role.
require_task_material_obra_role = require_task_obra_role
