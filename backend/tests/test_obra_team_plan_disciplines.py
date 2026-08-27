"""Acceso a planos por WhatsApp de cada responsable (`plan_disciplines`).

Semántica del campo:
    None  → puede pedir cualquier plano de la obra (default al sumar a alguien)
    []    → no puede pedir ninguno
    [..]  → solo esas disciplinas

El caso `[]` es el que se rompía: `plan_disciplines or None` en el POST lo
convertía en None (acceso total), justo lo contrario de lo pedido, porque en
Python la lista vacía es falsy.
"""
from __future__ import annotations

import pytest_asyncio

from app.core.security import create_access_token
from app.models.obra import Obra
from app.models.tenant import Tenant
from app.models.user import User

API = "/api/v1"


@pytest_asyncio.fixture
async def ctx(db):
    tenant = Tenant(name="Empresa Planos Team")
    db.add(tenant)
    await db.flush()
    admin = User(
        email="admin@team.com", hashed_password="x", full_name="Admin",
        role="admin", is_active=True, tenant_id=tenant.id,
    )
    db.add(admin)
    await db.flush()
    obra = Obra(name="Obra Team", manager_id=admin.id, tenant_id=tenant.id)
    db.add(obra)
    await db.flush()
    await db.commit()
    return {"obra_id": obra.id, "token": create_access_token(admin.id)}


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _add(client, ctx, *, phone: str, plan_disciplines=..., name="Nuevo"):
    payload = {"full_name": name, "whatsapp_number": phone, "role": None}
    if plan_disciplines is not ...:
        payload["plan_disciplines"] = plan_disciplines
    return client.post(f"{API}/obras/{ctx['obra_id']}/team", headers=_auth(ctx["token"]), json=payload)


# ── Alta ────────────────────────────────────────────────────────────────────

async def test_add_without_field_defaults_to_full_access(client, ctx):
    """Sumar a alguien sin especificar nada = acceso a todos los planos."""
    r = await _add(client, ctx, phone="+5493510001111")
    assert r.status_code == 201, r.text
    assert r.json()["plan_disciplines"] is None


async def test_add_with_null_is_full_access(client, ctx):
    r = await _add(client, ctx, phone="+5493510002222", plan_disciplines=None)
    assert r.status_code == 201, r.text
    assert r.json()["plan_disciplines"] is None


async def test_add_with_empty_list_means_no_access(client, ctx):
    """El bug: [] es falsy, y `or None` lo volvía acceso total."""
    r = await _add(client, ctx, phone="+5493510003333", plan_disciplines=[])
    assert r.status_code == 201, r.text
    assert r.json()["plan_disciplines"] == [], "sin acceso no debe volverse acceso total"


async def test_add_with_explicit_disciplines(client, ctx):
    r = await _add(client, ctx, phone="+5493510004444", plan_disciplines=["electricidad", "gas"])
    assert r.status_code == 201, r.text
    assert r.json()["plan_disciplines"] == ["electricidad", "gas"]


# ── Edición ─────────────────────────────────────────────────────────────────

async def test_toggle_full_access_to_none_and_back(client, ctx):
    """El interruptor de la fila: alterna entre todos y ninguno."""
    added = await _add(client, ctx, phone="+5493510005555")
    rid = added.json()["responsible_id"]
    url = f"{API}/obras/{ctx['obra_id']}/team/{rid}"

    off = await client.patch(url, headers=_auth(ctx["token"]), json={"role": None, "plan_disciplines": []})
    assert off.status_code == 200, off.text
    assert off.json()["plan_disciplines"] == []

    on = await client.patch(url, headers=_auth(ctx["token"]), json={"role": None, "plan_disciplines": None})
    assert on.status_code == 200, on.text
    assert on.json()["plan_disciplines"] is None
