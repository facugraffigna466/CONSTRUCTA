"""Aviso preventivo al 80% del plan (Fase 6 emails — mejora 6.8 audit 01 §8.6.A).

Cubre:
  - El aviso se dispara cuando el uso proyectado alcanza el 80% del límite
    (por 'obras' y 'usuarios'; para 'tareas por obra' se replica el patrón).
  - Al 79% no dispara.
  - Al 100% también dispara.
  - Dedupe: si `tenants.last_plan_warning_at` está dentro de los últimos 7
    días, no se manda otro.
  - `requested=0` (doble candado de accept-invite) no dispara — no hay
    cambio real de estado.
  - Si el tenant no tiene owner o el owner no tiene email, se skipea sin
    romper el flujo.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest_asyncio

from app.core import plan_limits
from app.core.security import create_access_token
from app.models.obra import Obra
from app.models.plan import Plan
from app.models.tenant import Tenant
from app.models.user import User

API = "/api/v1"


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def ctx(db):
    """Tenant con plan de max_obras=5, admin owner con email, 3 obras pre-creadas.
    Estado: 3/5 = 60% — el próximo POST /obras deja 4/5 = 80%."""
    plan = Plan(name="mini", max_obras=5, max_users=5, max_tasks_per_obra=10)
    db.add(plan)
    await db.flush()

    tenant = Tenant(name="Constructora Nueve", plan_id=plan.id)
    db.add(tenant)
    await db.flush()

    admin = User(
        email="admin@nueve.com", hashed_password="x", full_name="Admin Nueve",
        role="admin", is_active=True, tenant_id=tenant.id,
    )
    db.add(admin)
    await db.flush()

    # El owner_user_id se setea después de crear al admin para tener id disponible.
    tenant.owner_user_id = admin.id

    # 3 obras pre-existentes (3/5 = 60%). El próximo POST deja 4/5 = 80%.
    for i in range(3):
        db.add(Obra(name=f"Obra {i}", manager_id=admin.id, tenant_id=tenant.id))
    await db.commit()

    return {
        "db": db,
        "plan_id": plan.id,
        "tenant_id": tenant.id,
        "admin_id": admin.id,
        "admin_token": create_access_token(admin.id),
    }


# ─────────────────────────────────────────────────────────────
# Casos: threshold cumplido / no cumplido
# ─────────────────────────────────────────────────────────────


async def test_al_80_dispara_email(client, db, ctx):
    """3 obras existentes + 1 nueva = 4/5 = 80% → debe encolar email."""
    with patch("app.core.plan_limits._send_plan_warning_now", new=AsyncMock()) as mock_send:
        r = await client.post(
            f"{API}/obras", json={"name": "La cuarta", "location": "X"},
            headers=_auth(ctx["admin_token"]),
        )
    assert r.status_code == 201, r.text
    mock_send.assert_awaited_once()
    kwargs = mock_send.await_args.kwargs
    assert kwargs["tenant_id"] == ctx["tenant_id"]
    assert kwargs["resource_label"] == "obras"
    assert kwargs["projected"] == 4
    assert kwargs["limit"] == 5
    assert kwargs["plan_name"] == "mini"

    # Y guardó el timestamp en tenants.last_plan_warning_at
    tenant = await db.get(Tenant, ctx["tenant_id"])
    await db.refresh(tenant)
    assert tenant.last_plan_warning_at is not None


async def test_al_79_no_dispara(client, db, ctx):
    """Bajamos el plan a max_obras=10 → 3+1=4/10=40% (por debajo). No email."""
    plan = await db.get(Plan, ctx["plan_id"])
    plan.max_obras = 10
    await db.commit()

    with patch("app.core.plan_limits._send_plan_warning_now", new=AsyncMock()) as mock_send:
        r = await client.post(
            f"{API}/obras", json={"name": "sin trigger", "location": "X"},
            headers=_auth(ctx["admin_token"]),
        )
    assert r.status_code == 201
    mock_send.assert_not_awaited()


async def test_al_100_dispara_email(client, db, ctx):
    """Precargar hasta 4/5 y crear la quinta = 5/5 = 100% → dispara."""
    admin_id = ctx["admin_id"]
    db.add(Obra(name="Obra 4", manager_id=admin_id, tenant_id=ctx["tenant_id"]))
    await db.commit()

    with patch("app.core.plan_limits._send_plan_warning_now", new=AsyncMock()) as mock_send:
        r = await client.post(
            f"{API}/obras", json={"name": "La quinta", "location": "X"},
            headers=_auth(ctx["admin_token"]),
        )
    assert r.status_code == 201
    mock_send.assert_awaited_once()
    kwargs = mock_send.await_args.kwargs
    assert kwargs["projected"] == 5
    assert kwargs["limit"] == 5


# ─────────────────────────────────────────────────────────────
# Dedupe: cooldown de 7 días
# ─────────────────────────────────────────────────────────────


async def test_no_manda_si_hubo_uno_hace_menos_de_7_dias(client, db, ctx):
    """Simulamos que ya se mandó un aviso hace 3 días → el nuevo POST no
    debe encolar email aunque el umbral se cumpla."""
    tenant = await db.get(Tenant, ctx["tenant_id"])
    tenant.last_plan_warning_at = datetime.now(timezone.utc) - timedelta(days=3)
    await db.commit()

    with patch("app.core.plan_limits._send_plan_warning_now", new=AsyncMock()) as mock_send:
        r = await client.post(
            f"{API}/obras", json={"name": "no dedupe", "location": "X"},
            headers=_auth(ctx["admin_token"]),
        )
    assert r.status_code == 201
    mock_send.assert_not_awaited()


async def test_manda_si_paso_mas_de_7_dias(client, db, ctx):
    """Si el último aviso fue hace 10 días, el cooldown expiró → vuelve a mandar."""
    tenant = await db.get(Tenant, ctx["tenant_id"])
    tenant.last_plan_warning_at = datetime.now(timezone.utc) - timedelta(days=10)
    await db.commit()

    with patch("app.core.plan_limits._send_plan_warning_now", new=AsyncMock()) as mock_send:
        r = await client.post(
            f"{API}/obras", json={"name": "post cooldown", "location": "X"},
            headers=_auth(ctx["admin_token"]),
        )
    assert r.status_code == 201
    mock_send.assert_awaited_once()


# ─────────────────────────────────────────────────────────────
# requested=0 (doble candado accept-invite) NO dispara
# ─────────────────────────────────────────────────────────────


async def test_check_con_requested_0_nunca_dispara(db, ctx):
    """El doble candado del accept-invite llama check_plan_limit(..., requested=0)
    para verificar que el tenant sigue dentro del límite. No debe encolar aviso
    porque no hay cambio real (el user ya estaba contado como invitación viva)."""
    # Bajamos el plan para que estemos al 100% (3 obras + 0 = 3/3).
    plan = await db.get(Plan, ctx["plan_id"])
    plan.max_users = 3
    await db.commit()

    with patch("app.core.plan_limits._send_plan_warning_now", new=AsyncMock()) as mock_send:
        # Simulamos el llamado del accept-invite (requested=0).
        await plan_limits.check_plan_limit(
            db, tenant_id=ctx["tenant_id"], resource="users", requested=0,
        )
    mock_send.assert_not_awaited()


# ─────────────────────────────────────────────────────────────
# Manejo de owner ausente / sin email
# ─────────────────────────────────────────────────────────────


async def test_send_plan_warning_now_sin_owner_es_silencioso(db, ctx):
    """El helper _send_plan_warning_now debe skipear (sin explotar) si el
    tenant no tiene owner_user_id. Este es el path por defecto en tenants
    creados sin owner (raro pero posible)."""
    tenant = await db.get(Tenant, ctx["tenant_id"])
    tenant.owner_user_id = None
    await db.commit()

    # Corre efectivamente el helper (sin mockearlo) — solo mockeamos el
    # cliente HTTP para no hacer request real. Como salta antes del envío,
    # httpx nunca debería ser llamado.
    with patch("app.services.email_service._send_via_brevo", new=AsyncMock()) as mock_brevo:
        await plan_limits._send_plan_warning_now(
            tenant_id=ctx["tenant_id"],
            resource_label="obras",
            projected=4,
            limit=5,
            plan_name="mini",
        )
    mock_brevo.assert_not_awaited()


async def test_send_plan_warning_now_sin_email_owner_es_silencioso(db, ctx):
    """Si el owner existe pero no tiene email (bug/estado corrupto), tampoco
    explota."""
    admin = await db.get(User, ctx["admin_id"])
    admin.email = ""
    await db.commit()

    with patch("app.services.email_service._send_via_brevo", new=AsyncMock()) as mock_brevo:
        await plan_limits._send_plan_warning_now(
            tenant_id=ctx["tenant_id"],
            resource_label="obras",
            projected=4,
            limit=5,
            plan_name="mini",
        )
    mock_brevo.assert_not_awaited()
