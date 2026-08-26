"""POST /users/{id}/resend-invite: renueva una invitación pendiente (nuevo token,
nuevo TTL de 72h) sin borrar/reinvitar a mano — auditoría docs/auditoria/09-gestion
-equipo.md, sección 9.3."""
from datetime import datetime, timedelta, timezone

import pytest_asyncio

from app.core.security import create_access_token, hash_password
from app.models.tenant import Tenant
from app.models.tenant_membership import TenantMembership
from app.models.user import User

API = "/api/v1"


async def _mk_tenant(db, name: str) -> Tenant:
    t = Tenant(name=name)
    db.add(t)
    await db.flush()
    return t


async def _mk_admin(db, tenant_id: int) -> User:
    u = User(
        email="admin@a.com", hashed_password=hash_password("x"), full_name="Admin",
        role="admin", is_active=True, tenant_id=tenant_id,
    )
    db.add(u)
    await db.flush()
    db.add(TenantMembership(user_id=u.id, tenant_id=tenant_id, role="admin", is_active=True))
    await db.flush()
    return u


async def _mk_pending(db, tenant_id: int, *, token: str, expires: datetime) -> User:
    u = User(email="pendiente@x.com", hashed_password="", full_name="", tenant_id=tenant_id)
    db.add(u)
    await db.flush()
    # role/is_active/invitation_token/expires_at viven en TenantMembership
    # desde la Fase 3, no en User.
    db.add(TenantMembership(
        user_id=u.id, tenant_id=tenant_id, role="collaborator", is_active=False,
        invitation_token=token, invitation_expires_at=expires,
    ))
    await db.flush()
    return u


@pytest_asyncio.fixture
async def tenant_and_admin(db):
    t = await _mk_tenant(db, "Empresa A")
    admin = await _mk_admin(db, t.id)
    await db.commit()
    return t, admin


async def test_resend_invite_renueva_token_y_ttl(db, client, tenant_and_admin):
    tenant, admin = tenant_and_admin
    pending = await _mk_pending(
        db, tenant.id, token="tok-vieja", expires=datetime.now(timezone.utc) - timedelta(hours=1)
    )
    await db.commit()

    # Con el token viejo (vencido) ya no funciona.
    r0 = await client.get(f"{API}/auth/invite/tok-vieja")
    assert r0.status_code == 400, r0.text

    r = await client.post(
        f"{API}/users/{pending.id}/resend-invite",
        headers={"Authorization": f"Bearer {create_access_token(admin.id)}"},
    )
    assert r.status_code == 200, r.text
    new_token = r.json()["invite_token"]
    assert new_token != "tok-vieja"

    r2 = await client.get(f"{API}/auth/invite/{new_token}")
    assert r2.status_code == 200, r2.text
    assert r2.json()["email"] == "pendiente@x.com"


async def test_resend_invite_bloquea_si_ya_acepto(db, client, tenant_and_admin):
    tenant, admin = tenant_and_admin
    active_user = User(
        email="activo@x.com", hashed_password=hash_password("x"), full_name="Ya Activo",
        role="collaborator", is_active=True, tenant_id=tenant.id,
    )
    db.add(active_user)
    await db.flush()
    db.add(TenantMembership(
        user_id=active_user.id, tenant_id=tenant.id, role="collaborator", is_active=True,
    ))
    await db.flush()
    await db.commit()

    r = await client.post(
        f"{API}/users/{active_user.id}/resend-invite",
        headers={"Authorization": f"Bearer {create_access_token(admin.id)}"},
    )
    assert r.status_code == 409, r.text


async def test_resend_invite_bloquea_cross_tenant(db, client, tenant_and_admin):
    # tenant_and_admin = Empresa A (con admin_a); el pending es de Empresa B —
    # admin_a NO debe poder reenviarle la invitación.
    _empresa_a, admin_a = tenant_and_admin
    empresa_b = await _mk_tenant(db, "Empresa B")
    pending_b = await _mk_pending(
        db, empresa_b.id, token="tok-b", expires=datetime.now(timezone.utc) + timedelta(hours=48)
    )
    await db.commit()

    r = await client.post(
        f"{API}/users/{pending_b.id}/resend-invite",
        headers={"Authorization": f"Bearer {create_access_token(admin_a.id)}"},
    )
    assert r.status_code == 404, r.text
