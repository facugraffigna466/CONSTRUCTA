"""Desambiguación de obra al pedir un plano por WhatsApp cuando el responsable
trabaja en varias obras con la misma disciplina cargada.

Bug real reportado: el bot pregunta bien "¿de cuál obra?", pero el parser de
la respuesta solo aceptaba un número — si el responsable contestaba con el
nombre de la obra (lo que el propio mensaje le ofrece como opción), quedaba
en un loop de "No entendí" para siempre, sin mandar nunca el plano.
"""
from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest_asyncio

from app.models.obra import Obra
from app.models.obra_team_member import ObraTeamMember
from app.models.responsible import Responsible
from app.models.tenant import Tenant
from app.models.user import User
from app.schemas.message import TwilioInboundPayload
from app.services.message_service import MessageService, _match_numbered_option
from app.services.message_templates import build_no_tasks_message
from app.services.plano_service import PlanoService

API_UUID = "AC_test"


@pytest_asyncio.fixture
async def ctx(db):
    """Un responsable en el equipo de dos obras, ambas con plano de electricidad."""
    tenant = Tenant(name="Empresa Desamb")
    db.add(tenant)
    await db.flush()

    admin = User(
        email="admin@desamb.com", hashed_password="x", full_name="Admin",
        role="admin", is_active=True, tenant_id=tenant.id,
    )
    db.add(admin)
    await db.flush()

    norte = Obra(name="Edificio Norte", manager_id=admin.id, tenant_id=tenant.id)
    sur = Obra(name="Edificio Sur", manager_id=admin.id, tenant_id=tenant.id)
    db.add_all([norte, sur])
    await db.flush()

    resp = Responsible(
        full_name="Agustín Multi-obra", whatsapp_number="+5493510005555",
        tenant_id=tenant.id, is_active=True, confirmed_at=datetime.now(timezone.utc),
    )
    db.add(resp)
    await db.flush()

    db.add_all([
        ObraTeamMember(obra_id=norte.id, tenant_id=tenant.id, responsible_id=resp.id, plan_disciplines=None),
        ObraTeamMember(obra_id=sur.id, tenant_id=tenant.id, responsible_id=resp.id, plan_disciplines=None),
    ])
    await db.flush()

    svc = PlanoService(db)
    for obra in (norte, sur):
        await svc.create(
            obra_id=obra.id, tenant_id=tenant.id, uploaded_by=admin.id,
            discipline="electricidad", name=f"Tablero {obra.name}",
            file_bytes=b"%PDF-1.4 x", original_filename="t.pdf",
            content_type="application/pdf", actor_name="Setup",
        )
    await db.commit()

    return {"db": db, "resp_phone": "+5493510005555", "norte": norte.name, "sur": sur.name}


def _payload(body: str, from_number: str, sid: str) -> TwilioInboundPayload:
    return TwilioInboundPayload(
        MessageSid=sid, AccountSid=API_UUID,
        From=f"whatsapp:{from_number}", To="whatsapp:+14155238886",
        Body=body, NumMedia="0",
    )


async def _send(db, body: str, from_number: str, sid: str) -> str:
    async def fake_send(*a, **kw):
        return f"SM_out_{sid}"
    with patch("app.services.message_service.send_whatsapp_message", new=AsyncMock(side_effect=fake_send)) as mock_send:
        await MessageService(db).process_inbound(_payload(body, from_number, sid), raw_params={})
    return mock_send.call_args[0][1]  # texto del reply


# ── Unit: el helper de matching ─────────────────────────────────────────────

def test_match_by_number():
    assert _match_numbered_option("1", ["Edificio Norte", "Edificio Sur"]) == 0
    assert _match_numbered_option("2", ["Edificio Norte", "Edificio Sur"]) == 1


def test_match_by_exact_name():
    assert _match_numbered_option("Edificio Norte", ["Edificio Norte", "Edificio Sur"]) == 0


def test_match_by_name_case_and_accent_insensitive():
    assert _match_numbered_option("edificio norte", ["Edificio Norte", "Edificio Sur"]) == 0


def test_match_by_partial_name():
    """"Norte" alcanza para matchear "Edificio Norte" si es inequívoco."""
    assert _match_numbered_option("norte", ["Edificio Norte", "Edificio Sur"]) == 0


def test_match_ambiguous_partial_returns_none():
    assert _match_numbered_option("edificio", ["Edificio Norte", "Edificio Sur"]) is None


def test_match_exact_wins_over_prefix_collision():
    """Caso real encontrado con datos de producción: un nombre exacto no debe
    volverse ambiguo solo porque también es substring de otro nombre."""
    names = ["Edificio Norte", "Edificio Norte — Demo"]
    assert _match_numbered_option("Edificio Norte", names) == 0
    assert _match_numbered_option("edificio norte", names) == 0


def test_match_garbage_returns_none():
    assert _match_numbered_option("no sé", ["Edificio Norte", "Edificio Sur"]) is None


# ── End-to-end: el bug real, contra el flujo completo ───────────────────────

async def test_reply_with_number_delivers_plano(ctx):
    r1 = await _send(ctx["db"], "mandame el plano de electricidad", ctx["resp_phone"], "SM1")
    assert "¿De cuál?" in r1 or "¿De cuál" in r1

    r2 = await _send(ctx["db"], "1", ctx["resp_phone"], "SM2")
    assert "Plano de electricidad" in r2


async def test_reply_with_obra_name_delivers_plano(ctx):
    """El caso que antes quedaba en loop: contestar con el nombre, no el número."""
    await _send(ctx["db"], "mandame el plano de electricidad", ctx["resp_phone"], "SM3")

    r2 = await _send(ctx["db"], ctx["norte"], ctx["resp_phone"], "SM4")
    assert "No entendí" not in r2
    assert "Plano de electricidad" in r2


async def test_reply_with_unrelated_text_still_asks_again(ctx):
    """No degradamos el caso negativo: una respuesta que no matchea nada
    sigue re-preguntando, en vez de adivinar."""
    await _send(ctx["db"], "mandame el plano de electricidad", ctx["resp_phone"], "SM5")

    r2 = await _send(ctx["db"], "no sé cuál", ctx["resp_phone"], "SM6")
    assert "No entendí" in r2


# ── Plano demasiado pesado para WhatsApp ────────────────────────────────────
# Twilio rechaza los adjuntos de más de 16 MB DESPUÉS de aceptar el mensaje
# (error 63019, al bajar el media), así que el envío no falla de forma visible
# y el responsable se queda esperando sin recibir nada. El bot corta antes.

async def _pedir_y_elegir_obra(db, phone: str, sufijo: str):
    """Pide el plano y responde la desambiguación (el fixture tiene dos obras con
    electricidad). Devuelve el mock del segundo envío, que es el que lleva —o no—
    el adjunto."""
    import uuid
    from unittest.mock import AsyncMock, patch
    async def fake(*a, **kw):
        return f"SM_out_{uuid.uuid4().hex}"
    with patch("app.services.message_service.send_whatsapp_message",
               new=AsyncMock(side_effect=fake)):
        await MessageService(db).process_inbound(
            _payload("mandame el plano de electricidad", phone, f"SM_a_{sufijo}"), raw_params={},
        )
    with patch("app.services.message_service.send_whatsapp_message",
               new=AsyncMock(side_effect=fake)) as mock_send:
        await MessageService(db).process_inbound(
            _payload("1", phone, f"SM_b_{sufijo}"), raw_params={},
        )
    return mock_send


async def test_plano_too_big_is_explained_not_silent(ctx, db):
    """Se responde con una explicación en vez de intentar (y fallar) el envío."""
    from app.services.plano_service import WHATSAPP_MAX_BYTES
    from app.models.plano import Plano
    from sqlalchemy import select

    for plano in (await db.execute(select(Plano))).scalars().all():
        plano.file_size = WHATSAPP_MAX_BYTES + 1
    await db.commit()

    mock_send = await _pedir_y_elegir_obra(db, ctx["resp_phone"], "big")
    texto = mock_send.call_args[0][1]
    media = mock_send.call_args.kwargs.get("media_url")

    assert media is None, "no debe intentar adjuntar un archivo que Twilio va a rechazar"
    assert "16 MB" in texto
    assert "jefe de obra" in texto, "el mensaje tiene que ser accionable desde la obra"
    # Quien pide por WhatsApp no tiene acceso a la web: el mensaje no debe
    # derivarlo ahí. (Ojo: "whatsapp" contiene "app" — hay que buscar las
    # formas en que realmente se nombraría la aplicación.)
    bajo = texto.lower()
    for termino in ("la app", "aplicación", "aplicacion", "el sistema", "descargá", "descarga"):
        assert termino not in bajo, f"el mensaje deriva a la web con «{termino}»"


async def test_plano_under_limit_still_attaches(ctx, db, monkeypatch):
    """El caso normal no cambia: el plano se sigue adjuntando.

    `PUBLIC_BASE_URL` se fija acá a propósito: sin él, `_format_plano_reply`
    devuelve `media_url=None` por otra razón (no hay dominio público con el que
    construir el link firmado) y el test pasaría o fallaría según el `.env` de
    cada máquina. Lo detectó el CI, donde no hay `.env`.
    """
    from app.core.config import settings
    monkeypatch.setattr(settings, "PUBLIC_BASE_URL", "https://ejemplo.test", raising=False)

    mock_send = await _pedir_y_elegir_obra(db, ctx["resp_phone"], "small")
    assert mock_send.call_args.kwargs.get("media_url") is not None
    assert "16 MB" not in mock_send.call_args[0][1]


# ── Mensaje de "sin tareas" menciona planos ─────────────────────────────────

def test_no_tasks_message_mentions_planos():
    msg = build_no_tasks_message("Juan")
    assert "plano" in msg.lower()
