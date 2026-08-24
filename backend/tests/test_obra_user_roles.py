"""Endpoints de gestión de asignaciones User × Obra × Rol (Fase 4).

Cubre:
  - ADM (admin de empresa) puede todo: asignar/cambiar/quitar cualquier rol.
  - JO (jefe_obra en la obra) puede asignar COL/SL, NO puede asignar JO.
  - SL / sin fila → 404 en GET, 403 en cualquier mutación.
  - No se puede asignar rol al propio admin de empresa (400).
  - Aislamiento cross-tenant → 404.
  - Idempotencia del DELETE.
  - upsert: POST sobre asignación existente actualiza el rol.
"""
from __future__ import annotations

import pytest_asyncio

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
    tenant = Tenant(name="RolesEmpresa")
    db.add(tenant)
    await db.flush()

    admin = User(
        email="admin@r.com", hashed_password="x", full_name="Admin",
        role="admin", is_active=True, tenant_id=tenant.id,
    )
    jo = User(
        email="jo@r.com", hashed_password="x", full_name="Jefe",
        role="collaborator", is_active=True, tenant_id=tenant.id,
    )
    col = User(
        email="col@r.com", hashed_password="x", full_name="Colab",
        role="collaborator", is_active=True, tenant_id=tenant.id,
    )
    outsider = User(
        email="out@r.com", hashed_password="x", full_name="Out",
        role="collaborator", is_active=True, tenant_id=tenant.id,
    )
    db.add_all([admin, jo, col, outsider])
    await db.flush()

    obra = Obra(name="Obra R", manager_id=admin.id, tenant_id=tenant.id)
    obra_otra = Obra(name="Otra R", manager_id=admin.id, tenant_id=tenant.id)
    db.add_all([obra, obra_otra])
    await db.flush()

    # jo es jefe_obra en la obra principal (no en obra_otra)
    db.add(ObraUserRole(
        obra_id=obra.id, user_id=jo.id, tenant_id=tenant.id,
        role=ObraUserRoleType.JEFE_OBRA,
    ))
    await db.commit()

    return {
        "db": db,
        "tenant_id": tenant.id,
        "obra_id": obra.id,
        "obra_otra_id": obra_otra.id,
        "admin_id": admin.id,
        "jo_id": jo.id,
        "col_id": col.id,
        "out_id": outsider.id,
        "admin_token": create_access_token(admin.id),
        "jo_token": create_access_token(jo.id),
        "col_token": create_access_token(col.id),
    }


# ────────────────────────────────────────────────────────────────
# POST — asignar rol
# ────────────────────────────────────────────────────────────────


async def test_admin_puede_asignar_jefe_obra(client, ctx):
    r = await client.post(
        f"{API}/obras/{ctx['obra_id']}/user-roles",
        json={"user_id": ctx["col_id"], "role": "jefe_obra"},
        headers=_auth(ctx["admin_token"]),
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["user_id"] == ctx["col_id"]
    assert body["role"] == "jefe_obra"


async def test_jefe_obra_puede_asignar_colaborador(client, ctx):
    r = await client.post(
        f"{API}/obras/{ctx['obra_id']}/user-roles",
        json={"user_id": ctx["col_id"], "role": "colaborador"},
        headers=_auth(ctx["jo_token"]),
    )
    assert r.status_code == 201, r.text


async def test_jefe_obra_puede_asignar_solo_lectura(client, ctx):
    r = await client.post(
        f"{API}/obras/{ctx['obra_id']}/user-roles",
        json={"user_id": ctx["col_id"], "role": "solo_lectura"},
        headers=_auth(ctx["jo_token"]),
    )
    assert r.status_code == 201


async def test_jefe_obra_NO_puede_asignar_jefe_obra(client, ctx):
    """Escalación reservada al admin de empresa."""
    r = await client.post(
        f"{API}/obras/{ctx['obra_id']}/user-roles",
        json={"user_id": ctx["col_id"], "role": "jefe_obra"},
        headers=_auth(ctx["jo_token"]),
    )
    assert r.status_code == 403


async def test_colaborador_sin_rol_no_puede_asignar(client, ctx):
    """El collab del ctx no tiene fila en la obra → 404."""
    r = await client.post(
        f"{API}/obras/{ctx['obra_id']}/user-roles",
        json={"user_id": ctx["out_id"], "role": "colaborador"},
        headers=_auth(ctx["col_token"]),
    )
    assert r.status_code == 404


async def test_no_se_puede_asignar_al_admin_de_empresa(client, ctx):
    r = await client.post(
        f"{API}/obras/{ctx['obra_id']}/user-roles",
        json={"user_id": ctx["admin_id"], "role": "colaborador"},
        headers=_auth(ctx["admin_token"]),
    )
    assert r.status_code == 400


async def test_post_es_upsert(client, ctx):
    """Un segundo POST sobre el mismo (obra, user) actualiza el rol."""
    r1 = await client.post(
        f"{API}/obras/{ctx['obra_id']}/user-roles",
        json={"user_id": ctx["col_id"], "role": "solo_lectura"},
        headers=_auth(ctx["jo_token"]),
    )
    assert r1.status_code == 201
    r2 = await client.post(
        f"{API}/obras/{ctx['obra_id']}/user-roles",
        json={"user_id": ctx["col_id"], "role": "colaborador"},
        headers=_auth(ctx["jo_token"]),
    )
    assert r2.status_code == 201
    assert r2.json()["role"] == "colaborador"


# ────────────────────────────────────────────────────────────────
# PATCH — cambiar rol de asignación existente
# ────────────────────────────────────────────────────────────────


async def test_patch_actualiza_rol(client, ctx, db):
    # Precondición: col asignado como solo_lectura
    db.add(ObraUserRole(
        obra_id=ctx["obra_id"], user_id=ctx["col_id"], tenant_id=ctx["tenant_id"],
        role=ObraUserRoleType.SOLO_LECTURA,
    ))
    await db.commit()

    r = await client.patch(
        f"{API}/obras/{ctx['obra_id']}/user-roles/{ctx['col_id']}",
        json={"role": "colaborador"},
        headers=_auth(ctx["jo_token"]),
    )
    assert r.status_code == 200, r.text
    assert r.json()["role"] == "colaborador"


async def test_patch_a_jefe_obra_requiere_admin(client, ctx, db):
    db.add(ObraUserRole(
        obra_id=ctx["obra_id"], user_id=ctx["col_id"], tenant_id=ctx["tenant_id"],
        role=ObraUserRoleType.COLABORADOR,
    ))
    await db.commit()

    r = await client.patch(
        f"{API}/obras/{ctx['obra_id']}/user-roles/{ctx['col_id']}",
        json={"role": "jefe_obra"},
        headers=_auth(ctx["jo_token"]),
    )
    assert r.status_code == 403


async def test_patch_sin_fila_previa_da_404(client, ctx):
    r = await client.patch(
        f"{API}/obras/{ctx['obra_id']}/user-roles/{ctx['col_id']}",
        json={"role": "colaborador"},
        headers=_auth(ctx["jo_token"]),
    )
    assert r.status_code == 404


# ────────────────────────────────────────────────────────────────
# DELETE — quitar asignación
# ────────────────────────────────────────────────────────────────


async def test_delete_quita_asignacion(client, ctx, db):
    db.add(ObraUserRole(
        obra_id=ctx["obra_id"], user_id=ctx["col_id"], tenant_id=ctx["tenant_id"],
        role=ObraUserRoleType.COLABORADOR,
    ))
    await db.commit()

    r = await client.delete(
        f"{API}/obras/{ctx['obra_id']}/user-roles/{ctx['col_id']}",
        headers=_auth(ctx["jo_token"]),
    )
    assert r.status_code == 204


async def test_delete_idempotente(client, ctx):
    """Delete sin fila previa → 204 igual (idempotente para el frontend)."""
    r = await client.delete(
        f"{API}/obras/{ctx['obra_id']}/user-roles/{ctx['col_id']}",
        headers=_auth(ctx["jo_token"]),
    )
    assert r.status_code == 204


async def test_delete_colab_sin_rol_recibe_404(client, ctx):
    r = await client.delete(
        f"{API}/obras/{ctx['obra_id']}/user-roles/{ctx['out_id']}",
        headers=_auth(ctx["col_token"]),
    )
    assert r.status_code == 404


# ────────────────────────────────────────────────────────────────
# GET — listar asignaciones (visible para cualquier miembro)
# ────────────────────────────────────────────────────────────────


async def test_get_lista_asignaciones_como_admin(client, ctx, db):
    db.add(ObraUserRole(
        obra_id=ctx["obra_id"], user_id=ctx["col_id"], tenant_id=ctx["tenant_id"],
        role=ObraUserRoleType.SOLO_LECTURA,
    ))
    await db.commit()

    r = await client.get(
        f"{API}/obras/{ctx['obra_id']}/user-roles",
        headers=_auth(ctx["admin_token"]),
    )
    assert r.status_code == 200
    body = r.json()
    ids = {row["user_id"] for row in body}
    # jo (fixture) + col (agregado acá)
    assert ids == {ctx["jo_id"], ctx["col_id"]}


async def test_get_como_solo_lectura_pasa(client, ctx, db):
    """Un solo_lectura puede ver quién más está en el equipo."""
    db.add(ObraUserRole(
        obra_id=ctx["obra_id"], user_id=ctx["col_id"], tenant_id=ctx["tenant_id"],
        role=ObraUserRoleType.SOLO_LECTURA,
    ))
    await db.commit()

    r = await client.get(
        f"{API}/obras/{ctx['obra_id']}/user-roles",
        headers=_auth(ctx["col_token"]),
    )
    assert r.status_code == 200


async def test_get_sin_fila_recibe_404(client, ctx):
    """Colab sin fila → aislamiento (404, no vemos ni la lista)."""
    r = await client.get(
        f"{API}/obras/{ctx['obra_id']}/user-roles",
        headers=_auth(ctx["col_token"]),
    )
    assert r.status_code == 404
