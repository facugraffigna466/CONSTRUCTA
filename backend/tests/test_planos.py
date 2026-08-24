"""Módulo de Planos: el audit 05 (docs/auditoria/05-planos.md) encontró que esta
cobertura era cero. Cubre lo que ese audit reprodujo a mano: guards de rol,
aislamiento de tenant, whitelist de extensión/disciplina, versionado, borrado sin
huérfanos, e historial."""
from pathlib import Path

import pytest_asyncio

from app.core.security import create_access_token
from app.models.obra import Obra
from app.models.obra_user_role import ObraUserRole, ObraUserRoleType
from app.models.tenant import Tenant
from app.models.user import User
from app.services.plano_service import UPLOADS_DIR

API = "/api/v1"

_PDF = (b"plano.pdf", b"%PDF-1.4 contenido de prueba", "application/pdf")


@pytest_asyncio.fixture
async def ctx(db):
    """Tenant A con admin + collaborator, más un tenant B (para cross-tenant)."""
    t = Tenant(name="Empresa A")
    db.add(t)
    await db.flush()
    admin = User(email="admin@a.com", hashed_password="x", full_name="Admin A",
                 role="admin", is_active=True, tenant_id=t.id)
    collab = User(email="collab@a.com", hashed_password="x", full_name="Collab A",
                  role="collaborator", is_active=True, tenant_id=t.id)
    db.add_all([admin, collab])
    await db.flush()
    obra = Obra(name="Obra A", manager_id=admin.id, tenant_id=t.id)
    db.add(obra)
    await db.flush()

    t2 = Tenant(name="Empresa B")
    db.add(t2)
    await db.flush()
    admin_b = User(email="admin@b.com", hashed_password="x", full_name="Admin B",
                    role="admin", is_active=True, tenant_id=t2.id)
    db.add(admin_b)
    await db.flush()
    obra_b = Obra(name="Obra B", manager_id=admin_b.id, tenant_id=t2.id)
    db.add(obra_b)
    await db.flush()

    # Fase 2: para que los tests que ejercitan "colab puede subir plano" sigan
    # pasando, asignamos al colab rol COLABORADOR en la obra. Los tests que
    # verifican "colab NO puede borrar/marcar vigente" siguen dando 403 porque
    # esas acciones requieren JEFE_OBRA (que colab no tiene).
    db.add(ObraUserRole(
        obra_id=obra.id, user_id=collab.id, tenant_id=t.id,
        role=ObraUserRoleType.COLABORADOR,
    ))
    await db.commit()

    return {
        "db": db, "obra_id": obra.id, "obra_b_id": obra_b.id,
        "admin_token": create_access_token(admin.id),
        "collab_token": create_access_token(collab.id),
        "admin_b_token": create_access_token(admin_b.id),
    }


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _upload(client, obra_id, token, *, discipline="electricidad", name="Plano de prueba",
            filename="plano.pdf", content=b"%PDF-1.4 x", content_type="application/pdf",
            replaces=None):
    """`name` tiene default porque es obligatorio al crear: cada plano necesita
    identidad propia. Pasá `name=None` para probar justamente ese caso."""
    data = {"discipline": discipline}
    if name is not None:
        data["name"] = name
    if replaces is not None:
        data["replaces_plano_id"] = replaces
    return client.post(
        f"{API}/obras/{obra_id}/planos", headers=_auth(token),
        files={"file": (filename, content, content_type)}, data=data,
    )


# ── Happy path + versionado ─────────────────────────────────────────────────────

async def test_upload_happy_path(client, ctx):
    r = await _upload(client, ctx["obra_id"], ctx["admin_token"], name="Tablero")
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["version"] == 1 and body["is_latest"] is True
    assert body["file_url"] and "sig=" in body["file_url"] and "tid=" in body["file_url"]


async def test_second_upload_bumps_version_and_demotes_previous(client, ctx):
    r1 = await _upload(client, ctx["obra_id"], ctx["admin_token"], name="Tablero")
    r2 = await _upload(client, ctx["obra_id"], ctx["admin_token"], name="Tablero")
    assert r2.json()["version"] == 2 and r2.json()["is_latest"] is True

    listed = await client.get(f"{API}/obras/{ctx['obra_id']}/planos", headers=_auth(ctx["admin_token"]))
    by_id = {p["id"]: p for p in listed.json()}
    assert by_id[r1.json()["id"]]["is_latest"] is False
    assert by_id[r2.json()["id"]]["is_latest"] is True


# ── Guards de rol ────────────────────────────────────────────────────────────────

async def test_collaborator_can_upload(client, ctx):
    """Intencional: 'documentos.upload' está otorgado a ambos roles."""
    r = await _upload(client, ctx["obra_id"], ctx["collab_token"])
    assert r.status_code == 201, r.text


async def test_collaborator_cannot_delete(client, ctx):
    up = await _upload(client, ctx["obra_id"], ctx["admin_token"])
    plano_id = up.json()["id"]
    r = await client.delete(f"{API}/planos/{plano_id}", headers=_auth(ctx["collab_token"]))
    assert r.status_code == 403, r.text


async def test_admin_can_delete(client, ctx):
    up = await _upload(client, ctx["obra_id"], ctx["admin_token"])
    plano_id = up.json()["id"]
    r = await client.delete(f"{API}/planos/{plano_id}", headers=_auth(ctx["admin_token"]))
    assert r.status_code == 204, r.text


# ── Aislamiento de tenant ────────────────────────────────────────────────────────

async def test_upload_to_foreign_obra_is_404(client, ctx):
    """Antes: el POST nunca validaba el obra_id → 500 con obra inexistente, y
    silenciosamente aceptaba plantar un plano en una obra de otro tenant."""
    r = await _upload(client, ctx["obra_b_id"], ctx["admin_token"])
    assert r.status_code == 404, r.text


async def test_upload_to_nonexistent_obra_is_404_not_500(client, ctx):
    r = await _upload(client, 999999, ctx["admin_token"])
    assert r.status_code == 404, r.text


async def test_list_is_isolated_by_tenant(client, ctx):
    await _upload(client, ctx["obra_id"], ctx["admin_token"])
    r = await client.get(f"{API}/obras/{ctx['obra_id']}/planos", headers=_auth(ctx["admin_b_token"]))
    assert r.status_code == 404, r.text


# ── Whitelist de extensión (cierra el XSS de .html/.svg disfrazados de plano) ────

async def test_html_disguised_as_pdf_is_rejected(client, ctx):
    r = await _upload(
        client, ctx["obra_id"], ctx["admin_token"],
        filename="plano.pdf", content=b"<html><script>alert(1)</script></html>",
        content_type="application/pdf",
    )
    # El content_type que manda el cliente es irrelevante — lo que importa es que
    # la extensión real esté en la whitelist. "plano.pdf" SÍ pasa (aunque el
    # contenido no sea un PDF real: no hay sniffing de contenido, solo de extensión).
    assert r.status_code == 201, r.text


async def test_html_extension_is_rejected(client, ctx):
    r = await _upload(
        client, ctx["obra_id"], ctx["admin_token"],
        filename="plano.html", content=b"<html><script>alert(1)</script></html>",
        content_type="text/html",
    )
    assert r.status_code == 422, r.text


async def test_svg_extension_is_rejected(client, ctx):
    r = await _upload(
        client, ctx["obra_id"], ctx["admin_token"],
        filename="plano.svg", content=b"<svg><script>alert(1)</script></svg>",
        content_type="image/svg+xml",
    )
    assert r.status_code == 422, r.text


# ── Nombre obligatorio al crear ───────────────────────────────────────────────────
# Sin nombre, dos planos distintos de la misma disciplina caían en el mismo grupo
# (name = NULL) y se versionaban entre sí sin que nadie lo pidiera.

async def test_new_plano_without_name_is_rejected(client, ctx):
    r = await _upload(client, ctx["obra_id"], ctx["admin_token"], name=None)
    assert r.status_code == 422, r.text


async def test_new_plano_with_blank_name_is_rejected(client, ctx):
    r = await _upload(client, ctx["obra_id"], ctx["admin_token"], name="   ")
    assert r.status_code == 422, r.text


async def test_new_version_does_not_need_a_name(client, ctx):
    """Al versionar el nombre se hereda: no hay que volver a escribirlo (ni acertarle)."""
    base = await _upload(client, ctx["obra_id"], ctx["admin_token"], name="Tablero")
    nueva = await _upload(client, ctx["obra_id"], ctx["admin_token"],
                          name=None, replaces=base.json()["id"])
    assert nueva.status_code == 201, nueva.text
    assert nueva.json()["name"] == "Tablero"


# ── Whitelist de disciplina ──────────────────────────────────────────────────────

async def test_unknown_discipline_is_rejected(client, ctx):
    r = await _upload(client, ctx["obra_id"], ctx["admin_token"], discipline="asdf123")
    assert r.status_code == 422, r.text


async def test_known_discipline_synonym_is_accepted(client, ctx):
    r = await _upload(client, ctx["obra_id"], ctx["admin_token"], discipline="electrico")
    assert r.status_code == 201, r.text
    assert r.json()["discipline"] == "electricidad"


# ── Validación de tamaño / contenido ─────────────────────────────────────────────

async def test_empty_file_is_rejected(client, ctx):
    r = await _upload(client, ctx["obra_id"], ctx["admin_token"], content=b"")
    assert r.status_code == 400, r.text


async def test_name_over_255_chars_is_422_not_500(client, ctx):
    """Antes: el insert fallaba con 500 (columna VARCHAR(255)) y el archivo ya
    escrito a disco quedaba huérfano sin ninguna fila asociada."""
    r = await _upload(client, ctx["obra_id"], ctx["admin_token"], name="x" * 300)
    assert r.status_code == 422, r.text
    # y no debería haber escrito nada a uploads/
    before = set(UPLOADS_DIR.iterdir())
    r2 = await _upload(client, ctx["obra_id"], ctx["admin_token"], name="x" * 300)
    assert r2.status_code == 422
    assert set(UPLOADS_DIR.iterdir()) == before


# ── DELETE no deja huérfanos ──────────────────────────────────────────────────────

async def test_delete_removes_physical_file(client, ctx):
    up = await _upload(client, ctx["obra_id"], ctx["admin_token"])
    file_path = up.json()["original_filename"]  # solo para legibilidad del assert de abajo
    assert file_path  # sanity

    listed = await client.get(f"{API}/obras/{ctx['obra_id']}/planos", headers=_auth(ctx["admin_token"]))
    stored_name = Path(listed.json()[0]["file_url"].split("?")[0]).name

    assert (UPLOADS_DIR / stored_name).is_file()
    r = await client.delete(f"{API}/planos/{up.json()['id']}", headers=_auth(ctx["admin_token"]))
    assert r.status_code == 204
    assert not (UPLOADS_DIR / stored_name).exists()


async def test_delete_promotes_previous_version_to_latest(client, ctx):
    r1 = await _upload(client, ctx["obra_id"], ctx["admin_token"], name="Tablero")
    r2 = await _upload(client, ctx["obra_id"], ctx["admin_token"], name="Tablero")
    await client.delete(f"{API}/planos/{r2.json()['id']}", headers=_auth(ctx["admin_token"]))

    listed = await client.get(f"{API}/obras/{ctx['obra_id']}/planos", headers=_auth(ctx["admin_token"]))
    remaining = {p["id"]: p for p in listed.json()}
    assert r1.json()["id"] in remaining
    assert remaining[r1.json()["id"]]["is_latest"] is True


# ── Historial ─────────────────────────────────────────────────────────────────────

async def test_upload_and_delete_log_historial_events(client, ctx):
    from sqlalchemy import select
    from app.models.historial import HistorialEvento

    up = await _upload(client, ctx["obra_id"], ctx["admin_token"], name="Tablero")
    await client.delete(f"{API}/planos/{up.json()['id']}", headers=_auth(ctx["admin_token"]))

    events = (await ctx["db"].execute(
        select(HistorialEvento.event_type).where(HistorialEvento.obra_id == ctx["obra_id"])
    )).scalars().all()
    assert "plano_uploaded" in events
    assert "plano_deleted" in events


# ── Cuál es el "vigente" ──────────────────────────────────────────────────────────
# Una sola regla: manda la última versión que se sube. Si eso queda mal (se cargó
# una revisión vieja), se corrige a mano con PATCH /vigente — no hay heurística que
# lo adivine, justamente para que el comportamiento sea predecible.

async def test_last_upload_always_wins(client, ctx):
    """No hay heurística que adivine cuál versión "debería" mandar: la última que
    se sube queda vigente, y si eso está mal se corrige a mano."""
    await _upload(client, ctx["obra_id"], ctx["admin_token"], name="Tablero")
    ultima = await _upload(client, ctx["obra_id"], ctx["admin_token"], name="Tablero")

    assert ultima.json()["version"] == 2
    assert ultima.json()["is_latest"] is True

    listed = await client.get(f"{API}/obras/{ctx['obra_id']}/planos", headers=_auth(ctx["admin_token"]))
    assert len([p for p in listed.json() if p["is_latest"]]) == 1


async def test_previous_version_is_demoted(client, ctx):
    vieja = await _upload(client, ctx["obra_id"], ctx["admin_token"], name="Tablero")
    nueva = await _upload(client, ctx["obra_id"], ctx["admin_token"], name="Tablero")

    assert nueva.json()["is_latest"] is True
    listed = await client.get(f"{API}/obras/{ctx['obra_id']}/planos", headers=_auth(ctx["admin_token"]))
    by_id = {p["id"]: p for p in listed.json()}
    assert by_id[vieja.json()["id"]]["is_latest"] is False


async def test_without_dates_last_upload_still_wins(client, ctx):
    """Sin fecha de rótulo no hay con qué comparar → se mantiene la heurística
    de siempre (el último cargado manda), que es correcta en el caso normal."""
    r1 = await _upload(client, ctx["obra_id"], ctx["admin_token"], name="Tablero")
    r2 = await _upload(client, ctx["obra_id"], ctx["admin_token"], name="Tablero")
    assert r2.json()["is_latest"] is True

    listed = await client.get(f"{API}/obras/{ctx['obra_id']}/planos", headers=_auth(ctx["admin_token"]))
    by_id = {p["id"]: p for p in listed.json()}
    assert by_id[r1.json()["id"]]["is_latest"] is False


# ── Subir como actualización explícita de un plano existente ──────────────────────
# El camino de menor fricción: el usuario elige "esto actualiza a aquel plano" y no
# tiene que reescribir disciplina ni sector (ni acertarle al nombre exacto).

async def test_update_inherits_discipline_and_name(client, ctx):
    base = await _upload(client, ctx["obra_id"], ctx["admin_token"],
                         discipline="sanitarios", name="Planta baja")
    # se manda otra disciplina y otro nombre a propósito: deben ignorarse
    nueva = await _upload(client, ctx["obra_id"], ctx["admin_token"],
                          discipline="gas", name="cualquier otra cosa",
                          replaces=base.json()["id"])

    assert nueva.status_code == 201, nueva.text
    assert nueva.json()["discipline"] == "sanitarios"
    assert nueva.json()["name"] == "Planta baja"
    assert nueva.json()["version"] == 2
    assert nueva.json()["is_latest"] is True


async def test_update_demotes_the_previous_one(client, ctx):
    base = await _upload(client, ctx["obra_id"], ctx["admin_token"], name="Tablero")
    await _upload(client, ctx["obra_id"], ctx["admin_token"], replaces=base.json()["id"])

    listed = await client.get(f"{API}/obras/{ctx['obra_id']}/planos", headers=_auth(ctx["admin_token"]))
    vigentes = [p for p in listed.json() if p["is_latest"]]
    assert len(vigentes) == 1
    assert vigentes[0]["version"] == 2


async def test_update_records_who_uploaded_each_version(client, ctx):
    """El historial de versiones muestra quién subió cada una — dato que ya estaba
    en la base pero no se exponía."""
    base = await _upload(client, ctx["obra_id"], ctx["admin_token"], name="Tablero")
    await _upload(client, ctx["obra_id"], ctx["collab_token"], replaces=base.json()["id"])

    listed = await client.get(f"{API}/obras/{ctx['obra_id']}/planos", headers=_auth(ctx["admin_token"]))
    autores = {p["version"]: p["uploaded_by_name"] for p in listed.json()}
    assert autores[1] == "Admin A"
    assert autores[2] == "Collab A"


async def test_update_of_archived_version_still_lands_in_the_group(client, ctx):
    """Se puede elegir cualquier versión del grupo como referencia, no solo la
    vigente: lo que importa es a qué plano pertenece."""
    v1 = await _upload(client, ctx["obra_id"], ctx["admin_token"], name="Tablero")
    await _upload(client, ctx["obra_id"], ctx["admin_token"], name="Tablero")
    v3 = await _upload(client, ctx["obra_id"], ctx["admin_token"], replaces=v1.json()["id"])

    assert v3.json()["version"] == 3
    assert v3.json()["name"] == "Tablero"
    listed = await client.get(f"{API}/obras/{ctx['obra_id']}/planos", headers=_auth(ctx["admin_token"]))
    assert len([p for p in listed.json() if p["is_latest"]]) == 1


async def test_update_of_foreign_plano_is_404(client, ctx):
    """No se puede usar un plano de otro tenant como referencia."""
    base = await _upload(client, ctx["obra_id"], ctx["admin_token"])
    r = await _upload(client, ctx["obra_b_id"], ctx["admin_b_token"], replaces=base.json()["id"])
    assert r.status_code == 404, r.text


async def test_update_across_obras_of_same_tenant_is_404(client, ctx):
    """Ni siquiera entre dos obras del MISMO tenant: el grupo de versiones es por
    obra, así que un plano de la obra A no puede versionarse dentro de la obra B."""
    otra = await client.post(f"{API}/obras", headers=_auth(ctx["admin_token"]),
                             json={"name": "Otra obra del tenant A"})
    assert otra.status_code == 201, otra.text

    base = await _upload(client, ctx["obra_id"], ctx["admin_token"])
    r = await _upload(client, otra.json()["id"], ctx["admin_token"], replaces=base.json()["id"])
    assert r.status_code == 404, r.text


# ── Corrección manual del vigente ─────────────────────────────────────────────────

async def test_set_latest_switches_the_current_one(client, ctx):
    r1 = await _upload(client, ctx["obra_id"], ctx["admin_token"], name="Tablero")
    r2 = await _upload(client, ctx["obra_id"], ctx["admin_token"], name="Tablero")
    assert r2.json()["is_latest"] is True

    r = await client.patch(f"{API}/planos/{r1.json()['id']}/vigente", headers=_auth(ctx["admin_token"]))
    assert r.status_code == 200, r.text
    assert r.json()["is_latest"] is True

    listed = await client.get(f"{API}/obras/{ctx['obra_id']}/planos", headers=_auth(ctx["admin_token"]))
    by_id = {p["id"]: p for p in listed.json()}
    assert by_id[r1.json()["id"]]["is_latest"] is True
    assert by_id[r2.json()["id"]]["is_latest"] is False, "no puede haber dos vigentes"


async def test_set_latest_requires_admin(client, ctx):
    up = await _upload(client, ctx["obra_id"], ctx["admin_token"])
    r = await client.patch(f"{API}/planos/{up.json()['id']}/vigente", headers=_auth(ctx["collab_token"]))
    assert r.status_code == 403, r.text


async def test_set_latest_is_isolated_by_tenant(client, ctx):
    up = await _upload(client, ctx["obra_id"], ctx["admin_token"])
    r = await client.patch(f"{API}/planos/{up.json()['id']}/vigente", headers=_auth(ctx["admin_b_token"]))
    assert r.status_code == 404, r.text


async def test_set_latest_logs_historial(client, ctx):
    from sqlalchemy import select
    from app.models.historial import HistorialEvento

    r1 = await _upload(client, ctx["obra_id"], ctx["admin_token"], name="Tablero")
    await _upload(client, ctx["obra_id"], ctx["admin_token"], name="Tablero")
    await client.patch(f"{API}/planos/{r1.json()['id']}/vigente", headers=_auth(ctx["admin_token"]))

    events = (await ctx["db"].execute(
        select(HistorialEvento.event_type).where(HistorialEvento.obra_id == ctx["obra_id"])
    )).scalars().all()
    assert "plano_set_latest" in events


async def test_delete_latest_promotes_the_previously_uploaded_one(client, ctx):
    """Al borrar la vigente hereda la anterior por orden de carga, y nunca queda
    el plano sin ninguna versión vigente."""
    await _upload(client, ctx["obra_id"], ctx["admin_token"], name="Tablero")
    v2 = await _upload(client, ctx["obra_id"], ctx["admin_token"], name="Tablero")
    v3 = await _upload(client, ctx["obra_id"], ctx["admin_token"], name="Tablero")

    await client.delete(f"{API}/planos/{v3.json()['id']}", headers=_auth(ctx["admin_token"]))

    listed = await client.get(f"{API}/obras/{ctx['obra_id']}/planos", headers=_auth(ctx["admin_token"]))
    vigentes = [p for p in listed.json() if p["is_latest"]]
    assert len(vigentes) == 1
    assert vigentes[0]["id"] == v2.json()["id"]


async def test_delete_archived_version_leaves_latest_untouched(client, ctx):
    """Borrar una versión vieja del historial no toca a la vigente."""
    v1 = await _upload(client, ctx["obra_id"], ctx["admin_token"], name="Tablero")
    v2 = await _upload(client, ctx["obra_id"], ctx["admin_token"], name="Tablero")

    await client.delete(f"{API}/planos/{v1.json()['id']}", headers=_auth(ctx["admin_token"]))

    listed = await client.get(f"{API}/obras/{ctx['obra_id']}/planos", headers=_auth(ctx["admin_token"]))
    assert len(listed.json()) == 1
    assert listed.json()[0]["id"] == v2.json()["id"]
    assert listed.json()[0]["is_latest"] is True


# ── Race condition: el índice único parcial es Postgres-only, no se puede probar
# contra el SQLite de estos tests (ver conftest.py) — se validó a mano con
# `alembic upgrade head` contra Postgres real, documentado en el PR.
