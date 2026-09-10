"""GET /obras/{id}/dashboard — indicadores P0 y P1 (docs/features/dashboard-indicadores-obra.md).

Cada test arma los datos a propósito para que el resultado esperado se pueda
calcular a mano, misma convención que test_obra_stats.py. Los casos de cálculo
puro (§3) ya están cubiertos en test_dashboard_calc.py — acá se prueba la
composición: qué bloque queda `available` y con qué `reason`, y los agregados
que no son fórmulas de §3 (alertas, cuello de botella, calidad de dato,
línea base, ruta crítica, hitos, materiales).
"""
import pytest
from datetime import date, datetime, timedelta, timezone

import pytest_asyncio

from app.core.security import create_access_token
from app.models.alert import Alert, AlertSeverity, AlertType
from app.models.baseline import TaskBaseline
from app.models.obra import Obra
from app.models.responsible import Responsible
from app.models.task import Task, TaskStatus, task_dependencies_table
from app.models.task_material import TaskMaterial
from app.models.tenant import Tenant
from app.models.user import User
from app.services.obra_dashboard_service import ObraDashboardService

API = "/api/v1"
HOY = date.today()
LUNES = date(2026, 6, 1)
LUNES_SIGUIENTE = date(2026, 6, 8)  # working_days_between = 6, ver test_calendar_working_days.py
LUNES_MAS_DOS_SEMANAS = date(2026, 6, 15)  # working_days_between desde LUNES = 12


@pytest_asyncio.fixture
async def ctx(db):
    tenant = Tenant(name="Empresa Dashboard")
    db.add(tenant)
    await db.flush()
    user = User(email="dash@x.com", hashed_password="x", full_name="Jefe",
                role="admin", is_active=True, tenant_id=tenant.id)
    db.add(user)
    await db.flush()

    async def new_obra(name: str) -> Obra:
        obra = Obra(name=name, manager_id=user.id, tenant_id=tenant.id)
        db.add(obra)
        await db.flush()
        return obra

    return {"tenant": tenant, "user": user, "new_obra": new_obra, "db": db}


def _task(obra: Obra, tenant: Tenant, title: str, **kw) -> Task:
    return Task(obra_id=obra.id, tenant_id=tenant.id, title=title, **kw)


async def test_obra_sin_tareas_todo_no_disponible(ctx, db):
    obra = await ctx["new_obra"]("Sin tareas")
    await db.flush()

    body = await ObraDashboardService(db).get_dashboard(obra.id)

    assert body["progress"]["available"] is False
    assert body["progress"]["reason"] == "no_tasks"
    assert body["progress"]["real_percent"] is None
    assert body["forecast"]["available"] is False
    assert body["bottleneck"]["available"] is False
    assert body["data_quality"] == {
        "tasks_without_dates": 0,
        "tasks_without_responsible": 0,
        "tasks_without_dependencies": 0,
        "milestones_without_dates": 0,
    }


async def test_tareas_sin_fechas_avance_disponible_planificado_no(ctx, db):
    """Todas sin fechas: I-01 se calcula (promedio simple), I-02 queda None
    y el fin proyectado no está disponible por falta de plan."""
    obra = await ctx["new_obra"]("Sin fechas")
    db.add_all([
        _task(obra, ctx["tenant"], "A", status=TaskStatus.COMPLETADA),
        _task(obra, ctx["tenant"], "B", status=TaskStatus.PENDIENTE),
    ])
    await db.flush()

    body = await ObraDashboardService(db).get_dashboard(obra.id)

    assert body["progress"]["available"] is True
    assert body["progress"]["real_percent"] == 50.0
    assert body["progress"]["planned_percent"] is None
    assert body["forecast"]["available"] is False
    assert body["forecast"]["reason"] == "no_dates"


async def test_spi_none_cuando_planificado_es_cero(ctx, db):
    """La obra todavía no arrancó según el plan (hoy < start_date de toda
    tarea) -> SPI None, no infinito, y el fin proyectado no está disponible."""
    obra = await ctx["new_obra"]("Aún no arranca")
    db.add(_task(
        obra, ctx["tenant"], "Futura", status=TaskStatus.PENDIENTE,
        start_date=HOY + timedelta(days=10), due_date=HOY + timedelta(days=20),
    ))
    await db.flush()

    body = await ObraDashboardService(db).get_dashboard(obra.id)

    assert body["progress"]["planned_percent"] == 0.0
    assert body["progress"]["spi"] is None
    assert body["progress"]["spi_confidence"] is None
    assert body["forecast"]["available"] is False
    assert body["forecast"]["reason"] == "spi_unreliable"


async def test_spi_cero_no_rompe_el_forecast(ctx, db):
    """SPI puede dar exactamente 0.0 (avance real 0% con plan ya arrancado,
    ej. tarea sin tocar hace tiempo) — es un valor real, distinto de None, pero
    proyectar duración/spi con spi=0 es una división por cero. Regresión."""
    obra = await ctx["new_obra"]("Sin avance con plan arrancado")
    db.add(_task(
        obra, ctx["tenant"], "Sin arrancar", status=TaskStatus.PENDIENTE,
        start_date=HOY - timedelta(days=30), due_date=HOY + timedelta(days=30),
    ))
    await db.flush()

    body = await ObraDashboardService(db).get_dashboard(obra.id)

    assert body["progress"]["real_percent"] == 0.0
    assert body["progress"]["spi"] == 0.0
    assert body["forecast"]["available"] is False
    assert body["forecast"]["reason"] == "spi_unreliable"


async def test_spi_baja_confianza_forecast_no_disponible(ctx, db):
    """Planificado < 5%: se calcula pero con marca de baja confianza, y el
    fin proyectado no se muestra (sería una fecha basada en ruido)."""
    obra = await ctx["new_obra"]("Recién arrancando")
    db.add(_task(
        obra, ctx["tenant"], "Recién empezada", status=TaskStatus.PENDIENTE,
        start_date=HOY - timedelta(days=2), due_date=HOY + timedelta(days=90),
    ))
    await db.flush()

    body = await ObraDashboardService(db).get_dashboard(obra.id)

    assert 0 < body["progress"]["planned_percent"] < 5
    assert body["progress"]["spi_confidence"] == "low"
    assert body["forecast"]["available"] is False
    assert body["forecast"]["reason"] == "spi_unreliable"


async def test_tarea_bloqueada_conserva_avance_en_el_dashboard(ctx, db):
    """Una obra con una sola tarea bloqueada al 42% muestra 42%, no 0 —
    el promedio ponderado de una sola tarea es su propio avance."""
    obra = await ctx["new_obra"]("Con bloqueada")
    db.add(_task(
        obra, ctx["tenant"], "Trabada", status=TaskStatus.BLOQUEADA,
        estimated_progress=42,
        start_date=HOY - timedelta(days=5), due_date=HOY + timedelta(days=5),
    ))
    await db.flush()

    body = await ObraDashboardService(db).get_dashboard(obra.id)

    assert body["progress"]["real_percent"] == 42.0


async def test_cuello_de_botella_elige_la_que_mas_frena(ctx, db):
    obra = await ctx["new_obra"]("Con cuello de botella")
    poco = _task(obra, ctx["tenant"], "Frena poco", status=TaskStatus.BLOQUEADA)
    mucho = _task(obra, ctx["tenant"], "Frena mucho", status=TaskStatus.BLOQUEADA)
    dep_de_poco = _task(obra, ctx["tenant"], "Dependiente 1", status=TaskStatus.PENDIENTE)
    dep1_de_mucho = _task(obra, ctx["tenant"], "Dependiente 2", status=TaskStatus.PENDIENTE)
    dep2_de_mucho = _task(obra, ctx["tenant"], "Dependiente 3", status=TaskStatus.PENDIENTE)
    db.add_all([poco, mucho, dep_de_poco, dep1_de_mucho, dep2_de_mucho])
    await db.flush()

    await db.execute(task_dependencies_table.insert().values(
        task_id=dep_de_poco.id, depends_on_id=poco.id, dependency_type="FS", lag_days=0))
    for dep in (dep1_de_mucho, dep2_de_mucho):
        await db.execute(task_dependencies_table.insert().values(
            task_id=dep.id, depends_on_id=mucho.id, dependency_type="FS", lag_days=0))
    await db.flush()

    body = await ObraDashboardService(db).get_dashboard(obra.id)

    assert body["bottleneck"]["available"] is True
    assert body["bottleneck"]["task_id"] == mucho.id
    assert body["bottleneck"]["blocked_task_count"] == 2
    assert body["bottleneck"]["title"] == "Frena mucho"


async def test_alertas_por_severidad_excluye_leidas(ctx, db):
    obra = await ctx["new_obra"]("Con alertas")
    await db.flush()

    def _alert(severity: str, is_read: bool, age_days: int) -> Alert:
        return Alert(
            obra_id=obra.id, tenant_id=ctx["tenant"].id,
            type=AlertType.TASK_OVERDUE, severity=severity, message="x",
            is_read=is_read,
            created_at=datetime.now(timezone.utc) - timedelta(days=age_days),
        )

    db.add_all([
        _alert(AlertSeverity.CRITICA.value, is_read=False, age_days=10),
        _alert(AlertSeverity.CRITICA.value, is_read=False, age_days=3),
        _alert(AlertSeverity.CRITICA.value, is_read=True, age_days=30),  # leída: no cuenta
        _alert(AlertSeverity.ALTA.value, is_read=False, age_days=1),
    ])
    await db.flush()

    body = await ObraDashboardService(db).get_dashboard(obra.id)

    assert body["alerts"]["critica"] == 2
    assert body["alerts"]["alta"] == 1
    assert body["alerts"]["media"] == 0
    assert body["alerts"]["baja"] == 0
    assert body["alerts"]["oldest_critical_age_days"] == 10


async def test_data_quality_contadores(ctx, db):
    obra = await ctx["new_obra"]("Calidad de dato")
    resp = Responsible(tenant_id=ctx["tenant"].id, full_name="Juan",
                        whatsapp_number="+5493510000900", is_active=True)
    db.add(resp)
    await db.flush()

    dep_target = _task(
        obra, ctx["tenant"], "Predecesora", status=TaskStatus.COMPLETADA,
        responsible_id=resp.id, start_date=HOY, due_date=HOY + timedelta(days=1),
    )
    ok = _task(
        obra, ctx["tenant"], "Completa", status=TaskStatus.PENDIENTE,
        responsible_id=resp.id, start_date=HOY, due_date=HOY + timedelta(days=3),
    )
    sin_fechas = _task(
        obra, ctx["tenant"], "Sin fechas", status=TaskStatus.PENDIENTE, responsible_id=resp.id,
    )
    sin_responsable = _task(
        obra, ctx["tenant"], "Sin responsable", status=TaskStatus.PENDIENTE,
        start_date=HOY, due_date=HOY + timedelta(days=2),
    )
    hito_sin_fecha = _task(
        obra, ctx["tenant"], "Hito", status=TaskStatus.PENDIENTE, is_milestone=True,
        responsible_id=resp.id,
    )
    db.add_all([dep_target, ok, sin_fechas, sin_responsable, hito_sin_fecha])
    await db.flush()

    await db.execute(task_dependencies_table.insert().values(
        task_id=ok.id, depends_on_id=dep_target.id, dependency_type="FS", lag_days=0))
    await db.flush()

    body = await ObraDashboardService(db).get_dashboard(obra.id)

    assert body["data_quality"]["tasks_without_dates"] == 1  # sin_fechas
    assert body["data_quality"]["tasks_without_responsible"] == 1  # sin_responsable
    assert body["data_quality"]["milestones_without_dates"] == 1  # hito_sin_fecha
    # linked: ok (tiene dependencia) y dep_target (es predecesora de ok) -> quedan
    # afuera sin_fechas, sin_responsable e hito_sin_fecha = 3
    assert body["data_quality"]["tasks_without_dependencies"] == 3


async def test_baseline_no_guardada(ctx, db):
    obra = await ctx["new_obra"]("Sin línea base")
    db.add(_task(obra, ctx["tenant"], "Tarea", start_date=HOY, due_date=HOY + timedelta(days=5)))
    await db.flush()

    body = await ObraDashboardService(db).get_dashboard(obra.id)

    assert body["baseline"]["available"] is False
    assert body["baseline"]["reason"] == "no_baseline"


async def test_baseline_desviacion_y_tareas_agregadas(ctx, db):
    obra = await ctx["new_obra"]("Con línea base")
    desviada = _task(obra, ctx["tenant"], "Desviada", status=TaskStatus.PENDIENTE,
                      start_date=LUNES, due_date=LUNES_SIGUIENTE)
    a_tiempo = _task(obra, ctx["tenant"], "A tiempo", status=TaskStatus.PENDIENTE,
                      start_date=LUNES, due_date=LUNES)
    agregada_despues = _task(obra, ctx["tenant"], "Agregada después", status=TaskStatus.PENDIENTE,
                              start_date=LUNES, due_date=LUNES_MAS_DOS_SEMANAS)
    db.add_all([desviada, a_tiempo, agregada_despues])
    await db.flush()

    db.add_all([
        TaskBaseline(obra_id=obra.id, task_id=desviada.id, tenant_id=ctx["tenant"].id,
                     baseline_start=LUNES, baseline_finish=LUNES),
        TaskBaseline(obra_id=obra.id, task_id=a_tiempo.id, tenant_id=ctx["tenant"].id,
                     baseline_start=LUNES, baseline_finish=LUNES),
    ])
    await db.flush()

    body = await ObraDashboardService(db).get_dashboard(obra.id)
    baseline = body["baseline"]

    assert baseline["available"] is True
    assert baseline["tasks_total_in_baseline"] == 2
    assert baseline["tasks_deviated"] == 1
    assert baseline["tasks_added_after_baseline"] == 1
    # única desviada: LUNES -> LUNES_SIGUIENTE = 6 días laborales (calendario default)
    assert baseline["avg_deviation_days"] == pytest.approx(6.0)
    # fin de línea base (LUNES) vs. fin actual de TODA la obra (LUNES_MAS_DOS_SEMANAS) = 12
    assert baseline["end_deviation_days"] == 12


async def test_critical_path_sin_dependencias(ctx, db):
    obra = await ctx["new_obra"]("Sin dependencias")
    db.add(_task(obra, ctx["tenant"], "Suelta", start_date=HOY, due_date=HOY + timedelta(days=5)))
    await db.flush()

    body = await ObraDashboardService(db).get_dashboard(obra.id)

    assert body["critical_path"]["available"] is False
    assert body["critical_path"]["reason"] == "no_dependencies"


async def test_critical_path_con_dependencias(ctx, db):
    """A -> B y A -> D (FS, lag 0), más C suelta. Los floats se verifican a
    mano con el mismo algoritmo de compute_critical_path_unchecked:
    A y B quedan críticos (float 0), D en riesgo (float 2), C holgada (float 7)."""
    obra = await ctx["new_obra"]("Con dependencias")
    a = _task(obra, ctx["tenant"], "A", start_date=date(2026, 1, 1), due_date=date(2026, 1, 6))
    b = _task(obra, ctx["tenant"], "B", start_date=date(2026, 1, 6), due_date=date(2026, 1, 10))
    d = _task(obra, ctx["tenant"], "D", start_date=date(2026, 1, 6), due_date=date(2026, 1, 8))
    c = _task(obra, ctx["tenant"], "C", start_date=date(2026, 1, 1), due_date=date(2026, 1, 3))
    db.add_all([a, b, d, c])
    await db.flush()

    for dependiente in (b, d):
        await db.execute(task_dependencies_table.insert().values(
            task_id=dependiente.id, depends_on_id=a.id, dependency_type="FS", lag_days=0))
    await db.flush()

    body = await ObraDashboardService(db).get_dashboard(obra.id)
    cp = body["critical_path"]

    assert cp["available"] is True
    assert cp["critical_task_count"] == 2       # A, B
    assert cp["at_risk_task_count"] == 1        # D (float 2)
    assert cp["slack_task_count"] == 1          # C (float 7)
    assert cp["median_float_days"] == pytest.approx(4.5)  # mediana de [2, 7]
    assert cp["coverage_percent"] == 100.0
    assert cp["partial"] is False


async def test_hitos_sin_ninguno(ctx, db):
    obra = await ctx["new_obra"]("Sin hitos")
    db.add(_task(obra, ctx["tenant"], "Tarea normal", status=TaskStatus.PENDIENTE))
    await db.flush()

    body = await ObraDashboardService(db).get_dashboard(obra.id)

    assert body["milestones"]["available"] is False
    assert body["milestones"]["items"] == []


async def test_hitos_estados(ctx, db):
    obra = await ctx["new_obra"]("Con hitos")
    cumplido = _task(obra, ctx["tenant"], "Cumplido", status=TaskStatus.COMPLETADA, is_milestone=True,
                      due_date=date(2026, 1, 10), completed_date=date(2026, 1, 8))
    tarde = _task(obra, ctx["tenant"], "Tarde", status=TaskStatus.COMPLETADA, is_milestone=True,
                  due_date=date(2026, 1, 5), completed_date=date(2026, 1, 7))
    en_riesgo = _task(obra, ctx["tenant"], "En riesgo", status=TaskStatus.PENDIENTE, is_milestone=True,
                       due_date=HOY - timedelta(days=1))
    pendiente = _task(obra, ctx["tenant"], "Pendiente", status=TaskStatus.PENDIENTE, is_milestone=True,
                       due_date=HOY + timedelta(days=30))
    db.add_all([cumplido, tarde, en_riesgo, pendiente])
    await db.flush()

    body = await ObraDashboardService(db).get_dashboard(obra.id)
    estados = {item["title"]: item["state"] for item in body["milestones"]["items"]}

    assert body["milestones"]["available"] is True
    assert estados["Cumplido"] == "cumplido"
    assert estados["Tarde"] == "tarde"
    assert estados["En riesgo"] == "en_riesgo"
    assert estados["Pendiente"] == "pendiente"


async def test_materiales_sin_cargar(ctx, db):
    obra = await ctx["new_obra"]("Sin materiales")
    db.add(_task(obra, ctx["tenant"], "Tarea", status=TaskStatus.PENDIENTE))
    await db.flush()

    body = await ObraDashboardService(db).get_dashboard(obra.id)

    assert body["materials"]["available"] is False
    assert body["materials"]["reason"] == "no_materials"


async def test_materiales_ejecucion_y_alineacion(ctx, db):
    """Tarea única completada (real_percent=100) + materiales en los 3 estados.
    total_estimado=210, total_pedido=100, total_recibido=60 — verificado a mano."""
    obra = await ctx["new_obra"]("Con materiales")
    tarea = _task(obra, ctx["tenant"], "Única", status=TaskStatus.COMPLETADA)
    db.add(tarea)
    await db.flush()

    db.add_all([
        TaskMaterial(task_id=tarea.id, tenant_id=ctx["tenant"].id, name="Cemento",
                     quantity=10, unit_price=5, status="pendiente"),
        TaskMaterial(task_id=tarea.id, tenant_id=ctx["tenant"].id, name="Arena",
                     quantity=4, unit_price=25, status="pedido"),
        TaskMaterial(task_id=tarea.id, tenant_id=ctx["tenant"].id, name="Ladrillos",
                     quantity=2, unit_price=30, status="recibido"),
    ])
    await db.flush()

    body = await ObraDashboardService(db).get_dashboard(obra.id)
    materials = body["materials"]

    assert body["progress"]["real_percent"] == 100.0
    assert materials["available"] is True
    assert materials["total_estimado"] == pytest.approx(210.0)
    assert materials["total_pedido"] == pytest.approx(100.0)
    assert materials["total_recibido"] == pytest.approx(60.0)
    assert materials["percent_committed"] == pytest.approx(100 / 210 * 100)
    assert materials["percent_received"] == pytest.approx(60 / 210 * 100)
    assert materials["alignment_delta"] == pytest.approx(60 / 210 * 100 - 100.0)


async def test_dashboard_requiere_acceso_a_la_obra(ctx, db, client):
    """Un usuario sin fila de rol en la obra (y no admin) la ve como
    inexistente — mismo comportamiento que /critical-path."""
    obra = await ctx["new_obra"]("Restringida")
    intruso = User(email="intruso@x.com", hashed_password="x", full_name="Intruso",
                    role="user", is_active=True, tenant_id=ctx["tenant"].id)
    db.add(intruso)
    await db.flush()
    await db.commit()

    r = await client.get(
        f"{API}/obras/{obra.id}/dashboard",
        headers={"Authorization": f"Bearer {create_access_token(intruso.id)}"},
    )
    assert r.status_code == 404
