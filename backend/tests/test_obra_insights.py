"""Redacción de conclusiones con IA (insights, etapa 3).

La llamada al modelo se mockea (`_call_model`) para que los tests sean
determinísticos y no necesiten API key: lo que se prueba acá es la validación
anti-alucinación y el ciclo de vida, que son código nuestro, no la IA.
"""
from datetime import datetime, timezone

import pytest_asyncio
from sqlalchemy import select

from app.models.obra import Obra
from app.models.obra_insight import InsightStatus, ObraInsight
from app.models.obra_stats_snapshot import ObraStatsSnapshot
from app.models.tenant import Tenant
from app.models.user import User
from app.services.obra_insight_service import ObraInsightService

PERIOD = "2026-06"

# Snapshot mínimo pero con la forma real de la etapa 2.
SNAPSHOT = {
    "schema_version": 1,
    "obra": {"id": 1, "name": "Obra Test", "task_count": 9},
    "period": PERIOD,
    "data_quality": {"tasks_excluded_from_deviations": {}},
    "estimation_accuracy": {
        "by_discipline": [
            {"discipline": "electricidad", "task_count": 3, "avg_deviation_percent": 25.0}
        ]
    },
    "bitacora_themes": {
        "categories": [
            {"category": "falta_material", "mentions": 5,
             "mentions_followed_by_delay": 4, "correlation_rate": 0.8}
        ]
    },
    "top_deviations": {
        "items": [
            {"task": {"task_id": 36, "title": "Estructura y losa", "deviation_days": 39}}
        ]
    },
    "risk_concentration": {
        "by_task": {"tasks_with_delay": 7, "total_delay_days": 210,
                    "concentration_percent": 34.8},
        "by_responsible": {"concentration_percent": 39.0},
    },
    "alert_reaction": {"by_type": [{"type": "task_overdue", "avg_hours": 3.0}]},
}


def _conclusion(**over) -> dict:
    """Respuesta tipo de la IA, con la forma que exige el schema actual."""
    base = {
        "metric": "bitacora_themes",
        "subject": "falta_material",
        "priority": "alta",
        "title": "La falta de material precede a los retrasos",
        "situation": (
            "Se mencionó falta de material 5 veces y en 4 de esas hubo un retraso "
            "en los días siguientes."
        ),
        "decision": "Confirmá el stock la semana previa a cada hormigonado.",
        "impact": "Evitás que se repita el patrón en las 5 tareas que vienen.",
        "evidence": [
            {"path": "bitacora_themes.categories.0.mentions", "value": "5"},
            {"path": "bitacora_themes.categories.0.mentions_followed_by_delay", "value": "4"},
        ],
    }
    base.update(over)
    return base


@pytest_asyncio.fixture
async def ctx(db):
    tenant = Tenant(name="Empresa Insights3")
    db.add(tenant)
    await db.flush()
    user = User(email="i3@x.com", hashed_password="x", full_name="Jefe",
                role="admin", is_active=True, tenant_id=tenant.id)
    db.add(user)
    await db.flush()
    obra = Obra(name="Obra Test", manager_id=user.id, tenant_id=tenant.id)
    db.add(obra)
    await db.flush()
    db.add(ObraStatsSnapshot(obra_id=obra.id, tenant_id=tenant.id,
                             period=PERIOD, metrics=SNAPSHOT))
    await db.flush()
    return {"obra": obra, "tenant": tenant}


def _service(db, conclusions: list[dict]) -> ObraInsightService:
    """Servicio con la llamada a la IA mockeada."""
    service = ObraInsightService(db)

    async def fake_call(metrics):
        return conclusions

    service._call_model = fake_call  # type: ignore[method-assign]
    return service


# ── Creación ──────────────────────────────────────────────────────────────────

async def test_conclusion_nueva_se_crea(ctx, db):
    obra = ctx["obra"]
    rows = await _service(db, [_conclusion()]).generate_for_obra(obra.id, PERIOD)

    assert len(rows) == 1
    row = rows[0]
    assert row.status == InsightStatus.NUEVA
    assert row.reinforcement_count == 0
    assert row.topic_key == "bitacora_themes:falta_material"
    assert row.metric == "bitacora_themes"
    assert row.first_period == PERIOD and row.last_period == PERIOD
    assert row.tenant_id == ctx["tenant"].id
    # La narrativa se guarda tal cual la escribió la IA
    assert "5 veces" in row.description          # `situation` se guarda como description
    assert row.recommendation.startswith("Confirmá el stock")
    assert row.impact.startswith("Evitás que se repita")
    assert row.priority == "alta"
    # strength = cantidad de menciones de esa categoría en el snapshot
    assert row.strength == 5.0


async def test_conclusiones_de_varias_metricas_conviven(ctx, db):
    obra = ctx["obra"]
    otra = _conclusion(
        metric="risk_concentration", subject="by_task",
        title="El atraso está repartido, no concentrado",
        situation="Las 7 tareas atrasadas suman 210 días y el top concentra el 34.8 %.",
        evidence=[{"path": "risk_concentration.by_task.concentration_percent", "value": "34.8"}],
    )
    rows = await _service(db, [_conclusion(), otra]).generate_for_obra(obra.id, PERIOD)

    assert {r.topic_key for r in rows} == {
        "bitacora_themes:falta_material", "risk_concentration:by_task"
    }


# ── Refuerzo ──────────────────────────────────────────────────────────────────

async def test_conclusion_repetida_refuerza_y_no_duplica(ctx, db):
    """El mismo patrón dos meses seguidos actualiza la fila, no crea otra."""
    obra = ctx["obra"]
    await _service(db, [_conclusion()]).generate_for_obra(obra.id, PERIOD)

    db.add(ObraStatsSnapshot(obra_id=obra.id, tenant_id=ctx["tenant"].id,
                             period="2026-07", metrics=SNAPSHOT))
    await db.flush()

    nueva_redaccion = _conclusion(
        situation="Se mencionó falta de material 5 veces y hubo retraso en 4 de ellas.",
    )
    rows = await _service(db, [nueva_redaccion]).generate_for_obra(obra.id, "2026-07")

    assert len(rows) == 1
    assert rows[0].reinforcement_count == 1
    assert rows[0].last_period == "2026-07"
    assert rows[0].first_period == PERIOD          # conserva cuándo apareció
    assert "en 4 de ellas" in rows[0].description  # se actualiza con lo último

    all_rows = (await db.execute(
        select(ObraInsight).where(ObraInsight.obra_id == obra.id)
    )).scalars().all()
    assert len(all_rows) == 1


async def test_conclusion_no_reforzada_queda_intacta(ctx, db):
    """Si un patrón no aparece este ciclo, su fila no se toca."""
    obra = ctx["obra"]
    await _service(db, [_conclusion()]).generate_for_obra(obra.id, PERIOD)
    original = (await db.execute(select(ObraInsight))).scalars().one()
    original.status = InsightStatus.VISTA
    await db.flush()

    db.add(ObraStatsSnapshot(obra_id=obra.id, tenant_id=ctx["tenant"].id,
                             period="2026-07", metrics=SNAPSHOT))
    await db.flush()
    # Este ciclo la IA solo habla de otra métrica
    otra = _conclusion(
        metric="alert_reaction", subject="task_overdue",
        title="Las alertas vencidas se atienden rápido",
        situation="Las alertas de vencimiento se resuelven en 3.0 horas promedio.",
        evidence=[{"path": "alert_reaction.by_type.0.avg_hours", "value": "3.0"}],
    )
    await _service(db, [otra]).generate_for_obra(obra.id, "2026-07")

    refreshed = await db.get(ObraInsight, original.id)
    assert refreshed.status == InsightStatus.VISTA
    assert refreshed.reinforcement_count == 0
    assert refreshed.last_period == PERIOD


# ── Descartadas y resurgimiento ───────────────────────────────────────────────

async def _dismissed_insight(db, obra, tenant, strength: float) -> ObraInsight:
    row = ObraInsight(
        obra_id=obra.id, tenant_id=tenant.id, metric="bitacora_themes",
        topic_key="bitacora_themes:falta_material", title="Vieja", description="Vieja",
        evidence=[], status=InsightStatus.DESCARTADA, reinforcement_count=0,
        strength=strength, first_period="2026-05", last_period="2026-05",
        dismissed_at=datetime.now(timezone.utc),
    )
    db.add(row)
    await db.flush()
    return row


async def test_descartada_no_resurge_con_evidencia_debil(ctx, db):
    """Descartada con 3 menciones; ahora hay 5 → no llega al doble, no resurge."""
    obra, tenant = ctx["obra"], ctx["tenant"]
    dismissed = await _dismissed_insight(db, obra, tenant, strength=3.0)

    rows = await _service(db, [_conclusion()]).generate_for_obra(obra.id, PERIOD)

    assert rows == []
    all_rows = (await db.execute(
        select(ObraInsight).where(ObraInsight.obra_id == obra.id)
    )).scalars().all()
    assert len(all_rows) == 1
    assert all_rows[0].id == dismissed.id
    assert all_rows[0].status == InsightStatus.DESCARTADA


async def test_descartada_resurge_con_evidencia_fuerte(ctx, db):
    """Descartada con 2 menciones; ahora hay 5 → supera el doble, resurge."""
    obra, tenant = ctx["obra"], ctx["tenant"]
    dismissed = await _dismissed_insight(db, obra, tenant, strength=2.0)

    rows = await _service(db, [_conclusion()]).generate_for_obra(obra.id, PERIOD)

    assert len(rows) == 1
    resurfaced = rows[0]
    assert resurfaced.id != dismissed.id                       # fila nueva
    assert resurfaced.status == InsightStatus.NUEVA
    assert resurfaced.resurfaced_from_insight_id == dismissed.id
    assert resurfaced.strength == 5.0
    # La descartada original queda como estaba
    assert (await db.get(ObraInsight, dismissed.id)).status == InsightStatus.DESCARTADA


# ── Validación anti-alucinación ───────────────────────────────────────────────

async def test_numero_inventado_se_descarta(ctx, db):
    """La IA cita un 87 % que no está en ningún lado del snapshot."""
    obra = ctx["obra"]
    mentirosa = _conclusion(
        situation="La falta de material explica el 87 % de los retrasos de la obra.",
    )
    rows = await _service(db, [mentirosa]).generate_for_obra(obra.id, PERIOD)

    assert rows == []
    assert (await db.execute(select(ObraInsight))).scalars().all() == []


async def test_evidencia_con_ruta_inexistente_se_descarta(ctx, db):
    """Si ningún ítem de evidencia resuelve, la conclusión no se guarda."""
    obra = ctx["obra"]
    rows = await _service(db, [_conclusion(
        evidence=[{"path": "bitacora_themes.categories.9.mentions", "value": "5"}],
    )]).generate_for_obra(obra.id, PERIOD)
    assert rows == []


async def test_evidencia_con_valor_que_no_coincide_se_descarta(ctx, db):
    """La ruta existe pero el valor citado no es el que hay en el snapshot."""
    obra = ctx["obra"]
    rows = await _service(db, [_conclusion(
        situation="Se mencionó falta de material varias veces.",
        evidence=[{"path": "bitacora_themes.categories.0.mentions", "value": "12"}],
    )]).generate_for_obra(obra.id, PERIOD)
    assert rows == []


async def test_evidencia_invalida_se_poda_pero_la_conclusion_sobrevive(ctx, db):
    """Un ítem malo se descarta; si queda al menos uno bueno, la conclusión vale."""
    obra = ctx["obra"]
    rows = await _service(db, [_conclusion(
        evidence=[
            {"path": "bitacora_themes.categories.0.mentions", "value": "5"},
            {"path": "no.existe.esta.ruta", "value": "99"},
        ],
    )]).generate_for_obra(obra.id, PERIOD)

    assert len(rows) == 1
    assert rows[0].evidence == [{"path": "bitacora_themes.categories.0.mentions", "value": "5"}]


async def test_evidencia_con_notacion_de_corchetes_resuelve(ctx, db):
    """Regresión: el modelo cita `items[0].task`, no `items.0.task`.

    Con el resolvedor original esto descartaba evidencia perfectamente válida
    (detectado corriendo contra la IA real, no en la teoría).
    """
    obra = ctx["obra"]
    rows = await _service(db, [_conclusion(
        metric="schedule_deviation", subject="task_36",
        title="Estructura y losa arrastró al resto",
        situation="La tarea acumuló 39 días de desvío.",
        evidence=[{"path": "top_deviations.items[0].task.deviation_days", "value": "39"}],
    )]).generate_for_obra(obra.id, PERIOD)

    assert len(rows) == 1
    assert rows[0].evidence[0]["path"] == "top_deviations.items[0].task.deviation_days"


async def test_redondeo_legitimo_no_se_descarta(ctx, db):
    """Escribir '35 %' para un 34.8 del snapshot es redacción, no invención."""
    obra = ctx["obra"]
    rows = await _service(db, [_conclusion(
        metric="risk_concentration", subject="by_task",
        title="Atraso repartido",
        situation="El top de tareas concentra cerca del 35 % del atraso acumulado.",
        evidence=[{"path": "risk_concentration.by_task.concentration_percent", "value": "34.8"}],
    )]).generate_for_obra(obra.id, PERIOD)
    assert len(rows) == 1


async def test_fechas_del_snapshot_no_cuentan_como_numeros_inventados(ctx, db):
    """Los dígitos de un título o una fecha del snapshot no son cifras citadas."""
    obra = ctx["obra"]
    rows = await _service(db, [_conclusion(
        metric="schedule_deviation", subject="task_36",
        title="Estructura y losa arrastró al resto",
        situation="La tarea 'Estructura y losa' acumuló 39 días de desvío.",
        evidence=[{"path": "top_deviations.items.0.task.deviation_days", "value": "39"}],
    )]).generate_for_obra(obra.id, PERIOD)
    assert len(rows) == 1


# ── Robustez del job ──────────────────────────────────────────────────────────

async def test_sin_snapshot_no_guarda_nada(ctx, db):
    """Una obra sin snapshot de ese mes se saltea sin romper."""
    obra = ctx["obra"]
    rows = await _service(db, [_conclusion()]).generate_for_obra(obra.id, "2099-01")
    assert rows == []


async def test_fallo_de_la_ia_no_tumba_el_job(ctx, db):
    """Si la IA explota para una obra, el job sigue con las demás."""
    obra = ctx["obra"]
    service = ObraInsightService(db)

    async def boom(metrics):
        raise RuntimeError("la API se cayó")

    service._call_model = boom  # type: ignore[method-assign]
    total = await service.generate_for_all_active(PERIOD)

    assert total == 0
    assert (await db.execute(select(ObraInsight))).scalars().all() == []
    assert obra.id is not None
