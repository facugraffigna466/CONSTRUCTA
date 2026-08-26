"""Plan limits — bypass del conteo de usuarios y del bulk de tareas.

Cubre los dos bugs que la Fase 0 del rediseño de roles cierra:
1. Invitaciones pendientes bypaseaban el conteo (audit 01 §5.2).
2. bulk_create_tasks solo comparaba current vs limit, ignorando len(rows) (audit 03 §7.3).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest_asyncio

from app.core.security import create_access_token
from app.models.obra import Obra
from app.models.plan import Plan
from app.models.task import Task
from app.models.tenant import Tenant
from app.models.tenant_membership import TenantMembership
from app.models.user import User

API = "/api/v1"


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _mk_plan(db, name: str, max_users: int | None = None,
                   max_obras: int | None = None, max_tasks: int | None = None) -> Plan:
    plan = Plan(
        name=name,
        max_users=max_users,
        max_obras=max_obras,
        max_tasks_per_obra=max_tasks,
    )
    db.add(plan)
    await db.flush()
    return plan


@pytest_asyncio.fixture
async def small_plan_ctx(db):
    """Tenant con plan que permite hasta 3 usuarios y hasta 5 tareas/obra.
    Ya tiene un admin activo (1/3 slots consumidos)."""
    plan = await _mk_plan(db, "test-limit", max_users=3, max_tasks=5)
    tenant = Tenant(name="Empresa Limitada", plan_id=plan.id)
    db.add(tenant)
    await db.flush()

    admin = User(
        email="admin@limit.com",
        hashed_password="x",
        full_name="Admin",
        role="admin",
        is_active=True,
        tenant_id=tenant.id,
    )
    db.add(admin)
    await db.flush()
    # Espejo en TenantMembership (Fase 2 rediseño multi-tenant): plan_limits
    # cuenta contra esta tabla, no contra `users` directamente.
    db.add(TenantMembership(
        user_id=admin.id, tenant_id=tenant.id, role="admin", is_active=True,
    ))
    await db.flush()

    obra = Obra(name="Obra Limitada", manager_id=admin.id, tenant_id=tenant.id)
    db.add(obra)
    await db.flush()
    await db.commit()

    return {
        "plan_id": plan.id,
        "tenant_id": tenant.id,
        "admin_id": admin.id,
        "obra_id": obra.id,
        "admin_token": create_access_token(admin.id),
    }


# ────────────────────────────────────────────────────────────────
# Bypass del límite de usuarios via invitaciones pendientes
# ────────────────────────────────────────────────────────────────


async def test_invitaciones_pendientes_cuentan_hacia_el_limite(client, small_plan_ctx):
    """Repro del bypass: max_users=3, admin ya activo (1/3). Invito 2 más → 3/3.
    La 3ra invitación (que sería 4/3) debe fallar con 402 aunque las 2 primeras
    todavía no aceptaron."""
    headers = _auth(small_plan_ctx["admin_token"])

    r1 = await client.post(
        f"{API}/users/invite",
        json={"email": "invit1@limit.com", "role": "collaborator"},
        headers=headers,
    )
    assert r1.status_code == 201, r1.text

    r2 = await client.post(
        f"{API}/users/invite",
        json={"email": "invit2@limit.com", "role": "collaborator"},
        headers=headers,
    )
    assert r2.status_code == 201, r2.text

    # 4ta persona (admin + 2 invits pendientes ya son 3/3) → debe rebotar.
    r3 = await client.post(
        f"{API}/users/invite",
        json={"email": "invit3@limit.com", "role": "collaborator"},
        headers=headers,
    )
    assert r3.status_code == 402, r3.text
    body = r3.json()["detail"]
    assert body["code"] == "plan_limit_reached"
    assert body["resource"] == "usuarios"


async def test_invitaciones_vencidas_no_cuentan(client, db, small_plan_ctx):
    """Si la invitación venció (invitation_expires_at pasó) libera el slot."""
    # Metemos manualmente 2 usuarios "invitados" con token vencido:
    tenant_id = small_plan_ctx["tenant_id"]
    past = datetime.now(timezone.utc) - timedelta(hours=1)
    for i in range(2):
        expired_user = User(
            email=f"expired{i}@limit.com",
            hashed_password="",
            full_name="",
            role="collaborator",
            is_active=False,
            invitation_token=f"tok-expired-{i}",
            invitation_expires_at=past,
            tenant_id=tenant_id,
        )
        db.add(expired_user)
        await db.flush()
        db.add(TenantMembership(
            user_id=expired_user.id, tenant_id=tenant_id, role="collaborator",
            is_active=False, invitation_token=f"tok-expired-{i}",
            invitation_expires_at=past,
        ))
    await db.commit()

    # Ahora tenemos: admin activo (1) + 2 expirados (no cuentan) = 1/3.
    # Invitar 2 más debería andar.
    headers = _auth(small_plan_ctx["admin_token"])
    r1 = await client.post(
        f"{API}/users/invite",
        json={"email": "new1@limit.com", "role": "collaborator"},
        headers=headers,
    )
    assert r1.status_code == 201, r1.text
    r2 = await client.post(
        f"{API}/users/invite",
        json={"email": "new2@limit.com", "role": "collaborator"},
        headers=headers,
    )
    assert r2.status_code == 201, r2.text
    # Con 1 activo + 2 vivas = 3/3, la 4ta no.
    r3 = await client.post(
        f"{API}/users/invite",
        json={"email": "new3@limit.com", "role": "collaborator"},
        headers=headers,
    )
    assert r3.status_code == 402


async def test_accept_invite_revalida_limite(client, db, small_plan_ctx):
    """Doble candado: si el tenant queda por encima del límite (ej: alguien
    hizo downgrade de plan después del invite), aceptar debe fallar 402
    en vez de dejar entrar al usuario y quedar en 4/3."""
    tenant_id = small_plan_ctx["tenant_id"]
    # 1) Invitamos 2 usuarios legítimamente (1 admin + 2 pendientes = 3/3).
    headers = _auth(small_plan_ctx["admin_token"])
    inv1 = await client.post(
        f"{API}/users/invite",
        json={"email": "acc1@limit.com", "role": "collaborator"},
        headers=headers,
    )
    assert inv1.status_code == 201
    token1 = inv1.json()["invite_token"]

    inv2 = await client.post(
        f"{API}/users/invite",
        json={"email": "acc2@limit.com", "role": "collaborator"},
        headers=headers,
    )
    assert inv2.status_code == 201

    # 2) Simulamos un "downgrade": bajamos el límite del plan a 2. Ahora estamos
    #    en 3/2 (1 admin + 2 invitaciones vivas).
    plan = await db.get(Plan, small_plan_ctx["plan_id"])
    plan.max_users = 2
    await db.commit()

    # 3) Aceptar debe fallar con 402 aunque el token sea válido.
    r = await client.post(
        f"{API}/auth/accept-invite",
        json={"token": token1, "password": "unaContra123", "full_name": "Acc Uno"},
    )
    assert r.status_code == 402, r.text
    assert r.json()["detail"]["code"] == "plan_limit_reached"


# ────────────────────────────────────────────────────────────────
# Bulk create tasks respeta requested
# ────────────────────────────────────────────────────────────────


async def test_bulk_create_tasks_respeta_requested(client, db, small_plan_ctx):
    """max_tasks_per_obra=5. Precargamos 3 tareas → bulk de 3 (3+3=6 > 5) debe fallar."""
    obra_id = small_plan_ctx["obra_id"]
    tenant_id = small_plan_ctx["tenant_id"]

    for i in range(3):
        db.add(Task(obra_id=obra_id, tenant_id=tenant_id, title=f"pre-{i}"))
    await db.commit()

    r = await client.post(
        f"{API}/tasks/obra/{obra_id}/bulk",
        json={"rows": [{"title": "a"}, {"title": "b"}, {"title": "c"}]},
        headers=_auth(small_plan_ctx["admin_token"]),
    )
    assert r.status_code == 402, r.text
    body = r.json()["detail"]
    assert body["code"] == "plan_limit_reached"
    assert body["resource"] == "tareas por obra"


async def test_bulk_create_tasks_dentro_del_limite_pasa(client, db, small_plan_ctx):
    """max_tasks=5, precargamos 2 → bulk de 3 (2+3=5) debe pasar."""
    obra_id = small_plan_ctx["obra_id"]
    tenant_id = small_plan_ctx["tenant_id"]

    for i in range(2):
        db.add(Task(obra_id=obra_id, tenant_id=tenant_id, title=f"pre-{i}"))
    await db.commit()

    r = await client.post(
        f"{API}/tasks/obra/{obra_id}/bulk",
        json={"rows": [{"title": "a"}, {"title": "b"}, {"title": "c"}]},
        headers=_auth(small_plan_ctx["admin_token"]),
    )
    assert r.status_code == 201, r.text
