"""Refresh token: rotación, expiración, logout y no-replay.

Flujo principal: login → refresh → nuevo par de tokens → el token viejo ya no funciona.
"""
import pytest_asyncio
from datetime import datetime, timedelta, timezone
from sqlalchemy import select

from app.core.security import hash_password
from app.models.tenant import Tenant
from app.models.tenant_membership import TenantMembership
from app.models.user import User

API = "/api/v1"


@pytest_asyncio.fixture
async def user_with_tenant(db):
    t = Tenant(name="Empresa Test")
    db.add(t)
    await db.flush()
    u = User(
        email="refresh@test.com",
        hashed_password=hash_password("pass1234"),
        full_name="Test User",
        role="admin",
        is_active=True,
        tenant_id=t.id,
    )
    db.add(u)
    await db.flush()
    db.add(TenantMembership(user_id=u.id, tenant_id=t.id, role="admin", is_active=True))
    await db.flush()
    await db.commit()
    return u


async def test_login_devuelve_access_y_refresh(client, user_with_tenant):
    r = await client.post(f"{API}/auth/login", json={"email": "refresh@test.com", "password": "pass1234"})
    assert r.status_code == 200
    body = r.json()
    assert body.get("access_token"), "debe devolver access_token"
    assert body.get("refresh_token"), "debe devolver refresh_token"


async def test_refresh_devuelve_nuevos_tokens(client, user_with_tenant):
    login_r = await client.post(f"{API}/auth/login", json={"email": "refresh@test.com", "password": "pass1234"})
    old_refresh = login_r.json()["refresh_token"]

    r = await client.post(f"{API}/auth/refresh", json={"refresh_token": old_refresh})
    assert r.status_code == 200
    body = r.json()
    assert body.get("access_token")
    assert body.get("refresh_token")
    # El nuevo refresh token debe ser distinto al anterior (rotación).
    assert body["refresh_token"] != old_refresh


async def test_refresh_invalida_token_anterior(client, db, user_with_tenant):
    """Después de rotar, el token viejo no puede usarse otra vez (anti-replay)."""
    login_r = await client.post(f"{API}/auth/login", json={"email": "refresh@test.com", "password": "pass1234"})
    old_refresh = login_r.json()["refresh_token"]

    # Primer refresh — OK
    await client.post(f"{API}/auth/refresh", json={"refresh_token": old_refresh})

    # Replay del token viejo — debe fallar
    r = await client.post(f"{API}/auth/refresh", json={"refresh_token": old_refresh})
    assert r.status_code == 401


async def test_refresh_token_invalido_es_401(client, user_with_tenant):
    r = await client.post(f"{API}/auth/refresh", json={"refresh_token": "token-inventado"})
    assert r.status_code == 401


async def test_refresh_token_expirado_es_401(client, db, user_with_tenant):
    """Simula un refresh token cuyo expires_at ya pasó."""
    login_r = await client.post(f"{API}/auth/login", json={"email": "refresh@test.com", "password": "pass1234"})
    token_val = login_r.json()["refresh_token"]

    # Vencer el token directamente en la DB (refresh_token vive en la
    # membership desde la Fase 3, no en User).
    await db.rollback()
    membership = (await db.execute(
        select(TenantMembership).where(TenantMembership.refresh_token == token_val)
    )).scalar_one()
    membership.refresh_token_expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    await db.commit()

    r = await client.post(f"{API}/auth/refresh", json={"refresh_token": token_val})
    assert r.status_code == 401


async def test_logout_invalida_refresh_token(client, db, user_with_tenant):
    """Después de logout, el refresh token no puede usarse."""
    login_r = await client.post(f"{API}/auth/login", json={"email": "refresh@test.com", "password": "pass1234"})
    refresh_token = login_r.json()["refresh_token"]

    r = await client.post(f"{API}/auth/logout", json={"refresh_token": refresh_token})
    assert r.status_code == 204

    # El token está invalidado en DB (refresh_token vive en la membership).
    await db.rollback()
    u = (await db.execute(select(User).where(User.email == "refresh@test.com"))).scalar_one()
    membership = (await db.execute(
        select(TenantMembership).where(TenantMembership.user_id == u.id)
    )).scalar_one()
    assert membership.refresh_token is None

    # El endpoint /auth/refresh también lo rechaza.
    r2 = await client.post(f"{API}/auth/refresh", json={"refresh_token": refresh_token})
    assert r2.status_code == 401


async def test_logout_idempotente(client, user_with_tenant):
    """Logout con un token inexistente no debe fallar."""
    r = await client.post(f"{API}/auth/logout", json={"refresh_token": "no-existe"})
    assert r.status_code == 204


async def test_usuario_inactivo_no_puede_refrescar(client, db, user_with_tenant):
    login_r = await client.post(f"{API}/auth/login", json={"email": "refresh@test.com", "password": "pass1234"})
    refresh_token = login_r.json()["refresh_token"]

    # Desactivar la membership (Fase 3: refresh() gatea por membership.is_active).
    await db.rollback()
    membership = (await db.execute(
        select(TenantMembership).where(TenantMembership.refresh_token == refresh_token)
    )).scalar_one()
    membership.is_active = False
    await db.commit()

    r = await client.post(f"{API}/auth/refresh", json={"refresh_token": refresh_token})
    assert r.status_code == 401
