"""Listado de alertas: filtrado por obra en el servidor (F5) — antes traía todas
las del tenant y filtraba en el cliente. También `limit` acota el volumen."""
import pytest_asyncio

from app.core.security import create_access_token
from app.models.alert import Alert, AlertType
from app.models.obra import Obra
from app.models.tenant import Tenant
from app.models.user import User

API = "/api/v1"


@pytest_asyncio.fixture
async def alerts_ctx(db):
    """Un tenant con 2 obras: obra A con 2 alertas, obra B con 1."""
    t = Tenant(name="Empresa Alerts")
    db.add(t)
    await db.flush()
    u = User(email="al@x.com", hashed_password="x", full_name="Al", role="admin",
             is_active=True, tenant_id=t.id)
    db.add(u)
    await db.flush()
    obra_a = Obra(name="Obra A", manager_id=u.id, tenant_id=t.id)
    obra_b = Obra(name="Obra B", manager_id=u.id, tenant_id=t.id)
    db.add_all([obra_a, obra_b])
    await db.flush()
    db.add_all([
        Alert(obra_id=obra_a.id, tenant_id=t.id, type=AlertType.DELAY_RISK, message="A1"),
        Alert(obra_id=obra_a.id, tenant_id=t.id, type=AlertType.TASK_OVERDUE, message="A2"),
        Alert(obra_id=obra_b.id, tenant_id=t.id, type=AlertType.DELAY_RISK, message="B1"),
    ])
    await db.flush()
    await db.commit()
    return {"obra_a": obra_a.id, "obra_b": obra_b.id, "token": create_access_token(u.id)}


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def test_alerts_filtered_by_obra_server_side(client, alerts_ctx):
    """?obra_id=A → solo las 2 alertas de A (el servidor filtra, no el cliente)."""
    r = await client.get(
        f"{API}/alerts",
        headers=_auth(alerts_ctx["token"]),
        params={"obra_id": alerts_ctx["obra_a"]},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body) == 2
    assert all(a["obra_id"] == alerts_ctx["obra_a"] for a in body)


async def test_alerts_without_filter_returns_all_tenant(client, alerts_ctx):
    """Sin obra_id → las 3 del tenant (el bell global las sigue necesitando)."""
    r = await client.get(f"{API}/alerts", headers=_auth(alerts_ctx["token"]))
    assert r.status_code == 200, r.text
    assert len(r.json()) == 3


async def test_alerts_limit_caps_volume(client, alerts_ctx):
    """?limit=1 → como mucho 1 alerta (guarda de escala)."""
    r = await client.get(
        f"{API}/alerts",
        headers=_auth(alerts_ctx["token"]),
        params={"limit": 1},
    )
    assert r.status_code == 200, r.text
    assert len(r.json()) == 1
