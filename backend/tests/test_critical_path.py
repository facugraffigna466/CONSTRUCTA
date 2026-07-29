"""Ruta crítica (CPM): las tareas sin fecha no se pueden ubicar en el tiempo.
Antes se colaban con duración=1 y ES=0 (distorsionando la ruta en silencio);
ahora se excluyen del cálculo y se reportan en `tasks_without_dates`."""
from datetime import date

import pytest_asyncio

from app.core.security import create_access_token
from app.models.obra import Obra
from app.models.task import Task
from app.models.tenant import Tenant
from app.models.user import User

API = "/api/v1"


@pytest_asyncio.fixture
async def cpm_ctx(db):
    """Obra con 2 tareas con fecha y 1 sin fecha."""
    t = Tenant(name="Empresa CPM")
    db.add(t)
    await db.flush()
    u = User(email="cpm@x.com", hashed_password="x", full_name="CPM", role="admin",
             is_active=True, tenant_id=t.id)
    db.add(u)
    await db.flush()
    obra = Obra(name="Obra CPM", manager_id=u.id, tenant_id=t.id)
    db.add(obra)
    await db.flush()

    dated1 = Task(obra_id=obra.id, tenant_id=t.id, title="Con fecha 1",
                  start_date=date(2026, 1, 10), due_date=date(2026, 1, 15))
    dated2 = Task(obra_id=obra.id, tenant_id=t.id, title="Con fecha 2",
                  start_date=date(2026, 1, 16), due_date=date(2026, 1, 20))
    undated = Task(obra_id=obra.id, tenant_id=t.id, title="Sin fecha")
    db.add_all([dated1, dated2, undated])
    await db.flush()
    await db.commit()
    return {
        "obra_id": obra.id,
        "dated": [dated1.id, dated2.id],
        "undated": undated.id,
        "token": create_access_token(u.id),
    }


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def test_cpm_excludes_and_reports_undated(client, cpm_ctx):
    """La tarea sin fecha se reporta en tasks_without_dates y NO entra al cálculo."""
    r = await client.get(
        f"{API}/obras/{cpm_ctx['obra_id']}/critical-path",
        headers=_auth(cpm_ctx["token"]),
    )
    assert r.status_code == 200, r.text
    body = r.json()

    assert body["tasks_without_dates"] == [cpm_ctx["undated"]]
    # La sin fecha no aparece en el float ni entre las críticas
    assert str(cpm_ctx["undated"]) not in body["float_by_task"]
    assert cpm_ctx["undated"] not in body["critical_task_ids"]
    # Las que tienen fecha sí se calcularon
    for tid in cpm_ctx["dated"]:
        assert str(tid) in body["float_by_task"]


async def test_cpm_all_dated_no_warning(client, cpm_ctx, db):
    """Si todas las tareas tienen fecha, tasks_without_dates queda vacío."""
    # Borrar la tarea sin fecha para dejar solo las fechadas
    undated = await db.get(Task, cpm_ctx["undated"])
    await db.delete(undated)
    await db.commit()

    r = await client.get(
        f"{API}/obras/{cpm_ctx['obra_id']}/critical-path",
        headers=_auth(cpm_ctx["token"]),
    )
    assert r.status_code == 200, r.text
    assert r.json()["tasks_without_dates"] == []
