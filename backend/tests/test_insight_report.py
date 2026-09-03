"""Informe completo imprimible: contenido, gráficos y acceso por link firmado."""
import urllib.parse as up
from dataclasses import dataclass, field

import pytest_asyncio

from app.core.signing import sign_report_query
from app.models.obra import Obra
from app.models.obra_insight import InsightStatus, ObraInsight
from app.models.obra_stats_snapshot import ObraStatsSnapshot
from app.models.tenant import Tenant
from app.models.user import User
from app.services.insight_report_service import build_full_report_html

API = "/api/v1"
PERIOD = "2026-09"

METRICS = {
    "schema_version": 1,
    "obra": {"id": 1, "name": "Obra Test", "task_count": 8, "completed_task_count": 2},
    "params": {"concentration_top_percent": 20},
    "data_quality": {"tasks_excluded_from_deviations": {"completadas_sin_fecha_de_completado": 2}},
    "estimation_accuracy": {
        "tasks_excluded": {"sin_completar": 6},
        "by_discipline": [
            {"discipline": "electricidad", "avg_deviation_percent": 25.0, "task_count": 3},
            {"discipline": "sanitarios", "avg_deviation_percent": -10.0, "task_count": 2},
        ],
    },
    "bitacora_themes": {
        "entries_analyzed": 4, "correlation_window_days": 5,
        "categories": [{"category": "falta_material", "mentions": 5,
                        "mentions_followed_by_delay": 4, "correlation_rate": 0.8}],
    },
    "top_deviations": {
        "items": [{
            "task": {"task_id": 46, "title": "Instalación eléctrica", "status": "pendiente",
                     "start_date": "2026-08-09", "due_date": "2026-08-14",
                     "completed_date": None, "deviation_days": 47},
            "historial_events": [{"created_at": "2026-08-22T10:00:00+00:00",
                                  "description": "La tarea está vencida"}],
            "alerts": [{"created_at": "2026-08-22T10:00:00+00:00",
                        "message": "Tarea vencida", "on_predecessor": False}],
            "cascade_impact": {"direct_dependent_count": 2, "direct_dependent_task_ids": [47, 48]},
        }],
    },
    "risk_concentration": {
        "by_task": {"tasks_considered": 6, "tasks_with_delay": 6, "total_delay_days": 246,
                    "top_task_count": 2, "concentration_percent": 37.4,
                    "ranking": [{"title": "Instalación eléctrica", "delay_days": 47},
                                {"title": "Obra civil", "delay_days": 45}]},
        "by_responsible": {"unassigned_delay_days": 36,
                           "ranking": [{"name": "Carlos Méndez", "delay_days": 86,
                                        "responsible_id": 13, "task_count": 2}]},
    },
    "alert_reaction": {"alerts_total": 22, "alerts_measured": 0,
                       "alerts_resolved_without_timestamp": 10,
                       "alerts_unresolved_by_type": {"delay_risk": 10}, "by_type": []},
}


@dataclass
class FakeInsight:
    title: str = "El atraso está repartido"
    description: str = "Las 6 tareas suman 246 días de atraso."
    recommendation: str | None = "Revisar el cronograma original."
    impact: str | None = "Recuperás margen en las 6 tareas abiertas."
    priority: str | None = "alta"
    reinforcement_count: int = 0
    status: str = "nueva"
    evidence: list = field(default_factory=lambda: [
        {"path": "risk_concentration.by_task.total_delay_days", "value": "246"}
    ])


def _html(**over):
    kw = dict(obra_name="Local Comercial", period=PERIOD, metrics=METRICS,
              insights=[FakeInsight()])
    kw.update(over)
    return build_full_report_html(**kw)


# ── Contenido ─────────────────────────────────────────────────────────────────

def test_encabezado_con_obra_y_periodo():
    html = _html()
    assert "Local Comercial" in html
    assert "septiembre de 2026" in html
    assert "Descargar PDF" in html


def test_muestra_la_narrativa_completa_de_la_ia():
    """El informe no resume: muestra la conclusión tal cual la escribió la IA."""
    narrativa = ("La tarea venció el 14/08 y acumula 47 días de desvío, arrastrando "
                 "a las tres tareas que dependen de ella.")
    html = _html(insights=[FakeInsight(description=narrativa)])
    assert narrativa in html


def test_cada_decision_dice_que_hacer_y_que_se_destraba():
    """El informe es para decidir: acción concreta + qué gana si la toma."""
    html = _html()
    assert "Qué hacer" in html
    assert "Revisar el cronograma original." in html
    assert "Si lo hacés:" in html
    assert "Recuperás margen en las 6 tareas abiertas." in html
    assert "risk_concentration.by_task.total_delay_days" in html


def test_las_decisiones_se_ordenan_por_prioridad():
    html = _html(insights=[
        FakeInsight(title="La menos urgente", priority="baja"),
        FakeInsight(title="La urgente", priority="alta"),
    ])
    assert "Decidir ahora" in html
    assert "Para tener en cuenta" in html
    assert html.index("La urgente") < html.index("La menos urgente")


def test_autoprint_solo_cuando_se_pide():
    """Al venir del email se abre el diálogo de guardar PDF; si no, no molesta."""
    assert "window.print()" in _html(autoprint=True)
    assert "window.addEventListener('load'" in _html(autoprint=True)
    assert "window.addEventListener('load'" not in _html()


def test_sin_conclusiones_no_queda_una_seccion_vacia():
    html = _html(insights=[])
    assert "no encontramos nada que requiera una decisión tuya" in html


def test_hero_con_los_numeros_principales():
    html = _html()
    assert "246" in html                      # días de atraso
    assert "6 de 6" in html                   # tareas con retraso
    assert "2 de 8" in html                   # completadas


def test_detalle_de_desvios_trae_la_evidencia():
    html = _html()
    assert "#46" in html
    assert "+47 días" in html
    assert "La tarea está vencida" in html     # historial
    assert "Tarea vencida" in html             # alerta
    assert "#47, #48" in html                  # cascada


def test_declara_lo_que_quedo_afuera():
    html = _html()
    assert "completadas sin fecha de completado" in html


def test_bitacora_muestra_correlacion_y_aclara_que_no_es_causa():
    html = _html()
    assert "falta material" in html
    assert "80%" in html
    assert "no causa" in html


def test_alertas_sin_datos_medibles_lo_explica():
    html = _html()
    assert "ninguna tiene todavía un tiempo de reacción medible" in html


def test_explica_como_se_hizo_el_informe():
    """El lector tiene que poder saber qué calculó la máquina y qué redactó la IA."""
    plano = " ".join(_html().split())   # el HTML parte la frase en varias líneas
    assert "solo lee esos números ya calculados" in plano
    assert "se verifica automáticamente contra el cálculo" in plano


# ── Gráficos ──────────────────────────────────────────────────────────────────

def test_dibuja_los_graficos_como_svg():
    html = _html()
    assert html.count("<svg") >= 2             # atraso por tarea + por responsable
    assert "Carlos Méndez" in html


def test_las_barras_llevan_su_valor_escrito():
    """En papel no hay hover: cada barra tiene etiqueta directa."""
    html = _html()
    assert ">47<" in html and ">86<" in html


def test_grafico_divergente_separa_los_dos_signos():
    html = _html()
    assert "tardó más →" in html
    assert "← terminó antes" in html
    assert "+25%" in html and "-10%" in html


def test_sin_disciplinas_explica_por_que_falta_el_grafico():
    metrics = {**METRICS, "estimation_accuracy": {"by_discipline": [],
                                                  "tasks_excluded": {"sin_completar": 6}}}
    html = _html(metrics=metrics)
    assert "Todavía no hay tareas medibles" in html


def test_esconde_el_boton_al_imprimir():
    html = _html()
    assert "@media print" in html
    assert "display:none !important" in html


def test_escapa_el_html_del_contenido():
    html = _html(insights=[FakeInsight(title="<script>alert(1)</script>")])
    assert "<script>alert(1)</script>" not in html
    assert "&lt;script&gt;" in html


# ── Endpoint ──────────────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def ctx(db):
    tenant = Tenant(name="Empresa Informe")
    db.add(tenant)
    await db.flush()
    user = User(email="o@x.com", hashed_password="x", full_name="O", role="admin",
                is_active=True, tenant_id=tenant.id)
    db.add(user)
    await db.flush()
    obra = Obra(name="Local Comercial", manager_id=user.id, tenant_id=tenant.id)
    db.add(obra)
    await db.flush()
    db.add(ObraStatsSnapshot(obra_id=obra.id, tenant_id=tenant.id,
                             period=PERIOD, metrics=METRICS))
    db.add(ObraInsight(
        obra_id=obra.id, tenant_id=tenant.id, metric="risk_concentration",
        topic_key="risk_concentration:by_task", title="El atraso está repartido",
        description="Las 6 tareas suman 246 días.", evidence=[],
        status=InsightStatus.NUEVA, reinforcement_count=0,
        first_period=PERIOD, last_period=PERIOD,
    ))
    await db.flush()
    await db.commit()
    return {"obra": obra, "tenant": tenant}


def _signed(obra_id: int, tenant_id: int, period: str = PERIOD) -> str:
    return f"{API}/obras/{obra_id}/insights/report?period={period}&{sign_report_query(obra_id, period, tenant_id)}"


async def test_endpoint_sirve_el_informe_con_link_firmado(client, ctx):
    r = await client.get(_signed(ctx["obra"].id, ctx["tenant"].id))
    assert r.status_code == 200, r.text
    assert "text/html" in r.headers["content-type"]
    assert "Local Comercial" in r.text
    assert "El atraso está repartido" in r.text
    assert r.headers["x-robots-tag"] == "noindex, nofollow"


async def test_endpoint_rechaza_sin_firma(client, ctx):
    r = await client.get(f"{API}/obras/{ctx['obra'].id}/insights/report?period={PERIOD}")
    assert r.status_code == 403


async def test_endpoint_rechaza_firma_adulterada(client, ctx):
    url = _signed(ctx["obra"].id, ctx["tenant"].id)
    q = dict(up.parse_qsl(url.split("?", 1)[1]))
    q["sig"] = "0" * 64
    r = await client.get(f"{API}/obras/{ctx['obra'].id}/insights/report?{up.urlencode(q)}")
    assert r.status_code == 403


async def test_un_link_no_sirve_para_otro_periodo(client, ctx):
    """Firmado para septiembre, pedido para agosto → 403."""
    url = _signed(ctx["obra"].id, ctx["tenant"].id)
    q = dict(up.parse_qsl(url.split("?", 1)[1]))
    q["period"] = "2026-08"
    r = await client.get(f"{API}/obras/{ctx['obra'].id}/insights/report?{up.urlencode(q)}")
    assert r.status_code == 403


async def test_sin_snapshot_devuelve_404(client, ctx):
    r = await client.get(_signed(ctx["obra"].id, ctx["tenant"].id, period="2099-01"))
    assert r.status_code == 404


async def test_link_vencido_no_sirve(client, ctx):
    from app.core.signing import sign_report_query as sign
    q = sign(ctx["obra"].id, PERIOD, ctx["tenant"].id, ttl=-10)   # ya expirado
    r = await client.get(f"{API}/obras/{ctx['obra'].id}/insights/report?period={PERIOD}&{q}")
    assert r.status_code == 403


def test_no_repite_la_misma_alerta_tres_veces():
    """El sistema re-avisa la misma condición varios días; en el informe es ruido."""
    metrics = {**METRICS, "top_deviations": {"items": [{
        "task": {"task_id": 46, "title": "Instalación eléctrica", "status": "pendiente",
                 "start_date": "2026-08-09", "due_date": "2026-08-14",
                 "completed_date": None, "deviation_days": 47},
        "historial_events": [
            {"created_at": "2026-08-22T10:00:00+00:00", "description": "La tarea está vencida"},
            {"created_at": "2026-08-24T10:00:00+00:00", "description": "La tarea está vencida"},
            {"created_at": "2026-08-25T10:00:00+00:00", "description": "Se movió la fecha"},
        ],
        "alerts": [
            {"created_at": "2026-08-22T10:00:00+00:00", "message": "Tarea vencida", "on_predecessor": False},
            {"created_at": "2026-08-24T10:00:00+00:00", "message": "Tarea vencida", "on_predecessor": False},
        ],
        "cascade_impact": {"direct_dependent_count": 0, "direct_dependent_task_ids": []},
    }]}}
    html = _html(metrics=metrics)
    assert html.count("La tarea está vencida") == 1
    assert html.count("Tarea vencida") == 1
    assert "Se movió la fecha" in html      # lo distinto sí se conserva
