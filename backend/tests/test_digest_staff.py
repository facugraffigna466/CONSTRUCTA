"""Resumen semanal para el staff que maneja obras (arquitecto/administrador).

Es el gemelo del resumen de responsables, pero con la mirada de quien gestiona.
Lo que se prueba: a quién le llega, qué obras entran, que los responsables NO lo
reciban, y que el texto de la IA se valide antes de salir por WhatsApp.
Ver docs/features/digest-semanal-staff.md.
"""
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest_asyncio

from app.models.obra import Obra, ObraStatus
from app.models.responsible import Responsible
from app.models.settings import SystemSettings
from app.models.task import Task, TaskStatus
from app.models.tenant import Tenant
from app.models.user import User
from app.services import notification_service as notif
from app.services import staff_digest_service as staff_mod
from app.services.staff_digest_service import StaffDigestService

LUNES_9AM_AR = datetime(2026, 9, 7, 12, 0, tzinfo=timezone.utc)
LUNES = date(2026, 9, 7)


@pytest_asyncio.fixture
async def ctx(db):
    tenant = Tenant(name="Empresa Staff")
    db.add(tenant)
    await db.flush()
    arqui = User(email="arqui@x.com", hashed_password="x", full_name="Facundo",
                 role="admin", is_active=True, tenant_id=tenant.id,
                 whatsapp_number="+5493510000100")
    otro = User(email="otro@x.com", hashed_password="x", full_name="Otro Admin",
                role="admin", is_active=True, tenant_id=tenant.id,
                whatsapp_number="+5493510000200")
    db.add_all([arqui, otro])
    await db.flush()
    obra = Obra(name="Torre Norte", manager_id=arqui.id, tenant_id=tenant.id)
    db.add(obra)
    await db.flush()
    resp = Responsible(tenant_id=tenant.id, full_name="Juan Albañil",
                       whatsapp_number="+5493510000300", is_active=True)
    db.add(resp)
    db.add(SystemSettings(tenant_id=tenant.id, chatbot_enabled=True,
                          auto_reminders=True, send_hour_from=8, send_hour_to=20))
    await db.flush()
    return {"tenant": tenant, "arqui": arqui, "otro": otro, "obra": obra, "resp": resp}


def _task(ctx, title, *, due=None, status=TaskStatus.PENDIENTE, obra=None):
    return Task(obra_id=(obra or ctx["obra"]).id, tenant_id=ctx["tenant"].id,
                title=title, status=status, due_date=due,
                responsible_id=ctx["resp"].id)


class _Twilio:
    def __init__(self):
        self.sent: list[tuple[str, str]] = []

    async def __call__(self, to_number, body, media_url=None):
        self.sent.append((to_number, body))
        return "SM" + uuid.uuid4().hex[:20]


def _patch(monkeypatch, *, now=LUNES_9AM_AR, ia=None) -> _Twilio:
    """Mockea Twilio, congela el reloj y (opcional) fija la respuesta de la IA."""
    import app.models.message as msg_model

    twilio = _Twilio()
    monkeypatch.setattr(notif, "send_whatsapp_message", twilio)

    class _Frozen(datetime):
        @classmethod
        def now(cls, tz=None):
            return now.astimezone(tz) if tz else now.replace(tzinfo=None)

    monkeypatch.setattr(notif, "datetime", _Frozen)
    monkeypatch.setattr(staff_mod, "datetime", _Frozen)
    monkeypatch.setattr(msg_model, "datetime", _Frozen)

    if ia is None:
        # Por defecto se prueba el camino sin IA (texto de código).
        monkeypatch.setattr(staff_mod.settings, "ANTHROPIC_API_KEY", "")
    else:
        monkeypatch.setattr(staff_mod.settings, "ANTHROPIC_API_KEY", "test-key")

        async def fake_call(self, nombre, datos):
            return ia

        monkeypatch.setattr(StaffDigestService, "_call_model", fake_call)
    return twilio


# ── A quién le llega ──────────────────────────────────────────────────────────

async def test_el_manager_de_la_obra_recibe(ctx, db, monkeypatch):
    db.add(_task(ctx, "Estructura", status=TaskStatus.BLOQUEADA))
    await db.flush()
    twilio = _patch(monkeypatch)

    assert await StaffDigestService(db).send_weekly_digests() == 1
    numero, cuerpo = twilio.sent[0]
    assert numero == "+5493510000100"          # el arquitecto
    assert "¡Buen lunes, Facundo!" in cuerpo
    assert "Torre Norte" in cuerpo


async def test_el_responsable_no_recibe_este_mensaje(ctx, db, monkeypatch):
    """El suyo es el otro digest; este es de gestión."""
    db.add(_task(ctx, "Estructura", status=TaskStatus.BLOQUEADA))
    await db.flush()
    twilio = _patch(monkeypatch)

    await StaffDigestService(db).send_weekly_digests()
    destinatarios = [n for n, _ in twilio.sent]
    assert "+5493510000300" not in destinatarios       # el responsable


async def test_un_admin_que_no_maneja_obras_no_recibe(ctx, db, monkeypatch):
    """Llega a quien maneja la obra, no a todo el que tenga rol admin."""
    db.add(_task(ctx, "Estructura", status=TaskStatus.BLOQUEADA))
    await db.flush()
    twilio = _patch(monkeypatch)

    await StaffDigestService(db).send_weekly_digests()
    destinatarios = [n for n, _ in twilio.sent]
    assert destinatarios == ["+5493510000100"]
    assert "+5493510000200" not in destinatarios


async def test_sin_numero_cargado_no_recibe(ctx, db, monkeypatch):
    ctx["arqui"].whatsapp_number = None
    db.add(_task(ctx, "Estructura", status=TaskStatus.BLOQUEADA))
    await db.flush()
    twilio = _patch(monkeypatch)

    assert await StaffDigestService(db).send_weekly_digests() == 0


async def test_varias_obras_van_en_un_solo_mensaje(ctx, db, monkeypatch):
    otra = Obra(name="Casa Sur", manager_id=ctx["arqui"].id, tenant_id=ctx["tenant"].id)
    db.add(otra)
    await db.flush()
    db.add_all([
        _task(ctx, "Estructura", status=TaskStatus.BLOQUEADA),
        _task(ctx, "Cimientos", due=LUNES - timedelta(days=3), obra=otra),
    ])
    await db.flush()
    twilio = _patch(monkeypatch)

    assert await StaffDigestService(db).send_weekly_digests() == 1
    cuerpo = twilio.sent[0][1]
    assert "Torre Norte" in cuerpo and "Casa Sur" in cuerpo


# ── Qué obras y tareas entran ─────────────────────────────────────────────────

async def test_sin_nada_para_reportar_no_manda(ctx, db, monkeypatch):
    twilio = _patch(monkeypatch)
    assert await StaffDigestService(db).send_weekly_digests() == 0
    assert twilio.sent == []


async def test_obra_completada_no_entra(ctx, db, monkeypatch):
    ctx["obra"].status = ObraStatus.COMPLETADA
    db.add(_task(ctx, "Estructura", status=TaskStatus.BLOQUEADA))
    await db.flush()
    twilio = _patch(monkeypatch)

    assert await StaffDigestService(db).send_weekly_digests() == 0


async def test_cuenta_trabadas_vencidas_y_de_la_semana(ctx, db, monkeypatch):
    db.add_all([
        _task(ctx, "Trabada", status=TaskStatus.BLOQUEADA),
        _task(ctx, "Vencida", due=LUNES - timedelta(days=5)),
        _task(ctx, "De esta semana", due=LUNES + timedelta(days=2)),
        _task(ctx, "De la que viene", due=LUNES + timedelta(days=12)),
    ])
    await db.flush()
    twilio = _patch(monkeypatch)

    await StaffDigestService(db).send_weekly_digests()
    cuerpo = twilio.sent[0][1]
    assert "1 trabada/s" in cuerpo
    assert "1 vencida/s" in cuerpo
    assert "1 vence/n esta semana" in cuerpo


async def test_una_trabada_no_se_cuenta_ademas_como_vencida(ctx, db, monkeypatch):
    """Si está bloqueada y encima venció, cuenta en un solo lado."""
    db.add(_task(ctx, "Trabada y vencida", status=TaskStatus.BLOQUEADA,
                 due=LUNES - timedelta(days=5)))
    await db.flush()
    twilio = _patch(monkeypatch)

    await StaffDigestService(db).send_weekly_digests()
    cuerpo = twilio.sent[0][1]
    assert "1 trabada/s" in cuerpo
    assert "vencida/s" not in cuerpo


async def test_marca_el_cuello_de_botella(ctx, db, monkeypatch):
    """La tarea trabada que frena a otras es el cierre del mensaje."""
    from app.models.task import task_dependencies_table

    bloqueante = _task(ctx, "Obra civil", status=TaskStatus.BLOQUEADA)
    dep1 = _task(ctx, "Eléctrica", due=LUNES + timedelta(days=2))
    dep2 = _task(ctx, "Sanitaria", due=LUNES + timedelta(days=3))
    db.add_all([bloqueante, dep1, dep2])
    await db.flush()
    for d in (dep1, dep2):
        await db.execute(task_dependencies_table.insert().values(
            task_id=d.id, depends_on_id=bloqueante.id, dependency_type="FS", lag_days=0))
    await db.flush()
    twilio = _patch(monkeypatch)

    await StaffDigestService(db).send_weekly_digests()
    cuerpo = twilio.sent[0][1]
    assert "Obra civil" in cuerpo
    assert "frena 2" in cuerpo


# ── Configuración y repetición ────────────────────────────────────────────────

async def test_chatbot_apagado_no_manda(ctx, db, monkeypatch):
    from sqlalchemy import select
    cfg = (await db.execute(
        select(SystemSettings).where(SystemSettings.tenant_id == ctx["tenant"].id)
    )).scalar_one()
    cfg.chatbot_enabled = False
    db.add(_task(ctx, "Estructura", status=TaskStatus.BLOQUEADA))
    await db.flush()
    twilio = _patch(monkeypatch)

    assert await StaffDigestService(db).send_weekly_digests() == 0


async def test_fuera_de_la_ventana_espera(ctx, db, monkeypatch):
    db.add(_task(ctx, "Estructura", status=TaskStatus.BLOQUEADA))
    await db.flush()

    _patch(monkeypatch, now=datetime(2026, 9, 7, 9, 0, tzinfo=timezone.utc))   # 06:00 AR
    assert await StaffDigestService(db).send_weekly_digests() == 0

    twilio = _patch(monkeypatch, now=LUNES_9AM_AR)                             # 09:00 AR
    assert await StaffDigestService(db).send_weekly_digests() == 1


async def test_no_manda_dos_veces_la_misma_semana(ctx, db, monkeypatch):
    db.add(_task(ctx, "Estructura", status=TaskStatus.BLOQUEADA))
    await db.flush()
    twilio = _patch(monkeypatch)

    service = StaffDigestService(db)
    assert await service.send_weekly_digests() == 1
    assert await service.send_weekly_digests() == 0
    assert len(twilio.sent) == 1


# ── La IA redacta, pero se valida ─────────────────────────────────────────────

async def test_usa_el_texto_de_la_ia_cuando_es_valido(ctx, db, monkeypatch):
    db.add(_task(ctx, "Estructura", status=TaskStatus.BLOQUEADA))
    await db.flush()
    texto = "👋 ¡Buen lunes, Facundo!\n\nTorre Norte: 🔴 1 trabada.\nDestrabá esa primero."
    twilio = _patch(monkeypatch, ia=texto)

    await StaffDigestService(db).send_weekly_digests()
    assert twilio.sent[0][1] == texto


async def test_un_numero_inventado_por_la_ia_no_sale(ctx, db, monkeypatch):
    """Esto va por WhatsApp sin que nadie lo revise: si inventa, se descarta."""
    db.add(_task(ctx, "Estructura", status=TaskStatus.BLOQUEADA))
    await db.flush()
    mentira = "👋 ¡Buen lunes, Facundo!\n\nTorre Norte tiene 47 tareas trabadas."
    twilio = _patch(monkeypatch, ia=mentira)

    await StaffDigestService(db).send_weekly_digests()
    enviado = twilio.sent[0][1]
    assert enviado != mentira
    assert "47" not in enviado
    assert "1 trabada/s" in enviado          # cayó al texto de código


async def test_si_la_ia_explota_igual_sale_el_mensaje(ctx, db, monkeypatch):
    """Un lunes sin mensaje es peor que un mensaje sin adornos."""
    db.add(_task(ctx, "Estructura", status=TaskStatus.BLOQUEADA))
    await db.flush()
    twilio = _patch(monkeypatch, ia="x")

    async def boom(self, nombre, datos):
        raise RuntimeError("la API se cayó")

    monkeypatch.setattr(StaffDigestService, "_call_model", boom)

    assert await StaffDigestService(db).send_weekly_digests() == 1
    assert "Torre Norte" in twilio.sent[0][1]


async def test_un_texto_larguisimo_se_descarta(ctx, db, monkeypatch):
    """Es un WhatsApp, no un informe."""
    db.add(_task(ctx, "Estructura", status=TaskStatus.BLOQUEADA))
    await db.flush()
    twilio = _patch(monkeypatch, ia="a" * 2000)

    await StaffDigestService(db).send_weekly_digests()
    assert len(twilio.sent[0][1]) < 900


async def test_sin_api_key_usa_el_texto_de_codigo(ctx, db, monkeypatch):
    db.add(_task(ctx, "Estructura", status=TaskStatus.BLOQUEADA))
    await db.flush()
    twilio = _patch(monkeypatch)          # sin ia= → ANTHROPIC_API_KEY vacía

    assert await StaffDigestService(db).send_weekly_digests() == 1
    assert "¡Buen lunes, Facundo!" in twilio.sent[0][1]
