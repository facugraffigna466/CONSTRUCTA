"""Invitación con asignaciones de obra por-rol (Fase 3 rediseño de roles).

Cubre:
  - Payload extendido: invitar con `obra_assignments` guarda pendientes.
  - Payload viejo (sin obra_assignments): sigue funcionando — retrocompat.
  - Obra inválida (otro tenant / no existe): ignorada silenciosamente, la
    invitación se emite igual.
  - Accept materializa las filas de ObraUserRole en la misma transacción.
  - Obra borrada entre invite y accept: se descarta sin romper el accept.
  - GET /auth/invite/{token} devuelve las asignaciones que se van a aplicar.
  - GET /users/me y /users hidratan `obra_roles` del user.
"""
from __future__ import annotations

import pytest_asyncio
from sqlalchemy import select

from app.core.security import create_access_token
from app.models.obra import Obra
from app.models.obra_user_role import ObraUserRole, ObraUserRoleType
from app.models.tenant import Tenant
from app.models.user import User

API = "/api/v1"


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def ctx(db):
    """Tenant A con admin y dos obras. Tenant B con una obra (para probar
    aislamiento cross-tenant en el filtro de asignaciones)."""
    t_a = Tenant(name="A")
    t_b = Tenant(name="B")
    db.add_all([t_a, t_b])
    await db.flush()

    admin_a = User(
        email="admin@a.com", hashed_password="x", full_name="Admin A",
        role="admin", is_active=True, tenant_id=t_a.id,
    )
    admin_b = User(
        email="admin@b.com", hashed_password="x", full_name="Admin B",
        role="admin", is_active=True, tenant_id=t_b.id,
    )
    db.add_all([admin_a, admin_b])
    await db.flush()

    obra_a1 = Obra(name="Obra A1", manager_id=admin_a.id, tenant_id=t_a.id)
    obra_a2 = Obra(name="Obra A2", manager_id=admin_a.id, tenant_id=t_a.id)
    obra_b1 = Obra(name="Obra B1", manager_id=admin_b.id, tenant_id=t_b.id)
    db.add_all([obra_a1, obra_a2, obra_b1])
    await db.flush()
    await db.commit()

    return {
        "db": db,
        "tenant_a": t_a.id,
        "tenant_b": t_b.id,
        "obra_a1": obra_a1.id,
        "obra_a2": obra_a2.id,
        "obra_b1": obra_b1.id,
        "admin_a_token": create_access_token(admin_a.id),
    }


# ────────────────────────────────────────────────────────────────
# Payload viejo (retrocompat) — el frontend actual no manda obra_assignments
# ────────────────────────────────────────────────────────────────


async def test_invite_sin_obra_assignments_sigue_funcionando(client, ctx):
    """El frontend actual manda solo email+role. Debe seguir emitiendo la
    invitación sin explotar."""
    r = await client.post(
        f"{API}/users/invite",
        json={"email": "nueva@a.com", "role": "collaborator"},
        headers=_auth(ctx["admin_a_token"]),
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert "invite_token" in body
    assert body["obra_assignments"] == []


async def test_accept_sin_asignaciones_no_crea_filas(client, db, ctx):
    """Retrocompat: aceptar una invitación sin pendientes NO crea filas
    huérfanas en obra_user_roles."""
    inv = await client.post(
        f"{API}/users/invite",
        json={"email": "sin_obras@a.com", "role": "collaborator"},
        headers=_auth(ctx["admin_a_token"]),
    )
    token = inv.json()["invite_token"]
    acc = await client.post(
        f"{API}/auth/accept-invite",
        json={"token": token, "full_name": "Sin Obras", "password": "unaClave123"},
    )
    assert acc.status_code == 200

    user = (await db.execute(
        select(User).where(User.email == "sin_obras@a.com")
    )).scalar_one()
    rows = (await db.execute(
        select(ObraUserRole).where(ObraUserRole.user_id == user.id)
    )).scalars().all()
    assert rows == []


# ────────────────────────────────────────────────────────────────
# Payload nuevo — invite guarda pendientes
# ────────────────────────────────────────────────────────────────


async def test_invite_con_obras_guarda_pendientes(client, db, ctx):
    r = await client.post(
        f"{API}/users/invite",
        json={
            "email": "conobras@a.com",
            "role": "collaborator",
            "obra_assignments": [
                {"obra_id": ctx["obra_a1"], "role": "jefe_obra"},
                {"obra_id": ctx["obra_a2"], "role": "colaborador"},
            ],
        },
        headers=_auth(ctx["admin_a_token"]),
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert len(body["obra_assignments"]) == 2

    # Se guardaron las pendientes en la columna JSON.
    user = (await db.execute(
        select(User).where(User.email == "conobras@a.com")
    )).scalar_one()
    assert user.pending_obra_assignments is not None
    pending_ids = {p["obra_id"] for p in user.pending_obra_assignments}
    assert pending_ids == {ctx["obra_a1"], ctx["obra_a2"]}

    # Y NO se materializaron las filas en obra_user_roles todavía.
    rows = (await db.execute(
        select(ObraUserRole).where(ObraUserRole.user_id == user.id)
    )).scalars().all()
    assert rows == []


async def test_accept_materializa_asignaciones(client, db, ctx):
    inv = await client.post(
        f"{API}/users/invite",
        json={
            "email": "acc@a.com", "role": "collaborator",
            "obra_assignments": [
                {"obra_id": ctx["obra_a1"], "role": "jefe_obra"},
                {"obra_id": ctx["obra_a2"], "role": "solo_lectura"},
            ],
        },
        headers=_auth(ctx["admin_a_token"]),
    )
    token = inv.json()["invite_token"]
    acc = await client.post(
        f"{API}/auth/accept-invite",
        json={"token": token, "full_name": "Acc", "password": "unaClave123"},
    )
    assert acc.status_code == 200, acc.text

    user = (await db.execute(
        select(User).where(User.email == "acc@a.com")
    )).scalar_one()
    # pending_obra_assignments quedó limpio.
    assert user.pending_obra_assignments is None

    # Se crearon las filas efectivas con los roles correctos.
    rows = (await db.execute(
        select(ObraUserRole).where(ObraUserRole.user_id == user.id)
        .order_by(ObraUserRole.obra_id)
    )).scalars().all()
    assert len(rows) == 2
    by_obra = {r.obra_id: r.role for r in rows}
    assert by_obra[ctx["obra_a1"]] == ObraUserRoleType.JEFE_OBRA
    assert by_obra[ctx["obra_a2"]] == ObraUserRoleType.SOLO_LECTURA


# ────────────────────────────────────────────────────────────────
# Edge case: obras inválidas se descartan sin romper
# ────────────────────────────────────────────────────────────────


async def test_invite_ignora_obra_de_otro_tenant(client, db, ctx):
    """Cross-tenant en el payload: la obra_b1 (tenant B) se descarta;
    la a1 se acepta. La invitación se emite igual."""
    r = await client.post(
        f"{API}/users/invite",
        json={
            "email": "mix@a.com", "role": "collaborator",
            "obra_assignments": [
                {"obra_id": ctx["obra_a1"], "role": "colaborador"},
                {"obra_id": ctx["obra_b1"], "role": "jefe_obra"},
            ],
        },
        headers=_auth(ctx["admin_a_token"]),
    )
    assert r.status_code == 201, r.text
    body = r.json()
    # Solo queda la asignación válida.
    assert len(body["obra_assignments"]) == 1
    assert body["obra_assignments"][0]["obra_id"] == ctx["obra_a1"]


async def test_invite_ignora_obra_inexistente(client, ctx):
    r = await client.post(
        f"{API}/users/invite",
        json={
            "email": "inv@a.com", "role": "collaborator",
            "obra_assignments": [
                {"obra_id": 999999, "role": "colaborador"},
            ],
        },
        headers=_auth(ctx["admin_a_token"]),
    )
    assert r.status_code == 201
    assert r.json()["obra_assignments"] == []


async def test_accept_ignora_obra_borrada_entre_invite_y_accept(client, db, ctx):
    """Defensive: si entre el invite y el accept alguien borra una obra, no
    romper el accept — solo saltearse esa asignación."""
    inv = await client.post(
        f"{API}/users/invite",
        json={
            "email": "borrada@a.com", "role": "collaborator",
            "obra_assignments": [
                {"obra_id": ctx["obra_a1"], "role": "colaborador"},
                {"obra_id": ctx["obra_a2"], "role": "colaborador"},
            ],
        },
        headers=_auth(ctx["admin_a_token"]),
    )
    assert inv.status_code == 201
    token = inv.json()["invite_token"]

    # Borramos la a2 antes de aceptar.
    obra_a2 = await db.get(Obra, ctx["obra_a2"])
    await db.delete(obra_a2)
    await db.commit()

    acc = await client.post(
        f"{API}/auth/accept-invite",
        json={"token": token, "full_name": "Borrada", "password": "unaClave123"},
    )
    assert acc.status_code == 200, acc.text
    user = (await db.execute(
        select(User).where(User.email == "borrada@a.com")
    )).scalar_one()
    rows = (await db.execute(
        select(ObraUserRole).where(ObraUserRole.user_id == user.id)
    )).scalars().all()
    # Solo la a1 (la a2 se saltó silenciosamente).
    assert len(rows) == 1
    assert rows[0].obra_id == ctx["obra_a1"]


# ────────────────────────────────────────────────────────────────
# GET /auth/invite/{token} refleja las asignaciones
# ────────────────────────────────────────────────────────────────


async def test_invite_context_incluye_obras_pendientes(client, ctx):
    inv = await client.post(
        f"{API}/users/invite",
        json={
            "email": "ctx@a.com", "role": "collaborator",
            "obra_assignments": [
                {"obra_id": ctx["obra_a1"], "role": "jefe_obra"},
            ],
        },
        headers=_auth(ctx["admin_a_token"]),
    )
    token = inv.json()["invite_token"]

    r = await client.get(f"{API}/auth/invite/{token}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["email"] == "ctx@a.com"
    assert body["company_name"] == "A"
    assert len(body["obra_assignments"]) == 1
    assert body["obra_assignments"][0]["obra_id"] == ctx["obra_a1"]
    assert body["obra_assignments"][0]["obra_name"] == "Obra A1"
    assert body["obra_assignments"][0]["role"] == "jefe_obra"


# ────────────────────────────────────────────────────────────────
# UserRead expone obra_roles (Fase 3)
# ────────────────────────────────────────────────────────────────


async def test_users_me_incluye_obra_roles(client, db, ctx):
    """Después de aceptar la invitación, /users/me devuelve las asignaciones."""
    inv = await client.post(
        f"{API}/users/invite",
        json={
            "email": "me@a.com", "role": "collaborator",
            "obra_assignments": [
                {"obra_id": ctx["obra_a1"], "role": "colaborador"},
            ],
        },
        headers=_auth(ctx["admin_a_token"]),
    )
    token = inv.json()["invite_token"]
    acc = await client.post(
        f"{API}/auth/accept-invite",
        json={"token": token, "full_name": "Me", "password": "unaClave123"},
    )
    access_token = acc.json()["access_token"]

    r = await client.get(f"{API}/users/me", headers=_auth(access_token))
    assert r.status_code == 200
    body = r.json()
    assert body["email"] == "me@a.com"
    assert len(body["obra_roles"]) == 1
    assert body["obra_roles"][0]["obra_name"] == "Obra A1"
    assert body["obra_roles"][0]["role"] == "colaborador"


async def test_admin_list_users_incluye_obra_roles(client, db, ctx):
    """GET /users lista todos los miembros del tenant con sus obra_roles."""
    # Invitar y aceptar dos, con roles distintos.
    for email, obra_id, role in [
        ("u1@a.com", ctx["obra_a1"], "jefe_obra"),
        ("u2@a.com", ctx["obra_a2"], "solo_lectura"),
    ]:
        inv = await client.post(
            f"{API}/users/invite",
            json={
                "email": email, "role": "collaborator",
                "obra_assignments": [{"obra_id": obra_id, "role": role}],
            },
            headers=_auth(ctx["admin_a_token"]),
        )
        token = inv.json()["invite_token"]
        await client.post(
            f"{API}/auth/accept-invite",
            json={"token": token, "full_name": email, "password": "unaClave123"},
        )

    r = await client.get(f"{API}/users", headers=_auth(ctx["admin_a_token"]))
    assert r.status_code == 200
    members = {m["email"]: m for m in r.json()}
    assert set(members["u1@a.com"]["obra_roles"][0].keys()) >= {"obra_id", "obra_name", "role"}
    assert members["u1@a.com"]["obra_roles"][0]["role"] == "jefe_obra"
    assert members["u2@a.com"]["obra_roles"][0]["role"] == "solo_lectura"


# ────────────────────────────────────────────────────────────────
# Efecto end-to-end: after accept, el nuevo user PUEDE operar según su rol
# ────────────────────────────────────────────────────────────────


async def test_invitado_recien_aceptado_ve_solo_su_obra(client, ctx):
    """Un colaborator invitado con rol COL en obra_a1 debe ver a1 pero NO a2
    en su portfolio."""
    inv = await client.post(
        f"{API}/users/invite",
        json={
            "email": "portfolio@a.com", "role": "collaborator",
            "obra_assignments": [
                {"obra_id": ctx["obra_a1"], "role": "colaborador"},
            ],
        },
        headers=_auth(ctx["admin_a_token"]),
    )
    token = inv.json()["invite_token"]
    acc = await client.post(
        f"{API}/auth/accept-invite",
        json={"token": token, "full_name": "Portfolio", "password": "unaClave123"},
    )
    access_token = acc.json()["access_token"]

    r = await client.get(f"{API}/obras", headers=_auth(access_token))
    assert r.status_code == 200
    obra_ids = {o["id"] for o in r.json()}
    assert obra_ids == {ctx["obra_a1"]}
