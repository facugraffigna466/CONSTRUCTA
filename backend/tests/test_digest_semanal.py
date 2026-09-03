"""Resumen semanal de WhatsApp a los responsables (lunes a la mañana).

El envío por Twilio se mockea; lo que se prueba es qué tareas entran en el
mensaje de cada persona, en qué orden, y qué configuración lo frena.
Ver docs/features/digest-semanal-responsables.md.
"""
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest_asyncio

from app.models.obra import Obra
from app.models.responsible import Responsible
from app.models.settings import SystemSettings
from app.models.task import Task, TaskStatus
from app.models.tenant import Tenant
from app.models.user import User
from app.services import notification_service as notif
from app.services.message_templates import build_weekly_digest_message
from app.services.notification_service import NotificationService

# Lunes 7 de septiembre de 2026, 09:00 en Argentina (12:00 UTC): dentro de la
# ventana de envío por defecto (8 a 20) y día laborable.
LUNES_9AM_AR = datetime(2026, 9, 7, 12, 0, tzinfo=timezone.utc)
LUNES = date(2026, 9, 7)
DOMINGO = date(2026, 9, 13)


@pytest_asyncio.fixture
async def ctx(db):
    tenant = Tenant(name="Empresa Digest")
    db.add(tenant)
    await db.flush()
    user = User(email="jefe@digest.com", hashed_password="x", full_name="Jefe",
                role="admin", is_active=True, tenant_id=tenant.id)
    db.add(user)
    await db.flush()
    obra = Obra(name="Obra Digest", manager_id=user.id, tenant_id=tenant.id)
    db.add(obra)
    await db.flush()
    resp = Responsible(tenant_id=tenant.id, full_name="Juan Albañil",
                       whatsapp_number="+5493510000009", is_active=True)
    db.add(resp)
    db.add(SystemSettings(tenant_id=tenant.id, chatbot_enabled=True,
                          auto_reminders=True, send_hour_from=8, send_hour_to=20))
    await db.flush()
    return {"tenant": tenant, "obra": obra, "resp": resp}


def _task(ctx, title, *, due=None, status=TaskStatus.PENDIENTE, resp=True) -> Task:
    return Task(
        obra_id=ctx["obra"].id, tenant_id=ctx["tenant"].id, title=title,
        status=status, due_date=due,
        responsible_id=ctx["resp"].id if resp else None,
    )


class _Twilio:
    """SIDs únicos como los de Twilio: `external_message_id` es UNIQUE en la base,
    y un mock con contador propio los repite entre instancias."""

    def __init__(self):
        self.sent: list[tuple[str, str]] = []

    async def __call__(self, to_number, body, media_url=None):
        self.sent.append((to_number, body))
        return "SM" + uuid.uuid4().hex[:20]


def _patch(monkeypatch, *, now=LUNES_9AM_AR) -> _Twilio:
    """Mockea Twilio y congela el reloj (el del modelo Message también)."""
    import app.models.message as msg_model

    twilio = _Twilio()
    monkeypatch.setattr(notif, "send_whatsapp_message", twilio)

    class _Frozen(datetime):
        @classmethod
        def now(cls, tz=None):
            return now.astimezone(tz) if tz else now.replace(tzinfo=None)

    monkeypatch.setattr(notif, "datetime", _Frozen)
    monkeypatch.setattr(msg_model, "datetime", _Frozen)
    return twilio


# ── Caso principal ────────────────────────────────────────────────────────────

async def test_responsable_con_tareas_recibe_el_resumen(ctx, db, monkeypatch):
    db.add_all([
        _task(ctx, "Mampostería", due=LUNES + timedelta(days=3)),
        _task(ctx, "Revoques", due=LUNES + timedelta(days=5)),
    ])
    await db.flush()
    twilio = _patch(monkeypatch)

    assert await NotificationService(db).send_weekly_digest() == 1
    numero, cuerpo = twilio.sent[0]
    assert numero == "+5493510000009"
    assert "¡Buen lunes, Juan Albañil!" in cuerpo
    assert "Mampostería" in cuerpo and "Revoques" in cuerpo
    assert "Cualquier cosa, escribime." in cuerpo


async def test_sin_tareas_relevantes_no_recibe_nada(ctx, db, monkeypatch):
    """Un 'no tenés nada' semanal entrena a ignorar al bot."""
    twilio = _patch(monkeypatch)
    assert await NotificationService(db).send_weekly_digest() == 0
    assert twilio.sent == []


async def test_tarea_de_otra_semana_no_entra(ctx, db, monkeypatch):
    db.add(_task(ctx, "Pintura", due=DOMINGO + timedelta(days=5)))
    await db.flush()
    twilio = _patch(monkeypatch)

    assert await NotificationService(db).send_weekly_digest() == 0
    assert twilio.sent == []


async def test_completadas_y_canceladas_quedan_afuera(ctx, db, monkeypatch):
    db.add_all([
        _task(ctx, "Ya terminada", due=LUNES + timedelta(days=2), status=TaskStatus.COMPLETADA),
        _task(ctx, "Cancelada", due=LUNES + timedelta(days=2), status=TaskStatus.CANCELADA),
    ])
    await db.flush()
    twilio = _patch(monkeypatch)

    assert await NotificationService(db).send_weekly_digest() == 0


async def test_tarea_de_otro_responsable_no_entra(ctx, db, monkeypatch):
    otro = Responsible(tenant_id=ctx["tenant"].id, full_name="Ana",
                       whatsapp_number="+5493510000010", is_active=True)
    db.add(otro)
    await db.flush()
    t = _task(ctx, "De Ana", due=LUNES + timedelta(days=2))
    t.responsible_id = otro.id
    db.add(t)
    await db.flush()
    twilio = _patch(monkeypatch)

    await NotificationService(db).send_weekly_digest()
    destinatarios = [n for n, _ in twilio.sent]
    assert destinatarios == ["+5493510000010"]       # solo Ana
    assert "De Ana" in twilio.sent[0][1]


# ── Orden de prioridad ────────────────────────────────────────────────────────

async def test_lo_urgente_va_primero(ctx, db, monkeypatch):
    """Vencido y bloqueado arriba; después lo que vence esta semana."""
    db.add_all([
        _task(ctx, "Vence el jueves", due=LUNES + timedelta(days=3)),
        _task(ctx, "Quedó vencida", due=LUNES - timedelta(days=4)),
        _task(ctx, "Está trabada", due=LUNES + timedelta(days=2), status=TaskStatus.BLOQUEADA),
    ])
    await db.flush()
    twilio = _patch(monkeypatch)

    await NotificationService(db).send_weekly_digest()
    cuerpo = twilio.sent[0][1]

    assert cuerpo.index("Necesita atención") < cuerpo.index("Esta semana")
    assert cuerpo.index("Quedó vencida") < cuerpo.index("Vence el jueves")
    assert cuerpo.index("Está trabada") < cuerpo.index("Vence el jueves")
    assert "está bloqueada" in cuerpo
    assert "venció el" in cuerpo


async def test_bloqueada_no_aparece_dos_veces(ctx, db, monkeypatch):
    """Una tarea bloqueada que además vence esta semana entra en un solo grupo."""
    db.add(_task(ctx, "Trabada y vence", due=LUNES + timedelta(days=2),
                 status=TaskStatus.BLOQUEADA))
    await db.flush()
    twilio = _patch(monkeypatch)

    await NotificationService(db).send_weekly_digest()
    assert twilio.sent[0][1].count("Trabada y vence") == 1


async def test_en_progreso_sin_vencer_esta_semana_igual_aparece(ctx, db, monkeypatch):
    """Para que no se le escape algo que ya arrancó."""
    db.add(_task(ctx, "Arrancada hace rato", due=DOMINGO + timedelta(days=10),
                 status=TaskStatus.EN_PROGRESO))
    await db.flush()
    twilio = _patch(monkeypatch)

    assert await NotificationService(db).send_weekly_digest() == 1
    cuerpo = twilio.sent[0][1]
    assert "También tenés en curso" in cuerpo
    assert "Arrancada hace rato" in cuerpo


async def test_pendiente_sin_fecha_no_ensucia_el_resumen(ctx, db, monkeypatch):
    """Sin fecha y sin arrancar no es de esta semana: no entra."""
    db.add(_task(ctx, "Alguna vez", due=None))
    await db.flush()
    twilio = _patch(monkeypatch)

    assert await NotificationService(db).send_weekly_digest() == 0


# ── Configuración ─────────────────────────────────────────────────────────────

async def _cfg(db, ctx, **fields):
    from sqlalchemy import select
    cfg = (await db.execute(
        select(SystemSettings).where(SystemSettings.tenant_id == ctx["tenant"].id)
    )).scalar_one()
    for k, v in fields.items():
        setattr(cfg, k, v)
    await db.flush()


async def test_chatbot_apagado_no_recibe(ctx, db, monkeypatch):
    await _cfg(db, ctx, chatbot_enabled=False)
    db.add(_task(ctx, "Mampostería", due=LUNES + timedelta(days=2)))
    await db.flush()
    twilio = _patch(monkeypatch)

    assert await NotificationService(db).send_weekly_digest() == 0
    assert twilio.sent == []


async def test_recordatorios_automaticos_apagados_no_recibe(ctx, db, monkeypatch):
    await _cfg(db, ctx, auto_reminders=False)
    db.add(_task(ctx, "Mampostería", due=LUNES + timedelta(days=2)))
    await db.flush()
    twilio = _patch(monkeypatch)

    assert await NotificationService(db).send_weekly_digest() == 0


async def test_responsable_inactivo_no_recibe(ctx, db, monkeypatch):
    ctx["resp"].is_active = False
    db.add(_task(ctx, "Mampostería", due=LUNES + timedelta(days=2)))
    await db.flush()
    twilio = _patch(monkeypatch)

    assert await NotificationService(db).send_weekly_digest() == 0


async def test_fuera_de_la_ventana_horaria_espera(ctx, db, monkeypatch):
    """A las 6 AM todavía no; la corrida de las 9 sí manda."""
    db.add(_task(ctx, "Mampostería", due=LUNES + timedelta(days=2)))
    await db.flush()

    temprano = datetime(2026, 9, 7, 9, 0, tzinfo=timezone.utc)      # 06:00 AR
    _patch(monkeypatch, now=temprano)
    assert await NotificationService(db).send_weekly_digest() == 0

    twilio = _patch(monkeypatch, now=LUNES_9AM_AR)                  # 09:00 AR
    assert await NotificationService(db).send_weekly_digest() == 1
    assert len(twilio.sent) == 1


# ── No repetir ────────────────────────────────────────────────────────────────

async def test_no_manda_dos_veces_la_misma_semana(ctx, db, monkeypatch):
    """El job corre cada hora los lunes: solo la primera corrida envía."""
    db.add(_task(ctx, "Mampostería", due=LUNES + timedelta(days=2)))
    await db.flush()
    twilio = _patch(monkeypatch)

    service = NotificationService(db)
    assert await service.send_weekly_digest() == 1
    assert await service.send_weekly_digest() == 0
    assert len(twilio.sent) == 1
    assert ctx["resp"].last_weekly_digest_at is not None


async def test_la_semana_siguiente_vuelve_a_mandar(ctx, db, monkeypatch):
    db.add(_task(ctx, "Mampostería", due=LUNES + timedelta(days=2)))
    await db.flush()

    _patch(monkeypatch)
    assert await NotificationService(db).send_weekly_digest() == 1

    siguiente = LUNES_9AM_AR + timedelta(days=7)
    db.add(_task(ctx, "Otra tarea", due=LUNES + timedelta(days=9)))
    await db.flush()
    twilio = _patch(monkeypatch, now=siguiente)
    assert await NotificationService(db).send_weekly_digest() == 1
    assert "Otra tarea" in twilio.sent[0][1]


# ── Que no sea el mismo texto que el recordatorio individual ──────────────────

async def test_el_texto_no_se_pisa_con_el_recordatorio_individual(ctx, db, monkeypatch):
    """Si el mismo lunes salen los dos, tienen forma y propósito distintos.

    El recordatorio individual abre el menú numerado de estados y espera una
    respuesta; el resumen es una lista sin menú.
    """
    from app.services.message_templates import build_reminder_message

    db.add(_task(ctx, "Mampostería", due=LUNES + timedelta(days=1)))
    await db.flush()
    twilio = _patch(monkeypatch)
    await NotificationService(db).send_weekly_digest()
    digest = twilio.sent[0][1]

    recordatorio = build_reminder_message(
        "Juan Albañil", task_name="Mampostería", obra_name="Obra Digest",
        due_date="2026-09-08", current_status="pendiente",
    )

    assert digest != recordatorio
    assert "1️⃣" in recordatorio and "1️⃣" not in digest       # el menú es del recordatorio
    assert "Buen lunes" in digest and "Buen lunes" not in recordatorio


# ── La plantilla, aislada ─────────────────────────────────────────────────────

def test_la_plantilla_omite_las_secciones_vacias():
    solo_semana = build_weekly_digest_message(
        "Ana", urgentes=[], semana=[{"title": "Pintura", "due_date": "2026-09-10"}], en_curso=[],
    )
    assert "Necesita atención" not in solo_semana
    assert "También tenés en curso" not in solo_semana
    assert "Esta semana" in solo_semana


def test_la_plantilla_distingue_bloqueada_de_vencida():
    msg = build_weekly_digest_message(
        "Ana",
        urgentes=[{"title": "A", "motivo": "bloqueada"},
                  {"title": "B", "motivo": "vencida", "due_date": "2026-09-01"}],
        semana=[], en_curso=[],
    )
    assert "A — está bloqueada" in msg
    assert "B — venció el 01/09" in msg
