"""GET /auth/invite/{token}: contexto de la invitación (empresa, email, rol) sin
consumir el token, para que el invitado sepa a qué se une antes de aceptar (F9)."""
from datetime import datetime, timedelta, timezone

import pytest_asyncio

from app.models.tenant import Tenant
from app.models.tenant_membership import TenantMembership
from app.models.user import User

API = "/api/v1"


async def _mk_invite(db, *, token: str, expires: datetime, active: bool = False) -> None:
    t = Tenant(name="Constructora Sur")
    db.add(t)
    await db.flush()
    u = User(email="invitado@x.com", hashed_password="", full_name="", tenant_id=t.id)
    db.add(u)
    await db.flush()
    # invitation_token/expires_at/role/is_active viven en TenantMembership
    # (Fase 3 rediseño multi-tenant), no en User.
    db.add(TenantMembership(
        user_id=u.id, tenant_id=t.id, role="collaborator", is_active=active,
        invitation_token=token, invitation_expires_at=expires,
    ))
    await db.flush()
    await db.commit()


@pytest_asyncio.fixture
async def valid_invite(db):
    await _mk_invite(db, token="tok-valida", expires=datetime.now(timezone.utc) + timedelta(hours=48))


async def test_invite_context_returns_company_email_role(client, valid_invite):
    r = await client.get(f"{API}/auth/invite/tok-valida")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["email"] == "invitado@x.com"
    assert body["role"] == "collaborator"
    assert body["company_name"] == "Constructora Sur"


async def test_invite_context_unknown_token(client, db):
    r = await client.get(f"{API}/auth/invite/no-existe")
    assert r.status_code == 400, r.text


async def test_invite_context_expired(client, db):
    await _mk_invite(db, token="tok-vencida", expires=datetime.now(timezone.utc) - timedelta(hours=1))
    r = await client.get(f"{API}/auth/invite/tok-vencida")
    assert r.status_code == 400, r.text
