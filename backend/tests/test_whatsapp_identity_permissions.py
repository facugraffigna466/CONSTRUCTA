"""Rediseño de identidad + permisos WhatsApp del Responsible.

Ver docs/roles-redesign/whatsapp-identidad-permisos.md.

Cubre:

Parte A — ObraTeamMember como fuente de verdad + is_active:
  - `get_by_whatsapp` NO devuelve responsables inactivos.
  - `get_by_whatsapp_any` sí los devuelve (para el mensaje diferenciado del webhook).
  - `obra_ids_for_responsible` sale de ObraTeamMember, no de Task.responsible_id.
  - Responsable con tarea vieja pero sin ObraTeamMember → NO tiene acceso a esa obra.
  - `task_service.create` rechaza `responsible_id` que no está en el team de la obra.

Parte B — `plan_disciplines` es el único filtro (ya no hay `member_type`):
  - `allowed_disciplines_for_responsible` desambigua correctamente:
      * no en el team → devuelve [] (sin acceso), no None.
      * en el team + NULL → devuelve None (acceso total), sin importar de qué
        responsable se trate — la migración 0054 borró la distinción
        equipo/contratista, `plan_disciplines=NULL` es acceso total para todos.
      * en el team + lista explícita → devuelve esa lista.
  - Bitácora audio: el gate es "solo staff" (users con login). Cualquier
    `Responsible` —tenga o no rol de "equipo" en el team— queda bloqueado;
    solo un `User` (staff) puede mandar audios a la bitácora.

Parte C — confirmación:
  - Responsable con confirmed_at=None: cualquier mensaje distinto de SI
    dispara el pedido de confirmación (no procesa otros flujos).
  - Responsable con confirmed_at=None + body "SI" → se setea confirmed_at
    y responde con la bienvenida.
  - Un responsable ya confirmado no vuelve a ser preguntado al sumarlo
    a otra obra (send_welcome_confirmation es no-op).
"""
from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest_asyncio

from app.core.exceptions import UnprocessableError
from app.models.obra import Obra
from app.models.obra_team_member import ObraTeamMember
from app.models.responsible import Responsible
from app.models.task import Task
from app.models.tenant import Tenant
from app.models.user import User
from app.repositories.obra_team_member import ObraTeamMemberRepository
from app.repositories.responsible import ResponsibleRepository
from app.schemas.message import TwilioInboundPayload
from app.schemas.task import TaskCreate
from app.services.message_service import MessageService
from app.services.plano_service import PlanoService
from app.services.task_service import TaskService


# ─────────────────────────────────────────────────────────────
# Fixture base
# ─────────────────────────────────────────────────────────────


@pytest_asyncio.fixture
async def ctx(db):
    """Tenant + admin + una obra 'A' con un responsable 'equipo' + una obra 'B'
    donde el mismo responsable NO está en el team pero tuvo tareas viejas (para
    ejercitar el hueco pre-rediseño). Además un responsable desactivado con
    número conocido."""
    tenant = Tenant(name="Empresa WA")
    db.add(tenant)
    await db.flush()

    admin = User(
        email="admin@wa.com", hashed_password="x", full_name="Admin",
        role="admin", is_active=True, tenant_id=tenant.id,
        whatsapp_number="+5493510000099",
    )
    db.add(admin)
    await db.flush()

    obra_a = Obra(name="Obra A", manager_id=admin.id, tenant_id=tenant.id)
    obra_b = Obra(name="Obra B", manager_id=admin.id, tenant_id=tenant.id)
    db.add_all([obra_a, obra_b])
    await db.flush()

    # Responsable activo, confirmado, en el team de A como 'equipo' con acceso
    # total a planos (plan_disciplines=NULL).
    juan = Responsible(
        full_name="Juan Equipo",
        whatsapp_number="+5493510000001",
        role="Jefe",
        tenant_id=tenant.id,
        is_active=True,
        confirmed_at=datetime.now(timezone.utc),
    )
    # Responsable contratista, activo, confirmado, en el team de A con NULL.
    ana = Responsible(
        full_name="Ana Contratista",
        whatsapp_number="+5493510000002",
        role="Contratista eléctrica",
        tenant_id=tenant.id,
        is_active=True,
        confirmed_at=datetime.now(timezone.utc),
    )
    # Responsable desactivado (dado de baja recientemente).
    baja = Responsible(
        full_name="Pedro Baja",
        whatsapp_number="+5493510000003",
        role="Pintor",
        tenant_id=tenant.id,
        is_active=False,
        confirmed_at=datetime.now(timezone.utc),
    )
    # Responsable nuevo, pending confirmación (confirmed_at=None).
    lucia = Responsible(
        full_name="Lucía Nueva",
        whatsapp_number="+5493510000004",
        role="Electricista",
        tenant_id=tenant.id,
        is_active=True,
        confirmed_at=None,
    )
    db.add_all([juan, ana, baja, lucia])
    await db.flush()

    db.add_all([
        ObraTeamMember(
            obra_id=obra_a.id, tenant_id=tenant.id, responsible_id=juan.id,
            role="Jefe", plan_disciplines=None,
        ),
        ObraTeamMember(
            obra_id=obra_a.id, tenant_id=tenant.id, responsible_id=ana.id,
            role=None, plan_disciplines=None,
        ),
    ])
    # Tarea VIEJA en obra B asignada a Juan sin ObraTeamMember en B — este es
    # el caso que antes del rediseño le daba acceso indebido a la obra B.
    db.add(Task(
        obra_id=obra_b.id, tenant_id=tenant.id, title="Vieja de Juan",
        responsible_id=juan.id,
    ))
    await db.commit()

    return {
        "db": db,
        "tenant_id": tenant.id,
        "admin_id": admin.id,
        "obra_a_id": obra_a.id,
        "obra_b_id": obra_b.id,
        "juan_id": juan.id,
        "ana_id": ana.id,
        "baja_id": baja.id,
        "lucia_id": lucia.id,
        "juan_phone": juan.whatsapp_number,
        "ana_phone": ana.whatsapp_number,
        "baja_phone": baja.whatsapp_number,
        "lucia_phone": lucia.whatsapp_number,
        "admin_phone": admin.whatsapp_number,
    }


# ─────────────────────────────────────────────────────────────
# Parte A.1 — get_by_whatsapp filtra is_active
# ─────────────────────────────────────────────────────────────


async def test_get_by_whatsapp_no_devuelve_inactivos(db, ctx):
    repo = ResponsibleRepository(db)
    assert (await repo.get_by_whatsapp(ctx["juan_phone"])) is not None
    assert (await repo.get_by_whatsapp(ctx["baja_phone"])) is None


async def test_get_by_whatsapp_any_devuelve_inactivos(db, ctx):
    repo = ResponsibleRepository(db)
    baja = await repo.get_by_whatsapp_any(ctx["baja_phone"])
    assert baja is not None
    assert baja.is_active is False


async def test_get_by_whatsapp_con_numero_vacio_devuelve_none(db):
    repo = ResponsibleRepository(db)
    assert (await repo.get_by_whatsapp("")) is None
    assert (await repo.get_by_whatsapp_any("")) is None


# ─────────────────────────────────────────────────────────────
# Parte A.2 — obra_ids_for_responsible sale de ObraTeamMember
# ─────────────────────────────────────────────────────────────


async def test_obra_ids_for_responsible_sale_del_team_no_de_tareas(db, ctx):
    """Juan tiene tarea vieja en obra B pero NO ObraTeamMember. Ahora ve solo A."""
    ids = await PlanoService(db).obra_ids_for_responsible(ctx["juan_id"])
    assert ids == [ctx["obra_a_id"]]
    # (Antes del rediseño devolvía [obra_a_id, obra_b_id] por la tarea vieja.)


async def test_repo_helper_expuesto_para_reuso(db, ctx):
    """El helper del repo centralizado devuelve lo mismo que PlanoService."""
    ids_repo = await ObraTeamMemberRepository(db).list_obra_ids_for_responsible(
        ctx["juan_id"]
    )
    ids_svc = await PlanoService(db).obra_ids_for_responsible(ctx["juan_id"])
    assert set(ids_repo) == set(ids_svc) == {ctx["obra_a_id"]}


# ─────────────────────────────────────────────────────────────
# Parte A.3 + B — allowed_disciplines_for_responsible desambigua
# ─────────────────────────────────────────────────────────────


async def test_allowed_disciplinas_no_en_team_devuelve_vacio(db, ctx):
    """Juan NO está en el team de obra B → sin acceso a ningún plano de B.
    Antes devolvía None (interpretado como 'acceso total' — BUG audit 05)."""
    result = await PlanoService(db).allowed_disciplines_for_responsible(
        ctx["juan_id"], ctx["obra_b_id"]
    )
    assert result == []


async def test_allowed_disciplinas_equipo_null_devuelve_none_acceso_total(db, ctx):
    """Juan es 'equipo' en A con plan_disciplines=NULL → acceso total (None)."""
    result = await PlanoService(db).allowed_disciplines_for_responsible(
        ctx["juan_id"], ctx["obra_a_id"]
    )
    assert result is None


async def test_allowed_disciplinas_null_sin_distincion_de_tipo_de_responsable(db, ctx):
    """Ana, igual que Juan, está en el team de A con plan_disciplines=NULL →
    acceso total. La migración 0054 borró `member_type`: ya no hay semántica
    invertida por "contratista", el resultado es el mismo para cualquier
    responsable en el team."""
    result = await PlanoService(db).allowed_disciplines_for_responsible(
        ctx["ana_id"], ctx["obra_a_id"]
    )
    assert result is None


async def test_allowed_disciplinas_contratista_con_lista_devuelve_lista(db, ctx):
    """Si al contratista se le asignan disciplinas explícitas, esas ve."""
    row = await ObraTeamMemberRepository(db).get_for_pair(
        ctx["obra_a_id"], ctx["ana_id"]
    )
    row.plan_disciplines = ["electricidad"]
    await db.commit()
    result = await PlanoService(db).allowed_disciplines_for_responsible(
        ctx["ana_id"], ctx["obra_a_id"]
    )
    assert result == ["electricidad"]


async def test_allowed_disciplinas_equipo_con_lista_vacia(db, ctx):
    """Equipo con plan_disciplines=[] (explícitamente sin acceso) → []."""
    row = await ObraTeamMemberRepository(db).get_for_pair(
        ctx["obra_a_id"], ctx["juan_id"]
    )
    row.plan_disciplines = []
    await db.commit()
    result = await PlanoService(db).allowed_disciplines_for_responsible(
        ctx["juan_id"], ctx["obra_a_id"]
    )
    assert result == []


async def test_resolve_plan_access_devuelve_tupla(db, ctx):
    """La nueva API explícita: (is_member, disciplines)."""
    svc = PlanoService(db)

    # Juan en A: (True, None) = miembro con acceso total.
    is_member, disc = await svc.resolve_plan_access(ctx["juan_id"], ctx["obra_a_id"])
    assert (is_member, disc) == (True, None)

    # Juan en B: (False, []) = no en el team.
    is_member, disc = await svc.resolve_plan_access(ctx["juan_id"], ctx["obra_b_id"])
    assert (is_member, disc) == (False, [])

    # Ana en A: (True, None) = miembro con acceso total, igual que Juan (ya
    # no hay semántica invertida por "contratista", ver migración 0054).
    is_member, disc = await svc.resolve_plan_access(ctx["ana_id"], ctx["obra_a_id"])
    assert (is_member, disc) == (True, None)


# ─────────────────────────────────────────────────────────────
# Parte A.4 — task_service exige membership
# ─────────────────────────────────────────────────────────────


async def test_create_task_con_responsible_fuera_del_team_falla(db, ctx):
    """Antes: se creaba silenciosamente el ObraTeamMember con acceso total.
    Ahora: falla con mensaje claro para forzar el flujo correcto."""
    svc = TaskService(db)
    try:
        await svc.create(
            TaskCreate(
                obra_id=ctx["obra_b_id"], title="Nueva en B",
                responsible_id=ctx["juan_id"],  # Juan no está en team de B
            ),
            manager_id=ctx["admin_id"],
        )
    except UnprocessableError as exc:
        assert "no está en el equipo" in str(exc)
    else:
        raise AssertionError("Debía levantar UnprocessableError")


async def test_create_task_con_responsible_en_team_funciona(db, ctx):
    """Positivo: Juan sí está en team de A → OK."""
    svc = TaskService(db)
    task = await svc.create(
        TaskCreate(
            obra_id=ctx["obra_a_id"], title="Nueva en A para Juan",
            responsible_id=ctx["juan_id"],
        ),
        manager_id=ctx["admin_id"],
    )
    assert task.responsible_id == ctx["juan_id"]


async def test_create_task_sin_responsible_no_valida_team(db, ctx):
    """responsible_id=None → no hay nada que validar, pasa."""
    svc = TaskService(db)
    task = await svc.create(
        TaskCreate(obra_id=ctx["obra_a_id"], title="Sin asignar"),
        manager_id=ctx["admin_id"],
    )
    assert task.responsible_id is None


# ─────────────────────────────────────────────────────────────
# Parte B — bitácora por audio: gate "solo staff" (ver migración 0054)
# ─────────────────────────────────────────────────────────────


async def test_responsible_bloqueado_en_bitacora_audio_no_es_staff(db, ctx):
    """Ana es un Responsible (sin login) → bloqueada, sin importar su rol en
    el team. El gate ya no distingue equipo/contratista: es "solo staff"."""
    svc = MessageService(db)
    payload = TwilioInboundPayload(
        From=f"whatsapp:{ctx['ana_phone']}",
        To="whatsapp:+14155238886",
        MessageSid="SM_test_ana_audio", AccountSid="AC_test",
        Body="",
        NumMedia="1",
        MediaUrl0="https://api.twilio.com/fake-audio.ogg",
        MediaContentType0="audio/ogg",
    )
    with patch("app.services.message_service.send_whatsapp_message", new=AsyncMock(return_value="SM_out")):
        inbound = await svc.process_inbound(payload, raw_params={})
    # El mensaje inbound quedó marcado como procesado, pero el reply enviado
    # es el de bloqueo. Lo consultamos por el mensaje outbound guardado.
    from sqlalchemy import select
    from app.models.message import Message, MessageDirection
    out = (await db.execute(
        select(Message).where(
            Message.direction == MessageDirection.OUTBOUND,
            Message.to_number == ctx["ana_phone"],
        ).order_by(Message.id.desc())
    )).scalars().first()
    assert out is not None
    assert "solo para el equipo administrativo" in out.body


async def test_responsible_equipo_tambien_bloqueado_en_bitacora_audio(db, ctx):
    """Juan también es un Responsible (no un User con login), aunque su rol en
    el team sea de mayor confianza — el gate "solo staff" lo bloquea igual
    que a Ana. Antes de la migración 0054 "equipo" quedaba exento; ya no."""
    svc = MessageService(db)
    payload = TwilioInboundPayload(
        From=f"whatsapp:{ctx['juan_phone']}",
        To="whatsapp:+14155238886",
        MessageSid="SM_test_juan_audio", AccountSid="AC_test",
        Body="",
        NumMedia="1",
        MediaUrl0="https://api.twilio.com/fake-audio.ogg",
        MediaContentType0="audio/ogg",
    )
    with patch("app.services.message_service.send_whatsapp_message", new=AsyncMock(return_value="SM_out")):
        await svc.process_inbound(payload, raw_params={})
    from sqlalchemy import select
    from app.models.message import Message, MessageDirection
    out = (await db.execute(
        select(Message).where(
            Message.direction == MessageDirection.OUTBOUND,
            Message.to_number == ctx["juan_phone"],
        ).order_by(Message.id.desc())
    )).scalars().first()
    assert out is not None
    assert "solo para el equipo administrativo" in out.body


async def test_staff_no_bloqueado_en_bitacora_audio(db, ctx):
    """El admin es un User (staff con login) con whatsapp_number cargado →
    NO bloqueado por el gate. No verificamos el resultado del análisis IA
    (la descarga del audio fake falla limpio) — solo que la respuesta NO sea
    la de bloqueo, es decir que pasó el gate "solo staff"."""
    svc = MessageService(db)
    payload = TwilioInboundPayload(
        From=f"whatsapp:{ctx['admin_phone']}",
        To="whatsapp:+14155238886",
        MessageSid="SM_test_admin_audio", AccountSid="AC_test",
        Body="",
        NumMedia="1",
        MediaUrl0="https://api.twilio.com/fake-audio.ogg",
        MediaContentType0="audio/ogg",
    )
    with patch("app.services.message_service.send_whatsapp_message", new=AsyncMock(return_value="SM_out")):
        await svc.process_inbound(payload, raw_params={})
    from sqlalchemy import select
    from app.models.message import Message, MessageDirection
    out = (await db.execute(
        select(Message).where(
            Message.direction == MessageDirection.OUTBOUND,
            Message.to_number == ctx["admin_phone"],
        ).order_by(Message.id.desc())
    )).scalars().first()
    assert out is not None
    # No es el mensaje de bloqueo (pasó el gate "solo staff").
    assert "solo para el equipo administrativo" not in out.body


# ─────────────────────────────────────────────────────────────
# Parte A.1 (webhook) — mensajes diferenciados
# ─────────────────────────────────────────────────────────────


async def test_webhook_numero_desactivado_recibe_mensaje_especifico(db, ctx):
    svc = MessageService(db)
    payload = TwilioInboundPayload(
        From=f"whatsapp:{ctx['baja_phone']}",
        To="whatsapp:+14155238886",
        MessageSid="SM_test_baja", AccountSid="AC_test",
        Body="hola",
    )
    with patch("app.services.message_service.send_whatsapp_message", new=AsyncMock(return_value="SM_out")):
        await svc.process_inbound(payload, raw_params={})
    from sqlalchemy import select
    from app.models.message import Message, MessageDirection
    out = (await db.execute(
        select(Message).where(
            Message.direction == MessageDirection.OUTBOUND,
            Message.to_number == ctx["baja_phone"],
        ).order_by(Message.id.desc())
    )).scalars().first()
    assert out is not None
    assert "Ya no tenés acceso" in out.body
    # Y NO el de "no está registrado".
    assert "no está registrado" not in out.body


async def test_webhook_numero_desconocido_sigue_mensaje_generico(db, ctx):
    svc = MessageService(db)
    payload = TwilioInboundPayload(
        From="whatsapp:+5493519999999",
        To="whatsapp:+14155238886",
        MessageSid="SM_test_desconocido", AccountSid="AC_test",
        Body="hola",
    )
    with patch("app.services.message_service.send_whatsapp_message", new=AsyncMock(return_value="SM_out")):
        await svc.process_inbound(payload, raw_params={})
    from sqlalchemy import select
    from app.models.message import Message, MessageDirection
    out = (await db.execute(
        select(Message).where(
            Message.direction == MessageDirection.OUTBOUND,
            Message.to_number == "+5493519999999",
        ).order_by(Message.id.desc())
    )).scalars().first()
    assert out is not None
    assert "no está registrado" in out.body


# ─────────────────────────────────────────────────────────────
# Parte C — confirmación
# ─────────────────────────────────────────────────────────────


async def test_pendiente_confirmacion_bloquea_todo_menos_SI(db, ctx):
    """Lucía tiene confirmed_at=None. Cualquier body distinto de SI → repite
    el pedido de confirmación, NO procesa el mensaje."""
    svc = MessageService(db)
    payload = TwilioInboundPayload(
        From=f"whatsapp:{ctx['lucia_phone']}",
        To="whatsapp:+14155238886",
        MessageSid="SM_test_lucia_hola", AccountSid="AC_test",
        Body="hola, qué tal",
    )
    with patch("app.services.message_service.send_whatsapp_message", new=AsyncMock(return_value="SM_out")):
        await svc.process_inbound(payload, raw_params={})
    from sqlalchemy import select
    from app.models.message import Message, MessageDirection
    out = (await db.execute(
        select(Message).where(
            Message.direction == MessageDirection.OUTBOUND,
            Message.to_number == ctx["lucia_phone"],
        ).order_by(Message.id.desc())
    )).scalars().first()
    assert "Todavía no confirmaste" in out.body

    # Y confirmed_at sigue en None
    lucia = await db.get(Responsible, ctx["lucia_id"])
    await db.refresh(lucia)
    assert lucia.confirmed_at is None


async def test_pendiente_confirmacion_con_SI_confirma(db, ctx):
    """Body 'SI' setea confirmed_at y responde bienvenida."""
    svc = MessageService(db)
    payload = TwilioInboundPayload(
        From=f"whatsapp:{ctx['lucia_phone']}",
        To="whatsapp:+14155238886",
        MessageSid="SM_test_lucia_SI", AccountSid="AC_test",
        Body="SI",
    )
    with patch("app.services.message_service.send_whatsapp_message", new=AsyncMock(return_value="SM_out")):
        await svc.process_inbound(payload, raw_params={})
    from sqlalchemy import select
    from app.models.message import Message, MessageDirection
    out = (await db.execute(
        select(Message).where(
            Message.direction == MessageDirection.OUTBOUND,
            Message.to_number == ctx["lucia_phone"],
        ).order_by(Message.id.desc())
    )).scalars().first()
    assert "confirmado" in out.body.lower()

    lucia = await db.get(Responsible, ctx["lucia_id"])
    await db.refresh(lucia)
    assert lucia.confirmed_at is not None


async def test_pendiente_confirmacion_acepta_variantes(db, ctx):
    """'sí', 'ok', 'confirmo' también aceptan (concesión de UX)."""
    svc = MessageService(db)
    payload = TwilioInboundPayload(
        From=f"whatsapp:{ctx['lucia_phone']}",
        To="whatsapp:+14155238886",
        MessageSid="SM_test_lucia_ok", AccountSid="AC_test",
        Body="ok.",
    )
    with patch("app.services.message_service.send_whatsapp_message", new=AsyncMock(return_value="SM_out")):
        await svc.process_inbound(payload, raw_params={})
    lucia = await db.get(Responsible, ctx["lucia_id"])
    await db.refresh(lucia)
    assert lucia.confirmed_at is not None


async def test_send_welcome_confirmation_es_noop_si_ya_confirmado(db, ctx):
    """Sumar a Juan (ya confirmado) a otra obra NO manda otro WhatsApp."""
    from app.services.responsible_confirmation import send_welcome_confirmation
    juan = await db.get(Responsible, ctx["juan_id"])
    with patch("app.services.responsible_confirmation.send_whatsapp_message", new=AsyncMock()) as mock_send:
        await send_welcome_confirmation(juan, obra_name="Obra Nueva")
    mock_send.assert_not_called()


async def test_send_welcome_confirmation_manda_si_no_confirmado(db, ctx):
    from app.services.responsible_confirmation import send_welcome_confirmation
    lucia = await db.get(Responsible, ctx["lucia_id"])
    with patch("app.services.responsible_confirmation.send_whatsapp_message", new=AsyncMock()) as mock_send:
        await send_welcome_confirmation(lucia, obra_name="Obra Test")
    mock_send.assert_called_once()
    kwargs = mock_send.call_args.kwargs
    assert kwargs["to_number"] == ctx["lucia_phone"]
    assert "Obra Test" in kwargs["body"]
    assert "SI" in kwargs["body"]
