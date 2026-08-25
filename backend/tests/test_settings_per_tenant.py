"""SystemSettings pasa de 1 fila por manager a 1 fila por tenant, y los 4
toggles de la sección Alertas dejan de ser decorativos (docs/auditoria/
11-panel-configuracion.md, hallazgos 1, 2 y 3)."""
from datetime import date, timedelta

import pytest_asyncio

from app.core.security import create_access_token, hash_password
from app.models.alert import Alert, AlertType
from app.models.obra import Obra
from app.models.task import Task, TaskStatus
from app.models.tenant import Tenant
from app.models.user import User
from sqlalchemy import select

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
async def two_admins_same_tenant(db):
    """Dos admins de LA MISMA empresa — antes cada uno tenía su propia config
    de chatbot; ahora comparten una sola."""
    tenant = Tenant(name="Empresa Compartida")
    db.add(tenant)
    await db.flush()
    admin_a = await _mk_admin(db, tenant.id, "a@compartida.com")
    admin_b = await _mk_admin(db, tenant.id, "b@compartida.com")
    await db.commit()
    return tenant, admin_a, admin_b


async def test_settings_son_compartidos_dentro_del_tenant(client, two_admins_same_tenant):
    _tenant, admin_a, admin_b = two_admins_same_tenant

    # Admin A cambia el horario de envío.
    r = await client.patch(
        f"{API}/settings", json={"send_hour_from": 6, "send_hour_to": 22},
        headers=_auth(create_access_token(admin_a.id)),
    )
    assert r.status_code == 200, r.text

    # Admin B (mismo tenant) ve el cambio — antes tenía su propia fila con
    # los defaults (8-20), sin ninguna relación con lo que configuró A.
    r2 = await client.get(f"{API}/settings", headers=_auth(create_access_token(admin_b.id)))
    assert r2.status_code == 200, r2.text
    body = r2.json()
    assert body["send_hour_from"] == 6
    assert body["send_hour_to"] == 22


async def test_settings_no_se_filtran_entre_tenants_distintos(db, client, two_admins_same_tenant):
    tenant_a, admin_a, _ = two_admins_same_tenant
    tenant_b = Tenant(name="Empresa B")
    db.add(tenant_b)
    await db.flush()
    admin_c = await _mk_admin(db, tenant_b.id, "c@empresab.com")
    await db.commit()

    await client.patch(
        f"{API}/settings", json={"send_hour_from": 5},
        headers=_auth(create_access_token(admin_a.id)),
    )
    r = await client.get(f"{API}/settings", headers=_auth(create_access_token(admin_c.id)))
    assert r.status_code == 200, r.text
    # Empresa B nunca tocó nada — sigue en el default (8), no hereda lo de A.
    assert r.json()["send_hour_from"] == 8


@pytest_asyncio.fixture
async def obra_con_tarea_vencida(db):
    tenant = Tenant(name="Empresa Vencidos")
    db.add(tenant)
    await db.flush()
    admin = await _mk_admin(db, tenant.id, "admin@vencidos.com")
    obra = Obra(name="Obra V", manager_id=admin.id, tenant_id=tenant.id)
    db.add(obra)
    await db.flush()
    task = Task(
        obra_id=obra.id, tenant_id=tenant.id, title="Tarea vieja",
        status=TaskStatus.PENDIENTE, due_date=date.today() - timedelta(days=3),
    )
    db.add(task)
    await db.flush()
    await db.commit()
    return tenant, admin, obra, task


async def test_simulate_overdue_no_toca_otros_tenants(db, client, obra_con_tarea_vencida):
    """El endpoint de testing /settings/simulate-overdue solo debe generar
    alertas para el tenant del admin que lo dispara — antes procesaba TODAS
    las tareas vencidas del sistema."""
    _tenant, admin, _obra, task = obra_con_tarea_vencida

    otro_tenant = Tenant(name="Otra Empresa")
    db.add(otro_tenant)
    await db.flush()
    otro_admin = await _mk_admin(db, otro_tenant.id, "admin@otra.com")
    otra_obra = Obra(name="Obra Otra", manager_id=otro_admin.id, tenant_id=otro_tenant.id)
    db.add(otra_obra)
    await db.flush()
    otra_tarea = Task(
        obra_id=otra_obra.id, tenant_id=otro_tenant.id, title="Tarea de otra empresa",
        status=TaskStatus.PENDIENTE, due_date=date.today() - timedelta(days=5),
    )
    db.add(otra_tarea)
    await db.flush()
    await db.commit()

    r = await client.post(
        f"{API}/settings/simulate-overdue", headers=_auth(create_access_token(admin.id))
    )
    assert r.status_code == 200, r.text
    assert r.json()["alerts_created"] == 1

    alerts = (await db.execute(select(Alert))).scalars().all()
    assert len(alerts) == 1
    assert alerts[0].task_id == task.id  # no la de "Otra Empresa"


async def test_notify_task_overdue_false_no_crea_alerta(db, client, obra_con_tarea_vencida):
    _tenant, admin, _obra, _task = obra_con_tarea_vencida
    await client.patch(
        f"{API}/settings", json={"notify_task_overdue": False},
        headers=_auth(create_access_token(admin.id)),
    )
    r = await client.post(
        f"{API}/settings/simulate-overdue", headers=_auth(create_access_token(admin.id))
    )
    assert r.status_code == 200, r.text
    assert r.json()["alerts_created"] == 0


async def test_notify_task_overdue_false_bloquea_delay_risk_automatico(db, client, obra_con_tarea_vencida):
    """AlertService.evaluate_task_risks_for_obra corre en cada alta de tarea
    (proactivo, sin esperar a "Simular vencidos") y creaba la alerta de
    "vencida" (DELAY_RISK) sin mirar ningún setting — un chequeo DISTINTO al
    del cron/simulate-overdue (TASK_OVERDUE), que sí quedó gateado desde el
    principio. Encontrado probando en vivo: apagar el toggle no evitaba que
    esta alerta apareciera."""
    tenant, admin, obra, _task = obra_con_tarea_vencida
    await client.patch(
        f"{API}/settings", json={"notify_task_overdue": False},
        headers=_auth(create_access_token(admin.id)),
    )
    yesterday = (date.today() - timedelta(days=2)).isoformat()
    r = await client.post(
        f"{API}/tasks",
        headers=_auth(create_access_token(admin.id)),
        json={
            "obra_id": obra.id, "title": "vencida nueva",
            "start_date": yesterday, "due_date": yesterday,
        },
    )
    assert r.status_code == 201, r.text

    alerts = (await db.execute(select(Alert).where(Alert.obra_id == obra.id))).scalars().all()
    vencida_alerts = [a for a in alerts if "vencida desde el" in a.message]
    assert vencida_alerts == []


async def test_notify_task_blocked_false_no_crea_alerta(db, client, obra_con_tarea_vencida):
    tenant, admin, obra, _task = obra_con_tarea_vencida
    task2 = Task(
        obra_id=obra.id, tenant_id=tenant.id, title="Tarea a bloquear",
        status=TaskStatus.EN_PROGRESO,
    )
    db.add(task2)
    await db.flush()
    await db.commit()

    await client.patch(
        f"{API}/settings", json={"notify_task_blocked": False},
        headers=_auth(create_access_token(admin.id)),
    )
    r = await client.post(
        f"{API}/tasks/{task2.id}/status",
        json={"status": "bloqueada", "triggered_by": "user"},
        headers=_auth(create_access_token(admin.id)),
    )
    assert r.status_code == 200, r.text

    alerts = (await db.execute(
        select(Alert).where(Alert.task_id == task2.id, Alert.type == AlertType.TASK_BLOCKED)
    )).scalars().all()
    assert alerts == []
