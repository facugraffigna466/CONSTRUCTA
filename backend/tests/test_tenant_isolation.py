"""Aislamiento multi-tenant: un usuario de la empresa B NO puede acceder a los
recursos de una obra de la empresa A. Cada endpoint debe responder 404 (no filtrar
qué ids existen). Este set blinda el 'hardening de autorización' contra regresiones.
"""
import pytest_asyncio

from app.core.security import create_access_token
from app.models.obra import Obra
from app.models.purchase_order import PurchaseOrder, PurchaseOrderItem
from app.models.supplier import Supplier
from app.models.task import Task
from app.models.tenant import Tenant
from app.models.tenant_membership import TenantMembership
from app.models.user import User

API = "/api/v1"


async def _mk_tenant(db, name: str) -> Tenant:
    t = Tenant(name=name)
    db.add(t)
    await db.flush()
    return t


async def _mk_user(db, tenant_id: int, email: str, role: str = "admin") -> User:
    u = User(
        email=email,
        hashed_password="x",
        full_name="Test User",
        role=role,
        is_active=True,
        tenant_id=tenant_id,
    )
    db.add(u)
    await db.flush()
    # Espejo en TenantMembership (Fase 3 rediseño multi-tenant): role/is_active
    # y el aislamiento por tenant en /users se resuelven desde acá.
    db.add(TenantMembership(user_id=u.id, tenant_id=tenant_id, role=role, is_active=True))
    await db.flush()
    return u


@pytest_asyncio.fixture
async def two_tenants(db):
    """Empresa A con obra + tarea; empresa B con un usuario. Devuelve ids y tokens."""
    ta = await _mk_tenant(db, "Empresa A")
    tb = await _mk_tenant(db, "Empresa B")
    ua = await _mk_user(db, ta.id, "a@empresa-a.com")
    ub = await _mk_user(db, tb.id, "b@empresa-b.com")
    collab_b = await _mk_user(db, tb.id, "collab-b@empresa-b.com", role="collaborator")

    obra_a = Obra(name="Obra A", manager_id=ua.id, tenant_id=ta.id)
    db.add(obra_a)
    await db.flush()
    task_a = Task(obra_id=obra_a.id, tenant_id=ta.id, title="Tarea de A")
    db.add(task_a)
    await db.flush()

    # Pedido de compra en 'borrador' de la empresa A (con proveedor) para probar
    # el aislamiento y la idempotencia del envío externo.
    supplier_a = Supplier(tenant_id=ta.id, name="Proveedor A", phone="+540000000000", email="prov-a@x.com")
    db.add(supplier_a)
    await db.flush()
    order_a = PurchaseOrder(obra_id=obra_a.id, supplier_id=supplier_a.id, status="borrador")
    db.add(order_a)
    await db.flush()
    db.add(PurchaseOrderItem(order_id=order_a.id, name="Cemento", quantity=10, unit="bolsa"))
    await db.flush()
    await db.commit()

    return {
        "obra_a": obra_a.id,
        "task_a": task_a.id,
        "user_b": ub.id,
        "collab_b": collab_b.id,
        "order_a": order_a.id,
        "token_a": create_access_token(ua.id),
        "token_b": create_access_token(ub.id),
    }


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# Endpoints de LECTURA por obra/tarea que deben aislar por tenant.
def _cross_tenant_urls(ids: dict) -> list[str]:
    o, t = ids["obra_a"], ids["task_a"]
    return [
        f"{API}/tasks/obra/{o}",
        f"{API}/obras/{o}",
        f"{API}/obras/{o}/historial",
        f"{API}/exports/obras/{o}/excel",
        f"{API}/obras/{o}/calendar",
        f"{API}/obras/{o}/planos",
        f"{API}/obras/{o}/team",
        f"{API}/obras/{o}/baseline",
        f"{API}/tasks/{t}/materials",
        f"{API}/obras/{o}/solicitudes-cotizacion",
        f"{API}/obras/{o}/presupuesto",
        f"{API}/obras/{o}/purchase-orders",
    ]


async def test_cross_tenant_reads_return_404(client, two_tenants):
    """Usuario de la empresa B → recursos de la empresa A → 404 (no 200, no 403 con datos)."""
    ids = two_tenants
    leaks = []
    for url in _cross_tenant_urls(ids):
        r = await client.get(url, headers=_auth(ids["token_b"]))
        if r.status_code != 404:
            leaks.append(f"{url} → {r.status_code}")
    assert not leaks, "Fugas cross-tenant (deberían ser 404):\n" + "\n".join(leaks)


async def test_same_tenant_access_still_works(client, two_tenants):
    """No rompimos el acceso legítimo: el usuario de A sí ve su propia obra/tareas."""
    ids = two_tenants
    r = await client.get(f"{API}/tasks/obra/{ids['obra_a']}", headers=_auth(ids["token_a"]))
    assert r.status_code == 200, f"Acceso legítimo roto: {r.status_code} — {r.text[:200]}"
    r = await client.get(f"{API}/obras/{ids['obra_a']}", headers=_auth(ids["token_a"]))
    assert r.status_code == 200


async def test_cross_tenant_task_mutation_blocked(client, two_tenants):
    """Un usuario de B no puede crear una tarea en una obra de A."""
    ids = two_tenants
    r = await client.post(
        f"{API}/tasks",
        headers=_auth(ids["token_b"]),
        json={"obra_id": ids["obra_a"], "title": "Tarea intrusa"},
    )
    assert r.status_code == 404, f"Mutación cross-tenant permitida: {r.status_code}"


async def test_cross_tenant_material_mutation_blocked(client, two_tenants):
    """B no puede agregar materiales a una tarea de A (guard task→obra→tenant)."""
    ids = two_tenants
    r = await client.post(
        f"{API}/tasks/{ids['task_a']}/materials",
        headers=_auth(ids["token_b"]),
        json={"name": "Cemento intruso"},
    )
    assert r.status_code == 404, f"Material cross-tenant permitido: {r.status_code}"


async def test_cross_tenant_task_delete_blocked(client, two_tenants):
    """B no puede borrar una tarea de A; la tarea sigue viva para A."""
    ids = two_tenants
    r = await client.delete(f"{API}/tasks/{ids['task_a']}", headers=_auth(ids["token_b"]))
    assert r.status_code == 404, f"Borrado cross-tenant permitido: {r.status_code}"
    # La tarea de A no fue borrada
    r2 = await client.get(f"{API}/tasks/obra/{ids['obra_a']}", headers=_auth(ids["token_a"]))
    assert r2.status_code == 200
    assert any(t["id"] == ids["task_a"] for t in r2.json()), "Un usuario de B borró la tarea de A"


async def test_same_tenant_writes_still_work(client, two_tenants):
    """No sobre-restringimos: A sí puede escribir materiales en su propia tarea."""
    ids = two_tenants
    r = await client.post(
        f"{API}/tasks/{ids['task_a']}/materials",
        headers=_auth(ids["token_a"]),
        json={"name": "Cemento"},
    )
    assert r.status_code == 201, f"Escritura legítima rota: {r.status_code} — {r.text[:200]}"


# --- Gestión de miembros: un admin solo opera sobre usuarios de SU empresa ---

async def test_cross_tenant_role_change_blocked(client, two_tenants):
    """Admin de A no puede cambiar el rol de un miembro de B → 404 (no filtra existencia)."""
    ids = two_tenants
    r = await client.patch(
        f"{API}/users/{ids['collab_b']}/role",
        headers=_auth(ids["token_a"]),
        json={"role": "admin"},
    )
    assert r.status_code == 404, f"Cambio de rol cross-tenant permitido: {r.status_code}"


async def test_cross_tenant_member_delete_blocked(client, two_tenants):
    """Admin de A no puede eliminar a un miembro de B; el miembro sigue existiendo para B."""
    ids = two_tenants
    r = await client.delete(f"{API}/users/{ids['collab_b']}", headers=_auth(ids["token_a"]))
    assert r.status_code == 404, f"Borrado cross-tenant de usuario permitido: {r.status_code}"
    r2 = await client.get(f"{API}/users", headers=_auth(ids["token_b"]))
    assert r2.status_code == 200
    assert any(u["id"] == ids["collab_b"] for u in r2.json()), "Admin de A borró un usuario de B"


async def test_same_tenant_role_change_still_works(client, two_tenants):
    """No sobre-restringimos: admin de B sí puede promover a su propio colaborador."""
    ids = two_tenants
    r = await client.patch(
        f"{API}/users/{ids['collab_b']}/role",
        headers=_auth(ids["token_b"]),
        json={"role": "admin"},
    )
    assert r.status_code == 200, f"Cambio de rol legítimo roto: {r.status_code} — {r.text[:200]}"


# --- Compras: aislamiento de tenant + idempotencia del envío externo ---

async def test_cross_tenant_order_send_blocked(client, two_tenants):
    """B no puede enviar al proveedor un pedido de A → 404 (no dispara WhatsApp/email ajeno)."""
    ids = two_tenants
    r = await client.post(
        f"{API}/purchase-orders/{ids['order_a']}/send",
        headers=_auth(ids["token_b"]),
        json={"channel": "whatsapp"},
    )
    assert r.status_code == 404, f"Envío cross-tenant permitido: {r.status_code}"


async def test_cross_tenant_order_receive_blocked(client, two_tenants):
    """B no puede marcar recibido un pedido de A → 404."""
    ids = two_tenants
    r = await client.post(
        f"{API}/purchase-orders/{ids['order_a']}/receive",
        headers=_auth(ids["token_b"]),
    )
    assert r.status_code == 404, f"Recepción cross-tenant permitida: {r.status_code}"


async def test_order_send_is_idempotent(client, two_tenants):
    """A envía su pedido (200); un segundo envío (doble click / reintento) → 409, sin duplicar."""
    ids = two_tenants
    r1 = await client.post(
        f"{API}/purchase-orders/{ids['order_a']}/send",
        headers=_auth(ids["token_a"]),
        json={"channel": "whatsapp"},
    )
    assert r1.status_code == 200, f"Envío legítimo roto: {r1.status_code} — {r1.text[:200]}"
    assert r1.json()["status"] == "enviado"
    r2 = await client.post(
        f"{API}/purchase-orders/{ids['order_a']}/send",
        headers=_auth(ids["token_a"]),
        json={"channel": "whatsapp"},
    )
    assert r2.status_code == 409, f"Reenvío no bloqueado (no idempotente): {r2.status_code}"
