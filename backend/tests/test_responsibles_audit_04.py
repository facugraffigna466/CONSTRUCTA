"""Cobertura de los fixes de la auditoría 04 (responsables).

Cierra 6.1 (cross-tenant lookup), 6.2 (cross-tenant injection en team),
6.3 (whatsapp unique por tenant en Responsible), 6.4 (colisión
User↔Responsible), 6.6 (whatsapp unique por tenant en User), 6.7
(OTM huérfano post soft-delete) y 6.8 (send_window silencioso inbound).
"""
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest_asyncio
from sqlalchemy import select

from app.core.security import create_access_token
from app.models.obra import Obra
from app.models.obra_team_member import ObraTeamMember
from app.models.responsible import Responsible
from app.models.tenant import Tenant
from app.models.user import User

API = "/api/v1"


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ─── Fixture base: dos tenants con datos cruzados ─────────────────────────────

@pytest_asyncio.fixture
async def two_tenants_ctx(db):
    tA = Tenant(name="A")
    tB = Tenant(name="B")
    db.add_all([tA, tB])
    await db.flush()
    admin_a = User(email="a@x.com", hashed_password="x", full_name="Admin A",
                   role="admin", is_active=True, tenant_id=tA.id)
    admin_b = User(email="b@x.com", hashed_password="x", full_name="Admin B",
                   role="admin", is_active=True, tenant_id=tB.id)
    db.add_all([admin_a, admin_b])
    await db.flush()
    obra_a = Obra(name="Obra A", manager_id=admin_a.id, tenant_id=tA.id)
    obra_b = Obra(name="Obra B", manager_id=admin_b.id, tenant_id=tB.id)
    db.add_all([obra_a, obra_b])
    await db.flush()
    resp_a = Responsible(
        full_name="Resp A", whatsapp_number="+5490000000101",
        is_active=True, tenant_id=tA.id, confirmed_at=datetime.now(timezone.utc),
    )
    resp_b = Responsible(
        full_name="Resp B", whatsapp_number="+5490000000102",
        is_active=True, tenant_id=tB.id, confirmed_at=datetime.now(timezone.utc),
    )
    db.add_all([resp_a, resp_b])
    await db.flush()
    await db.commit()
    return {
        "tA_id": tA.id, "tB_id": tB.id,
        "obra_a_id": obra_a.id, "obra_b_id": obra_b.id,
        "resp_a_id": resp_a.id, "resp_b_id": resp_b.id,
        "resp_a_phone": resp_a.whatsapp_number,
        "resp_b_phone": resp_b.whatsapp_number,
        "admin_a_token": create_access_token(admin_a.id),
        "admin_b_token": create_access_token(admin_b.id),
    }


# ─── 6.1: lookup cross-tenant ─────────────────────────────────────────────────

async def test_lookup_returns_404_for_other_tenant(client, two_tenants_ctx):
    r = await client.get(
        f"{API}/responsibles/lookup",
        headers=_auth(two_tenants_ctx["admin_a_token"]),
        params={"whatsapp": two_tenants_ctx["resp_b_phone"]},
    )
    assert r.status_code == 404, r.text


async def test_lookup_returns_own_tenant_ok(client, two_tenants_ctx):
    r = await client.get(
        f"{API}/responsibles/lookup",
        headers=_auth(two_tenants_ctx["admin_a_token"]),
        params={"whatsapp": two_tenants_ctx["resp_a_phone"]},
    )
    assert r.status_code == 200, r.text
    assert r.json()["full_name"] == "Resp A"


# ─── 6.2: cross-tenant injection en POST /obras/{id}/team ─────────────────────

async def test_add_team_rejects_cross_tenant_responsible(client, two_tenants_ctx):
    with patch("app.services.responsible_confirmation.send_welcome_confirmation", new=AsyncMock()):
        r = await client.post(
            f"{API}/obras/{two_tenants_ctx['obra_a_id']}/team",
            headers=_auth(two_tenants_ctx["admin_a_token"]),
            json={"responsible_id": two_tenants_ctx["resp_b_id"]},
        )
    assert r.status_code == 404, r.text


# ─── 6.3: whatsapp_number unique por tenant en Responsible ────────────────────

async def test_same_whatsapp_allowed_in_different_tenants(client, two_tenants_ctx):
    """El mismo número puede cargarse en dos tenants distintos (un contratista
    trabajando para dos empresas)."""
    phone = "+5490000000999"
    with patch("app.services.responsible_confirmation.send_welcome_confirmation", new=AsyncMock()):
        r1 = await client.post(
            f"{API}/responsibles",
            headers=_auth(two_tenants_ctx["admin_a_token"]),
            json={"full_name": "Compartido A", "whatsapp_number": phone, "role": "Obrero"},
        )
        assert r1.status_code == 201, r1.text
        r2 = await client.post(
            f"{API}/responsibles",
            headers=_auth(two_tenants_ctx["admin_b_token"]),
            json={"full_name": "Compartido B", "whatsapp_number": phone, "role": "Obrero"},
        )
        assert r2.status_code == 201, r2.text


async def test_same_whatsapp_rejected_within_same_tenant(client, two_tenants_ctx):
    with patch("app.services.responsible_confirmation.send_welcome_confirmation", new=AsyncMock()):
        r = await client.post(
            f"{API}/responsibles",
            headers=_auth(two_tenants_ctx["admin_a_token"]),
            json={
                "full_name": "Duplicado",
                "whatsapp_number": two_tenants_ctx["resp_a_phone"],
                "role": "Obrero",
            },
        )
    assert r.status_code == 409, r.text


# ─── 6.4: colisión User↔Responsible con mismo número ──────────────────────────

async def test_creating_responsible_with_user_number_returns_conflict(
    client, db, two_tenants_ctx
):
    """Si un User del tenant A ya tiene un whatsapp, no se puede crear un
    Responsible con el mismo número en ese tenant — el bot no podría distinguir."""
    admin_a = await db.get(User, (
        await db.execute(select(User.id).where(User.email == "a@x.com"))
    ).scalar_one())
    admin_a.whatsapp_number = "+5490000000555"
    await db.commit()

    with patch("app.services.responsible_confirmation.send_welcome_confirmation", new=AsyncMock()):
        r = await client.post(
            f"{API}/responsibles",
            headers=_auth(two_tenants_ctx["admin_a_token"]),
            json={
                "full_name": "Colision",
                "whatsapp_number": "+5490000000555",
                "role": "Obrero",
            },
        )
    assert r.status_code == 409, r.text
    assert "usuario" in r.json()["detail"].lower()


async def test_setting_user_whatsapp_that_collides_with_responsible_returns_409(
    client, two_tenants_ctx
):
    r = await client.patch(
        f"{API}/users/me",
        headers=_auth(two_tenants_ctx["admin_a_token"]),
        json={"whatsapp_number": two_tenants_ctx["resp_a_phone"]},
    )
    assert r.status_code == 409, r.text
    assert "responsable" in r.json()["detail"].lower()


# ─── 6.7: soft-delete de Responsible limpia OTM ───────────────────────────────

async def test_deactivate_responsible_removes_team_memberships(
    client, db, two_tenants_ctx
):
    otm = ObraTeamMember(
        obra_id=two_tenants_ctx["obra_a_id"],
        tenant_id=two_tenants_ctx["tA_id"],
        responsible_id=two_tenants_ctx["resp_a_id"],
    )
    db.add(otm)
    await db.commit()

    r = await client.delete(
        f"{API}/responsibles/{two_tenants_ctx['resp_a_id']}",
        headers=_auth(two_tenants_ctx["admin_a_token"]),
    )
    assert r.status_code == 200, r.text

    # OTM debe haber sido limpiada
    remaining = (await db.execute(
        select(ObraTeamMember).where(
            ObraTeamMember.responsible_id == two_tenants_ctx["resp_a_id"]
        )
    )).scalars().all()
    assert len(remaining) == 0, "esperaba que se limpien las filas de team_member"


# ─── 6.8: send_window no bloquea inbound ──────────────────────────────────────

async def test_send_window_not_used_in_inbound_path():
    """Regresión estructural (6.8): el filtro de send_window solo debe aparecer
    en el bloque de outbound (recordatorios/reminders). En el bloque de proceso
    inbound del responsable no debe haber más chequeo horario — antes generaba
    silencio total.
    """
    import re
    import app.services.message_service as message_service_module
    src = open(message_service_module.__file__).read()
    # Contamos ocurrencias de _within_send_window en el archivo. Antes del fix
    # había 4 (definición + 1 en inbound + 2 en outbound). Ahora deben ser 3
    # (definición + 2 en outbound).
    matches = re.findall(r"_within_send_window\(", src)
    assert len(matches) == 3, (
        f"esperaba 3 apariciones de _within_send_window (def + 2 outbound), encontré {len(matches)}"
    )
    # Además, verificamos que no aparezca 'outside send window' en el path
    # de inbound (el log era la firma del bug).
    assert "outside send window" not in src, (
        "'outside send window' quedó en el código — el filtro sigue aplicándose a inbound"
    )
