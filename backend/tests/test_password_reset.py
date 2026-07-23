"""Recuperación de contraseña: forgot → token → reset → login con la nueva.
El envío de email se saltea en tests (sin BREVO_API_KEY), pero el token queda en la DB.
"""
import pytest_asyncio
from sqlalchemy import select

from app.core.security import hash_password
from app.models.tenant import Tenant
from app.models.user import User

API = "/api/v1"


@pytest_asyncio.fixture
async def a_user(db):
    t = Tenant(name="Empresa")
    db.add(t)
    await db.flush()
    u = User(
        email="u@test.com",
        hashed_password=hash_password("oldpass123"),
        full_name="U",
        role="admin",
        is_active=True,
        tenant_id=t.id,
    )
    db.add(u)
    await db.flush()
    await db.commit()
    return u


async def test_forgot_password_no_revela_si_existe(client, a_user):
    r1 = await client.post(f"{API}/auth/forgot-password", json={"email": "u@test.com"})
    r2 = await client.post(f"{API}/auth/forgot-password", json={"email": "noexiste@test.com"})
    # Misma respuesta 200 en ambos casos (no filtra si el email existe).
    assert r1.status_code == 200 and r2.status_code == 200


async def test_flujo_completo_de_reset(client, db, a_user):
    r = await client.post(f"{API}/auth/forgot-password", json={"email": "u@test.com"})
    assert r.status_code == 200

    await db.rollback()
    token = (await db.execute(select(User.reset_token).where(User.email == "u@test.com"))).scalar_one()
    assert token, "no se generó el reset_token"

    r = await client.post(f"{API}/auth/reset-password", json={"token": token, "new_password": "newpass123"})
    assert r.status_code == 200
    assert r.json().get("access_token"), "reset debería dejar logueado"

    # La contraseña nueva funciona; la vieja ya no.
    assert (await client.post(f"{API}/auth/login", json={"email": "u@test.com", "password": "newpass123"})).status_code == 200
    assert (await client.post(f"{API}/auth/login", json={"email": "u@test.com", "password": "oldpass123"})).status_code != 200

    # El token es de un solo uso.
    r = await client.post(f"{API}/auth/reset-password", json={"token": token, "new_password": "another123"})
    assert r.status_code == 400


async def test_token_invalido_es_400(client, a_user):
    r = await client.post(f"{API}/auth/reset-password", json={"token": "bogus", "new_password": "newpass123"})
    assert r.status_code == 400
