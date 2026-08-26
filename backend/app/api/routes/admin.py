from fastapi import APIRouter
from sqlalchemy import func, select

from app.core.deps import AdminUser, DbSession
from app.models.obra import Obra
from app.models.plan import Plan
from app.models.task import Task
from app.models.tenant import Tenant
from app.models.tenant_membership import TenantMembership
from app.schemas.plan import PlanUsage, TenantRead, PlanRead

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/usage", response_model=PlanUsage)
async def get_tenant_usage(current_user: AdminUser, db: DbSession):
    tenant_id = current_user.tenant_id

    # Tenant + plan
    if tenant_id:
        tenant = await db.get(Tenant, tenant_id)
        plan = await db.get(Plan, tenant.plan_id) if tenant and tenant.plan_id else None
    else:
        tenant = None
        plan = None

    tenant_read = TenantRead(
        id=tenant.id if tenant else 0,
        name=tenant.name if tenant else "Sin tenant",
        plan_id=tenant.plan_id if tenant else None,
        owner_user_id=tenant.owner_user_id if tenant else None,
        created_at=tenant.created_at if tenant else None,
        active_until=tenant.active_until if tenant else None,
        plan=PlanRead.model_validate(plan) if plan else None,
    )

    # Counts — SIEMPRE scopeados a este tenant. Sin tenant_id no hay "este
    # tenant" que contar: 0, nunca la rama alternativa "contar todo el sistema"
    # (ese patrón ya produjo un bug real de fuga cross-tenant en tasks_count;
    # ver docs/auditoria/10-panel-admin.md, hallazgo 1).
    if tenant_id:
        obras_count = (await db.execute(
            select(func.count()).where(Obra.tenant_id == tenant_id)
        )).scalar_one()
        users_count = (await db.execute(
            select(func.count()).where(
                TenantMembership.tenant_id == tenant_id, TenantMembership.is_active == True
            )
        )).scalar_one()
        tasks_count = (await db.execute(
            select(func.count(Task.id)).where(Task.tenant_id == tenant_id)
        )).scalar_one()
    else:
        obras_count = users_count = tasks_count = 0

    return PlanUsage(
        tenant=tenant_read,
        obras_count=obras_count,
        users_count=users_count,
        tasks_count=tasks_count,
        obras_limit=plan.max_obras if plan else None,
        users_limit=plan.max_users if plan else None,
        tasks_per_obra_limit=plan.max_tasks_per_obra if plan else None,
    )
