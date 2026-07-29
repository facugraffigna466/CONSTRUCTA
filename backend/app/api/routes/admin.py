from fastapi import APIRouter
from sqlalchemy import func, select

from app.core.deps import AdminUser, DbSession
from app.models.obra import Obra
from app.models.plan import Plan
from app.models.task import Task
from app.models.tenant import Tenant
from app.models.user import User
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

    # Counts
    obras_q = await db.execute(
        select(func.count()).where(Obra.tenant_id == tenant_id) if tenant_id
        else select(func.count(Obra.id))
    )
    users_q = await db.execute(
        select(func.count()).where(User.tenant_id == tenant_id, User.is_active == True) if tenant_id
        else select(func.count(User.id)).where(User.is_active == True)
    )
    # Consistente con obras/users: contar SOLO las tareas de este tenant. Antes
    # contaba todas las del sistema (número equivocado en el panel del tenant +
    # fuga del total global de tareas de otras empresas).
    tasks_q = await db.execute(
        select(func.count(Task.id)).where(Task.tenant_id == tenant_id) if tenant_id
        else select(func.count(Task.id))
    )

    return PlanUsage(
        tenant=tenant_read,
        obras_count=obras_q.scalar_one(),
        users_count=users_q.scalar_one(),
        tasks_count=tasks_q.scalar_one(),
        obras_limit=plan.max_obras if plan else None,
        users_limit=plan.max_users if plan else None,
        tasks_per_obra_limit=plan.max_tasks_per_obra if plan else None,
    )
