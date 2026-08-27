"""Remediación de docs/auditoria/06-alertas.md (módulo Alertas).

Cubre lo que quedaba pendiente al comparar la auditoría contra el código:
- 8.1: TASK_OVERDUE no se auto-resolvía (ni al empujar due_date a futuro vía
  update(), ni al completar/cancelar la tarea vía el pipeline del chatbot).
- 8.4: DELAY_RISK era puramente reactivo — una obra sin visitas nunca
  generaba alertas aunque tuviera tareas vencidas/bloqueadas.
- 8.3: dos implementaciones de ventana de envío (chatbot vs notificaciones)
  con reglas distintas — la del chatbot ni siquiera miraba el día.
"""
from datetime import date, datetime, timedelta, timezone

import pytest_asyncio
from sqlalchemy import select

from app.core.security import create_access_token, hash_password
from app.models.alert import Alert, AlertType
from app.models.obra import Obra
from app.models.task import Task, TaskStatus
from app.models.tenant import Tenant
from app.models.user import User
from app.repositories.alert import AlertRepository
from app.schemas.task import TaskStatusUpdate, TaskUpdate
from app.services.alert_service import AlertService
from app.services.calendar_service import is_within_send_window
from app.services.task_service import TaskService

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
async def obra_con_tarea_vencida_y_alerta(db):
    """Obra con una tarea vencida que ya tiene una alerta TASK_OVERDUE sin leer
    (simula lo que deja el cron mark_overdue_tasks)."""
    tenant = Tenant(name="Empresa Overdue")
    db.add(tenant)
    await db.flush()
    admin = await _mk_admin(db, tenant.id, "admin@overdue.com")
    obra = Obra(name="Obra O", manager_id=admin.id, tenant_id=tenant.id)
    db.add(obra)
    await db.flush()
    task = Task(
        obra_id=obra.id, tenant_id=tenant.id, title="Tarea vencida",
        status=TaskStatus.EN_PROGRESO, due_date=date.today() - timedelta(days=3),
    )
    db.add(task)
    await db.flush()

    alert_repo = AlertRepository(db)
    await alert_repo.create_alert(
        alert_type=AlertType.TASK_OVERDUE,
        message=f"La tarea '{task.title}' está vencida (venció el {task.due_date}).",
        obra_id=obra.id,
        task_id=task.id,
    )
    await db.commit()
    await db.refresh(task)
    return tenant, admin, obra, task


async def test_update_due_date_a_futuro_resuelve_task_overdue(db, client, obra_con_tarea_vencida_y_alerta):
    _tenant, admin, _obra, task = obra_con_tarea_vencida_y_alerta

    r = await client.patch(
        f"{API}/tasks/{task.id}",
        headers=_auth(create_access_token(admin.id)),
        json={"due_date": (date.today() + timedelta(days=5)).isoformat()},
    )
    assert r.status_code == 200, r.text

    alerts = (await db.execute(
        select(Alert).where(Alert.task_id == task.id, Alert.type == AlertType.TASK_OVERDUE)
    )).scalars().all()
    assert len(alerts) == 1
    assert alerts[0].is_read is True


async def test_apply_status_update_completada_resuelve_task_overdue(db, obra_con_tarea_vencida_y_alerta):
    """Camino del chatbot (apply_status_update) — antes solo update() vía HTTP
    resolvía alertas; una tarea vencida cerrada por WhatsApp dejaba la alerta
    huérfana para siempre."""
    _tenant, _admin, _obra, task = obra_con_tarea_vencida_y_alerta

    svc = TaskService(db)
    await svc.apply_status_update(
        task.id,
        TaskStatusUpdate(status=TaskStatus.COMPLETADA, triggered_by="system"),
    )

    alerts = (await db.execute(
        select(Alert).where(Alert.task_id == task.id, Alert.type == AlertType.TASK_OVERDUE)
    )).scalars().all()
    assert len(alerts) == 1
    assert alerts[0].is_read is True


async def test_apply_status_update_cancelada_resuelve_task_overdue(db, obra_con_tarea_vencida_y_alerta):
    _tenant, _admin, _obra, task = obra_con_tarea_vencida_y_alerta

    svc = TaskService(db)
    await svc.apply_status_update(
        task.id,
        TaskStatusUpdate(status=TaskStatus.CANCELADA, triggered_by="system"),
    )

    alerts = (await db.execute(
        select(Alert).where(Alert.task_id == task.id, Alert.type == AlertType.TASK_OVERDUE)
    )).scalars().all()
    assert alerts[0].is_read is True


async def test_apply_status_update_bloqueada_no_resuelve_task_overdue(db, obra_con_tarea_vencida_y_alerta):
    """Pasar a BLOQUEADA no implica que la tarea deje de estar vencida —
    solo COMPLETADA/CANCELADA resuelven (mismo criterio que la auditoría)."""
    _tenant, _admin, _obra, task = obra_con_tarea_vencida_y_alerta

    svc = TaskService(db)
    await svc.apply_status_update(
        task.id,
        TaskStatusUpdate(status=TaskStatus.BLOQUEADA, triggered_by="system"),
    )

    alerts = (await db.execute(
        select(Alert).where(Alert.task_id == task.id, Alert.type == AlertType.TASK_OVERDUE)
    )).scalars().all()
    assert alerts[0].is_read is False


async def test_evaluate_task_risks_for_all_obras_cubre_obra_sin_visitas(db):
    """8.4 — antes DELAY_RISK solo se evaluaba al abrir el tab Tareas/Gantt de
    esa obra puntual. evaluate_task_risks_for_all_obras() (llamado por el job
    periódico nuevo en scheduler.py) debe generar la alerta sin que nadie haya
    tocado la obra."""
    tenant = Tenant(name="Empresa Silenciosa")
    db.add(tenant)
    await db.flush()
    admin = await _mk_admin(db, tenant.id, "admin@silenciosa.com")
    obra = Obra(name="Obra sin visitas", manager_id=admin.id, tenant_id=tenant.id)
    db.add(obra)
    await db.flush()
    task = Task(
        obra_id=obra.id, tenant_id=tenant.id, title="Nadie la mira",
        status=TaskStatus.PENDIENTE, due_date=date.today() - timedelta(days=1),
    )
    db.add(task)
    await db.flush()
    await db.commit()

    created = await AlertService(db).evaluate_task_risks_for_all_obras()
    assert created >= 1

    alerts = (await db.execute(
        select(Alert).where(Alert.obra_id == obra.id, Alert.type == AlertType.DELAY_RISK)
    )).scalars().all()
    assert any("vencida" in a.message for a in alerts)


async def test_evaluate_task_risks_for_all_obras_salta_obras_cerradas(db):
    """Una obra COMPLETADA/CANCELADA no debe generar alertas nuevas por el job
    periódico aunque tenga tareas con fecha vencida sin cerrar."""
    from app.models.obra import ObraStatus

    tenant = Tenant(name="Empresa Cerrada")
    db.add(tenant)
    await db.flush()
    admin = await _mk_admin(db, tenant.id, "admin@cerrada.com")
    obra = Obra(
        name="Obra cerrada", manager_id=admin.id, tenant_id=tenant.id,
        status=ObraStatus.COMPLETADA,
    )
    db.add(obra)
    await db.flush()
    task = Task(
        obra_id=obra.id, tenant_id=tenant.id, title="Quedó vencida",
        status=TaskStatus.PENDIENTE, due_date=date.today() - timedelta(days=1),
    )
    db.add(task)
    await db.flush()
    await db.commit()

    await AlertService(db).evaluate_task_risks_for_all_obras()

    alerts = (await db.execute(select(Alert).where(Alert.obra_id == obra.id))).scalars().all()
    assert alerts == []


def test_is_within_send_window_respeta_fin_de_semana():
    """7.3/8.3 — la implementación vieja del chatbot (_within_send_window en
    message_service.py) solo miraba la hora, nunca el día: un domingo a las
    10am caía dentro de la ventana 8-20 igual. La unificada en
    calendar_service.py debe rechazar sábado/domingo."""
    # 2026-08-30 es domingo.
    sunday_10am_utc = datetime(2026, 8, 30, 13, 0, tzinfo=timezone.utc)  # 10:00 AR
    assert is_within_send_window(8, 20, now=sunday_10am_utc) is False

    monday_10am_utc = datetime(2026, 8, 31, 13, 0, tzinfo=timezone.utc)  # 10:00 AR
    assert is_within_send_window(8, 20, now=monday_10am_utc) is True


def test_is_within_send_window_respeta_feriado_nacional():
    # 2026-05-25 (Día de la Revolución de Mayo) es lunes — sin el chequeo de
    # feriado, pasaría el filtro de día hábil.
    holiday_10am_utc = datetime(2026, 5, 25, 13, 0, tzinfo=timezone.utc)
    assert is_within_send_window(8, 20, now=holiday_10am_utc) is False


def test_is_within_send_window_fuera_de_horario():
    monday_11pm_utc = datetime(2026, 8, 31, 23, 0, tzinfo=timezone.utc)  # 20:00 AR
    assert is_within_send_window(8, 20, now=monday_11pm_utc) is False
