"""Verificación de email: register crea un usuario sin verificar + token; /verify-email lo marca."""
from sqlalchemy import select

from app.models.user import User

API = "/api/v1"


async def test_register_sin_verificar_y_verify_funciona(client, db):
    r = await client.post(
        f"{API}/auth/register",
        json={"email": "new@x.com", "password": "pass1234", "full_name": "New User"},
    )
    assert r.status_code == 201
    assert r.json()["is_verified"] is False

    # El token queda en la DB (el email no se manda en tests).
    await db.rollback()
    token = (await db.execute(select(User.verification_token).where(User.email == "new@x.com"))).scalar_one()
    assert token

    r = await client.post(f"{API}/auth/verify-email", json={"token": token})
    assert r.status_code == 200

    await db.rollback()
    row = (await db.execute(
        select(User.is_verified, User.verification_token).where(User.email == "new@x.com")
    )).one()
    assert row.is_verified is True
    assert row.verification_token is None

    # Token de un solo uso.
    r = await client.post(f"{API}/auth/verify-email", json={"token": token})
    assert r.status_code == 400


async def test_verify_token_invalido_es_400(client, db):
    r = await client.post(f"{API}/auth/verify-email", json={"token": "bogus"})
    assert r.status_code == 400
