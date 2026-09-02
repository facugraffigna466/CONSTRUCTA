"""Entrega del informe mensual y orquestación del pipeline (insights, etapa 5).

El envío real (Brevo/Twilio) se mockea: lo que se prueba es la idempotencia,
el tracking de estado, el aislamiento de fallos y el encadenado de las etapas.
"""
from datetime import datetime, timezone

import pytest_asyncio
from sqlalchemy import select

from app.models.obra import Obra, ObraStatus
from app.models.obra_insight import InsightStatus, ObraInsight
from app.models.obra_stats_snapshot import ObraStatsSnapshot
from app.models.tenant import Tenant
from app.models.user import User
from app.services import insight_delivery_service as delivery
from app.services.insight_delivery_service import (
    InsightDeliveryService,
    run_pipeline_for_all_active,
    run_pipeline_for_obra,
)

PERIOD = "2026-09"
SNAPSHOT = {
    "schema_version": 1,
    "obra": {"id": 1, "name": "Obra Test"},
    "risk_concentration": {"by_task": {"concentration_percent": 34.8}},
}


@pytest_asyncio.fixture
async def ctx(db):
    tenant = Tenant(name="Empresa Entrega")
    db.add(tenant)
    await db.flush()
    owner = User(email="owner@empresa.com", hashed_password="x", full_name="Dueña",
                 role="admin", is_active=True, tenant_id=tenant.id)
    otro_admin = User(email="otro.admin@empresa.com", hashed_password="x", full_name="Otro",
                      role="admin", is_active=True, tenant_id=tenant.id)
    db.add_all([owner, otro_admin])
    await db.flush()
    tenant.owner_user_id = owner.id
    obra = Obra(name="Vivienda Test", manager_id=owner.id, tenant_id=tenant.id)
    db.add(obra)
    await db.flush()
    snap = ObraStatsSnapshot(obra_id=obra.id, tenant_id=tenant.id, period=PERIOD, metrics=SNAPSHOT)
    db.add(snap)
    db.add(ObraInsight(
        obra_id=obra.id, tenant_id=tenant.id, metric="risk_concentration",
        topic_key="risk_concentration:by_task", title="Atraso repartido",
        description="Las 7 tareas atrasadas suman 210 días.", evidence=[],
        status=InsightStatus.NUEVA, reinforcement_count=0,
        first_period=PERIOD, last_period=PERIOD,
    ))
    await db.flush()
    return {"tenant": tenant, "owner": owner, "otro_admin": otro_admin, "obra": obra, "snapshot": snap}


class _Spy:
    """Registra las llamadas de envío en vez de mandarlas de verdad."""
    def __init__(self, ok: bool = True, boom: bool = False):
        self.ok, self.boom, self.calls = ok, boom, []

    async def __call__(self, to_email, **kw):
        self.calls.append({"to": to_email, **kw})
        if self.boom:
            raise RuntimeError("Brevo se cayó")
        return self.ok


def _patch_email(monkeypatch, spy):
    monkeypatch.setattr(delivery, "send_insights_email", spy)


def _patch_whatsapp(monkeypatch, sink):
    import app.integrations.twilio.client as twilio
    monkeypatch.setattr(twilio, "send_whatsapp_message", sink)


# ── Envío exitoso ─────────────────────────────────────────────────────────────

async def test_envio_exitoso_marca_el_estado(ctx, db, monkeypatch):
    spy = _Spy()
    _patch_email(monkeypatch, spy)

    result = await InsightDeliveryService(db).deliver_for_obra(ctx["obra"].id, PERIOD)

    assert result["status"] == "sent"
    assert result["recipient"] == "owner@empresa.com"
    assert result["insights"] == 1

    snap = ctx["snapshot"]
    assert snap.email_status == "sent"
    assert snap.email_sent_at is not None
    assert snap.email_recipient == "owner@empresa.com"
    assert snap.email_error is None
    # El HTML se arma con las conclusiones vivas de la obra
    assert len(spy.calls) == 1
    assert spy.calls[0]["obra_name"] == "Vivienda Test"
    assert len(spy.calls[0]["insights"]) == 1


async def test_el_destinatario_es_el_owner_no_cualquier_admin(ctx, db, monkeypatch):
    """Hay otro usuario con rol admin en el tenant: no tiene que recibir nada."""
    spy = _Spy()
    _patch_email(monkeypatch, spy)

    await InsightDeliveryService(db).deliver_for_obra(ctx["obra"].id, PERIOD)

    destinatarios = [c["to"] for c in spy.calls]
    assert destinatarios == ["owner@empresa.com"]
    assert "otro.admin@empresa.com" not in destinatarios


async def test_descartadas_no_viajan_en_el_email(ctx, db, monkeypatch):
    spy = _Spy()
    _patch_email(monkeypatch, spy)
    db.add(ObraInsight(
        obra_id=ctx["obra"].id, tenant_id=ctx["tenant"].id, metric="alert_reaction",
        topic_key="alert_reaction:x", title="Descartada", description="No va.",
        evidence=[], status=InsightStatus.DESCARTADA, reinforcement_count=0,
        first_period=PERIOD, last_period=PERIOD,
    ))
    await db.flush()

    await InsightDeliveryService(db).deliver_for_obra(ctx["obra"].id, PERIOD)
    titulos = [i.title for i in spy.calls[0]["insights"]]
    assert "Descartada" not in titulos


# ── Idempotencia ──────────────────────────────────────────────────────────────

async def test_segunda_corrida_del_mismo_periodo_no_reenvia(ctx, db, monkeypatch):
    spy = _Spy()
    _patch_email(monkeypatch, spy)
    service = InsightDeliveryService(db)

    first = await service.deliver_for_obra(ctx["obra"].id, PERIOD)
    second = await service.deliver_for_obra(ctx["obra"].id, PERIOD)

    assert first["status"] == "sent"
    assert second["status"] == "already_sent"
    assert len(spy.calls) == 1          # una sola vez, no dos


async def test_force_permite_reenviar_a_mano(ctx, db, monkeypatch):
    spy = _Spy()
    _patch_email(monkeypatch, spy)
    service = InsightDeliveryService(db)

    await service.deliver_for_obra(ctx["obra"].id, PERIOD)
    again = await service.deliver_for_obra(ctx["obra"].id, PERIOD, force=True)

    assert again["status"] == "sent"
    assert len(spy.calls) == 2


async def test_un_fallo_previo_se_reintenta_en_el_proximo_ciclo(ctx, db, monkeypatch):
    """Un 'failed' no bloquea: la próxima corrida lo vuelve a intentar."""
    _patch_email(monkeypatch, _Spy(ok=False))
    await InsightDeliveryService(db).deliver_for_obra(ctx["obra"].id, PERIOD)
    assert ctx["snapshot"].email_status == "failed"

    spy_ok = _Spy(ok=True)
    _patch_email(monkeypatch, spy_ok)
    result = await InsightDeliveryService(db).deliver_for_obra(ctx["obra"].id, PERIOD)

    assert result["status"] == "sent"
    assert len(spy_ok.calls) == 1


# ── Fallos ────────────────────────────────────────────────────────────────────

async def test_brevo_rechaza_deja_failed_con_detalle(ctx, db, monkeypatch):
    _patch_email(monkeypatch, _Spy(ok=False))
    result = await InsightDeliveryService(db).deliver_for_obra(ctx["obra"].id, PERIOD)

    assert result["status"] == "failed"
    assert ctx["snapshot"].email_status == "failed"
    assert ctx["snapshot"].email_sent_at is None
    assert "Brevo" in ctx["snapshot"].email_error


async def test_excepcion_en_el_envio_no_propaga(ctx, db, monkeypatch):
    """Una excepción del cliente de email queda trazada, no revienta el job."""
    _patch_email(monkeypatch, _Spy(boom=True))
    result = await InsightDeliveryService(db).deliver_for_obra(ctx["obra"].id, PERIOD)

    assert result["status"] == "failed"
    assert "RuntimeError" in ctx["snapshot"].email_error


async def test_tenant_sin_owner_queda_skipped(ctx, db, monkeypatch):
    spy = _Spy()
    _patch_email(monkeypatch, spy)
    ctx["tenant"].owner_user_id = None
    await db.flush()

    result = await InsightDeliveryService(db).deliver_for_obra(ctx["obra"].id, PERIOD)

    assert result["status"] == "skipped"
    assert "owner_user_id" in ctx["snapshot"].email_error
    assert spy.calls == []


async def test_owner_inactivo_queda_skipped(ctx, db, monkeypatch):
    _patch_email(monkeypatch, _Spy())
    ctx["owner"].is_active = False
    await db.flush()

    result = await InsightDeliveryService(db).deliver_for_obra(ctx["obra"].id, PERIOD)
    assert result["status"] == "skipped"
    assert "inactivo" in ctx["snapshot"].email_error


async def test_sin_snapshot_no_manda_nada(ctx, db, monkeypatch):
    spy = _Spy()
    _patch_email(monkeypatch, spy)
    result = await InsightDeliveryService(db).deliver_for_obra(ctx["obra"].id, "2099-01")
    assert result["status"] == "no_snapshot"
    assert spy.calls == []


# ── WhatsApp ──────────────────────────────────────────────────────────────────

async def test_whatsapp_se_manda_si_el_owner_tiene_numero(ctx, db, monkeypatch):
    _patch_email(monkeypatch, _Spy())
    enviados = []

    async def fake_wa(to, body, media_url=None):
        enviados.append((to, body))
        return "SM123"

    _patch_whatsapp(monkeypatch, fake_wa)
    monkeypatch.setattr(delivery, "is_within_send_window", lambda *a, **k: True)
    ctx["owner"].whatsapp_number = "+5493510000000"
    await db.flush()

    result = await InsightDeliveryService(db).deliver_for_obra(ctx["obra"].id, PERIOD)

    assert result["whatsapp"] == "sent"
    assert ctx["snapshot"].whatsapp_status == "sent"
    to, body = enviados[0]
    assert to == "+5493510000000"
    assert "Vivienda Test" in body
    assert f"/obras/{ctx['obra'].id}/insights" in body


async def test_sin_numero_no_hay_whatsapp(ctx, db, monkeypatch):
    _patch_email(monkeypatch, _Spy())
    result = await InsightDeliveryService(db).deliver_for_obra(ctx["obra"].id, PERIOD)
    assert result["whatsapp"] == "sin_numero"


async def test_whatsapp_respeta_la_ventana_horaria(ctx, db, monkeypatch):
    _patch_email(monkeypatch, _Spy())
    monkeypatch.setattr(delivery, "is_within_send_window", lambda *a, **k: False)
    ctx["owner"].whatsapp_number = "+5493510000000"
    await db.flush()

    result = await InsightDeliveryService(db).deliver_for_obra(ctx["obra"].id, PERIOD)

    assert result["whatsapp"] == "skipped_fuera_de_ventana"
    assert result["status"] == "sent"          # el email igual salió


async def test_fallo_de_whatsapp_no_arruina_la_entrega(ctx, db, monkeypatch):
    """El email es el canal principal: si el WhatsApp explota, sigue 'sent'."""
    _patch_email(monkeypatch, _Spy())
    monkeypatch.setattr(delivery, "is_within_send_window", lambda *a, **k: True)

    async def wa_boom(to, body, media_url=None):
        raise RuntimeError("Twilio caído")

    _patch_whatsapp(monkeypatch, wa_boom)
    ctx["owner"].whatsapp_number = "+5493510000000"
    await db.flush()

    result = await InsightDeliveryService(db).deliver_for_obra(ctx["obra"].id, PERIOD)

    assert result["status"] == "sent"
    assert result["whatsapp"] == "failed"
    assert ctx["snapshot"].whatsapp_status == "failed"


# ── Pipeline completo ─────────────────────────────────────────────────────────

async def test_pipeline_encadena_las_cuatro_etapas(ctx, db, monkeypatch):
    """De punta a punta: estadísticas → IA → render → envío."""
    spy = _Spy()
    _patch_email(monkeypatch, spy)

    async def fake_model(metrics):
        return [{
            "metric": "risk_concentration", "subject": "by_task",
            "title": "El atraso se concentra en pocas tareas",
            "description": "El top de tareas concentra el 34.8 % del atraso.",
            "evidence": [{"path": "risk_concentration.by_task.concentration_percent", "value": "34.8"}],
            "recommendation": "Atacá primero esas tareas.",
        }]

    from app.services.obra_insight_service import ObraInsightService
    monkeypatch.setattr(ObraInsightService, "_call_model", staticmethod(fake_model))

    result = await run_pipeline_for_obra(db, ctx["obra"].id, PERIOD)

    assert result["status"] == "sent"
    # La etapa 2 recalculó el snapshot con datos reales de la obra
    snap = (await db.execute(select(ObraStatsSnapshot).where(
        ObraStatsSnapshot.obra_id == ctx["obra"].id, ObraStatsSnapshot.period == PERIOD
    ))).scalar_one()
    assert snap.metrics["obra"]["name"] == "Vivienda Test"
    assert snap.email_status == "sent"


async def test_si_falla_la_ia_no_se_manda_email_a_medio_armar(ctx, db, monkeypatch):
    spy = _Spy()
    _patch_email(monkeypatch, spy)

    async def boom(metrics):
        raise RuntimeError("la IA no respondió")

    from app.services.obra_insight_service import ObraInsightService
    monkeypatch.setattr(ObraInsightService, "_call_model", staticmethod(boom))

    result = await run_pipeline_for_obra(db, ctx["obra"].id, PERIOD)

    assert result["status"] == "insights_failed"
    assert spy.calls == []          # no se mandó nada


async def test_una_obra_que_falla_no_corta_el_resto(ctx, db, monkeypatch):
    """El job sigue con las demás obras aunque una explote."""
    otra = Obra(name="Obra Sana", manager_id=ctx["owner"].id, tenant_id=ctx["tenant"].id)
    db.add(otra)
    await db.flush()

    _patch_email(monkeypatch, _Spy())

    async def fake_model(metrics):
        return []

    from app.services.obra_insight_service import ObraInsightService
    monkeypatch.setattr(ObraInsightService, "_call_model", staticmethod(fake_model))

    original = delivery.ObraStatsService.snapshot

    async def snapshot_selectivo(self, obra_id, period=None):
        if obra_id == ctx["obra"].id:
            raise RuntimeError("esta obra tiene datos corruptos")
        return await original(self, obra_id, period)

    monkeypatch.setattr(delivery.ObraStatsService, "snapshot", snapshot_selectivo)

    results = await run_pipeline_for_all_active(db, PERIOD)
    by_obra = {r["obra_id"]: r["status"] for r in results}

    assert by_obra[ctx["obra"].id] == "stats_failed"
    assert by_obra[otra.id] == "sent"          # la otra se procesó igual


async def test_el_pipeline_saltea_obras_completadas(ctx, db, monkeypatch):
    _patch_email(monkeypatch, _Spy())

    async def fake_model(metrics):
        return []

    from app.services.obra_insight_service import ObraInsightService
    monkeypatch.setattr(ObraInsightService, "_call_model", staticmethod(fake_model))

    cerrada = Obra(name="Obra Cerrada", manager_id=ctx["owner"].id,
                   tenant_id=ctx["tenant"].id, status=ObraStatus.COMPLETADA)
    db.add(cerrada)
    await db.flush()

    results = await run_pipeline_for_all_active(db, PERIOD)
    assert cerrada.id not in {r["obra_id"] for r in results}


# ── Interruptor del job programado ────────────────────────────────────────────

def _registered_job_ids(monkeypatch, enabled: bool) -> set[str]:
    """Arranca el scheduler con el flag dado y devuelve los jobs registrados."""
    from app.core import scheduler as sched

    added: list[str] = []
    monkeypatch.setattr(sched.settings, "INSIGHTS_ENABLED", enabled)
    monkeypatch.setattr(sched.scheduler, "add_job",
                        lambda *a, **kw: added.append(kw.get("id", "")))
    monkeypatch.setattr(sched.scheduler, "start", lambda: None)
    sched.start_scheduler()
    return set(added)


def test_job_mensual_apagado_por_defecto(monkeypatch):
    """En local el cron no se registra: manda emails reales y gasta IA."""
    assert "monthly_insights" not in _registered_job_ids(monkeypatch, enabled=False)


def test_job_mensual_se_registra_si_esta_encendido(monkeypatch):
    assert "monthly_insights" in _registered_job_ids(monkeypatch, enabled=True)


def test_el_flag_no_toca_los_demas_jobs(monkeypatch):
    """Apagar insights no puede desactivar recordatorios ni alertas."""
    apagado = _registered_job_ids(monkeypatch, enabled=False)
    encendido = _registered_job_ids(monkeypatch, enabled=True)

    assert encendido - apagado == {"monthly_insights"}
    for job in ("mark_overdue", "check_no_response", "evaluate_delay_risk",
                "remind_bitacora_obra", "cleanup_expired_sessions"):
        assert job in apagado


async def test_el_disparo_manual_no_depende_del_flag(ctx, db, monkeypatch):
    """El flag apaga el cron, no la funcionalidad: probar a mano sigue andando."""
    from app.core import scheduler as sched

    monkeypatch.setattr(sched.settings, "INSIGHTS_ENABLED", False)
    spy = _Spy()
    _patch_email(monkeypatch, spy)

    result = await InsightDeliveryService(db).deliver_for_obra(ctx["obra"].id, PERIOD)

    assert result["status"] == "sent"
    assert len(spy.calls) == 1
