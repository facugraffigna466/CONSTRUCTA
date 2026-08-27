"""Desambiguación conversacional del webhook cuando el mismo whatsapp_number
tiene membership de staff activa en más de un tenant (Fase 3 rediseño
multi-tenant). Constructa usa un único número de Twilio para toda la
plataforma, así que no hay señal de infraestructura para distinguir la
empresa — el bot pregunta una vez y recuerda la elección."""
from unittest.mock import AsyncMock, patch

import pytest_asyncio
from sqlalchemy import select

from app.models.message import Message, MessageDirection
from app.models.tenant import Tenant
from app.models.tenant_membership import TenantMembership
from app.models.user import User
from app.models.whatsapp_tenant_context import WhatsappTenantContext
from app.schemas.message import TwilioInboundPayload
from app.services.message_service import MessageService

API = "/api/v1"
PHONE = "+5493510009999"


@pytest_asyncio.fixture
async def ctx(db):
    """Una identidad staff (mismo whatsapp_number) con membership activa en
    dos tenants distintos."""
    tenant_a = Tenant(name="Empresa A")
    tenant_b = Tenant(name="Empresa B")
    db.add_all([tenant_a, tenant_b])
    await db.flush()
    user = User(email="dosempresas@x.com", hashed_password="x", full_name="Dos Empresas")
    db.add(user)
    await db.flush()
    db.add_all([
        TenantMembership(
            user_id=user.id, tenant_id=tenant_a.id, role="admin", is_active=True,
            whatsapp_number=PHONE,
        ),
        TenantMembership(
            user_id=user.id, tenant_id=tenant_b.id, role="admin", is_active=True,
            whatsapp_number=PHONE,
        ),
    ])
    await db.flush()
    await db.commit()
    return {"user_id": user.id, "tenant_a_id": tenant_a.id, "tenant_b_id": tenant_b.id}


def _payload(body: str, sid: str) -> TwilioInboundPayload:
    return TwilioInboundPayload(
        From=f"whatsapp:{PHONE}", To="whatsapp:+14155238886",
        MessageSid=sid, AccountSid="AC_test", Body=body,
    )


async def _last_outbound(db) -> Message:
    return (await db.execute(
        select(Message).where(
            Message.direction == MessageDirection.OUTBOUND, Message.to_number == PHONE,
        ).order_by(Message.id.desc())
    )).scalars().first()


async def test_primer_mensaje_ambiguo_manda_menu_y_no_procesa(db, ctx):
    svc = MessageService(db)
    with patch("app.services.message_service.send_whatsapp_message", new=AsyncMock(return_value="SM_out")):
        await svc.process_inbound(_payload("hola", "SM1"), raw_params={})
    out = await _last_outbound(db)
    assert out is not None
    assert "Empresa A" in out.body and "Empresa B" in out.body
    assert "1)" in out.body and "2)" in out.body

    wa_ctx = await db.get(WhatsappTenantContext, PHONE)
    assert wa_ctx is not None
    assert wa_ctx.active_tenant_id is None
    assert wa_ctx.pending_options is not None


async def test_responder_con_numero_valido_fija_el_tenant(db, ctx):
    svc = MessageService(db)
    sids = iter(["SM_out_1", "SM_out_2"])
    with patch("app.services.message_service.send_whatsapp_message", new=AsyncMock(side_effect=lambda *a, **k: next(sids))):
        await svc.process_inbound(_payload("hola", "SM1"), raw_params={})
        await svc.process_inbound(_payload("1", "SM2"), raw_params={})

    out = await _last_outbound(db)
    assert "Reenviá tu mensaje" in out.body

    await db.refresh(await db.get(WhatsappTenantContext, PHONE))
    wa_ctx = await db.get(WhatsappTenantContext, PHONE)
    assert wa_ctx.pending_options is None
    assert wa_ctx.active_tenant_id in (ctx["tenant_a_id"], ctx["tenant_b_id"])


async def test_respuesta_invalida_al_menu_lo_repite(db, ctx):
    svc = MessageService(db)
    sids = iter(["SM_out_1", "SM_out_2"])
    with patch("app.services.message_service.send_whatsapp_message", new=AsyncMock(side_effect=lambda *a, **k: next(sids))):
        await svc.process_inbound(_payload("hola", "SM1"), raw_params={})
        await svc.process_inbound(_payload("no entiendo", "SM2"), raw_params={})
    out = await _last_outbound(db)
    assert "1)" in out.body and "2)" in out.body

    wa_ctx = await db.get(WhatsappTenantContext, PHONE)
    assert wa_ctx.pending_options is not None
    assert wa_ctx.active_tenant_id is None


async def test_tenant_elegido_se_recuerda_sin_volver_a_preguntar(db, ctx):
    svc = MessageService(db)
    sids = iter(["SM_out_1", "SM_out_2", "SM_out_3"])
    with patch("app.services.message_service.send_whatsapp_message", new=AsyncMock(side_effect=lambda *a, **k: next(sids))):
        await svc.process_inbound(_payload("hola", "SM1"), raw_params={})
        await svc.process_inbound(_payload("2", "SM2"), raw_params={})
        # Tercer mensaje: ya no debería repreguntar — pasa a procesarse normal
        # (staff sin plano/audio → menú de staff, no el menú de empresas).
        await svc.process_inbound(_payload("hola de nuevo", "SM3"), raw_params={})
    out = await _last_outbound(db)
    assert "Empresa A" not in out.body and "Empresa B" not in out.body
    assert "más de una empresa" not in out.body
