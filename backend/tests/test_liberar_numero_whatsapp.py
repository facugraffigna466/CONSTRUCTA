"""Liberación del número de WhatsApp de un responsable desactivado.

Antes, un número usado alguna vez como Responsible quedaba "quemado" para
siempre: el soft delete (is_active=False) era la única baja permitida, pero
el chequeo de colisión de PATCH /users/me y el ruteo del webhook seguían
matcheando al desactivado — no existía ninguna forma legítima de que un
staff (p. ej. el admin que se registró a sí mismo como responsable para
probar el menú) recuperara su propio número para la bitácora.

Cubre:
  - PATCH /users/me acepta el número de un responsable DESACTIVADO (antes 409)
    y sigue rechazando el de uno activo — incluida su variante +54/+549.
  - PATCH /users/me con whatsapp_number=null libera el número del staff
    (antes el null se filtraba y el campo quedaba pegado para siempre).
  - Webhook: si el número matchea staff, el staff gana sobre el responsable
    desactivado; "Ya no tenés acceso" queda solo para ex-responsables que
    no son staff. La resolución de staff también matchea variantes +54/+549.
  - Reactivar un responsable cuyo número fue tomado por un staff → 409.
  - POST /obras/{id}/team reusa al responsable desactivado del MISMO tenant
    (reactivándolo) y ya no puede reusar uno de otro tenant.
  - `wa_number_variants` (equivalencia +54 ↔ +549).
"""
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest_asyncio
from sqlalchemy import select

from app.core.phone import wa_number_variants
from app.core.security import create_access_token
from app.models.message import Message, MessageDirection
from app.models.obra import Obra
from app.models.responsible import Responsible
from app.models.tenant import Tenant
from app.models.tenant_membership import TenantMembership
from app.models.user import User
from app.schemas.message import TwilioInboundPayload
from app.services.message_service import MessageService

API = "/api/v1"

NUM_BAJA = "+5493510000801"      # responsable desactivado
NUM_ACTIVO = "+5493510000802"    # responsable activo (con 9 de móvil)
NUM_ACTIVO_SIN9 = "+543510000802"  # variante +54 del mismo número
NUM_LIBRE = "+5493510000809"


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def ctx(db):
    tenant = Tenant(name="Liberar SA")
    db.add(tenant)
    await db.flush()

    admin = User(
        email="admin@liberar.com", hashed_password="x", full_name="Admin Liberar",
        role="admin", is_active=True, tenant_id=tenant.id,
    )
    db.add(admin)
    await db.flush()
    membership = TenantMembership(
        user_id=admin.id, tenant_id=tenant.id, role="admin", is_active=True,
    )
    db.add(membership)
    await db.flush()

    obra = Obra(name="Obra Liberar", manager_id=admin.id, tenant_id=tenant.id)
    db.add(obra)
    await db.flush()

    baja = Responsible(
        full_name="Pedro Baja", whatsapp_number=NUM_BAJA, role="Pintor",
        tenant_id=tenant.id, is_active=False,
        confirmed_at=datetime.now(timezone.utc),
    )
    activo = Responsible(
        full_name="Ana Activa", whatsapp_number=NUM_ACTIVO, role="Electricista",
        tenant_id=tenant.id, is_active=True,
        confirmed_at=datetime.now(timezone.utc),
    )
    db.add_all([baja, activo])
    await db.commit()

    return {
        "tenant_id": tenant.id,
        "admin_id": admin.id,
        "membership_id": membership.id,
        "obra_id": obra.id,
        "baja_id": baja.id,
        "activo_id": activo.id,
        "token": create_access_token(admin.id),
    }


# ─── wa_number_variants ───────────────────────────────────────────────────────


def test_variants_con_9_genera_forma_sin_9():
    assert wa_number_variants("+5493511234567") == ["+5493511234567", "+543511234567"]


def test_variants_sin_9_genera_forma_con_9():
    assert wa_number_variants("+543511234567") == ["+543511234567", "+5493511234567"]


def test_variants_otro_pais_o_formato_raro_no_inventa():
    assert wa_number_variants("+14155238886") == ["+14155238886"]
    assert wa_number_variants("+549351123") == ["+549351123"]  # largo no estándar
    assert wa_number_variants("") == [""]


# ─── PATCH /users/me ─────────────────────────────────────────────────────────


async def test_patch_me_toma_numero_de_responsable_desactivado(client, db, ctx):
    """El caso que disparó todo: el admin quiere su número, que quedó pegado
    a un responsable de prueba ya desactivado. Antes: 409. Ahora: 200."""
    r = await client.patch(
        f"{API}/users/me", headers=_auth(ctx["token"]),
        json={"whatsapp_number": NUM_BAJA},
    )
    assert r.status_code == 200, r.text
    m = await db.get(TenantMembership, ctx["membership_id"])
    await db.refresh(m)
    assert m.whatsapp_number == NUM_BAJA


async def test_patch_me_sigue_rechazando_numero_de_responsable_activo(client, ctx):
    r = await client.patch(
        f"{API}/users/me", headers=_auth(ctx["token"]),
        json={"whatsapp_number": NUM_ACTIVO},
    )
    assert r.status_code == 409, r.text


async def test_patch_me_rechaza_variante_54_de_un_activo(client, ctx):
    """El responsable activo está guardado como +549…; cargar la forma +54…
    del MISMO número también debe chocar — es el mismo teléfono."""
    r = await client.patch(
        f"{API}/users/me", headers=_auth(ctx["token"]),
        json={"whatsapp_number": NUM_ACTIVO_SIN9},
    )
    assert r.status_code == 409, r.text


async def test_patch_me_null_libera_el_numero_del_staff(client, db, ctx):
    """Flujo inverso: el staff libera su número (whatsapp_number=null) y ese
    número puede pasar a ser de un responsable nuevo. Antes el null se
    filtraba silenciosamente y el campo no se podía borrar nunca."""
    r = await client.patch(
        f"{API}/users/me", headers=_auth(ctx["token"]),
        json={"whatsapp_number": NUM_LIBRE},
    )
    assert r.status_code == 200, r.text
    r = await client.patch(
        f"{API}/users/me", headers=_auth(ctx["token"]),
        json={"whatsapp_number": None},
    )
    assert r.status_code == 200, r.text
    m = await db.get(TenantMembership, ctx["membership_id"])
    await db.refresh(m)
    assert m.whatsapp_number is None
    # Ahora el número liberado puede ser de un responsable.
    with patch("app.services.responsible_confirmation.send_whatsapp_message", new=AsyncMock()):
        r = await client.post(
            f"{API}/responsibles", headers=_auth(ctx["token"]),
            json={"full_name": "Nuevo Dueño", "whatsapp_number": NUM_LIBRE},
        )
    assert r.status_code == 201, r.text


async def test_patch_me_valida_formato_e164(client, ctx):
    r = await client.patch(
        f"{API}/users/me", headers=_auth(ctx["token"]),
        json={"whatsapp_number": "351-123-4567"},
    )
    assert r.status_code == 422, r.text


# ─── Webhook: staff gana sobre responsable desactivado ───────────────────────


async def _last_outbound(db, to_number: str) -> Message | None:
    return (await db.execute(
        select(Message).where(
            Message.direction == MessageDirection.OUTBOUND,
            Message.to_number == to_number,
        ).order_by(Message.id.desc())
    )).scalars().first()


async def _inbound(db, from_number: str, sid: str, body: str = "hola"):
    svc = MessageService(db)
    payload = TwilioInboundPayload(
        From=f"whatsapp:{from_number}", To="whatsapp:+14155238886",
        MessageSid=sid, AccountSid="AC_test", Body=body,
    )
    with patch("app.services.message_service.send_whatsapp_message", new=AsyncMock(return_value="SM_out")):
        await svc.process_inbound(payload, raw_params={})


async def test_webhook_staff_gana_sobre_responsable_desactivado(db, ctx):
    """El número está en un responsable desactivado Y en la membership del
    admin → el bot atiende al staff (menú), no manda "Ya no tenés acceso"."""
    m = await db.get(TenantMembership, ctx["membership_id"])
    m.whatsapp_number = NUM_BAJA
    await db.commit()

    await _inbound(db, NUM_BAJA, "SM_liberar_staff_gana")
    out = await _last_outbound(db, NUM_BAJA)
    assert out is not None
    assert "Ya no tenés acceso" not in out.body
    assert "asistente de obra" in out.body  # menú de staff


async def test_webhook_desactivado_sin_staff_conserva_mensaje_de_baja(db, ctx):
    """Regresión: si el número es SOLO de un ex-responsable (ningún staff lo
    tiene), el mensaje diferenciado de baja sigue vigente."""
    await _inbound(db, NUM_BAJA, "SM_liberar_solo_baja")
    out = await _last_outbound(db, NUM_BAJA)
    assert out is not None
    assert "Ya no tenés acceso" in out.body


async def test_webhook_matchea_staff_por_variante_sin_9(db, ctx):
    """La membership guarda +549…; el mensaje entra como +54… (o viceversa,
    según cómo se cargó) → igual se resuelve como staff."""
    m = await db.get(TenantMembership, ctx["membership_id"])
    m.whatsapp_number = "+5493510000899"
    await db.commit()

    await _inbound(db, "+543510000899", "SM_liberar_variante")
    out = await _last_outbound(db, "+543510000899")
    assert out is not None
    assert "asistente de obra" in out.body


# ─── Reactivación con guard ──────────────────────────────────────────────────


async def test_reactivar_falla_si_un_staff_tomo_el_numero(client, db, ctx):
    """Desactivado → staff toma el número → reactivarlo recrearía la colisión
    User↔Responsible (hallazgo 6.4) → 409 con mensaje claro."""
    m = await db.get(TenantMembership, ctx["membership_id"])
    m.whatsapp_number = NUM_BAJA
    await db.commit()

    r = await client.patch(
        f"{API}/responsibles/{ctx['baja_id']}/reactivate", headers=_auth(ctx["token"]),
    )
    assert r.status_code == 409, r.text
    baja = await db.get(Responsible, ctx["baja_id"])
    await db.refresh(baja)
    assert baja.is_active is False


async def test_reactivar_funciona_si_el_numero_sigue_libre(client, db, ctx):
    r = await client.patch(
        f"{API}/responsibles/{ctx['baja_id']}/reactivate", headers=_auth(ctx["token"]),
    )
    assert r.status_code == 200, r.text
    baja = await db.get(Responsible, ctx["baja_id"])
    await db.refresh(baja)
    assert baja.is_active is True


# ─── Crear responsable sobre número de un desactivado ────────────────────────


async def test_crear_responsable_con_numero_de_desactivado_da_mensaje_util(client, ctx):
    """El unique de BD impide la fila duplicada, pero el 409 ahora dice QUÉ
    hacer (reactivar o editar al desactivado) en vez del genérico."""
    with patch("app.services.responsible_confirmation.send_whatsapp_message", new=AsyncMock()):
        r = await client.post(
            f"{API}/responsibles", headers=_auth(ctx["token"]),
            json={"full_name": "Otro Pintor", "whatsapp_number": NUM_BAJA},
        )
    assert r.status_code == 409, r.text
    assert "desactivado" in r.json()["detail"]


# ─── POST /obras/{id}/team: reuso scopeado al tenant + reactivación ──────────


async def test_add_team_reusa_desactivado_del_tenant_y_lo_reactiva(client, db, ctx):
    with patch("app.services.responsible_confirmation.send_whatsapp_message", new=AsyncMock()):
        r = await client.post(
            f"{API}/obras/{ctx['obra_id']}/team", headers=_auth(ctx["token"]),
            json={"full_name": "Pedro Baja", "whatsapp_number": NUM_BAJA},
        )
    assert r.status_code == 201, r.text
    assert r.json()["responsible_id"] == ctx["baja_id"]
    baja = await db.get(Responsible, ctx["baja_id"])
    await db.refresh(baja)
    assert baja.is_active is True


async def test_add_team_no_reusa_responsable_de_otro_tenant(client, db, ctx):
    """Antes el lookup de reuso era global: un alta por número podía enganchar
    (y sumar al team) un responsable de OTRA empresa. Ahora crea uno propio."""
    otro_tenant = Tenant(name="Otra Empresa")
    db.add(otro_tenant)
    await db.flush()
    ajeno = Responsible(
        full_name="Ajeno", whatsapp_number=NUM_LIBRE, tenant_id=otro_tenant.id,
        is_active=True, confirmed_at=datetime.now(timezone.utc),
    )
    db.add(ajeno)
    await db.commit()

    with patch("app.services.responsible_confirmation.send_whatsapp_message", new=AsyncMock()):
        r = await client.post(
            f"{API}/obras/{ctx['obra_id']}/team", headers=_auth(ctx["token"]),
            json={"full_name": "Propio", "whatsapp_number": NUM_LIBRE},
        )
    assert r.status_code == 201, r.text
    assert r.json()["responsible_id"] != ajeno.id
    nuevo = await db.get(Responsible, r.json()["responsible_id"])
    assert nuevo.tenant_id == ctx["tenant_id"]
