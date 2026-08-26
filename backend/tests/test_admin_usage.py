"""Panel admin /admin/usage: los conteos deben ser del tenant, no del sistema.
Antes tasks_count contaba TODAS las tareas (de todas las empresas)."""
import pytest_asyncio

from app.core.security import create_access_token
from app.models.obra import Obra
from app.models.task import Task
from app.models.tenant import Tenant
from app.models.tenant_membership import TenantMembership
from app.models.user import User

API = "/api/v1"


@pytest_asyncio.fixture
async def two_tenants_with_tasks(db):
    """Empresa A: 1 obra + 2 tareas. Empresa B: 1 obra + 3 tareas."""
    ta = Tenant(name="Empresa A")
    tb = Tenant(name="Empresa B")
    db.add_all([ta, tb])
    await db.flush()
    ua = User(email="a@x.com", hashed_password="x", full_name="A", role="admin",
              is_active=True, tenant_id=ta.id)
    ub = User(email="b@x.com", hashed_password="x", full_name="B", role="admin",
              is_active=True, tenant_id=tb.id)
    db.add_all([ua, ub])
    await db.flush()
    db.add_all([
        TenantMembership(user_id=ua.id, tenant_id=ta.id, role="admin", is_active=True),
        TenantMembership(user_id=ub.id, tenant_id=tb.id, role="admin", is_active=True),
    ])
    await db.flush()
    obra_a = Obra(name="Obra A", manager_id=ua.id, tenant_id=ta.id)
    obra_b = Obra(name="Obra B", manager_id=ub.id, tenant_id=tb.id)
    db.add_all([obra_a, obra_b])
    await db.flush()
    for i in range(2):
        db.add(Task(obra_id=obra_a.id, tenant_id=ta.id, title=f"A{i}"))
    for i in range(3):
        db.add(Task(obra_id=obra_b.id, tenant_id=tb.id, title=f"B{i}"))
    await db.flush()
    await db.commit()
    return {"token_a": create_access_token(ua.id)}


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def test_usage_counts_are_tenant_scoped(client, two_tenants_with_tasks):
    """El admin de A ve SOLO los conteos de A (2 tareas, 1 obra, 1 usuario),
    no la suma con B."""
    r = await client.get(f"{API}/admin/usage", headers=_auth(two_tenants_with_tasks["token_a"]))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["tasks_count"] == 2, f"Fuga cross-tenant en tasks_count: {body['tasks_count']}"
    assert body["obras_count"] == 1
    assert body["users_count"] == 1


async def test_usage_sin_tenant_no_filtra_conteo_global(db, client, two_tenants_with_tasks):
    """Un admin sin tenant_id (estado roto, no debería pasar en producción) NO
    debe ver los conteos de TODO el sistema — antes la rama `else` de la query
    caía a `select(func.count(X.id))` sin filtro, que sumaba obras/tareas/users
    de todas las empresas (docs/auditoria/10-panel-admin.md, hallazgo 1)."""
    huerfano = User(
        email="huerfano@x.com", hashed_password="x", full_name="Sin Tenant",
        role="admin", is_active=True, tenant_id=None,
    )
    db.add(huerfano)
    await db.flush()
    await db.commit()

    r = await client.get(f"{API}/admin/usage", headers=_auth(create_access_token(huerfano.id)))
    assert r.status_code == 200, r.text
    body = r.json()
    # Entre las dos tenants del fixture hay 2 obras, 2 users, 5 tareas en total —
    # si la rama global sobreviviera, alguno de estos números sería > 0.
    assert body["obras_count"] == 0
    assert body["users_count"] == 0
    assert body["tasks_count"] == 0
