"""Robustez del import de cronograma (Excel/CSV/MS Project XML) ante archivos
malformados o maliciosos. El endpoint debe responder 4xx con un mensaje claro —
nunca un 500 ni colgarse (billion laughs)."""
import pytest_asyncio

from app.core.security import create_access_token
from app.models.obra import Obra
from app.models.tenant import Tenant
from app.models.user import User
from app.services.import_service import MAX_IMPORT_ROWS

API = "/api/v1"


@pytest_asyncio.fixture
async def obra_ctx(db):
    """Un tenant con un usuario admin y una obra. Devuelve ids + token."""
    t = Tenant(name="Empresa Import")
    db.add(t)
    await db.flush()
    u = User(email="imp@x.com", hashed_password="x", full_name="Imp", role="admin",
             is_active=True, tenant_id=t.id)
    db.add(u)
    await db.flush()
    obra = Obra(name="Obra Import", manager_id=u.id, tenant_id=t.id)
    db.add(obra)
    await db.flush()
    await db.commit()
    return {"obra_id": obra.id, "token": create_access_token(u.id)}


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ── preview: validación y robustez del archivo ────────────────────────────────

async def test_preview_rejects_non_spreadsheet(client, obra_ctx):
    r = await client.post(
        f"{API}/imports/project-excel",
        headers=_auth(obra_ctx["token"]),
        files={"file": ("notas.txt", b"hola", "text/plain")},
    )
    assert r.status_code == 400, r.text


async def test_preview_rejects_empty_file(client, obra_ctx):
    r = await client.post(
        f"{API}/imports/project-excel",
        headers=_auth(obra_ctx["token"]),
        files={"file": ("vacio.csv", b"", "text/csv")},
    )
    assert r.status_code == 400, r.text


async def test_preview_malformed_xlsx_returns_422_not_500(client, obra_ctx):
    """Un .xlsx corrupto (no es un zip) → 422 limpio, no un 500."""
    r = await client.post(
        f"{API}/imports/project-excel",
        headers=_auth(obra_ctx["token"]),
        files={"file": ("roto.xlsx", b"esto no es un xlsx real",
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert r.status_code == 422, r.text


async def test_preview_xml_with_doctype_rejected(client, obra_ctx):
    """XML con DOCTYPE/ENTITY (vector 'billion laughs') → rechazado sin parsear."""
    bomb = (
        b'<?xml version="1.0"?>\n'
        b'<!DOCTYPE lolz [\n'
        b'  <!ENTITY lol "lol">\n'
        b'  <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;">\n'
        b']>\n'
        b'<Project><Tasks><Task><Name>&lol2;</Name></Task></Tasks></Project>'
    )
    r = await client.post(
        f"{API}/imports/project-excel",
        headers=_auth(obra_ctx["token"]),
        files={"file": ("bomb.xml", bomb, "application/xml")},
    )
    assert r.status_code == 422, r.text
    assert "DOCTYPE" in r.text or "ENTITY" in r.text


async def test_preview_valid_csv_ok(client, obra_ctx):
    csv_bytes = (
        "Nombre,Inicio,Fin\n"
        "Excavación,2026-01-10,2026-01-15\n"
        "Cimientos,2026-01-16,2026-01-20\n"
    ).encode("utf-8")
    r = await client.post(
        f"{API}/imports/project-excel",
        headers=_auth(obra_ctx["token"]),
        files={"file": ("plan.csv", csv_bytes, "text/csv")},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total_rows"] == 2
    assert body["rows"][0]["title"] == "Excavación"


# ── confirm: fail-fast y tope de filas ────────────────────────────────────────

async def test_confirm_unknown_obra_404(client, obra_ctx):
    r = await client.post(
        f"{API}/imports/project-excel/confirm",
        headers=_auth(obra_ctx["token"]),
        json={"obra_id": 999999, "rows": [{"row_index": 0, "title": "T"}]},
    )
    assert r.status_code == 404, r.text


async def test_confirm_too_many_rows_413(client, obra_ctx):
    rows = [{"row_index": i, "title": f"T{i}"} for i in range(MAX_IMPORT_ROWS + 1)]
    r = await client.post(
        f"{API}/imports/project-excel/confirm",
        headers=_auth(obra_ctx["token"]),
        json={"obra_id": obra_ctx["obra_id"], "rows": rows},
    )
    assert r.status_code == 413, r.text
