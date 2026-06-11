from datetime import datetime
from pydantic import BaseModel


class PlanRead(BaseModel):
    id: int
    name: str
    max_obras: int | None
    max_users: int | None
    max_tasks_per_obra: int | None
    price_monthly: float | None

    model_config = {"from_attributes": True}


class TenantRead(BaseModel):
    id: int
    name: str
    plan_id: int | None
    owner_user_id: int | None
    created_at: datetime
    active_until: datetime | None
    plan: PlanRead | None = None

    model_config = {"from_attributes": True}


class PlanUsage(BaseModel):
    tenant: TenantRead
    obras_count: int
    users_count: int
    tasks_count: int
    obras_limit: int | None
    users_limit: int | None
    tasks_per_obra_limit: int | None
