"""Cobertura de los fixes de la auditoría 02 del panel de resumen.

Cubre los tres hallazgos altos + el 5.4 (regresión del cambio de estado):

- 5.2: GET /alerts devuelve alertas huérfanas (obra_id NULL) del propio tenant,
       antes se perdían por el INNER JOIN a Obra.
- 5.3: GET /presence/online no muestra usuarios de otros tenants.
- 5.4: PATCH /obras/{id} con status=en_progreso sin tareas activas devuelve
       400 explícito en vez de aceptar silenciosamente y revertir.
"""
import pytest_asyncio

from app.core.security import create_access_token
from app.models.alert import Alert, AlertType
from app.models.obra import Obra
from app.models.tenant import Tenant
from app.models.user import User

API = "/api/v1"


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ─── 5.2: alertas huérfanas ───────────────────────────────────────────────────

@pytest_asyncio.fixture
async def orphan_alert_ctx(db):
    """Un tenant con 1 obra + 1 alerta huérfana (obra_id NULL) para el mismo tenant."""
    t = Tenant(name="Empresa Orfana")
    db.add(t)
    await db.flush()
    u = User(email="orf@x.com", hashed_password="x", full_name="Orfa", role="admin",
             is_active=True, tenant_id=t.id)
    db.add(u)
    await db.flush()
    obra = Obra(name="Obra con dueño", manager_id=u.id, tenant_id=t.id)
    db.add(obra)
    await db.flush()
    db.add_all([
        Alert(obra_id=obra.id, tenant_id=t.id, type=AlertType.DELAY_RISK, message="con obra"),
        # La joya: alerta huérfana, sin obra_id, pero con tenant_id → antes se perdía.
        Alert(obra_id=None, tenant_id=t.id, type=AlertType.TASK_OVERDUE, message="sin obra"),
    ])
    await db.flush()
    await db.commit()
    return {"token": create_access_token(u.id)}


async def test_alerts_include_orphan_without_obra(client, orphan_alert_ctx):
    r = await client.get(f"{API}/alerts", headers=_auth(orphan_alert_ctx["token"]))
    assert r.status_code == 200, r.text
    messages = {a["message"] for a in r.json()}
    assert "con obra" in messages
    assert "sin obra" in messages, "la alerta huérfana debe aparecer con Alert.tenant_id"


# ─── 5.3: presencia scopeada por tenant ───────────────────────────────────────

@pytest_asyncio.fixture
async def two_tenants(db):
    from app.core.presence import _store
    _store.clear()  # los tests corren en el mismo proceso, arrancamos limpio
    t1 = Tenant(name="Empresa 1")
    t2 = Tenant(name="Empresa 2")
    db.add_all([t1, t2])
    await db.flush()
    u1 = User(email="u1@x.com", hashed_password="x", full_name="Uno Uno",
              role="admin", is_active=True, tenant_id=t1.id)
    u2 = User(email="u2@x.com", hashed_password="x", full_name="Dos Dos",
              role="admin", is_active=True, tenant_id=t2.id)
    db.add_all([u1, u2])
    await db.flush()
    await db.commit()
    return {
        "t1_token": create_access_token(u1.id),
        "t2_token": create_access_token(u2.id),
    }


async def test_presence_scopes_by_tenant(client, two_tenants):
    # u2 hace heartbeat
    r2 = await client.get(f"{API}/presence/online", headers=_auth(two_tenants["t2_token"]))
    assert r2.status_code == 200, r2.text
    # u1 pide su lista de presencia: no debería ver a u2 (otro tenant)
    r1 = await client.get(f"{API}/presence/online", headers=_auth(two_tenants["t1_token"]))
    assert r1.status_code == 200, r1.text
    ids_visibles_para_u1 = {u["id"] for u in r1.json()["users"]}
    # Sólo u1 (que acaba de hacer heartbeat en este mismo request)
    assert "Dos Dos" not in {u["name"] for u in r1.json()["users"]}
    assert len(ids_visibles_para_u1) == 1


# ─── 5.4: cambio manual a en_progreso sin tareas ─────────────────────────────

@pytest_asyncio.fixture
async def obra_sin_tareas(db):
    t = Tenant(name="EnProgreso Tenant")
    db.add(t)
    await db.flush()
    u = User(email="ep@x.com", hashed_password="x", full_name="Ep", role="admin",
             is_active=True, tenant_id=t.id)
    db.add(u)
    await db.flush()
    obra = Obra(name="Obra vacía", manager_id=u.id, tenant_id=t.id)
    db.add(obra)
    await db.flush()
    await db.commit()
    return {"obra_id": obra.id, "token": create_access_token(u.id)}


async def test_update_status_en_progreso_sin_tareas_devuelve_400(client, obra_sin_tareas):
    r = await client.patch(
        f"{API}/obras/{obra_sin_tareas['obra_id']}",
        headers=_auth(obra_sin_tareas["token"]),
        json={"status": "en_progreso"},
    )
    assert r.status_code == 400, r.text
    assert "tarea" in r.json()["detail"].lower()
