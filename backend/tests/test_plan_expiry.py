"""tenant.active_until se guardaba pero no se hacía cumplir en ningún lado —
un tenant vencido seguía operando normal (docs/auditoria/10-panel-admin.md,
hallazgo 2). check_plan_limit() ahora bloquea con 402 antes de crear obras,
invitar usuarios o crear tareas si el plan venció."""
from datetime import datetime, timedelta, timezone

import pytest_asyncio

from app.core.security import create_access_token
from app.models.obra import Obra
from app.models.plan import Plan
from app.models.tenant import Tenant
from app.models.user import User

API = "/api/v1"


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _mk_ctx(db, *, active_until):
    plan = Plan(name="test-expiry", max_obras=10, max_users=10, max_tasks_per_obra=10)
    db.add(plan)
    await db.flush()
    tenant = Tenant(name="Empresa Vencida", plan_id=plan.id, active_until=active_until)
    db.add(tenant)
    await db.flush()
    admin = User(
        email="admin@vencida.com", hashed_password="x", full_name="Admin",
        role="admin", is_active=True, tenant_id=tenant.id,
    )
    db.add(admin)
    await db.flush()
    await db.commit()
    return tenant, admin


async def test_tenant_vencido_bloquea_crear_obra(db, client):
    _tenant, admin = await _mk_ctx(db, active_until=datetime.now(timezone.utc) - timedelta(days=1))
    r = await client.post(
        f"{API}/obras",
        json={"name": "Obra nueva", "location": "CBA"},
        headers=_auth(create_access_token(admin.id)),
    )
    assert r.status_code == 402, r.text
    assert r.json()["detail"]["code"] == "plan_expired"


async def test_tenant_vencido_bloquea_invitar(db, client):
    _tenant, admin = await _mk_ctx(db, active_until=datetime.now(timezone.utc) - timedelta(hours=1))
    r = await client.post(
        f"{API}/users/invite",
        json={"email": "nuevo@x.com", "role": "collaborator"},
        headers=_auth(create_access_token(admin.id)),
    )
    assert r.status_code == 402, r.text
    assert r.json()["detail"]["code"] == "plan_expired"


async def test_tenant_con_plan_vigente_no_se_bloquea(db, client):
    tenant, admin = await _mk_ctx(db, active_until=datetime.now(timezone.utc) + timedelta(days=30))
    r = await client.post(
        f"{API}/obras",
        json={"name": "Obra nueva", "location": "CBA"},
        headers=_auth(create_access_token(admin.id)),
    )
    assert r.status_code not in (402,), r.text


async def test_tenant_sin_active_until_no_se_bloquea(db, client):
    """active_until=None (plan sin vencimiento definido) no debe bloquear nada."""
    tenant, admin = await _mk_ctx(db, active_until=None)
    r = await client.post(
        f"{API}/obras",
        json={"name": "Obra nueva", "location": "CBA"},
        headers=_auth(create_access_token(admin.id)),
    )
    assert r.status_code not in (402,), r.text
