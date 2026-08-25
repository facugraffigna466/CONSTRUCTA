"""Cobertura de los fixes de la auditoría 03 (módulo tareas + bot WhatsApp).

Cierra 7.2 (responsible cross-tenant), 7.4 (dependency_type Literal),
7.5 (fechas fuera de rango de obra), 7.8 (evaluate proactivo) y 7.10
(webhook con manejo de errores diferenciado).
"""
from datetime import date, timedelta

import pytest_asyncio

from app.core.security import create_access_token
from app.models.alert import Alert, AlertType
from app.models.obra import Obra
from app.models.responsible import Responsible
from app.models.task import Task, TaskStatus
from app.models.tenant import Tenant
from app.models.user import User

API = "/api/v1"


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ─── 7.2: responsible cross-tenant ────────────────────────────────────────────

@pytest_asyncio.fixture
async def cross_tenant_ctx(db):
    """Dos tenants; tenant A tiene obra + admin; tenant B tiene responsible."""
    tA = Tenant(name="A")
    tB = Tenant(name="B")
    db.add_all([tA, tB])
    await db.flush()
    admin_a = User(email="a@x.com", hashed_password="x", full_name="A A",
                   role="admin", is_active=True, tenant_id=tA.id)
    db.add(admin_a)
    await db.flush()
    obra_a = Obra(name="Obra A", manager_id=admin_a.id, tenant_id=tA.id)
    db.add(obra_a)
    await db.flush()
    resp_b = Responsible(
        full_name="Resp B", whatsapp_number="+5490000000001",
        is_active=True, tenant_id=tB.id,
    )
    db.add(resp_b)
    await db.flush()
    await db.commit()
    return {
        "obra_a_id": obra_a.id,
        "resp_b_id": resp_b.id,
        "admin_a_token": create_access_token(admin_a.id),
    }


async def test_create_task_rejects_cross_tenant_responsible(client, cross_tenant_ctx):
    r = await client.post(
        f"{API}/tasks",
        headers=_auth(cross_tenant_ctx["admin_a_token"]),
        json={
            "obra_id": cross_tenant_ctx["obra_a_id"],
            "title": "cross tenant asignado",
            "responsible_id": cross_tenant_ctx["resp_b_id"],
        },
    )
    assert r.status_code == 404, r.text


# ─── 7.4: dependency_type Literal ─────────────────────────────────────────────

@pytest_asyncio.fixture
async def simple_obra_ctx(db):
    t = Tenant(name="Solo")
    db.add(t)
    await db.flush()
    u = User(email="s@x.com", hashed_password="x", full_name="Solo",
             role="admin", is_active=True, tenant_id=t.id)
    db.add(u)
    await db.flush()
    obra = Obra(
        name="Obra", manager_id=u.id, tenant_id=t.id,
        start_date=date(2026, 8, 1), expected_end_date=date(2026, 12, 31),
    )
    db.add(obra)
    await db.flush()
    predecessor = Task(
        obra_id=obra.id, tenant_id=t.id, title="predecesora",
        status=TaskStatus.PENDIENTE,
    )
    db.add(predecessor)
    await db.flush()
    await db.commit()
    return {
        "obra_id": obra.id,
        "pred_id": predecessor.id,
        "token": create_access_token(u.id),
        "user_id": u.id,
    }


async def test_dependency_type_rejects_invalid_literal(client, simple_obra_ctx):
    r = await client.post(
        f"{API}/tasks",
        headers=_auth(simple_obra_ctx["token"]),
        json={
            "obra_id": simple_obra_ctx["obra_id"],
            "title": "tipo dependencia inválido",
            "dependency_links": [
                {"depends_on_id": simple_obra_ctx["pred_id"], "dependency_type": "XX", "lag_days": 0}
            ],
        },
    )
    assert r.status_code == 422, r.text


# ─── 7.5: warning fechas fuera de rango de obra ────────────────────────────────

async def test_task_dates_outside_obra_range_returns_warning(client, simple_obra_ctx):
    # Obra: 2026-08-01 → 2026-12-31. Task con fechas 2027 supera el fin previsto.
    r = await client.post(
        f"{API}/tasks",
        headers=_auth(simple_obra_ctx["token"]),
        json={
            "obra_id": simple_obra_ctx["obra_id"],
            "title": "fuera de rango",
            "start_date": "2027-01-04",  # lunes, no requiere snap
            "due_date": "2027-01-08",
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    adj = body.get("date_adjustment") or ""
    assert "supera la fecha prevista" in adj.lower(), \
        f"esperaba advertencia de rango, vino: {adj!r}"


# ─── 7.8: evaluate_task_risks_for_obra proactivo ──────────────────────────────

async def test_creating_overdue_task_triggers_alert_without_get(
    client, db, simple_obra_ctx
):
    # Ninguna alerta al principio
    r0 = await client.get(
        f"{API}/alerts",
        headers=_auth(simple_obra_ctx["token"]),
        params={"obra_id": simple_obra_ctx["obra_id"], "unread_only": True},
    )
    assert r0.status_code == 200
    before = len(r0.json())

    # Creamos una tarea con due_date de ayer. No hacemos GET /tasks/obra/{id}
    # entre medio para probar que el trigger es proactivo.
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    r = await client.post(
        f"{API}/tasks",
        headers=_auth(simple_obra_ctx["token"]),
        json={
            "obra_id": simple_obra_ctx["obra_id"],
            "title": "vencida",
            "start_date": yesterday,
            "due_date": yesterday,
        },
    )
    assert r.status_code == 201, r.text

    # Consultamos alertas directamente — sin abrir la lista de tareas antes.
    r1 = await client.get(
        f"{API}/alerts",
        headers=_auth(simple_obra_ctx["token"]),
        params={"obra_id": simple_obra_ctx["obra_id"], "unread_only": True},
    )
    assert r1.status_code == 200
    after = len(r1.json())
    assert after > before, (
        f"esperaba nuevas alertas después de crear tarea vencida (before={before}, after={after})"
    )


# ─── 7.10: webhook con manejo de errores diferenciado ─────────────────────────

async def test_webhook_missing_account_sid_returns_200_with_twiml(client):
    """Antes: ValidationError silencioso, usuario sin respuesta. Ahora: 200 TwiML
    (mismo contrato con Twilio) pero el fallback WhatsApp se dispara."""
    from unittest.mock import patch, AsyncMock
    with patch("app.api.routes.webhooks.send_whatsapp_message", new=AsyncMock()) as m:
        r = await client.post(
            f"{API}/webhooks/twilio",
            data={
                "MessageSid": "SMxxxxx",
                # Falta AccountSid — ValidationError controlado
                "From": "whatsapp:+5490000000099",
                "To": "whatsapp:+14155238886",
                "Body": "HOLA",
                "NumMedia": "0",
            },
        )
        assert r.status_code == 200
        assert "<Response>" in r.text
        assert m.await_count == 1, "esperaba fallback WhatsApp al remitente"
        args = m.await_args
        assert args.args[0] == "+5490000000099"
        assert "problema" in args.args[1].lower()
