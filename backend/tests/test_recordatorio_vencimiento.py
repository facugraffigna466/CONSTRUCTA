"""Recordatorio de WhatsApp por tarea próxima a vencer.

Cubre el flujo que estaba roto: la lógica existía y estaba enganchada al
scheduler, pero ninguna tarea recibía el mensaje. Ver
docs/features/recordatorio-vencimiento.md.

El envío por Twilio se mockea; lo que se prueba es a quién se le manda, cuándo,
y qué configuración lo frena.
"""
from datetime import date, datetime, timedelta, timezone

import pytest_asyncio

from app.models.calendar import WorkingCalendar
from app.models.obra import Obra
from app.models.responsible import Responsible
from app.models.settings import SystemSettings
from app.models.task import Task, TaskStatus
from app.models.tenant import Tenant
from app.models.user import User
from app.services import notification_service as notif
from app.services.calendar_service import is_within_working_hours
from app.services.notification_service import NotificationService

# Un martes cualquiera, 10 de la mañana en Argentina (13:00 UTC): día y hora laborable.
MARTES_10AM_AR = datetime(2026, 9, 8, 13, 0, tzinfo=timezone.utc)
HOY_AR = date(2026, 9, 8)


@pytest_asyncio.fixture
async def ctx(db):
    tenant = Tenant(name="Empresa Recordatorios")
    db.add(tenant)
    await db.flush()
    user = User(email="jefe@x.com", hashed_password="x", full_name="Jefe",
                role="admin", is_active=True, tenant_id=tenant.id)
    db.add(user)
    await db.flush()
    obra = Obra(name="Obra Recordatorios", manager_id=user.id, tenant_id=tenant.id)
    db.add(obra)
    await db.flush()
    resp = Responsible(tenant_id=tenant.id, full_name="Juan Albañil",
                       whatsapp_number="+5493510000001", is_active=True)
    db.add(resp)
    db.add(SystemSettings(
        tenant_id=tenant.id, chatbot_enabled=True, auto_reminders=True,
        reminder_1day=True, reminder_3days=True,
    ))
    db.add(WorkingCalendar(obra_id=obra.id, tenant_id=tenant.id, working_days=63,
                           hour_from=7, hour_to=18))
    await db.flush()
    return {"tenant": tenant, "obra": obra, "resp": resp, "db": db}


def _task(ctx, *, due: date, status=TaskStatus.PENDIENTE, resp=True, title="Hormigonado") -> Task:
    return Task(
        obra_id=ctx["obra"].id, tenant_id=ctx["tenant"].id, title=title,
        status=status, due_date=due,
        responsible_id=ctx["resp"].id if resp else None,
    )


class _Twilio:
    """Registra los envíos en vez de mandarlos."""
    def __init__(self):
        self.sent: list[tuple[str, str]] = []

    async def __call__(self, to_number, body, media_url=None):
        self.sent.append((to_number, body))
        return f"SM{len(self.sent):04d}"


def _patch(monkeypatch, *, now=MARTES_10AM_AR) -> _Twilio:
    """Mockea Twilio y congela el reloj.

    Se congela también el del modelo `Message`: su `created_at` por defecto usa
    su propio `datetime.now`, y si queda con la hora real la deduplicación
    compara contra una ventana que no lo alcanza.
    """
    import app.models.message as msg_model

    twilio = _Twilio()
    monkeypatch.setattr(notif, "send_whatsapp_message", twilio)

    class _FrozenDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return now.astimezone(tz) if tz else now.replace(tzinfo=None)

    monkeypatch.setattr(notif, "datetime", _FrozenDatetime)
    monkeypatch.setattr(msg_model, "datetime", _FrozenDatetime)
    return twilio


# ── El caso que estaba roto ───────────────────────────────────────────────────

async def test_tarea_a_3_dias_dispara_el_recordatorio(ctx, db, monkeypatch):
    """Regresión del bug principal: la tarea no tiene hora de vencimiento.

    Antes se buscaba el vencimiento en una ventana de ±30 min sobre
    `ahora + 72h`; sin `due_time` la tarea contaba como vencida 23:59, fuera del
    horario laboral, y el recordatorio no salía nunca.
    """
    db.add(_task(ctx, due=HOY_AR + timedelta(days=3)))
    await db.flush()
    twilio = _patch(monkeypatch)

    enviados = await NotificationService(db).send_reminders(hours_ahead=72)

    assert enviados == 1
    assert len(twilio.sent) == 1
    numero, cuerpo = twilio.sent[0]
    assert numero == "+5493510000001"
    assert "Hormigonado" in cuerpo


async def test_tarea_a_1_dia_dispara_el_otro_recordatorio(ctx, db, monkeypatch):
    db.add(_task(ctx, due=HOY_AR + timedelta(days=1)))
    await db.flush()
    twilio = _patch(monkeypatch)

    assert await NotificationService(db).send_reminders(hours_ahead=24) == 1
    assert len(twilio.sent) == 1


async def test_la_ventana_de_3_dias_no_alcanza_a_la_de_1_dia(ctx, db, monkeypatch):
    """Cada job mira su propio día: el de 72h no toca una tarea que vence mañana."""
    db.add(_task(ctx, due=HOY_AR + timedelta(days=1)))
    await db.flush()
    twilio = _patch(monkeypatch)

    assert await NotificationService(db).send_reminders(hours_ahead=72) == 0
    assert twilio.sent == []


# ── Qué NO tiene que disparar ─────────────────────────────────────────────────

async def test_tarea_completada_no_dispara_nada(ctx, db, monkeypatch):
    """Si se terminó antes, no le llega un recordatorio de algo que ya hizo."""
    db.add(_task(ctx, due=HOY_AR + timedelta(days=3), status=TaskStatus.COMPLETADA))
    await db.flush()
    twilio = _patch(monkeypatch)

    assert await NotificationService(db).send_reminders(hours_ahead=72) == 0
    assert twilio.sent == []


async def test_tarea_cancelada_no_dispara_nada(ctx, db, monkeypatch):
    db.add(_task(ctx, due=HOY_AR + timedelta(days=3), status=TaskStatus.CANCELADA))
    await db.flush()
    twilio = _patch(monkeypatch)

    assert await NotificationService(db).send_reminders(hours_ahead=72) == 0


async def test_tarea_sin_responsable_no_dispara_nada(ctx, db, monkeypatch):
    db.add(_task(ctx, due=HOY_AR + timedelta(days=3), resp=False))
    await db.flush()
    twilio = _patch(monkeypatch)

    assert await NotificationService(db).send_reminders(hours_ahead=72) == 0


async def test_responsable_inactivo_no_recibe(ctx, db, monkeypatch):
    ctx["resp"].is_active = False
    db.add(_task(ctx, due=HOY_AR + timedelta(days=3)))
    await db.flush()
    twilio = _patch(monkeypatch)

    assert await NotificationService(db).send_reminders(hours_ahead=72) == 0


# ── Configuración de SystemSettings ───────────────────────────────────────────

async def _cfg(db, ctx, **fields):
    from sqlalchemy import select
    cfg = (await db.execute(
        select(SystemSettings).where(SystemSettings.tenant_id == ctx["tenant"].id)
    )).scalar_one()
    for k, v in fields.items():
        setattr(cfg, k, v)
    await db.flush()


async def test_reminder_3days_apagado_no_manda_el_de_3_dias(ctx, db, monkeypatch):
    await _cfg(db, ctx, reminder_3days=False)
    db.add(_task(ctx, due=HOY_AR + timedelta(days=3)))
    await db.flush()
    twilio = _patch(monkeypatch)

    assert await NotificationService(db).send_reminders(hours_ahead=72) == 0
    assert twilio.sent == []


async def test_reminder_3days_apagado_no_afecta_al_de_1_dia(ctx, db, monkeypatch):
    """Los dos interruptores son independientes."""
    await _cfg(db, ctx, reminder_3days=False)
    db.add(_task(ctx, due=HOY_AR + timedelta(days=1)))
    await db.flush()
    twilio = _patch(monkeypatch)

    assert await NotificationService(db).send_reminders(hours_ahead=24) == 1


async def test_reminder_1day_apagado_no_manda_el_de_1_dia(ctx, db, monkeypatch):
    await _cfg(db, ctx, reminder_1day=False)
    db.add(_task(ctx, due=HOY_AR + timedelta(days=1)))
    await db.flush()
    twilio = _patch(monkeypatch)

    assert await NotificationService(db).send_reminders(hours_ahead=24) == 0


async def test_auto_reminders_apagado_frena_todo(ctx, db, monkeypatch):
    await _cfg(db, ctx, auto_reminders=False)
    db.add(_task(ctx, due=HOY_AR + timedelta(days=3)))
    await db.flush()
    twilio = _patch(monkeypatch)

    assert await NotificationService(db).send_reminders(hours_ahead=72) == 0


async def test_chatbot_apagado_frena_todo(ctx, db, monkeypatch):
    await _cfg(db, ctx, chatbot_enabled=False)
    db.add(_task(ctx, due=HOY_AR + timedelta(days=3)))
    await db.flush()
    twilio = _patch(monkeypatch)

    assert await NotificationService(db).send_reminders(hours_ahead=72) == 0


# ── Horario laboral ───────────────────────────────────────────────────────────

async def test_fuera_de_horario_no_manda_pero_no_lo_pierde(ctx, db, monkeypatch):
    """A las 5 AM no molesta; la corrida de las 8 sí lo manda."""
    db.add(_task(ctx, due=HOY_AR + timedelta(days=3)))
    await db.flush()

    madrugada = datetime(2026, 9, 8, 8, 0, tzinfo=timezone.utc)   # 05:00 AR
    twilio = _patch(monkeypatch, now=madrugada)
    assert await NotificationService(db).send_reminders(hours_ahead=72) == 0

    manana = datetime(2026, 9, 8, 11, 0, tzinfo=timezone.utc)     # 08:00 AR
    twilio2 = _patch(monkeypatch, now=manana)
    assert await NotificationService(db).send_reminders(hours_ahead=72) == 1
    assert len(twilio2.sent) == 1


async def test_domingo_no_se_manda(ctx, db, monkeypatch):
    """El calendario laboral por defecto es lunes a sábado."""
    domingo = datetime(2026, 9, 13, 13, 0, tzinfo=timezone.utc)   # 10:00 AR, domingo
    db.add(_task(ctx, due=date(2026, 9, 16)))                     # 3 días después
    await db.flush()
    twilio = _patch(monkeypatch, now=domingo)

    assert await NotificationService(db).send_reminders(hours_ahead=72) == 0


def test_la_franja_horaria_se_compara_en_hora_argentina():
    """Regresión del desfase de 3 horas: antes se comparaba la hora UTC contra
    una franja configurada en hora local, corriendo la ventana."""
    cal = WorkingCalendar(working_days=63, hour_from=7, hour_to=18)
    ar = timezone(timedelta(hours=-3))

    def en_utc(hora_local: int) -> datetime:
        return datetime(2026, 9, 8, hora_local, 0, tzinfo=ar).astimezone(timezone.utc)

    assert is_within_working_hours(cal, en_utc(8)) is True
    assert is_within_working_hours(cal, en_utc(17)) is True    # antes daba False
    assert is_within_working_hours(cal, en_utc(5)) is False    # antes daba True
    assert is_within_working_hours(cal, en_utc(23)) is False


# ── Deduplicación ─────────────────────────────────────────────────────────────

async def test_no_manda_dos_veces_el_mismo_recordatorio(ctx, db, monkeypatch):
    """El job corre cada hora: la segunda corrida del día no repite el mensaje."""
    db.add(_task(ctx, due=HOY_AR + timedelta(days=3)))
    await db.flush()
    twilio = _patch(monkeypatch)

    service = NotificationService(db)
    assert await service.send_reminders(hours_ahead=72) == 1
    assert await service.send_reminders(hours_ahead=72) == 0
    assert len(twilio.sent) == 1


# ── Pieza reusable ────────────────────────────────────────────────────────────

async def test_notify_responsible_manda_y_deja_registro(ctx, db, monkeypatch):
    """Punto único de salida, pensado para reusar en notificaciones nuevas."""
    from sqlalchemy import select

    from app.models.message import Message, MessageDirection

    twilio = _patch(monkeypatch)
    sid = await NotificationService(db).notify_responsible(
        ctx["resp"], "Mensaje de prueba", notification_type="weekly_digest",
    )
    await db.flush()

    assert twilio.sent == [("+5493510000001", "Mensaje de prueba")]
    assert sid == "SM0001"
    msg = (await db.execute(
        select(Message).where(Message.direction == MessageDirection.OUTBOUND)
    )).scalars().one()
    assert msg.body == "Mensaje de prueba"
    assert msg.task_id is None                       # sirve sin tarea asociada
    assert msg.ai_interpretation["notification_type"] == "weekly_digest"


async def test_can_notify_obra_explica_por_que_no(ctx, db, monkeypatch):
    _patch(monkeypatch)
    service = NotificationService(db)

    ok, motivo = await service.can_notify_obra(ctx["obra"].id)
    assert ok is True and motivo == ""

    await _cfg(db, ctx, chatbot_enabled=False)
    ok, motivo = await service.can_notify_obra(ctx["obra"].id)
    assert ok is False
    assert "chatbot_enabled" in motivo
