from typing import Literal
from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.obra import Obra
from app.models.plan import Plan
from app.models.task import Task
from app.models.tenant import Tenant
from app.models.user import User


async def check_plan_limit(
    db: AsyncSession,
    tenant_id: int | None,
    resource: Literal["obras", "users", "tasks"],
    obra_id: int | None = None,
) -> None:
    """
    Raises HTTP 402 if the tenant has reached the plan limit for the given resource.
    - tenant_id=None → skip check (no tenant assigned yet)
    - obra_id required when resource='tasks'
    """
    if tenant_id is None:
        return

    tenant = await db.get(Tenant, tenant_id)
    if not tenant or not tenant.plan_id:
        return

    plan = await db.get(Plan, tenant.plan_id)
    if not plan:
        return

    if resource == "obras":
        limit = plan.max_obras
        if limit is None:
            return
        count_result = await db.execute(
            select(func.count()).where(Obra.tenant_id == tenant_id)
        )
        current = count_result.scalar_one()
        if current >= limit:
            _raise_upgrade_error("obras", current, limit, plan.name)

    elif resource == "users":
        limit = plan.max_users
        if limit is None:
            return
        count_result = await db.execute(
            select(func.count()).where(User.tenant_id == tenant_id, User.is_active == True)
        )
        current = count_result.scalar_one()
        if current >= limit:
            _raise_upgrade_error("usuarios", current, limit, plan.name)

    elif resource == "tasks":
        limit = plan.max_tasks_per_obra
        if limit is None or obra_id is None:
            return
        count_result = await db.execute(
            select(func.count()).where(Task.obra_id == obra_id)
        )
        current = count_result.scalar_one()
        if current >= limit:
            _raise_upgrade_error("tareas por obra", current, limit, plan.name)


def _raise_upgrade_error(resource: str, current: int, limit: int, plan_name: str) -> None:
    raise HTTPException(
        status_code=status.HTTP_402_PAYMENT_REQUIRED,
        detail={
            "code": "plan_limit_reached",
            "resource": resource,
            "current": current,
            "limit": limit,
            "plan": plan_name,
            "message": f"Alcanzaste el límite de {resource} para el plan {plan_name} ({current}/{limit}). Actualizá tu plan para continuar.",
        },
    )
