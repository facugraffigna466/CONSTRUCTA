"""Denormalización de tenant_id: al crear filas hijas vía la API, el tenant_id se
copia de la obra padre (keep-in-sync). Complementa a la migración 0040 (backfill de
filas existentes) validando que las filas NUEVAS también nacen con tenant_id.
"""
import pytest_asyncio
from sqlalchemy import select

from app.core.security import create_access_token
from app.models.obra import Obra
from app.models.task import Task
from app.models.task_material import TaskMaterial
from app.models.tenant import Tenant
from app.models.user import User

API = "/api/v1"


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def tenant_with_obra(db):
    t = Tenant(name="Empresa A")
    db.add(t)
    await db.flush()
    u = User(email="a@a.com", hashed_password="x", full_name="A", role="admin", is_active=True, tenant_id=t.id)
    db.add(u)
    await db.flush()
    obra = Obra(name="Obra A", manager_id=u.id, tenant_id=t.id)
    db.add(obra)
    await db.flush()
    await db.commit()
    return {"tenant_id": t.id, "obra_id": obra.id, "token": create_access_token(u.id)}


async def test_new_task_inherits_tenant_id(client, db, tenant_with_obra):
    ctx = tenant_with_obra
    r = await client.post(
        f"{API}/tasks",
        headers=_auth(ctx["token"]),
        json={"obra_id": ctx["obra_id"], "title": "Tarea nueva"},
    )
    assert r.status_code == 201, f"{r.status_code} — {r.text[:200]}"

    await db.rollback()  # cerrar la txn vieja para leer lo recién commiteado
    task = (await db.execute(select(Task).where(Task.obra_id == ctx["obra_id"]))).scalar_one()
    assert task.tenant_id == ctx["tenant_id"], "La tarea no heredó el tenant_id de la obra"


async def test_new_material_inherits_tenant_id(client, db, tenant_with_obra):
    ctx = tenant_with_obra
    r = await client.post(
        f"{API}/tasks",
        headers=_auth(ctx["token"]),
        json={"obra_id": ctx["obra_id"], "title": "Tarea con material"},
    )
    task_id = r.json()["id"]

    r = await client.post(
        f"{API}/tasks/{task_id}/materials",
        headers=_auth(ctx["token"]),
        json={"name": "Cemento"},
    )
    assert r.status_code == 201, f"{r.status_code} — {r.text[:200]}"

    await db.rollback()
    mat = (await db.execute(select(TaskMaterial).where(TaskMaterial.task_id == task_id))).scalar_one()
    assert mat.tenant_id == ctx["tenant_id"], "El material no heredó el tenant_id"
