"""Bitácora con IA: validación del audio y control de costo (cota mensual por
tenant). El objetivo es que un archivo inválido dé 4xx claro y que el gasto de
IA quede acotado por plan — nunca sin límite."""
from datetime import datetime, timezone

import pytest_asyncio

from app.core.security import create_access_token
from app.models.bitacora import BitacoraEntry
from app.models.obra import Obra
from app.models.tenant import Tenant
from app.models.user import User
from app.services.bitacora_service import _BITACORA_DEFAULT_LIMIT

API = "/api/v1"


@pytest_asyncio.fixture
async def ctx(db):
    """Tenant sin plan (→ límite por defecto) con un usuario admin y una obra."""
    t = Tenant(name="Empresa Bitácora")
    db.add(t)
    await db.flush()
    u = User(email="jefe@x.com", hashed_password="x", full_name="Jefe", role="admin",
             is_active=True, tenant_id=t.id)
    db.add(u)
    await db.flush()
    obra = Obra(name="Obra Bitácora", manager_id=u.id, tenant_id=t.id)
    db.add(obra)
    await db.flush()
    await db.commit()
    return {"db": db, "tenant_id": t.id, "user_id": u.id,
            "obra_id": obra.id, "token": create_access_token(u.id)}


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ── Validación del audio ──────────────────────────────────────────────────────

async def test_audio_rejects_non_audio(client, ctx):
    r = await client.post(
        f"{API}/obras/{ctx['obra_id']}/bitacora/audio",
        headers=_auth(ctx["token"]),
        files={"file": ("notas.txt", b"esto no es audio", "text/plain")},
    )
    assert r.status_code == 400, r.text


async def test_audio_rejects_empty(client, ctx):
    r = await client.post(
        f"{API}/obras/{ctx['obra_id']}/bitacora/audio",
        headers=_auth(ctx["token"]),
        files={"file": ("voz.ogg", b"", "audio/ogg")},
    )
    assert r.status_code == 400, r.text


# ── Control de costo de IA (cota mensual por tenant) ──────────────────────────

async def test_text_entry_under_quota_ok(client, ctx):
    """Bajo la cota: la entrada de texto se crea (201) aunque no haya API key de IA."""
    r = await client.post(
        f"{API}/obras/{ctx['obra_id']}/bitacora/texto",
        headers=_auth(ctx["token"]),
        json={"text": "Avance de hoy: se terminó la losa del primer piso."},
    )
    assert r.status_code == 201, r.text


async def test_ai_quota_enforced(client, ctx):
    """Al alcanzar la cota mensual del plan, una nueva entrada → 429 (no se procesa)."""
    db = ctx["db"]
    now = datetime.now(timezone.utc)
    for i in range(_BITACORA_DEFAULT_LIMIT):
        db.add(BitacoraEntry(
            obra_id=ctx["obra_id"], source="web", transcript=f"nota {i}",
            created_by=ctx["user_id"], status="procesado", created_at=now,
        ))
    await db.commit()

    r = await client.post(
        f"{API}/obras/{ctx['obra_id']}/bitacora/texto",
        headers=_auth(ctx["token"]),
        json={"text": "Una nota más que debería exceder la cota."},
    )
    assert r.status_code == 429, r.text
