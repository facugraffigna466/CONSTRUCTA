"""Guards por-obra (Fase 2 del rediseño de roles).

Esta suite reemplaza la política binaria admin/collaborator con permisos
por-obra (ObraUserRole). Las reglas están en docs/roles-redesign/fase-1-modelo.md:

  - admin de empresa: pasa siempre en cualquier obra de su tenant.
  - jefe_obra:  crear/editar/borrar todo dentro de la obra excepto los datos
                maestros de la obra (esos siguen siendo admin).
  - colaborador: crear/editar tareas, cambiar estado, subir planos, recibir
                 órdenes; NO borra ni marca planos vigentes.
  - solo_lectura: GET a todo lo de la obra; ningún POST/PATCH/DELETE.

El fixture `ctx` NO le asigna rol al collab por defecto — cada test decide
qué rol necesita (o ninguno, para probar el 404 de aislamiento).
"""
from __future__ import annotations

import io

import pytest_asyncio

from app.core.security import create_access_token
from app.models.obra import Obra
from app.models.obra_user_role import ObraUserRole, ObraUserRoleType
from app.models.responsible import Responsible
from app.models.task import Task
from app.models.tenant import Tenant
from app.models.user import User

API = "/api/v1"


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _assign(db, obra_id: int, user_id: int, tenant_id: int, role: ObraUserRoleType) -> None:
    db.add(ObraUserRole(obra_id=obra_id, user_id=user_id, tenant_id=tenant_id, role=role))
    await db.commit()


@pytest_asyncio.fixture
async def ctx(db):
    """Tenant + admin + colaborador (sin rol en la obra) + una obra con una tarea.

    El colaborador arranca SIN fila en ObraUserRole. Tests que necesitan
    verificar comportamientos con rol deben llamar `_assign(...)` antes del
    request."""
    tenant = Tenant(name="Empresa Guards")
    db.add(tenant)
    await db.flush()

    admin = User(
        email="admin@guards.com", hashed_password="x", full_name="Admin",
        role="admin", is_active=True, tenant_id=tenant.id,
    )
    collab = User(
        email="collab@guards.com", hashed_password="x", full_name="Collab",
        role="collaborator", is_active=True, tenant_id=tenant.id,
    )
    db.add_all([admin, collab])
    await db.flush()

    obra = Obra(name="Obra Guards", manager_id=admin.id, tenant_id=tenant.id)
    db.add(obra)
    await db.flush()

    task = Task(obra_id=obra.id, tenant_id=tenant.id, title="Tarea Guards")
    responsible = Responsible(
        full_name="Juan Guards", whatsapp_number="+540000000099",
        role="Jefe", tenant_id=tenant.id, is_active=True,
    )
    db.add_all([task, responsible])
    await db.flush()
    await db.commit()

    return {
        "db": db,
        "tenant_id": tenant.id,
        "obra_id": obra.id,
        "task_id": task.id,
        "responsible_id": responsible.id,
        "admin_id": admin.id,
        "collab_id": collab.id,
        "admin_token": create_access_token(admin.id),
        "collab_token": create_access_token(collab.id),
    }


# ────────────────────────────────────────────────────────────────
# ORACLE de la política Fase 2 — cross-cutting
# ────────────────────────────────────────────────────────────────


async def test_collaborator_sin_asignacion_recibe_404_en_get_obra(client, ctx):
    """Aislamiento: colab sin fila NO ve la obra (no distinguimos 'no existe'
    de 'no tenés acceso')."""
    r = await client.get(f"{API}/obras/{ctx['obra_id']}", headers=_auth(ctx["collab_token"]))
    assert r.status_code == 404


async def test_admin_ve_la_obra(client, ctx):
    r = await client.get(f"{API}/obras/{ctx['obra_id']}", headers=_auth(ctx["admin_token"]))
    assert r.status_code == 200


async def test_solo_lectura_puede_leer_pero_no_mutar(client, ctx):
    await _assign(ctx["db"], ctx["obra_id"], ctx["collab_id"], ctx["tenant_id"], ObraUserRoleType.SOLO_LECTURA)

    # GET: pasa
    r_get = await client.get(f"{API}/obras/{ctx['obra_id']}", headers=_auth(ctx["collab_token"]))
    assert r_get.status_code == 200

    # POST tarea (COL): 403 rol insuficiente
    r_create = await client.post(
        f"{API}/tasks",
        json={"obra_id": ctx["obra_id"], "title": "no permitida"},
        headers=_auth(ctx["collab_token"]),
    )
    assert r_create.status_code == 403

    # PATCH tarea (COL): 403
    r_patch = await client.patch(
        f"{API}/tasks/{ctx['task_id']}",
        json={"title": "no permitida"},
        headers=_auth(ctx["collab_token"]),
    )
    assert r_patch.status_code == 403

    # DELETE tarea (JO): 403
    r_del = await client.delete(
        f"{API}/tasks/{ctx['task_id']}", headers=_auth(ctx["collab_token"]),
    )
    assert r_del.status_code == 403


# ────────────────────────────────────────────────────────────────
# Obras — mutaciones siguen siendo admin de empresa (ni JO alcanza)
# ────────────────────────────────────────────────────────────────


async def test_jefe_obra_no_puede_crear_obra(client, ctx):
    """Crear obra es ADM (no confundir con jefe_obra sobre UNA obra)."""
    await _assign(ctx["db"], ctx["obra_id"], ctx["collab_id"], ctx["tenant_id"], ObraUserRoleType.JEFE_OBRA)
    r = await client.post(
        f"{API}/obras", json={"name": "Nueva", "location": "Cba"},
        headers=_auth(ctx["collab_token"]),
    )
    assert r.status_code == 403


async def test_jefe_obra_no_puede_editar_obra(client, ctx):
    """Datos maestros de la obra: siguen siendo ADM."""
    await _assign(ctx["db"], ctx["obra_id"], ctx["collab_id"], ctx["tenant_id"], ObraUserRoleType.JEFE_OBRA)
    r = await client.patch(
        f"{API}/obras/{ctx['obra_id']}", json={"name": "Cambiada"},
        headers=_auth(ctx["collab_token"]),
    )
    assert r.status_code == 403


async def test_jefe_obra_no_puede_borrar_obra(client, ctx):
    await _assign(ctx["db"], ctx["obra_id"], ctx["collab_id"], ctx["tenant_id"], ObraUserRoleType.JEFE_OBRA)
    r = await client.delete(
        f"{API}/obras/{ctx['obra_id']}", headers=_auth(ctx["collab_token"]),
    )
    assert r.status_code == 403


async def test_admin_si_puede_crear_obra(client, ctx):
    """Sanity: el guard no rompe el flujo del admin de empresa."""
    r = await client.post(
        f"{API}/obras", json={"name": "Obra Admin", "location": "Cba"},
        headers=_auth(ctx["admin_token"]),
    )
    assert r.status_code == 201


# ────────────────────────────────────────────────────────────────
# Tareas
# ────────────────────────────────────────────────────────────────


async def test_colaborador_asignado_puede_crear_tarea(client, ctx):
    await _assign(ctx["db"], ctx["obra_id"], ctx["collab_id"], ctx["tenant_id"], ObraUserRoleType.COLABORADOR)
    r = await client.post(
        f"{API}/tasks",
        json={"obra_id": ctx["obra_id"], "title": "Legítima"},
        headers=_auth(ctx["collab_token"]),
    )
    assert r.status_code == 201, r.text


async def test_colaborador_asignado_puede_editar_tarea(client, ctx):
    await _assign(ctx["db"], ctx["obra_id"], ctx["collab_id"], ctx["tenant_id"], ObraUserRoleType.COLABORADOR)
    r = await client.patch(
        f"{API}/tasks/{ctx['task_id']}", json={"title": "Renombrada"},
        headers=_auth(ctx["collab_token"]),
    )
    assert r.status_code == 200, r.text


async def test_colaborador_NO_puede_borrar_tarea(client, ctx):
    """Delete task = JO (matriz §2.4). Colab con rol COL → 403."""
    await _assign(ctx["db"], ctx["obra_id"], ctx["collab_id"], ctx["tenant_id"], ObraUserRoleType.COLABORADOR)
    r = await client.delete(
        f"{API}/tasks/{ctx['task_id']}", headers=_auth(ctx["collab_token"]),
    )
    assert r.status_code == 403


async def test_colaborador_NO_puede_bulk_tasks(client, ctx):
    """Bulk create = JO (matriz §2.4)."""
    await _assign(ctx["db"], ctx["obra_id"], ctx["collab_id"], ctx["tenant_id"], ObraUserRoleType.COLABORADOR)
    r = await client.post(
        f"{API}/tasks/obra/{ctx['obra_id']}/bulk",
        json={"rows": [{"title": "a"}, {"title": "b"}]},
        headers=_auth(ctx["collab_token"]),
    )
    assert r.status_code == 403


async def test_jefe_obra_puede_borrar_tarea(client, ctx):
    await _assign(ctx["db"], ctx["obra_id"], ctx["collab_id"], ctx["tenant_id"], ObraUserRoleType.JEFE_OBRA)
    r = await client.delete(
        f"{API}/tasks/{ctx['task_id']}", headers=_auth(ctx["collab_token"]),
    )
    assert r.status_code == 204


async def test_colaborador_puede_cambiar_estado_de_tarea(client, ctx):
    """POST /tasks/{id}/status = COL (matriz §2 nota). La regla (c) — user es
    responsible de la tarea — está diferida a Fase 4."""
    await _assign(ctx["db"], ctx["obra_id"], ctx["collab_id"], ctx["tenant_id"], ObraUserRoleType.COLABORADOR)
    r = await client.post(
        f"{API}/tasks/{ctx['task_id']}/status",
        json={"status": "en_progreso"},
        headers=_auth(ctx["collab_token"]),
    )
    # Puede ser 200 (transición ok) o 400 (transición no válida), nunca 403/404.
    assert r.status_code not in (403, 404), r.text


async def test_solo_lectura_NO_puede_cambiar_estado_de_tarea(client, ctx):
    await _assign(ctx["db"], ctx["obra_id"], ctx["collab_id"], ctx["tenant_id"], ObraUserRoleType.SOLO_LECTURA)
    r = await client.post(
        f"{API}/tasks/{ctx['task_id']}/status",
        json={"status": "en_progreso"},
        headers=_auth(ctx["collab_token"]),
    )
    assert r.status_code == 403


async def test_colab_sin_fila_recibe_404_en_status(client, ctx):
    """Aislamiento: sin fila en la obra, la tarea se ve como 'no encontrada'."""
    r = await client.post(
        f"{API}/tasks/{ctx['task_id']}/status",
        json={"status": "en_progreso"},
        headers=_auth(ctx["collab_token"]),
    )
    assert r.status_code == 404


# ────────────────────────────────────────────────────────────────
# Planos
# ────────────────────────────────────────────────────────────────


async def test_colaborador_asignado_puede_subir_plano(client, ctx):
    await _assign(ctx["db"], ctx["obra_id"], ctx["collab_id"], ctx["tenant_id"], ObraUserRoleType.COLABORADOR)
    files = {"file": ("plano.pdf", io.BytesIO(b"%PDF-1.4\ntest\n"), "application/pdf")}
    r = await client.post(
        f"{API}/obras/{ctx['obra_id']}/planos",
        files=files,
        data={"discipline": "arquitectura", "name": "Plano collab"},
        headers=_auth(ctx["collab_token"]),
    )
    assert r.status_code == 201, r.text


async def test_colaborador_NO_puede_borrar_plano(client, ctx):
    """Delete plano = JO. Colab con rol COL → 403."""
    # Subimos como admin
    files = {"file": ("plano.pdf", io.BytesIO(b"%PDF-1.4\ntest\n"), "application/pdf")}
    up = await client.post(
        f"{API}/obras/{ctx['obra_id']}/planos",
        files=files, data={"discipline": "arquitectura", "name": "Plano"},
        headers=_auth(ctx["admin_token"]),
    )
    assert up.status_code == 201, up.text
    plano_id = up.json()["id"]

    await _assign(ctx["db"], ctx["obra_id"], ctx["collab_id"], ctx["tenant_id"], ObraUserRoleType.COLABORADOR)
    r = await client.delete(f"{API}/planos/{plano_id}", headers=_auth(ctx["collab_token"]))
    assert r.status_code == 403


async def test_jefe_obra_puede_borrar_plano(client, ctx):
    files = {"file": ("plano.pdf", io.BytesIO(b"%PDF-1.4\ntest\n"), "application/pdf")}
    up = await client.post(
        f"{API}/obras/{ctx['obra_id']}/planos",
        files=files, data={"discipline": "arquitectura", "name": "Plano"},
        headers=_auth(ctx["admin_token"]),
    )
    plano_id = up.json()["id"]
    await _assign(ctx["db"], ctx["obra_id"], ctx["collab_id"], ctx["tenant_id"], ObraUserRoleType.JEFE_OBRA)
    r = await client.delete(f"{API}/planos/{plano_id}", headers=_auth(ctx["collab_token"]))
    assert r.status_code == 204


# ────────────────────────────────────────────────────────────────
# Aislamiento entre obras — jefe_obra en A no puede tocar B
# ────────────────────────────────────────────────────────────────


@pytest_asyncio.fixture
async def ctx_two_obras(db):
    """Un tenant con dos obras (A y B). Colab con rol jefe_obra solo en A."""
    tenant = Tenant(name="Empresa DosObras")
    db.add(tenant)
    await db.flush()

    admin = User(email="a@do.com", hashed_password="x", full_name="A",
                 role="admin", is_active=True, tenant_id=tenant.id)
    collab = User(email="c@do.com", hashed_password="x", full_name="C",
                  role="collaborator", is_active=True, tenant_id=tenant.id)
    db.add_all([admin, collab])
    await db.flush()

    obra_a = Obra(name="Obra A", manager_id=admin.id, tenant_id=tenant.id)
    obra_b = Obra(name="Obra B", manager_id=admin.id, tenant_id=tenant.id)
    db.add_all([obra_a, obra_b])
    await db.flush()

    task_b = Task(obra_id=obra_b.id, tenant_id=tenant.id, title="Tarea B")
    db.add(task_b)
    await db.flush()

    # collab es jefe_obra SOLO en A
    db.add(ObraUserRole(
        obra_id=obra_a.id, user_id=collab.id, tenant_id=tenant.id,
        role=ObraUserRoleType.JEFE_OBRA,
    ))
    await db.commit()

    return {
        "db": db,
        "obra_a": obra_a.id,
        "obra_b": obra_b.id,
        "task_b": task_b.id,
        "collab_token": create_access_token(collab.id),
        "admin_token": create_access_token(admin.id),
    }


async def test_jefe_obra_en_su_obra_opera_normalmente(client, ctx_two_obras):
    r = await client.get(
        f"{API}/obras/{ctx_two_obras['obra_a']}",
        headers=_auth(ctx_two_obras["collab_token"]),
    )
    assert r.status_code == 200

    r_create = await client.post(
        f"{API}/tasks",
        json={"obra_id": ctx_two_obras["obra_a"], "title": "Nueva en A"},
        headers=_auth(ctx_two_obras["collab_token"]),
    )
    assert r_create.status_code == 201, r_create.text


async def test_jefe_obra_recibe_404_en_obra_donde_no_esta_asignado(client, ctx_two_obras):
    r = await client.get(
        f"{API}/obras/{ctx_two_obras['obra_b']}",
        headers=_auth(ctx_two_obras["collab_token"]),
    )
    assert r.status_code == 404


async def test_jefe_obra_no_puede_mutar_tareas_de_otra_obra(client, ctx_two_obras):
    """Task de obra B es invisible para jefe_obra de A: 404 al intentar tocarla."""
    r = await client.patch(
        f"{API}/tasks/{ctx_two_obras['task_b']}",
        json={"title": "Intento invasivo"},
        headers=_auth(ctx_two_obras["collab_token"]),
    )
    assert r.status_code == 404


async def test_list_obras_filtra_a_visibles(client, ctx_two_obras):
    """El portfolio del colab jefe_obra en A solo debe mostrar A."""
    r = await client.get(f"{API}/obras", headers=_auth(ctx_two_obras["collab_token"]))
    assert r.status_code == 200
    ids = {o["id"] for o in r.json()}
    assert ids == {ctx_two_obras["obra_a"]}


async def test_list_obras_admin_ve_todas(client, ctx_two_obras):
    r = await client.get(f"{API}/obras", headers=_auth(ctx_two_obras["admin_token"]))
    assert r.status_code == 200
    ids = {o["id"] for o in r.json()}
    assert ids == {ctx_two_obras["obra_a"], ctx_two_obras["obra_b"]}
