"""Motivo del bloqueo: el responsable informa QUÉ pasó y también POR QUÉ.

El menú numérico sabía registrar que una tarea quedaba bloqueada, pero el motivo
—el dato que decide si hay que comprar, llamar al proveedor o reprogramar— nunca
entraba al sistema: quedaba una cadena fija ("Demorada vía WhatsApp") y la
alerta que le llegaba al jefe decía solamente "La tarea X fue bloqueada". Eso lo
obligaba a levantar el teléfono, que es la comunicación informal que el producto
existe para eliminar.

Se cubre acá el ciclo completo, incluida la garantía que ordenó el diseño: el
bloqueo se aplica ANTES de preguntar, así que el reporte de campo no se pierde
aunque la persona no conteste.
"""
from datetime import date, timedelta

import pytest
import pytest_asyncio

from app.models.alert import AlertType
from app.models.conversation_session import ConversationStep
from app.models.obra import Obra
from app.models.responsible import Responsible
from app.models.task import Task, TaskStatus
from app.models.tenant import Tenant
from app.models.user import User
from app.services.conversation_service import ConversationService

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def ctx(db):
    t = Tenant(name="Empresa Motivo")
    db.add(t)
    await db.flush()
    u = User(email="jefe@motivo.com", hashed_password="x", full_name="Jefa",
             role="admin", is_active=True, tenant_id=t.id)
    db.add(u)
    await db.flush()
    obra = Obra(name="Obra Motivo", manager_id=u.id, tenant_id=t.id)
    db.add(obra)
    await db.flush()
    resp = Responsible(full_name="Martín Suárez", whatsapp_number="+5493511230000",
                       tenant_id=t.id, is_active=True)
    db.add(resp)
    await db.flush()
    tarea = Task(obra_id=obra.id, tenant_id=t.id, title="Hormigonado losa 3",
                 responsible_id=resp.id, status=TaskStatus.EN_PROGRESO,
                 due_date=date.today() + timedelta(days=5))
    db.add(tarea)
    await db.flush()
    await db.commit()
    return {"db": db, "obra_id": obra.id, "task_id": tarea.id, "resp": resp}


async def _bloquear(ctx) -> str:
    """Deja la conversación esperando el motivo, como después de elegir 'bloqueada'."""
    svc = ConversationService(ctx["db"])
    return await svc._apply_demorada(
        ctx["resp"], ctx["task_id"], {"id": ctx["task_id"], "title": "Hormigonado losa 3"}
    )


async def test_bloquear_pregunta_el_motivo(ctx):
    texto = await _bloquear(ctx)
    assert "¿Por qué?" in texto
    assert "Falta material" in texto
    assert "Espera otra tarea" in texto

    conv = await ConversationService(ctx["db"]).session_repo.get_by_responsible(ctx["resp"].id)
    assert conv.step == ConversationStep.AWAIT_BLOCK_REASON


async def test_el_bloqueo_se_aplica_antes_de_preguntar(ctx):
    """La garantía del diseño: si la persona abandona la conversación, el
    reporte de campo ya quedó registrado igual."""
    await _bloquear(ctx)
    ctx["db"].expire_all()
    tarea = await ctx["db"].get(Task, ctx["task_id"])
    assert tarea.status == TaskStatus.BLOQUEADA


async def test_el_motivo_llega_al_historial_y_a_la_alerta(ctx):
    from sqlalchemy import select
    from app.models.alert import Alert
    from app.models.historial import HistorialEvento

    await _bloquear(ctx)
    db = ctx["db"]
    svc = ConversationService(db)
    conv = await svc.session_repo.get_by_responsible(ctx["resp"].id)
    texto, task_id = await svc._handle_block_reason(ctx["resp"], conv, "1")

    assert "Falta material" in texto
    assert task_id == ctx["task_id"]

    evento = (await db.execute(
        select(HistorialEvento).where(HistorialEvento.event_type == "task_block_reason")
    )).scalars().first()
    assert evento is not None
    assert evento.payload["reason_code"] == "falta_material"

    alerta = (await db.execute(
        select(Alert).where(Alert.task_id == ctx["task_id"],
                            Alert.type == AlertType.TASK_BLOCKED)
    )).scalars().first()
    assert alerta is not None
    assert "falta material" in alerta.message.lower(), (
        "el jefe tiene que ver el motivo en la alerta, no solo en el historial"
    )

    conv = await svc.session_repo.get_by_responsible(ctx["resp"].id)
    assert conv.step == ConversationStep.IDLE


async def test_saltear_el_motivo_deja_el_bloqueo_hecho(ctx):
    """'X' no cancela nada: la tarea ya está bloqueada, solo se omite la aclaración."""
    await _bloquear(ctx)
    db = ctx["db"]
    svc = ConversationService(db)
    conv = await svc.session_repo.get_by_responsible(ctx["resp"].id)
    texto, _ = await svc._handle_block_reason(ctx["resp"], conv, "X")

    assert "sin motivo cargado" in texto
    assert "cancelada" not in texto.lower(), "decir 'cancelada' haría creer que no se registró"

    db.expire_all()
    assert (await db.get(Task, ctx["task_id"])).status == TaskStatus.BLOQUEADA


async def test_respuesta_invalida_vuelve_a_preguntar(ctx):
    await _bloquear(ctx)
    db = ctx["db"]
    svc = ConversationService(db)
    conv = await svc.session_repo.get_by_responsible(ctx["resp"].id)
    texto, _ = await svc._handle_block_reason(ctx["resp"], conv, "no sé")

    assert "¿Por qué?" in texto
    conv = await svc.session_repo.get_by_responsible(ctx["resp"].id)
    assert conv.step == ConversationStep.AWAIT_BLOCK_REASON, "no debe perder el paso"


async def test_el_motivo_no_se_duplica_en_la_alerta(ctx):
    from sqlalchemy import select
    from app.models.alert import Alert

    await _bloquear(ctx)
    db = ctx["db"]
    svc = ConversationService(db)
    conv = await svc.session_repo.get_by_responsible(ctx["resp"].id)
    await svc._handle_block_reason(ctx["resp"], conv, "1")
    mensaje = (await db.execute(
        select(Alert.message).where(Alert.task_id == ctx["task_id"])
    )).scalars().first()

    # Segunda vez sobre la misma alerta (reintento del mismo motivo).
    await svc.alert_repo.append_reason_to_open_alert(
        ctx["task_id"], AlertType.TASK_BLOCKED, "Falta material"
    )
    mensaje2 = (await db.execute(
        select(Alert.message).where(Alert.task_id == ctx["task_id"])
    )).scalars().first()
    assert mensaje == mensaje2


# ── El audio de un responsable ya no es un callejón sin salida ────────────────

async def test_audio_de_responsable_devuelve_el_menu(ctx, monkeypatch):
    """Agarró la herramienta equivocada: en vez de mandarlo con su jefe, se le
    muestra el canal que sí puede usar."""
    from app.schemas.message import TwilioInboundPayload
    from app.services.message_service import MessageService

    payload = TwilioInboundPayload(
        From=f"whatsapp:{ctx['resp'].whatsapp_number}",
        To="whatsapp:+14155238886",
        Body="",
        MessageSid="SM_test_audio",
        AccountSid="AC_test",
        NumMedia="1",
        MediaUrl0="https://api.twilio.com/media/fake",
        MediaContentType0="audio/ogg",
    )
    reply = await MessageService(ctx["db"])._handle_bitacora_audio(
        payload, ctx["resp"], is_staff=False
    )

    assert "equipo administrativo" in reply
    # Lo que importa: le llega el menú, no una puerta cerrada.
    assert "Hormigonado losa 3" in reply or "1️⃣" in reply
    assert "avisale a tu jefe" not in reply.lower()
