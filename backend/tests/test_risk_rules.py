"""Reglas de detección de riesgo — tanda 1 y 3 de docs/propuesta-reglas-riesgo.md.

Cubre las cuatro reglas que explotan datos que el sistema ya calculaba o guardaba
pero nunca miraba para generar alertas: ruta crítica (§1.1), línea base (§2.1),
hitos (§7.1) y calendario laboral (§5.1). Además de que cada regla dispare cuando
corresponde, se verifica lo que la propuesta pide sostener: dedup contra alertas
no leídas, un evento de historial por alerta y respeto del toggle por tenant.
"""
from datetime import date, timedelta

import pytest_asyncio
from sqlalchemy import select

from app.models.alert import Alert, AlertSeverity, AlertType
from app.models.baseline import TaskBaseline
from app.models.calendar import CalendarException, WorkingCalendar
from app.models.historial import HistorialEvento
from app.models.obra import Obra
from app.models.settings import SystemSettings
from app.models.task import Task, TaskStatus, task_dependencies_table
from app.models.tenant import Tenant
from app.models.user import User
from app.services.risk_service import RiskService

TODAY = date.today()


@pytest_asyncio.fixture
async def obra_ctx(db):
    """Obra vacía con settings por defecto (todas las reglas habilitadas)."""
    tenant = Tenant(name="Empresa Riesgo")
    db.add(tenant)
    await db.flush()
    user = User(email="riesgo@x.com", hashed_password="x", full_name="PM",
                role="admin", is_active=True, tenant_id=tenant.id)
    db.add(user)
    await db.flush()
    obra = Obra(name="Obra Riesgo", manager_id=user.id, tenant_id=tenant.id)
    db.add(obra)
    await db.flush()
    settings = SystemSettings(tenant_id=tenant.id)
    db.add(settings)
    await db.flush()
    await db.commit()
    return {"db": db, "tenant": tenant, "user": user, "obra": obra, "settings": settings}


async def _mk_task(db, ctx, title: str, **kwargs) -> Task:
    task = Task(
        obra_id=ctx["obra"].id, tenant_id=ctx["tenant"].id, title=title, **kwargs
    )
    db.add(task)
    await db.flush()
    return task


async def _link(db, task: Task, depends_on: Task) -> None:
    await db.execute(
        task_dependencies_table.insert().values(
            task_id=task.id, depends_on_id=depends_on.id,
            dependency_type="FS", lag_days=0,
        )
    )


async def _alerts(db, alert_type: AlertType) -> list[Alert]:
    result = await db.execute(select(Alert).where(Alert.type == alert_type))
    return list(result.scalars().all())


# ── §1.1 critical_task_delayed ────────────────────────────────────────────────

@pytest_asyncio.fixture
async def cadena_critica(db, obra_ctx):
    """A → B encadenadas: sin holgura, las dos quedan en la ruta crítica.
    B vence pasado mañana; A venció hace tres días."""
    a = await _mk_task(db, obra_ctx, "Encofrado",
                       start_date=TODAY - timedelta(days=8),
                       due_date=TODAY - timedelta(days=3),
                       status=TaskStatus.EN_PROGRESO)
    b = await _mk_task(db, obra_ctx, "Hormigonado",
                       start_date=TODAY - timedelta(days=2),
                       due_date=TODAY + timedelta(days=2),
                       status=TaskStatus.PENDIENTE)
    await _link(db, b, a)
    await db.commit()
    return {"a": a, "b": b}


async def test_critica_vencida_es_severidad_critica(db, obra_ctx, cadena_critica):
    """Una tarea de la ruta crítica ya vencida mueve la fecha de fin de obra:
    llega como crítica y con un mensaje distinto al de 'por vencer'."""
    await RiskService(db).evaluate_obra(obra_ctx["obra"].id)

    alerts = await _alerts(db, AlertType.CRITICAL_TASK_DELAYED)
    vencida = [a for a in alerts if a.task_id == cadena_critica["a"].id]
    assert len(vencida) == 1
    assert vencida[0].severity == AlertSeverity.CRITICA.value
    assert "vencida desde" in vencida[0].message


async def test_critica_por_vencer_avisa_antes(db, obra_ctx, cadena_critica):
    """El lookahead (3 días por defecto) hace que avise ANTES del vencimiento,
    que es lo que la diferencia de task_overdue."""
    await RiskService(db).evaluate_obra(obra_ctx["obra"].id)

    alerts = await _alerts(db, AlertType.CRITICAL_TASK_DELAYED)
    alerts_por_vencer = [a for a in alerts if a.task_id == cadena_critica["b"].id]
    assert len(alerts_por_vencer) == 1
    assert alerts_por_vencer[0].severity == AlertSeverity.ALTA.value
    assert "Si se atrasa, se atrasa toda la obra" in alerts_por_vencer[0].message


async def test_critica_lejana_no_alerta(db, obra_ctx):
    """Una tarea crítica que vence dentro de un mes no es riesgo todavía."""
    await _mk_task(db, obra_ctx, "Pintura",
                   start_date=TODAY + timedelta(days=20),
                   due_date=TODAY + timedelta(days=30),
                   status=TaskStatus.PENDIENTE)
    await db.commit()

    await RiskService(db).evaluate_obra(obra_ctx["obra"].id)
    assert await _alerts(db, AlertType.CRITICAL_TASK_DELAYED) == []


async def test_dedup_no_duplica_entre_corridas(db, obra_ctx, cadena_critica):
    """Dos corridas del cron sobre la misma condición dejan UNA alerta."""
    service = RiskService(db)
    await service.evaluate_obra(obra_ctx["obra"].id)
    creadas_segunda = await service.evaluate_obra(obra_ctx["obra"].id)

    assert creadas_segunda == 0
    assert len(await _alerts(db, AlertType.CRITICAL_TASK_DELAYED)) == 2  # a y b, una c/u


async def test_alerta_leida_vuelve_a_dispararse(db, obra_ctx, cadena_critica):
    """La dedup es contra NO leídas: si el usuario la marcó leída y la condición
    sigue, la corrida siguiente vuelve a avisar (detección de recurrencia)."""
    service = RiskService(db)
    await service.evaluate_obra(obra_ctx["obra"].id)
    for alert in await _alerts(db, AlertType.CRITICAL_TASK_DELAYED):
        alert.is_read = True
    await db.commit()

    assert await service.evaluate_obra(obra_ctx["obra"].id) == 2


async def test_cada_alerta_deja_un_evento_de_historial(db, obra_ctx, cadena_critica):
    """Invariante que la propuesta pide sostener: un evento por alerta, ni más ni menos."""
    await RiskService(db).evaluate_obra(obra_ctx["obra"].id)

    result = await db.execute(
        select(HistorialEvento).where(HistorialEvento.event_type == "alert_created")
    )
    eventos = list(result.scalars().all())
    assert len(eventos) == len(await _alerts(db, AlertType.CRITICAL_TASK_DELAYED))
    assert all(e.payload["alert_type"] == "critical_task_delayed" for e in eventos)


async def test_toggle_apagado_no_evalua(db, obra_ctx, cadena_critica):
    """El toggle por tenant apaga la regla sin tocar a las demás."""
    obra_ctx["settings"].risk_critical_task_delayed = False
    await db.commit()

    await RiskService(db).evaluate_obra(obra_ctx["obra"].id)
    assert await _alerts(db, AlertType.CRITICAL_TASK_DELAYED) == []


# ── §2.1 baseline_deviation ───────────────────────────────────────────────────

async def test_desvio_de_linea_base_escala_a_critica(db, obra_ctx):
    """Al doble del umbral (5 días → 10) el desvío pasa de alta a crítica."""
    task = await _mk_task(db, obra_ctx, "Instalación eléctrica",
                          start_date=TODAY, due_date=TODAY + timedelta(days=40),
                          status=TaskStatus.EN_PROGRESO)
    db.add(TaskBaseline(obra_id=obra_ctx["obra"].id, tenant_id=obra_ctx["tenant"].id,
                        task_id=task.id, baseline_start=TODAY,
                        baseline_finish=TODAY + timedelta(days=25)))
    await db.commit()

    await RiskService(db).evaluate_obra(obra_ctx["obra"].id)

    alerts = await _alerts(db, AlertType.BASELINE_DEVIATION)
    assert len(alerts) == 1
    assert alerts[0].severity == AlertSeverity.CRITICA.value
    assert "15 días de atraso" in alerts[0].message


async def test_adelantarse_a_la_linea_base_no_es_riesgo(db, obra_ctx):
    """Terminar antes de lo planificado no genera alerta."""
    task = await _mk_task(db, obra_ctx, "Movimiento de suelos",
                          start_date=TODAY, due_date=TODAY + timedelta(days=10),
                          status=TaskStatus.EN_PROGRESO)
    db.add(TaskBaseline(obra_id=obra_ctx["obra"].id, tenant_id=obra_ctx["tenant"].id,
                        task_id=task.id, baseline_start=TODAY,
                        baseline_finish=TODAY + timedelta(days=20)))
    await db.commit()

    await RiskService(db).evaluate_obra(obra_ctx["obra"].id)
    assert await _alerts(db, AlertType.BASELINE_DEVIATION) == []


async def test_obra_sin_linea_base_no_alerta(db, obra_ctx):
    """Sin línea base guardada la regla no tiene contra qué comparar."""
    await _mk_task(db, obra_ctx, "Sin baseline",
                   start_date=TODAY, due_date=TODAY + timedelta(days=90),
                   status=TaskStatus.EN_PROGRESO)
    await db.commit()

    await RiskService(db).evaluate_obra(obra_ctx["obra"].id)
    assert await _alerts(db, AlertType.BASELINE_DEVIATION) == []


# ── §7.1 milestone_at_risk ────────────────────────────────────────────────────

async def test_hito_con_predecesora_pendiente(db, obra_ctx):
    """Hito próximo con una previa sin terminar: crítico, y nombra la previa."""
    previa = await _mk_task(db, obra_ctx, "Losa planta alta",
                            start_date=TODAY - timedelta(days=5),
                            due_date=TODAY + timedelta(days=1),
                            status=TaskStatus.EN_PROGRESO)
    hito = await _mk_task(db, obra_ctx, "Entrega de obra gruesa",
                          start_date=TODAY + timedelta(days=3),
                          due_date=TODAY + timedelta(days=3),
                          is_milestone=True, status=TaskStatus.PENDIENTE)
    await _link(db, hito, previa)
    await db.commit()

    await RiskService(db).evaluate_obra(obra_ctx["obra"].id)

    alerts = await _alerts(db, AlertType.MILESTONE_AT_RISK)
    assert len(alerts) == 1
    assert alerts[0].severity == AlertSeverity.CRITICA.value
    assert "«Losa planta alta»" in alerts[0].message


async def test_hito_con_previas_completas_no_alerta(db, obra_ctx):
    """Si la predecesora está completada el hito no corre riesgo por esa vía."""
    previa = await _mk_task(db, obra_ctx, "Losa terminada",
                            start_date=TODAY - timedelta(days=5),
                            due_date=TODAY - timedelta(days=1),
                            status=TaskStatus.COMPLETADA)
    hito = await _mk_task(db, obra_ctx, "Entrega",
                          start_date=TODAY + timedelta(days=2),
                          due_date=TODAY + timedelta(days=2),
                          is_milestone=True, status=TaskStatus.PENDIENTE)
    await _link(db, hito, previa)
    await db.commit()

    await RiskService(db).evaluate_obra(obra_ctx["obra"].id)
    assert await _alerts(db, AlertType.MILESTONE_AT_RISK) == []


async def test_hito_toma_la_dependencia_legacy(db, obra_ctx):
    """La columna depends_on_id (anterior a la tabla M2M) también cuenta como previa."""
    previa = await _mk_task(db, obra_ctx, "Contrapiso",
                            start_date=TODAY, due_date=TODAY + timedelta(days=1),
                            status=TaskStatus.EN_PROGRESO)
    hito = await _mk_task(db, obra_ctx, "Hito legacy",
                          start_date=TODAY + timedelta(days=2),
                          due_date=TODAY + timedelta(days=2),
                          is_milestone=True, status=TaskStatus.PENDIENTE,
                          depends_on_id=previa.id)
    await db.commit()

    await RiskService(db).evaluate_obra(obra_ctx["obra"].id)

    alerts = await _alerts(db, AlertType.MILESTONE_AT_RISK)
    assert len(alerts) == 1
    assert alerts[0].task_id == hito.id


# ── §5.1 deadline_conflicts_holiday ───────────────────────────────────────────

async def test_vencimiento_en_feriado_nombra_el_feriado(db, obra_ctx):
    """Si hay una excepción cargada con etiqueta, el mensaje la usa."""
    feriado = TODAY + timedelta(days=5)
    calendar = WorkingCalendar(obra_id=obra_ctx["obra"].id, tenant_id=obra_ctx["tenant"].id)
    db.add(calendar)
    await db.flush()
    db.add(CalendarException(calendar_id=calendar.id, date=feriado,
                             is_working=False, label="Día de la Independencia"))
    await _mk_task(db, obra_ctx, "Colocación de aberturas",
                   start_date=TODAY, due_date=feriado, status=TaskStatus.PENDIENTE)
    await db.commit()

    await RiskService(db).evaluate_obra(obra_ctx["obra"].id)

    alerts = await _alerts(db, AlertType.DEADLINE_CONFLICTS_HOLIDAY)
    assert len(alerts) == 1
    assert alerts[0].severity == AlertSeverity.BAJA.value
    assert "es Día de la Independencia" in alerts[0].message


async def test_vencimiento_pasado_en_feriado_no_alerta(db, obra_ctx):
    """La regla mira hacia adelante: reprogramar una fecha que ya pasó no sirve."""
    feriado = TODAY - timedelta(days=3)
    calendar = WorkingCalendar(obra_id=obra_ctx["obra"].id, tenant_id=obra_ctx["tenant"].id)
    db.add(calendar)
    await db.flush()
    db.add(CalendarException(calendar_id=calendar.id, date=feriado,
                             is_working=False, label="Feriado puente"))
    await _mk_task(db, obra_ctx, "Tarea vieja",
                   start_date=feriado - timedelta(days=2), due_date=feriado,
                   status=TaskStatus.EN_PROGRESO)
    await db.commit()

    await RiskService(db).evaluate_obra(obra_ctx["obra"].id)
    assert await _alerts(db, AlertType.DEADLINE_CONFLICTS_HOLIDAY) == []


# ── Orquestación ──────────────────────────────────────────────────────────────

async def test_tareas_completadas_quedan_fuera(db, obra_ctx):
    """Ninguna regla evalúa tareas completadas o canceladas."""
    task = await _mk_task(db, obra_ctx, "Ya terminada",
                          start_date=TODAY - timedelta(days=10),
                          due_date=TODAY - timedelta(days=5),
                          status=TaskStatus.COMPLETADA)
    db.add(TaskBaseline(obra_id=obra_ctx["obra"].id, tenant_id=obra_ctx["tenant"].id,
                        task_id=task.id, baseline_start=TODAY - timedelta(days=30),
                        baseline_finish=TODAY - timedelta(days=30)))
    await db.commit()

    assert await RiskService(db).evaluate_obra(obra_ctx["obra"].id) == 0


async def test_una_regla_rota_no_frena_las_demas(db, obra_ctx, cadena_critica, monkeypatch):
    """Una excepción en una regla se loguea y la corrida sigue con el resto."""
    async def boom(self, ctx):
        raise RuntimeError("la línea base explotó")

    monkeypatch.setattr(RiskService, "_rule_baseline_deviation", boom)

    await RiskService(db).evaluate_obra(obra_ctx["obra"].id)
    # Se cuenta por tipo y no por total: la regla de calendario puede sumar una
    # alerta o ninguna según en qué día de la semana caiga la corrida.
    assert len(await _alerts(db, AlertType.CRITICAL_TASK_DELAYED)) == 2
