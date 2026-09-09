"""Aislamiento multi-tenant: un usuario de la empresa B NO puede acceder a los
recursos de una obra de la empresa A. Cada endpoint debe responder 404 (no filtrar
qué ids existen). Este set blinda el 'hardening de autorización' contra regresiones.
"""
import pytest_asyncio

from app.core.security import create_access_token
from app.models.obra import Obra
from app.models.purchase_order import PurchaseOrder, PurchaseOrderItem
from app.models.solicitud_cotizacion import SolicitudCotizacion
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

    # Obra de B (ub es admin de B, así que assert_obra_access la deja pasar sin
    # necesitar una fila de ObraUserRole) + una solicitud de cotización por obra,
    # para probar confirmar_contratista() (auto-crea Supplier).
    obra_b = Obra(name="Obra B", manager_id=ub.id, tenant_id=tb.id)
    db.add(obra_b)
    await db.flush()
    sol_a = SolicitudCotizacion(obra_id=obra_a.id, tenant_id=ta.id, ref_code="COT-01")
    sol_b = SolicitudCotizacion(obra_id=obra_b.id, tenant_id=tb.id, ref_code="COT-01")
    db.add(sol_a)
    db.add(sol_b)
    await db.flush()
    await db.commit()

    return {
        "obra_a": obra_a.id,
        "obra_b": obra_b.id,
        "task_a": task_a.id,
        "user_b": ub.id,
        "collab_b": collab_b.id,
        "order_a": order_a.id,
        "supplier_a": supplier_a.id,
        "sol_a": sol_a.id,
        "sol_b": sol_b.id,
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


async def test_cross_tenant_supplier_list_isolated(client, two_tenants):
    """El listado de proveedores de B no debe traer proveedores de A."""
    ids = two_tenants
    r = await client.get(f"{API}/suppliers", headers=_auth(ids["token_b"]))
    assert r.status_code == 200
    assert not any(s["id"] == ids["supplier_a"] for s in r.json()), (
        "Fuga cross-tenant: B ve un proveedor de A en /suppliers"
    )


async def test_cross_tenant_supplier_mutation_blocked(client, two_tenants):
    """Admin de B no puede editar ni borrar un proveedor de A → 404 (no filtra existencia)."""
    ids = two_tenants
    r = await client.patch(
        f"{API}/suppliers/{ids['supplier_a']}",
        headers=_auth(ids["token_b"]),
        json={"name": "Secuestrado"},
    )
    assert r.status_code == 404, f"Edición cross-tenant de proveedor permitida: {r.status_code}"

    r = await client.delete(f"{API}/suppliers/{ids['supplier_a']}", headers=_auth(ids["token_b"]))
    assert r.status_code == 404, f"Borrado cross-tenant de proveedor permitido: {r.status_code}"


async def test_same_tenant_supplier_access_still_works(client, two_tenants):
    """No sobre-restringimos: A sí ve y puede editar su propio proveedor."""
    ids = two_tenants
    r = await client.get(f"{API}/suppliers", headers=_auth(ids["token_a"]))
    assert r.status_code == 200
    assert any(s["id"] == ids["supplier_a"] for s in r.json())

    r = await client.patch(
        f"{API}/suppliers/{ids['supplier_a']}",
        headers=_auth(ids["token_a"]),
        json={"name": "Proveedor A renombrado"},
    )
    assert r.status_code == 200, f"Edición legítima rota: {r.status_code} — {r.text[:200]}"


async def test_cross_tenant_contratista_confirm_creates_separate_supplier(client, two_tenants):
    """confirmar_contratista() auto-crea un Supplier. Con el mismo nombre/teléfono,
    A y B no deben terminar compartiendo el mismo registro ni mezclando pedidos."""
    ids = two_tenants
    payload = {"supplier_name": "Contratista Compartido", "supplier_phone": "+549111111111"}

    r_a = await client.post(
        f"{API}/solicitudes-cotizacion/{ids['sol_a']}/confirmar-contratista",
        headers=_auth(ids["token_a"]),
        json=payload,
    )
    assert r_a.status_code == 201, f"Confirmación legítima de A rota: {r_a.status_code} — {r_a.text[:200]}"
    supplier_id_a = r_a.json()["supplier_id"]

    r_b = await client.post(
        f"{API}/solicitudes-cotizacion/{ids['sol_b']}/confirmar-contratista",
        headers=_auth(ids["token_b"]),
        json=payload,
    )
    assert r_b.status_code == 201, f"Confirmación legítima de B rota: {r_b.status_code} — {r_b.text[:200]}"
    supplier_id_b = r_b.json()["supplier_id"]

    assert supplier_id_a != supplier_id_b, (
        "Fuga cross-tenant: A y B terminaron con el mismo Supplier auto-creado"
    )


async def test_same_tenant_contratista_confirm_reuses_supplier(client, db, two_tenants):
    """Dentro del mismo tenant, confirmar dos veces el mismo contratista sí reutiliza el Supplier."""
    ids = two_tenants
    payload = {"supplier_name": "Contratista Repetido", "supplier_phone": "+549222222222"}

    r1 = await client.post(
        f"{API}/solicitudes-cotizacion/{ids['sol_a']}/confirmar-contratista",
        headers=_auth(ids["token_a"]),
        json=payload,
    )
    assert r1.status_code == 201
    supplier_id_1 = r1.json()["supplier_id"]

    # Segunda solicitud de la misma obra (ref_code distinto por la unicidad
    # (obra_id, ref_code)), creada directo en DB — lo que se prueba acá es la
    # reutilización del Supplier, no el endpoint de creación de solicitudes.
    obra_a = await db.get(Obra, ids["obra_a"])
    sol_a2 = SolicitudCotizacion(obra_id=obra_a.id, tenant_id=obra_a.tenant_id, ref_code="COT-02")
    db.add(sol_a2)
    await db.commit()

    r2 = await client.post(
        f"{API}/solicitudes-cotizacion/{sol_a2.id}/confirmar-contratista",
        headers=_auth(ids["token_a"]),
        json=payload,
    )
    assert r2.status_code == 201
    assert r2.json()["supplier_id"] == supplier_id_1, "No reutilizó el Supplier existente del mismo tenant"


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
