"""Verifica que el backfill de Fase 5 preserva el acceso pre-rediseño.

Escenario base ("pre-Fase 2"):
  - Tenant con admin + 2 collaborators activos.
  - 3 obras en ese tenant (creadas por el admin).
  - Ninguna fila en obra_user_roles (así estaba el sistema antes de este rediseño).

Verifica que:
  1. ANTES del backfill: los collaborators reciben 404 en GET /obras/{id} y su
     portfolio (GET /obras) devuelve vacío — reflejando el estado roto post
     enforcement de Fase 2 sin migración.
  2. Correr la migración crea exactamente collabs × obras filas nuevas
     (con origin='backfill_fase5').
  3. DESPUÉS del backfill: los collaborators ven las 3 obras en el portfolio,
     acceden a los GET, pueden crear/editar tareas (rol colaborador), pero
     NO pueden borrar (colaborador no tiene delete — matriz fase-1 §2.4).
  4. Filas manuales pre-existentes (rol JEFE_OBRA otorgado por admin en
     Fase 4 antes de correr el backfill) NO se degradan: el ON CONFLICT
     DO NOTHING respeta la fila existente.
  5. El downgrade borra SOLO las filas del backfill (origin='backfill_fase5'),
     no las manuales.
"""
from __future__ import annotations

import pytest_asyncio
from sqlalchemy import select, text

from app.core.security import create_access_token
from app.models.obra import Obra
from app.models.obra_user_role import ObraUserRole, ObraUserRoleType
from app.models.tenant import Tenant
from app.models.user import User

API = "/api/v1"


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# La consulta del backfill vive en `alembic/versions/0049_backfill_obra_user_roles.py`.
# La replicamos acá porque en el harness de tests corremos SQLite en memoria y no
# ejecutamos alembic (`conftest.py` usa `Base.metadata.create_all`). El SQL es
# compatible con SQLite (INSERT OR IGNORE para el UPSERT).
_BACKFILL_SQLITE = """
INSERT OR IGNORE INTO obra_user_roles (obra_id, user_id, tenant_id, role, created_at, origin)
SELECT
    o.id, u.id, o.tenant_id, 'colaborador', CURRENT_TIMESTAMP, 'backfill_fase5'
FROM users u
JOIN obras o ON o.tenant_id = u.tenant_id
WHERE u.role = 'collaborator' AND u.tenant_id IS NOT NULL
"""
_ROLLBACK_SQLITE = "DELETE FROM obra_user_roles WHERE origin = 'backfill_fase5'"


@pytest_asyncio.fixture
async def pre_rediseño(db):
    """Escenario "pre-Fase 2": collabs sin filas en obra_user_roles + obras.

    Este es el estado que un tenant real va a tener cuando la migración corra
    por primera vez."""
    tenant = Tenant(name="Empresa Pre-Rediseño")
    otro_tenant = Tenant(name="Otra Empresa")
    db.add_all([tenant, otro_tenant])
    await db.flush()

    admin = User(
        email="admin@pre.com", hashed_password="x", full_name="Admin",
        role="admin", is_active=True, tenant_id=tenant.id,
    )
    collab1 = User(
        email="collab1@pre.com", hashed_password="x", full_name="Collab 1",
        role="collaborator", is_active=True, tenant_id=tenant.id,
    )
    collab2 = User(
        email="collab2@pre.com", hashed_password="x", full_name="Collab 2",
        role="collaborator", is_active=True, tenant_id=tenant.id,
    )
    otro_admin = User(
        email="admin@otra.com", hashed_password="x", full_name="Admin Otro",
        role="admin", is_active=True, tenant_id=otro_tenant.id,
    )
    otro_collab = User(
        email="collab@otra.com", hashed_password="x", full_name="Collab Otro",
        role="collaborator", is_active=True, tenant_id=otro_tenant.id,
    )
    db.add_all([admin, collab1, collab2, otro_admin, otro_collab])
    await db.flush()

    obras = [
        Obra(name=f"Obra {n}", manager_id=admin.id, tenant_id=tenant.id)
        for n in range(1, 4)
    ]
    otras_obras = [
        Obra(name="Obra Otro", manager_id=otro_admin.id, tenant_id=otro_tenant.id),
    ]
    db.add_all([*obras, *otras_obras])
    await db.flush()
    await db.commit()

    return {
        "db": db,
        "tenant_id": tenant.id,
        "otro_tenant_id": otro_tenant.id,
        "admin_id": admin.id,
        "collab1_id": collab1.id,
        "collab2_id": collab2.id,
        "otro_admin_id": otro_admin.id,
        "otro_collab_id": otro_collab.id,
        "obra_ids": [o.id for o in obras],
        "otras_obra_ids": [o.id for o in otras_obras],
        "admin_token": create_access_token(admin.id),
        "collab1_token": create_access_token(collab1.id),
        "collab2_token": create_access_token(collab2.id),
    }


async def test_antes_del_backfill_collab_no_ve_ninguna_obra(client, pre_rediseño):
    """Estado roto que la migración viene a resolver."""
    r = await client.get(f"{API}/obras", headers=_auth(pre_rediseño["collab1_token"]))
    assert r.status_code == 200
    assert r.json() == []

    for oid in pre_rediseño["obra_ids"]:
        r = await client.get(f"{API}/obras/{oid}", headers=_auth(pre_rediseño["collab1_token"]))
        assert r.status_code == 404


async def test_backfill_crea_filas_esperadas(client, db, pre_rediseño):
    """Conteo exacto: 2 collabs × 3 obras + 1 collab × 1 obra otro = 7 filas."""
    await db.execute(text(_BACKFILL_SQLITE))
    await db.commit()

    n_backfill = (await db.execute(text(
        "SELECT COUNT(*) FROM obra_user_roles WHERE origin='backfill_fase5'"
    ))).scalar_one()
    assert n_backfill == 7  # 2×3 (tenant A) + 1×1 (tenant B)

    # Todas con role='colaborador'.
    rows = (await db.execute(select(ObraUserRole))).scalars().all()
    assert all(r.role == ObraUserRoleType.COLABORADOR for r in rows)
    assert all(r.origin == "backfill_fase5" for r in rows)


async def test_backfill_no_toca_admins(client, db, pre_rediseño):
    """Los admin de empresa no reciben filas — son superset absoluto."""
    await db.execute(text(_BACKFILL_SQLITE))
    await db.commit()

    n_admin_rows = (await db.execute(text(
        "SELECT COUNT(*) FROM obra_user_roles our "
        "JOIN users u ON u.id = our.user_id "
        "WHERE u.role = 'admin'"
    ))).scalar_one()
    assert n_admin_rows == 0


async def test_backfill_no_cruza_tenants(client, db, pre_rediseño):
    """El JOIN por tenant_id impide que un collab reciba obras de otro tenant."""
    await db.execute(text(_BACKFILL_SQLITE))
    await db.commit()

    ctx = pre_rediseño
    # collab1 (tenant A) NO debería tener fila para la obra del otro tenant.
    n = (await db.execute(text(
        "SELECT COUNT(*) FROM obra_user_roles "
        "WHERE user_id = :u AND obra_id = :o"
    ), {"u": ctx["collab1_id"], "o": ctx["otras_obra_ids"][0]})).scalar_one()
    assert n == 0


async def test_despues_del_backfill_collab_ve_sus_obras(client, db, pre_rediseño):
    """El escenario positivo: post-backfill, collab recupera el acceso que tenía
    antes del enforcement de Fase 2."""
    await db.execute(text(_BACKFILL_SQLITE))
    await db.commit()

    r = await client.get(f"{API}/obras", headers=_auth(pre_rediseño["collab1_token"]))
    assert r.status_code == 200
    ids = {o["id"] for o in r.json()}
    assert ids == set(pre_rediseño["obra_ids"])

    # GET de una obra concreta también pasa.
    r = await client.get(
        f"{API}/obras/{pre_rediseño['obra_ids'][0]}",
        headers=_auth(pre_rediseño["collab1_token"]),
    )
    assert r.status_code == 200


async def test_collab_puede_crear_tarea_post_backfill(client, db, pre_rediseño):
    """Rol 'colaborador' incluye tarea.create (matriz fase-1 §2.4)."""
    await db.execute(text(_BACKFILL_SQLITE))
    await db.commit()

    r = await client.post(
        f"{API}/tasks",
        json={"obra_id": pre_rediseño["obra_ids"][0], "title": "Post backfill"},
        headers=_auth(pre_rediseño["collab1_token"]),
    )
    assert r.status_code == 201, r.text


async def test_collab_NO_puede_borrar_tarea_post_backfill(client, db, pre_rediseño):
    """El backfill respeta el nivel de acceso previo: NO le da más. El
    collaborator no podía borrar tareas antes (era rol de empresa 'collaborator'
    global sin acceso a delete) y tampoco puede ahora con rol colaborador
    por-obra."""
    await db.execute(text(_BACKFILL_SQLITE))
    await db.commit()

    obra_id = pre_rediseño["obra_ids"][0]
    admin_token = pre_rediseño["admin_token"]
    # Admin crea una tarea
    crea = await client.post(
        f"{API}/tasks", json={"obra_id": obra_id, "title": "para borrar"},
        headers=_auth(admin_token),
    )
    task_id = crea.json()["id"]
    # Collab intenta borrar → 403 (delete = jefe_obra)
    r = await client.delete(
        f"{API}/tasks/{task_id}", headers=_auth(pre_rediseño["collab1_token"]),
    )
    assert r.status_code == 403


async def test_backfill_es_idempotente(client, db, pre_rediseño):
    """Correrlo dos veces no duplica ni rompe el UNIQUE."""
    await db.execute(text(_BACKFILL_SQLITE))
    await db.commit()
    n1 = (await db.execute(text(
        "SELECT COUNT(*) FROM obra_user_roles WHERE origin='backfill_fase5'"
    ))).scalar_one()

    await db.execute(text(_BACKFILL_SQLITE))
    await db.commit()
    n2 = (await db.execute(text(
        "SELECT COUNT(*) FROM obra_user_roles WHERE origin='backfill_fase5'"
    ))).scalar_one()

    assert n1 == n2  # no crea filas nuevas


async def test_backfill_respeta_asignaciones_previas(client, db, pre_rediseño):
    """Si un admin ya asignó JEFE_OBRA a un collab antes de correr el backfill,
    el ON CONFLICT DO NOTHING respeta la fila existente y NO la degrada a
    'colaborador'."""
    # Pre-condición: collab1 ya tiene JEFE_OBRA en la obra 0 (por invite Fase 3
    # o assign endpoint Fase 4).
    db.add(ObraUserRole(
        obra_id=pre_rediseño["obra_ids"][0],
        user_id=pre_rediseño["collab1_id"],
        tenant_id=pre_rediseño["tenant_id"],
        role=ObraUserRoleType.JEFE_OBRA,
        origin=None,  # manual
    ))
    await db.commit()

    await db.execute(text(_BACKFILL_SQLITE))
    await db.commit()

    row = (await db.execute(select(ObraUserRole).where(
        ObraUserRole.obra_id == pre_rediseño["obra_ids"][0],
        ObraUserRole.user_id == pre_rediseño["collab1_id"],
    ))).scalar_one()
    assert row.role == ObraUserRoleType.JEFE_OBRA  # preservado
    assert row.origin is None  # sigue siendo manual, no la reetiquetó


async def test_rollback_borra_solo_backfill(client, db, pre_rediseño):
    """El downgrade elimina solo las filas del backfill, no las manuales."""
    # Manual antes del backfill
    db.add(ObraUserRole(
        obra_id=pre_rediseño["obra_ids"][0],
        user_id=pre_rediseño["collab1_id"],
        tenant_id=pre_rediseño["tenant_id"],
        role=ObraUserRoleType.JEFE_OBRA,
        origin=None,
    ))
    await db.commit()

    await db.execute(text(_BACKFILL_SQLITE))
    await db.commit()

    n_antes = (await db.execute(text("SELECT COUNT(*) FROM obra_user_roles"))).scalar_one()
    assert n_antes >= 1

    # Rollback
    await db.execute(text(_ROLLBACK_SQLITE))
    await db.commit()

    n_despues = (await db.execute(text("SELECT COUNT(*) FROM obra_user_roles"))).scalar_one()
    # Solo queda la fila manual (origin NULL).
    assert n_despues == 1
    survivor = (await db.execute(select(ObraUserRole))).scalar_one()
    assert survivor.origin is None
    assert survivor.role == ObraUserRoleType.JEFE_OBRA
