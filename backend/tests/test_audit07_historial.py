"""Remediación de docs/auditoria/07-historial.md (módulo Historial).

Cubre los hallazgos que seguían abiertos (ningún commit anterior tocaba
"historial" ni "audit.?07"):
- 7.1/8.1: obra eliminada → historial permanentemente inaccesible.
- 7.3/8.2: responsables/baseline sin ningún rastro en historial.
- 7.4/8.4: import MS Project XML generaba un task_created por fila.
- 7.7/8.6: descripciones en inglés.
- 7.8/8.7: alert_created faltante para ORDER_RECEIVED.
"""
from datetime import date

import pytest_asyncio
from sqlalchemy import select

from app.core.security import create_access_token, hash_password
from app.models.historial import HistorialEvento
from app.models.obra import Obra
from app.models.tenant import Tenant
from app.models.user import User
from app.repositories.historial import HistorialRepository
from app.schemas.responsible import ResponsibleCreate
from app.services.obra_service import ObraService
from app.services.responsible_service import ResponsibleService

API = "/api/v1"


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _mk_admin(db, tenant_id: int, email: str) -> User:
    u = User(
        email=email, hashed_password=hash_password("x"), full_name="Admin",
        role="admin", is_active=True, tenant_id=tenant_id,
    )
    db.add(u)
    await db.flush()
    return u


@pytest_asyncio.fixture
async def tenant_ctx(db):
    tenant = Tenant(name="Empresa Historial")
    db.add(tenant)
    await db.flush()
    admin = await _mk_admin(db, tenant.id, "admin@historial.com")
    obra = Obra(name="Obra H", manager_id=admin.id, tenant_id=tenant.id)
    db.add(obra)
    await db.flush()
    await db.commit()
    return tenant, admin, obra


# ── 7.1/8.1 — obra eliminada ────────────────────────────────────────────────

async def test_obra_deleted_logs_snapshot_event(db, tenant_ctx):
    """El evento se loguea ANTES del borrado (mismo patrón que task_deleted),
    con el snapshot todavía válido. Qué le pasa después a `obra_id` es un
    comportamiento de ondelete=SET NULL a nivel de motor de base — SQLite en
    los tests no lo ejecuta sin PRAGMA foreign_keys=ON (a diferencia de la
    Postgres real), así que no se testea acá; ver test_global_historial_*
    para la recuperación post-cascade."""
    tenant, admin, obra = tenant_ctx
    obra_name = obra.name

    actor = {"id": admin.id, "name": admin.full_name, "role": "admin", "channel": "web"}
    await ObraService(db).delete(obra.id, admin.id, actor=actor)

    events = (await db.execute(
        select(HistorialEvento).where(HistorialEvento.event_type == "obra_deleted")
    )).scalars().all()
    assert len(events) == 1
    ev = events[0]
    assert ev.tenant_id == tenant.id
    assert ev.payload["name"] == obra_name
    assert obra_name in ev.description


async def test_global_historial_returns_orphaned_obra_deleted_event(db, client, tenant_ctx):
    """Simula el estado post-cascade (obra_id=NULL, tenant_id intacto) que
    produce ondelete=SET NULL en Postgres real, y confirma que el endpoint
    de recuperación los encuentra."""
    tenant, admin, _obra = tenant_ctx
    await HistorialRepository(db).log(
        event_type="obra_deleted", description="Alguien eliminó la obra 'Obra H'.",
        obra_id=None, tenant_id=tenant.id, triggered_by="user",
    )
    await db.commit()

    r = await client.get(f"{API}/obras/historial/global", headers=_auth(create_access_token(admin.id)))
    assert r.status_code == 200, r.text
    types = [ev["event_type"] for ev in r.json()]
    assert "obra_deleted" in types


async def test_global_historial_scoped_to_tenant(db, client, tenant_ctx):
    tenant, admin, _obra = tenant_ctx
    await HistorialRepository(db).log(
        event_type="obra_deleted", description="Eliminada", obra_id=None,
        tenant_id=tenant.id, triggered_by="user",
    )

    otro_tenant = Tenant(name="Otra Empresa H")
    db.add(otro_tenant)
    await db.flush()
    otro_admin = await _mk_admin(db, otro_tenant.id, "admin@otrah.com")
    await db.commit()

    r = await client.get(f"{API}/obras/historial/global", headers=_auth(create_access_token(otro_admin.id)))
    assert r.status_code == 200, r.text
    assert r.json() == []  # no ve el obra_deleted del otro tenant


async def test_global_historial_requires_admin(db, client, tenant_ctx):
    """AdminUser dep — un collaborator no puede ver la actividad de la empresa."""
    tenant, _admin, _obra = tenant_ctx
    collab = User(
        email="collab@historial.com", hashed_password=hash_password("x"), full_name="Collab",
        role="collaborator", is_active=True, tenant_id=tenant.id,
    )
    db.add(collab)
    await db.flush()
    await db.commit()

    r = await client.get(f"{API}/obras/historial/global", headers=_auth(create_access_token(collab.id)))
    assert r.status_code == 403


# ── 7.3/8.2 — responsables y baseline ───────────────────────────────────────

async def test_responsible_crud_logs_historial_events(db, client, tenant_ctx):
    tenant, admin, _obra = tenant_ctx
    headers = _auth(create_access_token(admin.id))

    r = await client.post(
        f"{API}/responsibles", headers=headers,
        json={"full_name": "Juan Pérez", "whatsapp_number": "+5491112345678"},
    )
    assert r.status_code == 201, r.text
    resp_id = r.json()["id"]

    r2 = await client.patch(
        f"{API}/responsibles/{resp_id}", headers=headers, json={"role": "Electricista"},
    )
    assert r2.status_code == 200, r2.text

    r3 = await client.delete(f"{API}/responsibles/{resp_id}", headers=headers)
    assert r3.status_code == 200, r3.text

    r4 = await client.patch(f"{API}/responsibles/{resp_id}/reactivate", headers=headers)
    assert r4.status_code == 200, r4.text

    events = (await db.execute(
        select(HistorialEvento).where(HistorialEvento.tenant_id == tenant.id)
    )).scalars().all()
    types = {ev.event_type for ev in events}
    assert "responsible_created" in types
    assert "responsible_updated" in types
    assert "responsible_reactivated" in types
    # Todos con obra_id=None (directorio global) pero tenant_id resuelto.
    created = next(ev for ev in events if ev.event_type == "responsible_created")
    assert created.obra_id is None
    assert created.tenant_id == tenant.id


async def test_baseline_save_logs_historial_event(db, client, tenant_ctx):
    _tenant, admin, obra = tenant_ctx
    headers = _auth(create_access_token(admin.id))

    r = await client.post(
        f"{API}/tasks", headers=headers,
        json={"obra_id": obra.id, "title": "Tarea baseline", "start_date": str(date.today())},
    )
    assert r.status_code == 201, r.text

    r2 = await client.post(f"{API}/obras/{obra.id}/baseline", headers=headers)
    assert r2.status_code == 201, r2.text

    events = (await db.execute(
        select(HistorialEvento).where(
            HistorialEvento.obra_id == obra.id, HistorialEvento.event_type == "baseline_saved"
        )
    )).scalars().all()
    assert len(events) == 1
    assert events[0].payload["task_count"] == 1


# ── 7.4/8.4 — import MS Project XML: un solo evento agregado ───────────────

async def test_msproject_import_logs_single_aggregate_event(db, client, tenant_ctx):
    _tenant, admin, obra = tenant_ctx
    headers = _auth(create_access_token(admin.id))

    rows = [
        {"row_index": 0, "title": "Tarea A", "start_date": None, "due_date": None,
         "responsible_name": None, "depends_on_row": None, "is_milestone": False,
         "warning": None, "error": None},
        {"row_index": 1, "title": "Tarea B", "start_date": None, "due_date": None,
         "responsible_name": None, "depends_on_row": None, "is_milestone": False,
         "warning": None, "error": None},
    ]
    r = await client.post(
        f"{API}/imports/project-excel/confirm", headers=headers,
        json={"obra_id": obra.id, "rows": rows, "source": "msproject"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["created"] == 2

    events = (await db.execute(
        select(HistorialEvento).where(HistorialEvento.obra_id == obra.id)
    )).scalars().all()
    aggregate = [e for e in events if e.event_type == "tasks_imported_from_msproject"]
    individual = [e for e in events if e.event_type == "task_created"]
    assert len(aggregate) == 1
    assert aggregate[0].payload["count"] == 2
    assert individual == []  # silent=True suprimió los eventos por fila


# ── 7.8/8.7 — ORDER_RECEIVED sin alert_created ──────────────────────────────

async def test_purchase_order_receive_logs_alert_created(db, client, tenant_ctx):
    from app.models.purchase_order import PurchaseOrder

    _tenant, admin, obra = tenant_ctx
    order = PurchaseOrder(obra_id=obra.id, status="enviado")
    db.add(order)
    await db.flush()
    await db.commit()

    headers = _auth(create_access_token(admin.id))
    r = await client.post(f"{API}/purchase-orders/{order.id}/receive", headers=headers)
    assert r.status_code == 200, r.text

    events = (await db.execute(
        select(HistorialEvento).where(
            HistorialEvento.obra_id == obra.id, HistorialEvento.event_type == "alert_created"
        )
    )).scalars().all()
    assert any(e.payload and e.payload.get("alert_type") == "order_received" for e in events)


# ── 7.7/8.6 — descripciones en español ──────────────────────────────────────

async def test_task_created_description_is_spanish(db, tenant_ctx):
    from app.schemas.task import TaskCreate
    from app.services.task_service import TaskService

    _tenant, admin, obra = tenant_ctx
    task = await TaskService(db).create(
        TaskCreate(obra_id=obra.id, title="Tarea en español"), manager_id=admin.id,
    )

    ev = (await db.execute(
        select(HistorialEvento).where(
            HistorialEvento.task_id == task.id, HistorialEvento.event_type == "task_created"
        )
    )).scalar_one()
    assert "creada" in ev.description
    assert "created" not in ev.description


async def test_obra_updated_description_is_readable(db, client, tenant_ctx):
    _tenant, admin, obra = tenant_ctx
    r = await client.patch(
        f"{API}/obras/{obra.id}", headers=_auth(create_access_token(admin.id)),
        json={"name": "Obra H renombrada"},
    )
    assert r.status_code == 200, r.text

    ev = (await db.execute(
        select(HistorialEvento).where(
            HistorialEvento.obra_id == obra.id, HistorialEvento.event_type == "obra_updated"
        )
    )).scalar_one()
    assert "['name']" not in ev.description  # ya no es repr() de una lista Python
    assert "name" in ev.description


# ── real-time (8.5) — smoke test: log() no rompe cuando emit_historial_created corre ──

async def test_log_with_explicit_tenant_id_and_no_obra(db, tenant_ctx):
    """Cobertura directa del repo: obra_id=None + tenant_id explícito no debe
    intentar derivarlo con tenant_for_obra() (que devolvería None)."""
    tenant, _admin, _obra = tenant_ctx
    event = await HistorialRepository(db).log(
        event_type="responsible_created",
        description="Test",
        obra_id=None,
        tenant_id=tenant.id,
        triggered_by="user",
    )
    assert event.tenant_id == tenant.id
    assert event.obra_id is None
