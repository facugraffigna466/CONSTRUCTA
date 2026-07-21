"""Aislamiento multi-tenant: un usuario de la empresa B NO puede acceder a los
recursos de una obra de la empresa A. Cada endpoint debe responder 404 (no filtrar
qué ids existen). Este set blinda el 'hardening de autorización' contra regresiones.
"""
import pytest_asyncio

from app.core.security import create_access_token
from app.models.obra import Obra
from app.models.task import Task
from app.models.tenant import Tenant
from app.models.user import User

API = "/api/v1"


async def _mk_tenant(db, name: str) -> Tenant:
    t = Tenant(name=name)
    db.add(t)
    await db.flush()
    return t


async def _mk_user(db, tenant_id: int, email: str) -> User:
    u = User(
        email=email,
        hashed_password="x",
        full_name="Test User",
        role="admin",
        is_active=True,
        tenant_id=tenant_id,
    )
    db.add(u)
    await db.flush()
    return u


@pytest_asyncio.fixture
async def two_tenants(db):
    """Empresa A con obra + tarea; empresa B con un usuario. Devuelve ids y tokens."""
    ta = await _mk_tenant(db, "Empresa A")
    tb = await _mk_tenant(db, "Empresa B")
    ua = await _mk_user(db, ta.id, "a@empresa-a.com")
    ub = await _mk_user(db, tb.id, "b@empresa-b.com")

    obra_a = Obra(name="Obra A", manager_id=ua.id, tenant_id=ta.id)
    db.add(obra_a)
    await db.flush()
    task_a = Task(obra_id=obra_a.id, title="Tarea de A")
    db.add(task_a)
    await db.flush()
    await db.commit()

    return {
        "obra_a": obra_a.id,
        "task_a": task_a.id,
        "token_a": create_access_token(ua.id),
        "token_b": create_access_token(ub.id),
    }


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# Endpoints de LECTURA por obra/tarea que deben aislar por tenant.
def _cross_tenant_urls(ids: dict) -> list[str]:
    o, t = ids["obra_a"], ids["task_a"]
    return [
        f"{API}/tasks/obra/{o}",
        f"{API}/obras/{o}",
        f"{API}/obras/{o}/historial",
        f"{API}/exports/obras/{o}/excel",
        f"{API}/obras/{o}/calendar",
        f"{API}/obras/{o}/planos",
        f"{API}/obras/{o}/team",
        f"{API}/obras/{o}/baseline",
        f"{API}/tasks/{t}/materials",
        f"{API}/obras/{o}/solicitudes-cotizacion",
    ]


async def test_cross_tenant_reads_return_404(client, two_tenants):
    """Usuario de la empresa B → recursos de la empresa A → 404 (no 200, no 403 con datos)."""
    ids = two_tenants
    leaks = []
    for url in _cross_tenant_urls(ids):
        r = await client.get(url, headers=_auth(ids["token_b"]))
        if r.status_code != 404:
            leaks.append(f"{url} → {r.status_code}")
    assert not leaks, "Fugas cross-tenant (deberían ser 404):\n" + "\n".join(leaks)


async def test_same_tenant_access_still_works(client, two_tenants):
    """No rompimos el acceso legítimo: el usuario de A sí ve su propia obra/tareas."""
    ids = two_tenants
    r = await client.get(f"{API}/tasks/obra/{ids['obra_a']}", headers=_auth(ids["token_a"]))
    assert r.status_code == 200, f"Acceso legítimo roto: {r.status_code} — {r.text[:200]}"
    r = await client.get(f"{API}/obras/{ids['obra_a']}", headers=_auth(ids["token_a"]))
    assert r.status_code == 200


async def test_cross_tenant_task_mutation_blocked(client, two_tenants):
    """Un usuario de B no puede crear una tarea en una obra de A."""
    ids = two_tenants
    r = await client.post(
        f"{API}/tasks",
        headers=_auth(ids["token_b"]),
        json={"obra_id": ids["obra_a"], "title": "Tarea intrusa"},
    )
    assert r.status_code == 404, f"Mutación cross-tenant permitida: {r.status_code}"


async def test_cross_tenant_material_mutation_blocked(client, two_tenants):
    """B no puede agregar materiales a una tarea de A (guard task→obra→tenant)."""
    ids = two_tenants
    r = await client.post(
        f"{API}/tasks/{ids['task_a']}/materials",
        headers=_auth(ids["token_b"]),
        json={"name": "Cemento intruso"},
    )
    assert r.status_code == 404, f"Material cross-tenant permitido: {r.status_code}"


async def test_cross_tenant_task_delete_blocked(client, two_tenants):
    """B no puede borrar una tarea de A; la tarea sigue viva para A."""
    ids = two_tenants
    r = await client.delete(f"{API}/tasks/{ids['task_a']}", headers=_auth(ids["token_b"]))
    assert r.status_code == 404, f"Borrado cross-tenant permitido: {r.status_code}"
    # La tarea de A no fue borrada
    r2 = await client.get(f"{API}/tasks/obra/{ids['obra_a']}", headers=_auth(ids["token_a"]))
    assert r2.status_code == 200
    assert any(t["id"] == ids["task_a"] for t in r2.json()), "Un usuario de B borró la tarea de A"


async def test_same_tenant_writes_still_work(client, two_tenants):
    """No sobre-restringimos: A sí puede escribir materiales en su propia tarea."""
    ids = two_tenants
    r = await client.post(
        f"{API}/tasks/{ids['task_a']}/materials",
        headers=_auth(ids["token_a"]),
        json={"name": "Cemento"},
    )
    assert r.status_code == 201, f"Escritura legítima rota: {r.status_code} — {r.text[:200]}"
