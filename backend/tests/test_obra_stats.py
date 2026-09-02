"""Motor de estadísticas de obra (insights, etapa 2).

Cada test arma los datos a propósito para que el resultado esperado se pueda
calcular a mano, y lo deja escrito en el docstring/comentario. Una obra distinta
por test: así los números de un caso no contaminan al otro.
"""
from datetime import date, datetime, timezone

import pytest_asyncio

from app.models.alert import Alert, AlertType
from app.models.bitacora import BitacoraEntry
from app.models.historial import HistorialEvento
from app.models.obra import Obra
from app.models.obra_stats_snapshot import ObraStatsSnapshot
from app.models.responsible import Responsible
from app.models.task import Task, TaskStatus
from app.models.tenant import Tenant
from app.models.user import User
from app.services.obra_stats_service import ObraStatsService, previous_period


def _dt(y: int, m: int, d: int, hour: int = 0) -> datetime:
    return datetime(y, m, d, hour, tzinfo=timezone.utc)


@pytest_asyncio.fixture
async def ctx(db):
    """Tenant + user + una obra por test (el test elige cuál usar)."""
    tenant = Tenant(name="Empresa Insights")
    db.add(tenant)
    await db.flush()
    user = User(email="insights@x.com", hashed_password="x", full_name="Jefe",
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


async def _started_event(db, obra: Obra, task: Task, when: datetime) -> None:
    """Evento de historial que marca el inicio REAL (pasó a en_progreso)."""
    db.add(HistorialEvento(
        obra_id=obra.id, task_id=task.id, event_type="task_status_changed",
        description="Status: pendiente → en_progreso",
        payload={"from": "pendiente", "to": "en_progreso"},
        triggered_by="user", created_at=when,
    ))


# ── Métrica 1 — precisión de estimación por disciplina ────────────────────────

async def test_estimation_accuracy_por_disciplina(ctx, db):
    """3 tareas de electricidad con desvíos conocidos + 1 de sanitarios.

    Electricidad (planificado inclusive = due - start + 1; real = completed - inicio_real + 1):
      T1: plan 01→05 jun = 5 días, real 01→10 jun = 10 días → (10-5)/5  = +100 %
      T2: plan 01→04 jun = 4 días, real 01→05 jun =  5 días → (5-4)/4   =  +25 %
      T3: plan 01→10 jun = 10 días, real 01→05 jun = 5 días → (5-10)/10 =  -50 %
      promedio = (100 + 25 - 50) / 3 = 25.0 %
    Sanitarios:
      T4: plan 01→02 jun = 2 días, real 01→03 jun = 3 días → +50 %
    T5 queda sin completar → se excluye.
    """
    obra = await ctx["new_obra"]("Obra estimación")
    tenant = ctx["tenant"]

    t1 = _task(obra, tenant, "Instalación eléctrica planta baja", status=TaskStatus.COMPLETADA,
               start_date=date(2026, 6, 1), due_date=date(2026, 6, 5), completed_date=date(2026, 6, 10))
    t2 = _task(obra, tenant, "Tablero principal", status=TaskStatus.COMPLETADA,
               start_date=date(2026, 6, 1), due_date=date(2026, 6, 4), completed_date=date(2026, 6, 5))
    t3 = _task(obra, tenant, "Iluminación exterior", status=TaskStatus.COMPLETADA,
               start_date=date(2026, 6, 1), due_date=date(2026, 6, 10), completed_date=date(2026, 6, 5))
    t4 = _task(obra, tenant, "Plomería de baños", status=TaskStatus.COMPLETADA,
               start_date=date(2026, 6, 1), due_date=date(2026, 6, 2), completed_date=date(2026, 6, 3))
    t5 = _task(obra, tenant, "Tablero secundario", status=TaskStatus.EN_PROGRESO,
               start_date=date(2026, 6, 1), due_date=date(2026, 6, 20))
    db.add_all([t1, t2, t3, t4, t5])
    await db.flush()

    for t in (t1, t2, t3, t4):
        await _started_event(db, obra, t, _dt(2026, 6, 1, 8))
    await db.flush()

    metrics = await ObraStatsService(db).compute(obra.id, "2026-06")
    acc = metrics["estimation_accuracy"]

    assert acc["tasks_considered"] == 4
    assert acc["tasks_excluded"]["sin_completar"] == 1

    by_disc = {d["discipline"]: d for d in acc["by_discipline"]}
    assert by_disc["electricidad"]["task_count"] == 3
    assert by_disc["electricidad"]["avg_deviation_percent"] == 25.0
    assert by_disc["sanitarios"]["avg_deviation_percent"] == 50.0

    per_task = {t["task_id"]: t for t in by_disc["electricidad"]["tasks"]}
    assert per_task[t1.id]["planned_days"] == 5 and per_task[t1.id]["actual_days"] == 10
    assert per_task[t1.id]["deviation_percent"] == 100.0
    assert per_task[t3.id]["deviation_percent"] == -50.0
    # El inicio real salió del historial, no de la fecha planificada
    assert per_task[t1.id]["actual_start_source"] == "historial_status_changed"


async def test_estimation_accuracy_sin_evento_usa_fecha_planificada(ctx, db):
    """Sin evento de 'en progreso', el inicio real cae a start_date y se declara."""
    obra = await ctx["new_obra"]("Obra sin historial")
    t = _task(obra, ctx["tenant"], "Cableado eléctrico", status=TaskStatus.COMPLETADA,
              start_date=date(2026, 6, 1), due_date=date(2026, 6, 5), completed_date=date(2026, 6, 7))
    db.add(t)
    await db.flush()

    acc = (await ObraStatsService(db).compute(obra.id, "2026-06"))["estimation_accuracy"]
    row = acc["by_discipline"][0]["tasks"][0]
    assert row["actual_start_source"] == "planned_start_date_fallback"
    # plan 5 días, real 01→07 = 7 días → (7-5)/5 = +40 %
    assert row["deviation_percent"] == 40.0


# ── Métrica 2 — temas de bitácora y correlación con retrasos ──────────────────

async def test_bitacora_themes_correlacion(ctx, db):
    """3 bitácoras, 2 categorías, ventana de 5 días.

      B1 01/06 'falta material'  → bloqueo el 03/06 (dentro de 5 días) → correlaciona
      B2 10/06 'falta material'  → nada hasta el 21/06 (fuera)         → NO correlaciona
      B3 20/06 'llovió'          → fecha empujada el 21/06 (dentro)    → correlaciona
    Esperado: falta_material 2 menciones / 1 con retraso (0.5); clima 1/1 (1.0).
    """
    obra = await ctx["new_obra"]("Obra bitácora")
    tenant = ctx["tenant"]
    task = _task(obra, tenant, "Losa primer piso", start_date=date(2026, 6, 1), due_date=date(2026, 6, 30))
    db.add(task)
    await db.flush()

    db.add_all([
        BitacoraEntry(obra_id=obra.id, tenant_id=tenant.id, status="procesado",
                      transcript="Hoy falta material para la losa", created_at=_dt(2026, 6, 1, 9)),
        BitacoraEntry(obra_id=obra.id, tenant_id=tenant.id, status="procesado",
                      transcript="De nuevo falta material", created_at=_dt(2026, 6, 10, 9)),
        BitacoraEntry(obra_id=obra.id, tenant_id=tenant.id, status="procesado",
                      transcript="Llovió toda la jornada", created_at=_dt(2026, 6, 20, 9)),
    ])
    # Señal 1: bloqueo dentro de la ventana de B1
    db.add(HistorialEvento(
        obra_id=obra.id, task_id=task.id, event_type="task_status_changed",
        description="Status: en_progreso → bloqueada",
        payload={"from": "en_progreso", "to": "bloqueada"},
        triggered_by="chatbot", created_at=_dt(2026, 6, 3, 10),
    ))
    # Señal 2: fecha de fin empujada, dentro de la ventana de B3
    db.add(HistorialEvento(
        obra_id=obra.id, task_id=task.id, event_type="task_updated",
        description="Tarea actualizada: fecha de fin",
        payload={"changes": {"due_date": {"from": "2026-06-30", "to": "2026-07-10"}}},
        triggered_by="user", created_at=_dt(2026, 6, 21, 11),
    ))
    await db.flush()

    themes = (await ObraStatsService(db).compute(obra.id, "2026-06"))["bitacora_themes"]
    assert themes["entries_analyzed"] == 3
    assert themes["entries_with_any_category"] == 3
    assert themes["delay_signals_total"] == 2

    cats = {c["category"]: c for c in themes["categories"]}
    assert cats["falta_material"]["mentions"] == 2
    assert cats["falta_material"]["mentions_followed_by_delay"] == 1
    assert cats["falta_material"]["correlation_rate"] == 0.5
    assert cats["clima"]["mentions"] == 1
    assert cats["clima"]["correlation_rate"] == 1.0

    # La ocurrencia correlacionada apunta al evento concreto que la respalda
    correlated = [o for o in cats["falta_material"]["occurrences"] if o["delay_signals"]][0]
    assert correlated["delay_signals"][0]["type"] == "task_blocked"


# ── Métrica 3 — evidencia de los mayores desvíos ──────────────────────────────

async def test_top_deviations_arma_paquete_de_evidencia(ctx, db):
    """4 tareas: desvíos +15, +2, +1 y 0 días. El top 3 excluye la de desvío 0."""
    obra = await ctx["new_obra"]("Obra desvíos")
    tenant = ctx["tenant"]
    due = date(2026, 6, 10)

    ta = _task(obra, tenant, "Hormigonado de losa", status=TaskStatus.COMPLETADA,
               start_date=date(2026, 6, 1), due_date=due, completed_date=date(2026, 6, 25))
    tb = _task(obra, tenant, "Mampostería", status=TaskStatus.COMPLETADA,
               start_date=date(2026, 6, 1), due_date=due, completed_date=date(2026, 6, 12))
    tc = _task(obra, tenant, "Revoques", status=TaskStatus.COMPLETADA,
               start_date=date(2026, 6, 1), due_date=due, completed_date=date(2026, 6, 11))
    td = _task(obra, tenant, "Pintura", status=TaskStatus.COMPLETADA,
               start_date=date(2026, 6, 1), due_date=due, completed_date=due)
    db.add_all([ta, tb, tc, td])
    await db.flush()

    db.add(HistorialEvento(
        obra_id=obra.id, task_id=ta.id, event_type="task_status_changed",
        description="Status: en_progreso → bloqueada",
        payload={"from": "en_progreso", "to": "bloqueada"},
        triggered_by="chatbot", created_at=_dt(2026, 6, 8, 10),
    ))
    db.add(HistorialEvento(
        obra_id=obra.id, task_id=ta.id, event_type="task_cascade_rescheduled",
        description="Se reprogramaron 1 tarea en cascada",
        payload={"source_task_id": ta.id, "affected": [{"task_id": tb.id, "title": "Mampostería"}]},
        triggered_by="user", created_at=_dt(2026, 6, 9, 10),
    ))
    db.add(BitacoraEntry(
        obra_id=obra.id, tenant_id=tenant.id, status="procesado",
        transcript="No llegó el material para el hormigonado", summary="Falta material",
        created_at=_dt(2026, 6, 7, 9),
    ))
    db.add(Alert(
        obra_id=obra.id, task_id=ta.id, tenant_id=tenant.id, type=AlertType.TASK_BLOCKED,
        message="La tarea 'Hormigonado de losa' fue bloqueada.", is_read=False,
        created_at=_dt(2026, 6, 8, 10),
    ))
    await db.flush()

    top = (await ObraStatsService(db).compute(obra.id, "2026-06"))["top_deviations"]
    assert top["count"] == 3
    ids = [i["task"]["task_id"] for i in top["items"]]
    assert ids == [ta.id, tb.id, tc.id]      # ordenado por desvío absoluto
    assert td.id not in ids                   # desvío 0 no entra

    worst = top["items"][0]
    assert worst["task"]["deviation_days"] == 15
    assert worst["task"]["basis"] == "completed_vs_due"
    assert {e["event_type"] for e in worst["historial_events"]} == {
        "task_status_changed", "task_cascade_rescheduled"
    }
    assert worst["bitacora_mentions"][0]["categories"] == ["falta_material"]
    assert worst["alerts"][0]["type"] == "task_blocked"
    assert worst["cascade_impact"]["tasks_pushed_by_cascade"] == [tb.id]


async def test_tarea_abierta_se_mide_contra_el_fin_del_periodo(ctx, db):
    """Sin completar: el desvío se mide contra el fin del período (30/06 - 10/06 = 20)."""
    obra = await ctx["new_obra"]("Obra abierta")
    t = _task(obra, ctx["tenant"], "Cubierta", status=TaskStatus.EN_PROGRESO,
              start_date=date(2026, 6, 1), due_date=date(2026, 6, 10))
    db.add(t)
    await db.flush()

    top = (await ObraStatsService(db).compute(obra.id, "2026-06"))["top_deviations"]
    assert top["items"][0]["task"]["deviation_days"] == 20
    assert top["items"][0]["task"]["basis"] == "open_vs_period_end"


async def test_completada_despues_del_periodo_cuenta_como_abierta(ctx, db):
    """El snapshot de junio no puede saber que la tarea cerró en julio."""
    obra = await ctx["new_obra"]("Obra cierre posterior")
    t = _task(obra, ctx["tenant"], "Carpintería", status=TaskStatus.COMPLETADA,
              start_date=date(2026, 6, 1), due_date=date(2026, 6, 10),
              completed_date=date(2026, 7, 20))
    db.add(t)
    await db.flush()

    metrics = await ObraStatsService(db).compute(obra.id, "2026-06")
    assert metrics["top_deviations"]["items"][0]["task"]["basis"] == "open_vs_period_end"
    assert metrics["top_deviations"]["items"][0]["task"]["deviation_days"] == 20
    assert metrics["estimation_accuracy"]["tasks_excluded"]["completada_despues_del_periodo"] == 1


async def test_completada_sin_fecha_no_inventa_atraso(ctx, db):
    """Caso real de la obra #5: status=completada pero completed_date=NULL.

    Hoy solo el endpoint /status setea completed_date; un PATCH genérico puede
    dejar la tarea cerrada sin ella. Medirla contra el fin del período daría un
    atraso enorme e inexistente, así que se excluye y se declara en data_quality.
    """
    obra = await ctx["new_obra"]("Obra completada sin fecha")
    db.add(_task(obra, ctx["tenant"], "Excavación y bases", status=TaskStatus.COMPLETADA,
                 start_date=date(2026, 6, 1), due_date=date(2026, 6, 7), completed_date=None))
    await db.flush()

    metrics = await ObraStatsService(db).compute(obra.id, "2026-06")
    assert metrics["top_deviations"]["count"] == 0
    assert metrics["risk_concentration"]["by_task"]["tasks_with_delay"] == 0
    gaps = metrics["data_quality"]["tasks_excluded_from_deviations"]
    assert gaps["completadas_sin_fecha_de_completado"] == 1


# ── Métrica 4 — concentración de riesgo (80/20) ───────────────────────────────

async def test_risk_concentration_80_20(ctx, db):
    """5 tareas atrasadas: 60, 10, 5, 3 y 2 días → total 80.

    Top 20 % de 5 tareas = ceil(1) = 1 tarea → 60 de 80 = 75.0 %.
    Por responsable: R1 carga la de 60; R2 las otras cuatro (10+5+3+2 = 20).
    Top 20 % de 2 responsables = ceil(0.4) = 1 → R1 con 60 de 80 = 75.0 %.
    """
    obra = await ctx["new_obra"]("Obra concentración")
    tenant = ctx["tenant"]
    r1 = Responsible(tenant_id=tenant.id, full_name="Juan Pérez",
                     whatsapp_number="+5490000000001")
    r2 = Responsible(tenant_id=tenant.id, full_name="Ana Gómez",
                     whatsapp_number="+5490000000002")
    db.add_all([r1, r2])
    await db.flush()

    due = date(2026, 6, 1)
    plan = [
        ("Excavación", date(2026, 7, 31), r1.id),   # 60 días
        ("Fundación", date(2026, 6, 11), r2.id),    # 10
        ("Estructura", date(2026, 6, 6), r2.id),    # 5
        ("Contrapiso", date(2026, 6, 4), r2.id),    # 3
        ("Carpeta", date(2026, 6, 3), r2.id),       # 2
    ]
    for title, completed, resp_id in plan:
        db.add(_task(obra, tenant, title, status=TaskStatus.COMPLETADA, responsible_id=resp_id,
                     start_date=date(2026, 5, 1), due_date=due, completed_date=completed))
    await db.flush()

    conc = (await ObraStatsService(db).compute(obra.id, "2026-08"))["risk_concentration"]

    by_task = conc["by_task"]
    assert by_task["tasks_with_delay"] == 5
    assert by_task["total_delay_days"] == 80
    assert by_task["top_task_count"] == 1
    assert by_task["top_delay_days"] == 60
    assert by_task["concentration_percent"] == 75.0

    by_resp = conc["by_responsible"]
    assert by_resp["responsibles_with_delay"] == 2
    assert by_resp["top_responsible_count"] == 1
    assert by_resp["concentration_percent"] == 75.0
    assert by_resp["ranking"][0]["name"] == "Juan Pérez"
    assert by_resp["ranking"][0]["delay_days"] == 60
    assert by_resp["ranking"][1]["delay_days"] == 20


# ── Métrica 5 — velocidad de reacción a alertas ───────────────────────────────

async def test_alert_reaction_por_tipo(ctx, db):
    """task_overdue: 2 h y 4 h → promedio 3.0. task_blocked: 10 h → 10.0.

    Una delay_risk sin resolver y una task_blocked resuelta SIN resolved_at
    (dato previo a la migración 0062) quedan fuera del promedio y se reportan.
    """
    obra = await ctx["new_obra"]("Obra alertas")
    tenant = ctx["tenant"]
    db.add_all([
        Alert(obra_id=obra.id, tenant_id=tenant.id, type=AlertType.TASK_OVERDUE,
              message="Vencida A", is_read=True,
              created_at=_dt(2026, 6, 1, 0), resolved_at=_dt(2026, 6, 1, 2)),
        Alert(obra_id=obra.id, tenant_id=tenant.id, type=AlertType.TASK_OVERDUE,
              message="Vencida B", is_read=True,
              created_at=_dt(2026, 6, 2, 0), resolved_at=_dt(2026, 6, 2, 4)),
        Alert(obra_id=obra.id, tenant_id=tenant.id, type=AlertType.TASK_BLOCKED,
              message="Bloqueada C", is_read=True,
              created_at=_dt(2026, 6, 3, 0), resolved_at=_dt(2026, 6, 3, 10)),
        Alert(obra_id=obra.id, tenant_id=tenant.id, type=AlertType.DELAY_RISK,
              message="Riesgo D", is_read=False, created_at=_dt(2026, 6, 4, 0)),
        Alert(obra_id=obra.id, tenant_id=tenant.id, type=AlertType.TASK_BLOCKED,
              message="Vieja E", is_read=True, created_at=_dt(2026, 6, 5, 0)),
    ])
    await db.flush()

    reaction = (await ObraStatsService(db).compute(obra.id, "2026-06"))["alert_reaction"]
    assert reaction["alerts_total"] == 5
    assert reaction["alerts_measured"] == 3
    assert reaction["alerts_resolved_without_timestamp"] == 1
    assert reaction["alerts_unresolved_by_type"] == {"delay_risk": 1}

    by_type = {r["type"]: r for r in reaction["by_type"]}
    assert by_type["task_overdue"]["avg_hours"] == 3.0
    assert by_type["task_overdue"]["resolved_count"] == 2
    assert by_type["task_blocked"]["avg_hours"] == 10.0
    # (2 + 4 + 10) / 3 = 5.33
    assert reaction["overall_avg_hours"] == 5.33


async def test_marcar_alerta_leida_setea_resolved_at(ctx, db):
    """Regresión: sin resolved_at la métrica 5 no se puede calcular."""
    from app.services.alert_service import AlertService

    obra = await ctx["new_obra"]("Obra resolved_at")
    alert = Alert(obra_id=obra.id, tenant_id=ctx["tenant"].id, type=AlertType.TASK_OVERDUE,
                  message="Vencida", is_read=False)
    db.add(alert)
    await db.flush()

    updated = await AlertService(db).mark_read(alert.id)
    assert updated.is_read is True
    assert updated.resolved_at is not None


# ── Persistencia del snapshot ─────────────────────────────────────────────────

async def test_snapshot_se_guarda_y_es_idempotente_por_periodo(ctx, db):
    """Recalcular el mismo (obra, period) pisa la fila, no crea una segunda."""
    from sqlalchemy import select

    obra = await ctx["new_obra"]("Obra snapshot")
    db.add(_task(obra, ctx["tenant"], "Instalación eléctrica", status=TaskStatus.COMPLETADA,
                 start_date=date(2026, 6, 1), due_date=date(2026, 6, 5),
                 completed_date=date(2026, 6, 8)))
    await db.flush()

    service = ObraStatsService(db)
    first = await service.snapshot(obra.id, "2026-06")
    assert first.period == "2026-06"
    assert first.tenant_id == ctx["tenant"].id
    assert first.metrics["schema_version"] == 1
    assert first.metrics["obra"]["id"] == obra.id

    await service.snapshot(obra.id, "2026-06")
    rows = (await db.execute(
        select(ObraStatsSnapshot).where(ObraStatsSnapshot.obra_id == obra.id)
    )).scalars().all()
    assert len(rows) == 1


async def test_snapshot_all_active_saltea_completadas_y_canceladas(ctx, db):
    """El job mensual procesa solo obras activas."""
    from app.models.obra import ObraStatus

    activa = await ctx["new_obra"]("Activa")
    completada = await ctx["new_obra"]("Completada")
    completada.status = ObraStatus.COMPLETADA
    cancelada = await ctx["new_obra"]("Cancelada")
    cancelada.status = ObraStatus.CANCELADA
    await db.flush()

    snapshots = await ObraStatsService(db).snapshot_all_active("2026-06")
    obra_ids = {s.obra_id for s in snapshots}
    assert activa.id in obra_ids
    assert completada.id not in obra_ids
    assert cancelada.id not in obra_ids


def test_previous_period_es_el_mes_cerrado():
    """El job del día 1 reporta el mes que acaba de cerrar (incluye cruce de año)."""
    assert previous_period(date(2026, 9, 2)) == "2026-08"
    assert previous_period(date(2026, 1, 1)) == "2025-12"
