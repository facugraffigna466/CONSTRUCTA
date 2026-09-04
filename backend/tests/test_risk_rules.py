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
from app.models.responsible import Responsible
from app.models.obra import Obra
from app.models.purchase_order import PurchaseOrder
from app.models.supplier import Supplier
from app.models.task_material import TaskMaterial
from app.models.task_risk_snapshot import TaskRiskSnapshot
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
    """Invariante que la propuesta pide sostener: un evento por alerta, ni más ni menos.

    Se compara contra TODAS las alertas de la corrida y no contra las de un tipo:
    qué reglas disparan depende del día en que se corra —la de calendario laboral,
    por ejemplo, marca los vencimientos que caen en domingo—, así que fijar un tipo
    hacía que el test pasara o fallara según la fecha. Comparar los dos conjuntos
    completos verifica la invariante de forma más fuerte y sin depender del almanaque.
    """
    await RiskService(db).evaluate_obra(obra_ctx["obra"].id)

    alertas = list((await db.execute(select(Alert))).scalars().all())
    eventos = list((await db.execute(
        select(HistorialEvento).where(HistorialEvento.event_type == "alert_created")
    )).scalars().all())

    assert len(eventos) == len(alertas)
    assert sorted(e.payload["alert_type"] for e in eventos) == sorted(a.type.value for a in alertas)
    # La cadena crítica siempre está entre lo detectado, corra el día que corra.
    assert "critical_task_delayed" in {e.payload["alert_type"] for e in eventos}


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


# ── Bloque 3 — materiales y compras ───────────────────────────────────────────

async def _mk_material(db, task: Task, name: str, status: str, dias_atras: int = 0):
    from datetime import datetime, timezone

    material = TaskMaterial(
        task_id=task.id, tenant_id=task.tenant_id, name=name, status=status,
        created_at=datetime.now(timezone.utc) - timedelta(days=dias_atras),
    )
    db.add(material)
    await db.flush()
    return material


async def test_materiales_pendientes_se_agrupan_por_tarea(db, obra_ctx):
    """Tres materiales sin pedir en la misma tarea dan UNA alerta que los lista,
    no tres: la acción del destinatario (armar el pedido) es una sola."""
    task = await _mk_task(db, obra_ctx, "Instalación sanitaria",
                          start_date=TODAY + timedelta(days=30),
                          due_date=TODAY + timedelta(days=40),
                          status=TaskStatus.PENDIENTE)
    for nombre in ("Caños PVC", "Codos", "Pegamento"):
        await _mk_material(db, task, nombre, "pendiente", dias_atras=10)
    await db.commit()

    await RiskService(db).evaluate_obra(obra_ctx["obra"].id)

    alerts = await _alerts(db, AlertType.MATERIAL_PENDING_TOO_LONG)
    assert len(alerts) == 1
    assert "3 materiales sin pedir" in alerts[0].message
    assert "«Caños PVC»" in alerts[0].message


async def test_material_pendiente_reciente_no_alerta(db, obra_ctx):
    """Recién cargado no es riesgo: el umbral por defecto son 7 días."""
    task = await _mk_task(db, obra_ctx, "Carpintería",
                          start_date=TODAY + timedelta(days=30),
                          due_date=TODAY + timedelta(days=40),
                          status=TaskStatus.PENDIENTE)
    await _mk_material(db, task, "Puertas", "pendiente", dias_atras=1)
    await db.commit()

    await RiskService(db).evaluate_obra(obra_ctx["obra"].id)
    assert await _alerts(db, AlertType.MATERIAL_PENDING_TOO_LONG) == []


async def test_material_ya_pedido_no_alerta_como_pendiente(db, obra_ctx):
    """Pasar a 'pedido' cierra esta regla — de ahí en más el riesgo lo cubre
    order_sent_no_confirmation."""
    task = await _mk_task(db, obra_ctx, "Techos",
                          start_date=TODAY + timedelta(days=30),
                          due_date=TODAY + timedelta(days=40),
                          status=TaskStatus.PENDIENTE)
    await _mk_material(db, task, "Chapas", "pedido", dias_atras=20)
    await db.commit()

    await RiskService(db).evaluate_obra(obra_ctx["obra"].id)
    assert await _alerts(db, AlertType.MATERIAL_PENDING_TOO_LONG) == []


async def test_pedido_enviado_sin_confirmar_es_alerta_de_obra(db, obra_ctx):
    """Un pedido agrupa materiales de varias tareas: la alerta va a nivel obra."""
    from datetime import datetime, timezone

    supplier = Supplier(tenant_id=obra_ctx["tenant"].id, name="Corralón del Centro")
    db.add(supplier)
    await db.flush()
    db.add(PurchaseOrder(
        obra_id=obra_ctx["obra"].id, supplier_id=supplier.id, status="enviado",
        sent_at=datetime.now(timezone.utc) - timedelta(days=12),
    ))
    await db.commit()

    await RiskService(db).evaluate_obra(obra_ctx["obra"].id)

    alerts = await _alerts(db, AlertType.ORDER_SENT_NO_CONFIRMATION)
    assert len(alerts) == 1
    assert alerts[0].task_id is None
    assert "Corralón del Centro" in alerts[0].message


async def test_pedido_recibido_no_alerta(db, obra_ctx):
    """Solo los que quedaron en 'enviado' son riesgo."""
    from datetime import datetime, timezone

    db.add(PurchaseOrder(
        obra_id=obra_ctx["obra"].id, status="recibido",
        sent_at=datetime.now(timezone.utc) - timedelta(days=30),
        received_at=datetime.now(timezone.utc) - timedelta(days=25),
    ))
    await db.commit()

    await RiskService(db).evaluate_obra(obra_ctx["obra"].id)
    assert await _alerts(db, AlertType.ORDER_SENT_NO_CONFIRMATION) == []


async def test_material_bloquea_tarea_por_arrancar(db, obra_ctx):
    """Anticipa el bloqueo antes de que la tarea figure como BLOQUEADA."""
    task = await _mk_task(db, obra_ctx, "Mampostería",
                          start_date=TODAY + timedelta(days=2),
                          due_date=TODAY + timedelta(days=20),
                          status=TaskStatus.PENDIENTE)
    await _mk_material(db, task, "Ladrillos", "pedido")
    await db.commit()

    await RiskService(db).evaluate_obra(obra_ctx["obra"].id)

    alerts = await _alerts(db, AlertType.MATERIAL_BLOCKING_TASK)
    assert len(alerts) == 1
    assert alerts[0].severity == AlertSeverity.ALTA.value
    assert f"arranca el {(TODAY + timedelta(days=2)).strftime('%d/%m/%Y')}" in alerts[0].message


async def test_material_bloquea_tarea_que_ya_debia_arrancar(db, obra_ctx):
    """Si el inicio ya pasó el problema es peor, no menor: el mensaje lo dice."""
    task = await _mk_task(db, obra_ctx, "Revoque",
                          start_date=TODAY - timedelta(days=4),
                          due_date=TODAY + timedelta(days=20),
                          status=TaskStatus.PENDIENTE)
    await _mk_material(db, task, "Cal", "pendiente")
    await db.commit()

    await RiskService(db).evaluate_obra(obra_ctx["obra"].id)

    alerts = await _alerts(db, AlertType.MATERIAL_BLOCKING_TASK)
    assert len(alerts) == 1
    assert "tenía que arrancar el" in alerts[0].message


async def test_material_recibido_no_bloquea(db, obra_ctx):
    """El material que ya llegó a la obra deja de ser riesgo."""
    task = await _mk_task(db, obra_ctx, "Contrapiso",
                          start_date=TODAY + timedelta(days=1),
                          due_date=TODAY + timedelta(days=20),
                          status=TaskStatus.PENDIENTE)
    await _mk_material(db, task, "Arena", "recibido")
    await db.commit()

    await RiskService(db).evaluate_obra(obra_ctx["obra"].id)
    assert await _alerts(db, AlertType.MATERIAL_BLOCKING_TASK) == []


# ── §4.1 progress_stalled ─────────────────────────────────────────────────────

async def test_avance_estancado(db, obra_ctx):
    """En progreso hace más de una semana sin mover el porcentaje."""
    from datetime import datetime, timezone

    task = await _mk_task(db, obra_ctx, "Cielorraso",
                          start_date=TODAY - timedelta(days=20),
                          due_date=TODAY + timedelta(days=20),
                          status=TaskStatus.EN_PROGRESO, estimated_progress=35,
                          last_progress_at=datetime.now(timezone.utc) - timedelta(days=12))
    await db.commit()

    await RiskService(db).evaluate_obra(obra_ctx["obra"].id)

    alerts = await _alerts(db, AlertType.PROGRESS_STALLED)
    assert len(alerts) == 1
    assert alerts[0].task_id == task.id
    assert "al 35%" in alerts[0].message


async def test_tarea_recien_creada_no_esta_estancada(db, obra_ctx):
    """Sin last_progress_at se cae a created_at: una tarea nueva no arranca
    con una alerta de estancamiento encima."""
    await _mk_task(db, obra_ctx, "Recién creada",
                   start_date=TODAY, due_date=TODAY + timedelta(days=30),
                   status=TaskStatus.EN_PROGRESO)
    await db.commit()

    await RiskService(db).evaluate_obra(obra_ctx["obra"].id)
    assert await _alerts(db, AlertType.PROGRESS_STALLED) == []


async def test_last_progress_at_se_sella_al_cambiar_el_avance(db, obra_ctx):
    """El sello lo pone TaskRepository.update_fields(), y solo si el valor cambió."""
    from app.repositories.task import TaskRepository

    task = await _mk_task(db, obra_ctx, "Con avance", estimated_progress=10)
    await db.commit()
    repo = TaskRepository(db)

    sin_cambio = await repo.update_fields(task.id, estimated_progress=10)
    assert sin_cambio.last_progress_at is None

    con_cambio = await repo.update_fields(task.id, estimated_progress=60)
    assert con_cambio.last_progress_at is not None


# ── §1.2 float_shrinking ──────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def obra_con_holgura(db, obra_ctx):
    """A (10 días) y C (8 días) en paralelo, las dos previas a B.
    A queda en la ruta crítica y C con 2 días de holgura."""
    base = TODAY
    a = await _mk_task(db, obra_ctx, "Estructura",
                       start_date=base, due_date=base + timedelta(days=10),
                       status=TaskStatus.EN_PROGRESO)
    c = await _mk_task(db, obra_ctx, "Instalaciones",
                       start_date=base, due_date=base + timedelta(days=8),
                       status=TaskStatus.EN_PROGRESO)
    b = await _mk_task(db, obra_ctx, "Cerramientos",
                       start_date=base + timedelta(days=10),
                       due_date=base + timedelta(days=15),
                       status=TaskStatus.PENDIENTE)
    await _link(db, b, a)
    await _link(db, b, c)
    await db.commit()
    return {"a": a, "c": c, "b": b}


async def test_primera_corrida_guarda_snapshot_sin_alertar(db, obra_ctx, obra_con_holgura):
    """Sin corrida previa no hay contra qué comparar: se guarda y no se alerta."""
    await RiskService(db).evaluate_obra(obra_ctx["obra"].id)

    assert await _alerts(db, AlertType.FLOAT_SHRINKING) == []
    snapshots = (await db.execute(select(TaskRiskSnapshot))).scalars().all()
    assert {s.task_id for s in snapshots} == {
        obra_con_holgura["a"].id, obra_con_holgura["c"].id, obra_con_holgura["b"].id
    }


async def test_holgura_que_se_achica_alerta(db, obra_ctx, obra_con_holgura):
    """La holgura de C cayó de 6 a 2 días: está por volverse crítica."""
    db.add(TaskRiskSnapshot(task_id=obra_con_holgura["c"].id,
                            tenant_id=obra_ctx["tenant"].id, float_days=6))
    await db.commit()

    await RiskService(db).evaluate_obra(obra_ctx["obra"].id)

    alerts = await _alerts(db, AlertType.FLOAT_SHRINKING)
    assert len(alerts) == 1
    assert alerts[0].task_id == obra_con_holgura["c"].id
    assert "bajó de 6 a 2 días" in alerts[0].message


async def test_holgura_estable_no_alerta_y_pisa_el_snapshot(db, obra_ctx, obra_con_holgura):
    """El snapshot se actualiza SIEMPRE, alerte o no: si solo se guardara al
    alertar, la corrida siguiente compararía contra un valor viejo."""
    db.add(TaskRiskSnapshot(task_id=obra_con_holgura["c"].id,
                            tenant_id=obra_ctx["tenant"].id, float_days=2))
    await db.commit()

    await RiskService(db).evaluate_obra(obra_ctx["obra"].id)

    assert await _alerts(db, AlertType.FLOAT_SHRINKING) == []
    snapshot = await db.get(TaskRiskSnapshot, obra_con_holgura["c"].id)
    assert snapshot.float_days == 2


async def test_tarea_ya_critica_no_alerta_por_holgura(db, obra_ctx, obra_con_holgura):
    """Holgura 0 es ruta crítica y la cubre critical_task_delayed; no se duplica."""
    db.add(TaskRiskSnapshot(task_id=obra_con_holgura["a"].id,
                            tenant_id=obra_ctx["tenant"].id, float_days=5))
    await db.commit()

    await RiskService(db).evaluate_obra(obra_ctx["obra"].id)

    alerts = await _alerts(db, AlertType.FLOAT_SHRINKING)
    assert [a.task_id for a in alerts] == []


# ── §6.1 recurring_blocker ────────────────────────────────────────────────────

async def _bloqueo(db, obra_ctx, task: Task) -> None:
    db.add(HistorialEvento(
        obra_id=obra_ctx["obra"].id, task_id=task.id, tenant_id=obra_ctx["tenant"].id,
        event_type="task_status_changed", description="Status: en_progreso → bloqueada",
        payload={"from": "en_progreso", "to": "bloqueada"}, triggered_by="chatbot",
    ))


async def test_tarea_que_se_bloquea_una_y_otra_vez(db, obra_ctx):
    """Tres bloqueos son un síntoma estructural, no un bloqueo puntual."""
    task = await _mk_task(db, obra_ctx, "Conexión de gas",
                          start_date=TODAY, due_date=TODAY + timedelta(days=30),
                          status=TaskStatus.EN_PROGRESO)
    for _ in range(3):
        await _bloqueo(db, obra_ctx, task)
    await db.commit()

    await RiskService(db).evaluate_obra(obra_ctx["obra"].id)

    alerts = await _alerts(db, AlertType.RECURRING_BLOCKER)
    assert len(alerts) == 1
    assert "se bloqueó 3 veces" in alerts[0].message


async def test_dos_bloqueos_no_alcanzan(db, obra_ctx):
    """Por debajo del umbral (3 por defecto) no hay patrón."""
    task = await _mk_task(db, obra_ctx, "Pintura exterior",
                          start_date=TODAY, due_date=TODAY + timedelta(days=30),
                          status=TaskStatus.EN_PROGRESO)
    for _ in range(2):
        await _bloqueo(db, obra_ctx, task)
    await db.commit()

    await RiskService(db).evaluate_obra(obra_ctx["obra"].id)
    assert await _alerts(db, AlertType.RECURRING_BLOCKER) == []


async def test_otros_cambios_de_estado_no_cuentan_como_bloqueo(db, obra_ctx):
    """Solo los eventos con payload to='bloqueada' suman."""
    task = await _mk_task(db, obra_ctx, "Zócalos",
                          start_date=TODAY, due_date=TODAY + timedelta(days=30),
                          status=TaskStatus.EN_PROGRESO)
    for _ in range(4):
        db.add(HistorialEvento(
            obra_id=obra_ctx["obra"].id, task_id=task.id, tenant_id=obra_ctx["tenant"].id,
            event_type="task_status_changed", description="Status: pendiente → en_progreso",
            payload={"from": "pendiente", "to": "en_progreso"}, triggered_by="user",
        ))
    await db.commit()

    await RiskService(db).evaluate_obra(obra_ctx["obra"].id)
    assert await _alerts(db, AlertType.RECURRING_BLOCKER) == []


# ── §6.2 chronic_no_response ──────────────────────────────────────────────────

async def test_responsable_que_no_contesta_nunca(db, obra_ctx):
    """La alerta apunta a la persona (nivel obra), no a ninguna de las tareas:
    si no contesta en tres tareas, el problema no se resuelve mirando una."""
    from datetime import datetime, timezone

    responsable = Responsible(full_name="Juan Pérez", whatsapp_number="+5493511111111",
                              tenant_id=obra_ctx["tenant"].id)
    db.add(responsable)
    await db.flush()

    for i in range(3):
        task = await _mk_task(db, obra_ctx, f"Tarea {i}",
                              start_date=TODAY, due_date=TODAY + timedelta(days=30),
                              status=TaskStatus.EN_PROGRESO,
                              responsible_id=responsable.id)
        db.add(Alert(obra_id=obra_ctx["obra"].id, task_id=task.id,
                     tenant_id=obra_ctx["tenant"].id, type=AlertType.NO_RESPONSE,
                     message=f"Sin respuesta en tarea {i}", severity="media",
                     created_at=datetime.now(timezone.utc) - timedelta(days=i + 1)))
    await db.commit()

    await RiskService(db).evaluate_obra(obra_ctx["obra"].id)

    alerts = await _alerts(db, AlertType.CHRONIC_NO_RESPONSE)
    assert len(alerts) == 1
    assert alerts[0].task_id is None
    assert "Juan Pérez acumula 3 alertas" in alerts[0].message


async def test_alertas_viejas_quedan_fuera_de_la_ventana(db, obra_ctx):
    """La ventana por defecto son 30 días: lo de hace dos meses ya no es patrón."""
    from datetime import datetime, timezone

    responsable = Responsible(full_name="Ana Gómez", whatsapp_number="+5493512222222",
                              tenant_id=obra_ctx["tenant"].id)
    db.add(responsable)
    await db.flush()

    for i in range(4):
        task = await _mk_task(db, obra_ctx, f"Vieja {i}",
                              start_date=TODAY, due_date=TODAY + timedelta(days=30),
                              status=TaskStatus.EN_PROGRESO,
                              responsible_id=responsable.id)
        db.add(Alert(obra_id=obra_ctx["obra"].id, task_id=task.id,
                     tenant_id=obra_ctx["tenant"].id, type=AlertType.NO_RESPONSE,
                     message=f"Sin respuesta vieja {i}", severity="media",
                     created_at=datetime.now(timezone.utc) - timedelta(days=60)))
    await db.commit()

    await RiskService(db).evaluate_obra(obra_ctx["obra"].id)
    assert await _alerts(db, AlertType.CHRONIC_NO_RESPONSE) == []


# ── Cadencias ─────────────────────────────────────────────────────────────────

async def test_la_cadencia_acota_las_reglas_que_corren(db, obra_ctx, cadena_critica):
    """El job semanal no debe recalcular el CPM ni tocar las reglas frecuentes."""
    await RiskService(db).evaluate_obra(obra_ctx["obra"].id, cadence="weekly")
    assert await _alerts(db, AlertType.CRITICAL_TASK_DELAYED) == []

    await RiskService(db).evaluate_obra(obra_ctx["obra"].id, cadence="frequent")
    assert len(await _alerts(db, AlertType.CRITICAL_TASK_DELAYED)) == 2


async def test_todas_las_reglas_tienen_toggle_y_cadencia_valida(db):
    """Guarda contra el drift: una regla nueva sin toggle en SystemSettings quedaría
    apagada para siempre, y una cadencia mal escrita no la correría ningún job."""
    from app.core.scheduler import RiskCadence
    from app.services.risk_service import DAILY, FREQUENT, WEEKLY, RiskService

    validas = {FREQUENT, DAILY, WEEKLY}
    assert validas == {RiskCadence.FREQUENT, RiskCadence.DAILY, RiskCadence.WEEKLY}

    for rule in RiskService.RULES:
        assert hasattr(SystemSettings, rule.setting), rule.setting
        assert hasattr(RiskService, rule.method), rule.method
        assert rule.cadence in validas, rule


# ── Auto-resolución ───────────────────────────────────────────────────────────
#
# Contracara de la dedup: si la condición desaparece y la alerta queda sin leer
# para siempre, cuando el problema vuelve la dedup la suprime y el aviso se pierde.

async def _sin_leer(db, alert_type: AlertType) -> list[Alert]:
    result = await db.execute(
        select(Alert).where(Alert.type == alert_type, Alert.is_read == False)  # noqa: E712
    )
    return list(result.scalars().all())


async def _despejar_condicion_critica(db, cadena) -> None:
    """Empuja las dos tareas de la cadena al futuro: dejan de estar en riesgo."""
    for task, dias in ((cadena["a"], 60), (cadena["b"], 70)):
        task.start_date = TODAY + timedelta(days=dias - 5)
        task.due_date = TODAY + timedelta(days=dias)
    await db.commit()


async def test_la_condicion_desaparece_y_la_alerta_se_resuelve(db, obra_ctx, cadena_critica):
    """Corregidas las fechas, la alerta deja de figurar como pendiente."""
    service = RiskService(db)
    await service.evaluate_obra(obra_ctx["obra"].id)
    assert len(await _sin_leer(db, AlertType.CRITICAL_TASK_DELAYED)) == 2

    await _despejar_condicion_critica(db, cadena_critica)
    await service.evaluate_obra(obra_ctx["obra"].id)

    assert await _sin_leer(db, AlertType.CRITICAL_TASK_DELAYED) == []
    # Las alertas siguen existiendo (el historial no se borra), solo resueltas.
    resueltas = await _alerts(db, AlertType.CRITICAL_TASK_DELAYED)
    assert len(resueltas) == 2
    assert all(a.is_read for a in resueltas)


async def test_resolver_sella_resolved_at(db, obra_ctx, cadena_critica):
    """Sin el timestamp no se puede medir la velocidad de reacción (insights)."""
    service = RiskService(db)
    await service.evaluate_obra(obra_ctx["obra"].id)
    await _despejar_condicion_critica(db, cadena_critica)
    await service.evaluate_obra(obra_ctx["obra"].id)

    assert all(a.resolved_at is not None for a in await _alerts(db, AlertType.CRITICAL_TASK_DELAYED))


async def test_la_condicion_vuelve_y_avisa_de_nuevo(db, obra_ctx, cadena_critica):
    """El ciclo completo, que es el motivo real de todo esto: sin resolver, la
    dedup vería una alerta idéntica pendiente y se callaría la segunda vez."""
    service = RiskService(db)
    await service.evaluate_obra(obra_ctx["obra"].id)
    await _despejar_condicion_critica(db, cadena_critica)
    await service.evaluate_obra(obra_ctx["obra"].id)
    assert await _sin_leer(db, AlertType.CRITICAL_TASK_DELAYED) == []

    # El problema reaparece: la tarea vuelve a vencer en el pasado.
    cadena_critica["a"].start_date = TODAY - timedelta(days=8)
    cadena_critica["a"].due_date = TODAY - timedelta(days=3)
    cadena_critica["b"].start_date = TODAY - timedelta(days=2)
    cadena_critica["b"].due_date = TODAY + timedelta(days=2)
    await db.commit()

    creadas = await service.evaluate_obra(obra_ctx["obra"].id)
    assert creadas >= 1
    assert len(await _sin_leer(db, AlertType.CRITICAL_TASK_DELAYED)) == 2


async def test_una_cadencia_distinta_no_barre_lo_ajeno(db, obra_ctx, cadena_critica):
    """El job semanal no sabe nada de las reglas frecuentes: no puede darlas por
    resueltas solo porque no las evaluó."""
    service = RiskService(db)
    await service.evaluate_obra(obra_ctx["obra"].id, cadence="frequent")
    await _despejar_condicion_critica(db, cadena_critica)

    await service.evaluate_obra(obra_ctx["obra"].id, cadence="weekly")
    assert len(await _sin_leer(db, AlertType.CRITICAL_TASK_DELAYED)) == 2


async def test_apagar_una_regla_no_resuelve_lo_ya_avisado(db, obra_ctx, cadena_critica):
    """Apagar una regla silencia lo que viene, no borra lo que ya se detectó."""
    service = RiskService(db)
    await service.evaluate_obra(obra_ctx["obra"].id)

    obra_ctx["settings"].risk_critical_task_delayed = False
    await db.commit()
    await service.evaluate_obra(obra_ctx["obra"].id)

    assert len(await _sin_leer(db, AlertType.CRITICAL_TASK_DELAYED)) == 2


async def test_una_regla_que_explota_no_resuelve_las_suyas(db, obra_ctx, cadena_critica, monkeypatch):
    """Sin una corrida completa no sabemos qué sigue vigente: no se barre nada."""
    service = RiskService(db)
    await service.evaluate_obra(obra_ctx["obra"].id)
    await _despejar_condicion_critica(db, cadena_critica)

    async def boom(self, ctx):
        raise RuntimeError("el CPM explotó")

    monkeypatch.setattr(RiskService, "_rule_critical_task_delayed", boom)
    await RiskService(db).evaluate_obra(obra_ctx["obra"].id)

    assert len(await _sin_leer(db, AlertType.CRITICAL_TASK_DELAYED)) == 2


async def test_cambiar_el_mensaje_resuelve_el_viejo(db, obra_ctx):
    """Si el desvío crece, el texto anterior quedó obsoleto: se resuelve y queda
    solo el nuevo, en vez de acumular dos avisos de la misma tarea."""
    task = await _mk_task(db, obra_ctx, "Instalación eléctrica",
                          start_date=TODAY, due_date=TODAY + timedelta(days=31),
                          status=TaskStatus.EN_PROGRESO)
    db.add(TaskBaseline(obra_id=obra_ctx["obra"].id, tenant_id=obra_ctx["tenant"].id,
                        task_id=task.id, baseline_start=TODAY,
                        baseline_finish=TODAY + timedelta(days=25)))
    await db.commit()

    service = RiskService(db)
    await service.evaluate_obra(obra_ctx["obra"].id)
    pendientes = await _sin_leer(db, AlertType.BASELINE_DEVIATION)
    assert len(pendientes) == 1 and "6 días de atraso" in pendientes[0].message

    task.due_date = TODAY + timedelta(days=37)
    await db.commit()
    await service.evaluate_obra(obra_ctx["obra"].id)

    pendientes = await _sin_leer(db, AlertType.BASELINE_DEVIATION)
    assert len(pendientes) == 1
    assert "12 días de atraso" in pendientes[0].message
    assert len(await _alerts(db, AlertType.BASELINE_DEVIATION)) == 2


async def test_no_toca_las_alertas_de_las_reglas_viejas(db, obra_ctx, cadena_critica):
    """La reconciliación se limita a los tipos de las reglas que corrió; delay_risk
    y compañía siguen con su propio mecanismo de auto-resolución."""
    db.add(Alert(obra_id=obra_ctx["obra"].id, task_id=cadena_critica["a"].id,
                 tenant_id=obra_ctx["tenant"].id, type=AlertType.DELAY_RISK,
                 message="La tarea «Encofrado» no tiene responsable asignado.",
                 severity="media"))
    await db.commit()

    await RiskService(db).evaluate_obra(obra_ctx["obra"].id)
    assert len(await _sin_leer(db, AlertType.DELAY_RISK)) == 1


async def test_no_resuelve_alertas_de_otra_obra(db, obra_ctx, cadena_critica):
    """La reconciliación está acotada a la obra de la corrida."""
    otra = Obra(name="Obra Vecina", manager_id=obra_ctx["user"].id,
                tenant_id=obra_ctx["tenant"].id)
    db.add(otra)
    await db.flush()
    db.add(Alert(obra_id=otra.id, task_id=None, tenant_id=obra_ctx["tenant"].id,
                 type=AlertType.CRITICAL_TASK_DELAYED,
                 message="Alerta de la obra vecina", severity="critica"))
    await db.commit()

    await _despejar_condicion_critica(db, cadena_critica)
    await RiskService(db).evaluate_obra(obra_ctx["obra"].id)

    vecina = [a for a in await _sin_leer(db, AlertType.CRITICAL_TASK_DELAYED)
              if a.obra_id == otra.id]
    assert len(vecina) == 1


async def test_el_evento_de_resolucion_lleva_los_ids_exactos(db, obra_ctx, monkeypatch):
    """Incluye las alertas de nivel obra, que no tienen task_id.

    Avisar solo "se resolvió algo de la tarea N" dejaba fuera a las de obra —el
    tab seguía mostrándolas pendientes hasta recargar— y además hacía que el
    frontend tachara todas las alertas de esa tarea, incluso las que siguen
    vigentes.
    """
    from datetime import datetime, timezone

    import app.services.risk_service as risk_module

    emitidos: list[tuple] = []

    async def capturar(task_id, obra_id, alert_ids=None):
        emitidos.append((task_id, obra_id, alert_ids))

    monkeypatch.setattr(risk_module, "emit_alerts_resolved", capturar)

    supplier = Supplier(tenant_id=obra_ctx["tenant"].id, name="Corralón Sur")
    db.add(supplier)
    await db.flush()
    order = PurchaseOrder(
        obra_id=obra_ctx["obra"].id, supplier_id=supplier.id, status="enviado",
        sent_at=datetime.now(timezone.utc) - timedelta(days=15),
    )
    db.add(order)
    await db.commit()

    service = RiskService(db)
    await service.evaluate_obra(obra_ctx["obra"].id)
    pendiente = (await _sin_leer(db, AlertType.ORDER_SENT_NO_CONFIRMATION))[0]
    assert pendiente.task_id is None

    # El proveedor confirma: la condición desaparece.
    order.status = "recibido"
    order.received_at = datetime.now(timezone.utc)
    await db.commit()
    await service.evaluate_obra(obra_ctx["obra"].id)

    assert await _sin_leer(db, AlertType.ORDER_SENT_NO_CONFIRMATION) == []
    assert len(emitidos) == 1
    task_id, obra_id, alert_ids = emitidos[0]
    assert task_id is None
    assert obra_id == obra_ctx["obra"].id
    assert pendiente.id in alert_ids


# ── Aviso por WhatsApp de las alertas críticas ────────────────────────────────

@pytest_asyncio.fixture
def whatsapp(monkeypatch):
    """Intercepta los envíos y abre la ventana de envío.

    La ventana se fuerza a propósito en vez de depender del reloj: `can_notify_obra`
    mira el horario laboral de la obra, así que sin esto los tests pasarían o
    fallarían según la hora y el día en que se corran. Las reglas de la ventana se
    verifican aparte, en el test que la cierra.
    """
    import app.services.notification_service as notif
    from app.services.notification_service import NotificationService

    enviados: list[tuple[str, str]] = []

    async def fake_send(numero, cuerpo, *a, **kw):
        enviados.append((numero, cuerpo))
        return "SM_fake"

    async def siempre_puede(self, obra_id):
        return True, ""

    monkeypatch.setattr(notif, "send_whatsapp_message", fake_send)
    monkeypatch.setattr(NotificationService, "can_notify_obra", siempre_puede)
    return enviados


async def _con_whatsapp(db, obra_ctx, numero="+5493511234567"):
    obra_ctx["user"].whatsapp_number = numero
    await db.commit()


async def test_manda_las_criticas_por_whatsapp(db, obra_ctx, whatsapp):
    """Un hito en riesgo es crítico: sale el aviso al manager de la obra."""
    await _con_whatsapp(db, obra_ctx)
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

    assert len(whatsapp) == 1
    numero, cuerpo = whatsapp[0]
    assert numero == "+5493511234567"
    assert "Obra Riesgo" in cuerpo
    assert "Entrega de obra gruesa" in cuerpo
    assert all(a.notified_at is not None
               for a in await _alerts(db, AlertType.MILESTONE_AT_RISK))


async def test_no_repite_el_aviso_en_la_corrida_siguiente(db, obra_ctx, whatsapp, cadena_critica):
    """notified_at hace idempotente el envío: el job corre cada 4 horas."""
    await _con_whatsapp(db, obra_ctx)
    service = RiskService(db)
    await service.evaluate_obra(obra_ctx["obra"].id)
    assert len(whatsapp) == 1

    await service.evaluate_obra(obra_ctx["obra"].id)
    assert len(whatsapp) == 1


async def test_fuera_del_horario_no_manda_ni_marca(db, obra_ctx, cadena_critica, monkeypatch):
    """Y sobre todo NO sella: la corrida siguiente tiene que reintentar."""
    import app.services.notification_service as notif
    from app.services.notification_service import NotificationService

    enviados = []

    async def fake_send(numero, cuerpo, *a, **kw):
        enviados.append(numero)
        return "SM"

    async def cerrado(self, obra_id):
        return False, "fuera del horario laboral de la obra"

    monkeypatch.setattr(notif, "send_whatsapp_message", fake_send)
    monkeypatch.setattr(NotificationService, "can_notify_obra", cerrado)
    await _con_whatsapp(db, obra_ctx)

    await RiskService(db).evaluate_obra(obra_ctx["obra"].id)

    assert enviados == []
    criticas = [a for a in await _alerts(db, AlertType.CRITICAL_TASK_DELAYED)
                if a.severity == AlertSeverity.CRITICA.value]
    assert criticas and all(a.notified_at is None for a in criticas)


async def test_el_interruptor_apagado_no_manda(db, obra_ctx, whatsapp, cadena_critica):
    await _con_whatsapp(db, obra_ctx)
    obra_ctx["settings"].risk_whatsapp_critical = False
    await db.commit()

    await RiskService(db).evaluate_obra(obra_ctx["obra"].id)
    assert whatsapp == []


async def test_las_no_criticas_no_van_por_whatsapp(db, obra_ctx, whatsapp):
    """Mandar cada aviso de riesgo convertiría el canal en ruido."""
    await _con_whatsapp(db, obra_ctx)
    task = await _mk_task(db, obra_ctx, "Mampostería",
                          start_date=TODAY + timedelta(days=2),
                          due_date=TODAY + timedelta(days=25),
                          status=TaskStatus.PENDIENTE)
    await _mk_material(db, task, "Ladrillos", "pedido")
    await db.commit()

    await RiskService(db).evaluate_obra(obra_ctx["obra"].id)

    assert len(await _alerts(db, AlertType.MATERIAL_BLOCKING_TASK)) == 1   # severidad alta
    assert whatsapp == []


async def test_sin_destinatario_con_whatsapp_no_explota(db, obra_ctx, whatsapp, cadena_critica):
    """El manager puede no tener número cargado; la corrida sigue igual."""
    assert obra_ctx["user"].whatsapp_number is None

    creadas = await RiskService(db).evaluate_obra(obra_ctx["obra"].id)

    assert creadas >= 1
    assert whatsapp == []


async def test_el_mensaje_corta_en_cinco_y_cuenta_el_resto(db, obra_ctx, whatsapp):
    """Siete hitos en riesgo entran en un solo mensaje legible, no en siete."""
    await _con_whatsapp(db, obra_ctx)
    for i in range(7):
        previa = await _mk_task(db, obra_ctx, f"Previa {i}",
                                start_date=TODAY - timedelta(days=5),
                                due_date=TODAY + timedelta(days=1),
                                status=TaskStatus.EN_PROGRESO)
        hito = await _mk_task(db, obra_ctx, f"Hito {i}",
                              start_date=TODAY + timedelta(days=3),
                              due_date=TODAY + timedelta(days=3),
                              is_milestone=True, status=TaskStatus.PENDIENTE)
        await _link(db, hito, previa)
    await db.commit()

    await RiskService(db).evaluate_obra(obra_ctx["obra"].id)

    assert len(whatsapp) == 1
    cuerpo = whatsapp[0][1]
    assert cuerpo.count("• ") == 6          # 5 alertas + la línea del resto
    assert "y 2 más" in cuerpo


async def test_si_el_envio_falla_no_marca_como_avisada(db, obra_ctx, cadena_critica, monkeypatch):
    """Sin marcar, la corrida siguiente reintenta."""
    import app.services.notification_service as notif
    from app.services.notification_service import NotificationService

    async def explota(numero, cuerpo, *a, **kw):
        raise RuntimeError("Twilio caído")

    async def siempre_puede(self, obra_id):
        return True, ""

    monkeypatch.setattr(notif, "send_whatsapp_message", explota)
    monkeypatch.setattr(NotificationService, "can_notify_obra", siempre_puede)
    await _con_whatsapp(db, obra_ctx)

    creadas = await RiskService(db).evaluate_obra(obra_ctx["obra"].id)

    assert creadas >= 1   # la corrida no se cae
    criticas = [a for a in await _alerts(db, AlertType.CRITICAL_TASK_DELAYED)
                if a.severity == AlertSeverity.CRITICA.value]
    assert criticas and all(a.notified_at is None for a in criticas)
