"""Una identidad, dos empresas (Fase 3 rediseño multi-tenant).

Cubre el escenario que motivó el rediseño: alguien ya registrado en la
Empresa A puede ser invitado a la Empresa B con el mismo email, aceptar
confirmando su contraseña existente (sin crear una cuenta nueva), y el login
posterior le ofrece elegir en cuál de las dos entrar — cada una con su propia
sesión y aislamiento de datos.
"""
from app.core.security import create_access_token, hash_password
from app.models.tenant import Tenant
from app.models.tenant_membership import TenantMembership
from app.models.user import User

API = "/api/v1"


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _mk_tenant_admin(db, tenant_name: str, email: str, password: str) -> tuple[Tenant, User]:
    t = Tenant(name=tenant_name)
    db.add(t)
    await db.flush()
    u = User(email=email, hashed_password=hash_password(password), full_name="Admin", tenant_id=t.id)
    db.add(u)
    await db.flush()
    db.add(TenantMembership(user_id=u.id, tenant_id=t.id, role="admin", is_active=True))
    await db.flush()
    return t, u


async def test_invite_no_tira_409_si_el_email_ya_existe_en_otro_tenant(db, client):
    """El bug original: invitar un email que ya tiene cuenta en otra empresa
    debe funcionar (sumar una membership), no rebotar con 409."""
    tenant_a, admin_a = await _mk_tenant_admin(db, "Empresa A", "persona@x.com", "claveA123")
    tenant_b, admin_b = await _mk_tenant_admin(db, "Empresa B", "admin_b@x.com", "claveB123")
    await db.commit()

    r = await client.post(
        f"{API}/users/invite",
        json={"email": "persona@x.com", "role": "collaborator"},
        headers=_auth(create_access_token(admin_b.id, tenant_id=tenant_b.id)),
    )
    assert r.status_code == 201, r.text


async def test_flujo_completo_misma_persona_dos_empresas(db, client):
    tenant_a, persona = await _mk_tenant_admin(db, "Empresa A", "persona@x.com", "claveA123")
    tenant_b, admin_b = await _mk_tenant_admin(db, "Empresa B", "admin_b@x.com", "claveB123")
    await db.commit()

    # 1. Empresa B invita al email que ya es admin de Empresa A.
    inv = await client.post(
        f"{API}/users/invite",
        json={"email": "persona@x.com", "role": "collaborator"},
        headers=_auth(create_access_token(admin_b.id, tenant_id=tenant_b.id)),
    )
    assert inv.status_code == 201, inv.text
    token = inv.json()["invite_token"]

    # 2. El contexto de la invitación avisa que ya existe cuenta (no pide crear una).
    ctx = await client.get(f"{API}/auth/invite/{token}")
    assert ctx.status_code == 200, ctx.text
    assert ctx.json()["existing_account"] is True
    assert ctx.json()["company_name"] == "Empresa B"

    # 3. Aceptar confirmando la contraseña EXISTENTE (no una nueva) — sin full_name.
    acc = await client.post(
        f"{API}/auth/accept-invite",
        json={"token": token, "password": "claveA123"},
    )
    assert acc.status_code == 200, acc.text
    assert acc.json().get("access_token"), "accept-invite debe dejar logueado en Empresa B"

    # 4. Login ahora resuelve DOS empresas activas — pide elegir, no tira tokens.
    login = await client.post(
        f"{API}/auth/login", json={"email": "persona@x.com", "password": "claveA123"}
    )
    assert login.status_code == 200, login.text
    body = login.json()
    assert body["requires_tenant_selection"] is True
    assert body.get("access_token") is None
    tenant_names = {t["name"] for t in body["tenants"]}
    assert tenant_names == {"Empresa A", "Empresa B"}

    # 5. Elegir Empresa B via /auth/select-tenant con el pre_auth_token.
    tenant_b_id = next(t["id"] for t in body["tenants"] if t["name"] == "Empresa B")
    sel = await client.post(
        f"{API}/auth/select-tenant",
        json={"pre_auth_token": body["pre_auth_token"], "tenant_id": tenant_b_id},
    )
    assert sel.status_code == 200, sel.text
    access_b = sel.json()["access_token"]

    # 6. La sesión de Empresa B ve solo Empresa B.
    me_b = await client.get(f"{API}/users/me", headers=_auth(access_b))
    assert me_b.status_code == 200
    assert me_b.json()["tenant_name"] == "Empresa B"

    # 7. Y la contraseña sigue siendo la MISMA en ambas empresas (una sola identidad).
    login_a_still_pending = await client.post(
        f"{API}/auth/login", json={"email": "persona@x.com", "password": "claveA123"}
    )
    assert login_a_still_pending.status_code == 200
    assert login_a_still_pending.json()["requires_tenant_selection"] is True


async def test_pre_auth_token_no_sirve_como_bearer_de_sesion(db, client):
    """El pre_auth_token (emitido cuando hay que elegir empresa) no debe
    funcionar como token de sesión normal en ningún endpoint autenticado."""
    tenant_a, persona = await _mk_tenant_admin(db, "Empresa A", "dos@x.com", "clave123")
    tenant_b, admin_b = await _mk_tenant_admin(db, "Empresa B", "admin2@x.com", "clave456")
    await db.commit()
    inv = await client.post(
        f"{API}/users/invite",
        json={"email": "dos@x.com", "role": "collaborator"},
        headers=_auth(create_access_token(admin_b.id, tenant_id=tenant_b.id)),
    )
    token = inv.json()["invite_token"]
    await client.post(f"{API}/auth/accept-invite", json={"token": token, "password": "clave123"})

    login = await client.post(f"{API}/auth/login", json={"email": "dos@x.com", "password": "clave123"})
    pre_auth = login.json()["pre_auth_token"]

    r = await client.get(f"{API}/users/me", headers=_auth(pre_auth))
    assert r.status_code == 401


async def test_remove_member_no_borra_la_identidad_de_otro_tenant(db, client):
    """Sacar a alguien de la Empresa B no debe afectar su acceso a la Empresa A."""
    tenant_a, persona = await _mk_tenant_admin(db, "Empresa A", "multi@x.com", "clave123")
    tenant_b, admin_b = await _mk_tenant_admin(db, "Empresa B", "adminB@x.com", "clave456")
    await db.commit()

    inv = await client.post(
        f"{API}/users/invite",
        json={"email": "multi@x.com", "role": "collaborator"},
        headers=_auth(create_access_token(admin_b.id, tenant_id=tenant_b.id)),
    )
    token = inv.json()["invite_token"]
    await client.post(f"{API}/auth/accept-invite", json={"token": token, "password": "clave123"})

    r = await client.delete(
        f"{API}/users/{persona.id}",
        headers=_auth(create_access_token(admin_b.id, tenant_id=tenant_b.id)),
    )
    assert r.status_code == 204, r.text

    # La identidad sigue intacta y con acceso pleno a Empresa A.
    login_a = await client.post(
        f"{API}/auth/login", json={"email": "multi@x.com", "password": "clave123"}
    )
    assert login_a.status_code == 200
    assert login_a.json().get("access_token"), "debe seguir pudiendo entrar a Empresa A"
