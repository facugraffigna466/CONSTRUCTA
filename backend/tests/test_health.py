"""Health check: verifica que la app responde y que la DB está accesible."""


async def test_health_ok_con_db(client):
    r = await client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["db"] == "ok"
