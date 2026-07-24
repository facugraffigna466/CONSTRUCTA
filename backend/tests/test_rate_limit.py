"""Rate limiting: tras N intentos de login desde la misma IP, el siguiente → 429."""

API = "/api/v1"


async def test_login_se_limita_tras_10_intentos(client, db):
    # Los primeros 10 intentos entran (fallan por credenciales, pero NO por rate limit).
    for _ in range(10):
        r = await client.post(f"{API}/auth/login", json={"email": "brute@x.com", "password": "wrong"})
        assert r.status_code != 429, f"no debería estar limitado aún: {r.status_code}"

    # El 11º supera el límite → 429 con Retry-After.
    r = await client.post(f"{API}/auth/login", json={"email": "brute@x.com", "password": "wrong"})
    assert r.status_code == 429
    assert r.headers.get("Retry-After")


async def test_forgot_password_se_limita(client, db):
    # Límite de forgot: 5 por ventana.
    for _ in range(5):
        r = await client.post(f"{API}/auth/forgot-password", json={"email": "a@x.com"})
        assert r.status_code != 429
    r = await client.post(f"{API}/auth/forgot-password", json={"email": "a@x.com"})
    assert r.status_code == 429
