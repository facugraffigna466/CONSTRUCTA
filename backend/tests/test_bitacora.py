"""Bitácora con IA: validación del audio y control de costo (cota mensual por
tenant). El objetivo es que un archivo inválido dé 4xx claro y que el gasto de
IA quede acotado por plan — nunca sin límite."""
from datetime import datetime, timezone

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.core.security import create_access_token
from app.models.bitacora import BitacoraEntry
from app.models.obra import Obra
from app.models.tenant import Tenant
from app.models.tenant_membership import TenantMembership
from app.models.user import User
from app.services.bitacora_service import _BITACORA_DEFAULT_LIMIT

API = "/api/v1"


@pytest_asyncio.fixture
async def ctx(db):
    """Tenant sin plan (→ límite por defecto) con un usuario admin y una obra."""
    t = Tenant(name="Empresa Bitácora")
    db.add(t)
    await db.flush()
    u = User(email="jefe@x.com", hashed_password="x", full_name="Jefe", role="admin",
             is_active=True, tenant_id=t.id)
    db.add(u)
    await db.flush()
    db.add(TenantMembership(user_id=u.id, tenant_id=t.id, role="admin", is_active=True))
    await db.flush()
    obra = Obra(name="Obra Bitácora", manager_id=u.id, tenant_id=t.id)
    db.add(obra)
    await db.flush()
    await db.commit()
    return {"db": db, "tenant_id": t.id, "user_id": u.id,
            "obra_id": obra.id, "token": create_access_token(u.id)}


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ── Validación del audio ──────────────────────────────────────────────────────

async def test_audio_rejects_non_audio(client, ctx):
    r = await client.post(
        f"{API}/obras/{ctx['obra_id']}/bitacora/audio",
        headers=_auth(ctx["token"]),
        files={"file": ("notas.txt", b"esto no es audio", "text/plain")},
    )
    assert r.status_code == 400, r.text


async def test_audio_rejects_empty(client, ctx):
    r = await client.post(
        f"{API}/obras/{ctx['obra_id']}/bitacora/audio",
        headers=_auth(ctx["token"]),
        files={"file": ("voz.ogg", b"", "audio/ogg")},
    )
    assert r.status_code == 400, r.text


# ── Control de costo de IA (cota mensual por tenant) ──────────────────────────

async def test_text_entry_under_quota_ok(client, ctx):
    """Bajo la cota: la entrada de texto se crea (201) aunque no haya API key de IA."""
    r = await client.post(
        f"{API}/obras/{ctx['obra_id']}/bitacora/texto",
        headers=_auth(ctx["token"]),
        json={"text": "Avance de hoy: se terminó la losa del primer piso."},
    )
    assert r.status_code == 201, r.text


async def test_ai_quota_enforced(client, ctx):
    """Al alcanzar la cota mensual del plan, una nueva entrada → 429 (no se procesa)."""
    db = ctx["db"]
    now = datetime.now(timezone.utc)
    for i in range(_BITACORA_DEFAULT_LIMIT):
        db.add(BitacoraEntry(
            obra_id=ctx["obra_id"], source="web", transcript=f"nota {i}",
            created_by=ctx["user_id"], status="procesado", created_at=now,
        ))
    await db.commit()

    r = await client.post(
        f"{API}/obras/{ctx['obra_id']}/bitacora/texto",
        headers=_auth(ctx["token"]),
        json={"text": "Una nota más que debería exceder la cota."},
    )
    assert r.status_code == 429, r.text


async def test_ai_quota_counts_whatsapp_entries(ctx):
    """audit 08-bitácora §8.1: las entradas de WhatsApp (created_by=None, el
    patrón que deja _handle_bitacora_audio para un Responsible) tienen que
    contar hacia la cota igual que las de la web — el conteo es por obra del
    tenant, no por quién figura como autor."""
    from app.services.bitacora_service import BitacoraService
    from fastapi import HTTPException

    db = ctx["db"]
    now = datetime.now(timezone.utc)
    for i in range(_BITACORA_DEFAULT_LIMIT):
        db.add(BitacoraEntry(
            obra_id=ctx["obra_id"], source="whatsapp", transcript=f"nota whatsapp {i}",
            created_by=None, status="procesado", created_at=now,
        ))
    await db.commit()

    with pytest.raises(HTTPException) as exc:
        await BitacoraService(db).assert_within_ai_quota(ctx["tenant_id"])
    assert exc.value.status_code == 429


# ── Sugerencias: hallazgos N2/N5 del audit 08-bitácora ─────────────────────────

def _base_suggestion(**overrides) -> dict:
    base = {
        "type": "note", "task_id": None, "task_title": None,
        "new_start_date": None, "new_due_date": None, "new_status": None,
        "title": None, "description": None, "responsible_name": None,
        "reason": "test", "applied": False, "dismissed": False,
        "result_task_id": None, "result_note": None,
    }
    base.update(overrides)
    return base


async def test_apply_suggestion_rejects_stale_cross_obra_task(client, ctx):
    """N2: una sugerencia reschedule_task cuyo task_id quedó apuntando a una
    tarea de OTRA obra (p. ej. tras reasignar la nota con assign_obra) no debe
    poder aplicarse — antes se delegaba directo a TaskService, que solo valida
    tenant, nunca la obra real de la tarea."""
    from app.models.task import Task

    db = ctx["db"]
    otra_obra = Obra(name="Otra obra", manager_id=ctx["user_id"], tenant_id=ctx["tenant_id"])
    db.add(otra_obra)
    await db.flush()
    tarea_ajena = Task(obra_id=otra_obra.id, tenant_id=ctx["tenant_id"], title="Tarea de otra obra")
    db.add(tarea_ajena)
    await db.flush()

    entry = BitacoraEntry(
        obra_id=ctx["obra_id"], source="web", transcript="reprogramar",
        status="procesado",
        suggestions=[_base_suggestion(type="reschedule_task", task_id=tarea_ajena.id, new_due_date="2026-09-01")],
    )
    db.add(entry)
    await db.commit()

    r = await client.post(
        f"{API}/bitacora/{entry.id}/suggestions/0/apply",
        headers=_auth(ctx["token"]),
    )
    assert r.status_code == 422, r.text


async def test_apply_suggestion_invalid_date_returns_4xx_not_500(client, ctx):
    """N5: una fecha inválida en el edit no debe tirar un ValueError sin capturar."""
    from app.models.task import Task

    db = ctx["db"]
    tarea = Task(obra_id=ctx["obra_id"], tenant_id=ctx["tenant_id"], title="Tarea")
    db.add(tarea)
    await db.flush()
    entry = BitacoraEntry(
        obra_id=ctx["obra_id"], source="web", transcript="reprogramar", status="procesado",
        suggestions=[_base_suggestion(type="reschedule_task", task_id=tarea.id)],
    )
    db.add(entry)
    await db.commit()

    r = await client.post(
        f"{API}/bitacora/{entry.id}/suggestions/0/apply",
        headers=_auth(ctx["token"]),
        json={"new_due_date": "no-es-una-fecha"},
    )
    assert r.status_code == 422, r.text


async def test_apply_suggestion_invalid_status_returns_4xx_not_500(client, ctx):
    from app.models.task import Task

    db = ctx["db"]
    tarea = Task(obra_id=ctx["obra_id"], tenant_id=ctx["tenant_id"], title="Tarea")
    db.add(tarea)
    await db.flush()
    entry = BitacoraEntry(
        obra_id=ctx["obra_id"], source="web", transcript="cambiar estado", status="procesado",
        suggestions=[_base_suggestion(type="update_status", task_id=tarea.id, new_status="estado_que_no_existe")],
    )
    db.add(entry)
    await db.commit()

    r = await client.post(
        f"{API}/bitacora/{entry.id}/suggestions/0/apply",
        headers=_auth(ctx["token"]),
    )
    assert r.status_code == 422, r.text


# ── Aislamiento multi-tenant en notas sin obra: hallazgo N3 ────────────────────

async def test_dismiss_suggestion_blocks_cross_tenant_unassigned_entry(client, db):
    """N3: una nota de WhatsApp sin obra asignada (obra_id=NULL) no debe poder
    ser tocada por un admin de OTRO tenant. Antes BitacoraEntry no tenía
    tenant_id propio y el guard de permisos se salteaba el chequeo entero para
    este caso."""
    from app.models.responsible import Responsible

    tenant_a = Tenant(name="Empresa A")
    tenant_b = Tenant(name="Empresa B")
    db.add_all([tenant_a, tenant_b])
    await db.flush()
    user_a = User(email="a@x.com", hashed_password="x", full_name="Admin A", role="admin",
                  is_active=True, tenant_id=tenant_a.id)
    user_b = User(email="b@x.com", hashed_password="x", full_name="Admin B", role="admin",
                  is_active=True, tenant_id=tenant_b.id)
    db.add_all([user_a, user_b])
    await db.flush()
    db.add_all([
        TenantMembership(user_id=user_a.id, tenant_id=tenant_a.id, role="admin", is_active=True),
        TenantMembership(user_id=user_b.id, tenant_id=tenant_b.id, role="admin", is_active=True),
    ])
    responsable_a = Responsible(full_name="Responsable A", whatsapp_number="+5491111111111", tenant_id=tenant_a.id)
    db.add(responsable_a)
    await db.flush()

    entry = BitacoraEntry(
        obra_id=None, source="whatsapp", transcript="nota sin obra todavía",
        status="procesado", responsible_id=responsable_a.id, tenant_id=tenant_a.id,
        suggestions=[_base_suggestion()],
    )
    db.add(entry)
    await db.commit()

    r_ajeno = await client.post(
        f"{API}/bitacora/{entry.id}/suggestions/0/dismiss",
        headers=_auth(create_access_token(user_b.id)),
    )
    assert r_ajeno.status_code == 404, r_ajeno.text

    r_propio = await client.post(
        f"{API}/bitacora/{entry.id}/suggestions/0/dismiss",
        headers=_auth(create_access_token(user_a.id)),
    )
    assert r_propio.status_code == 200, r_propio.text


# ── Ciclo de vida de archivos: hallazgo N4 ──────────────────────────────────────

async def test_obra_delete_cleans_up_bitacora_audio_file(ctx):
    """N4: borrar una obra borraba los audios de bitácora huérfanos en disco —
    ObraService.delete() limpiaba planos pero no bitácora."""
    import uuid
    from app.services.obra_service import ObraService
    from app.services.plano_service import UPLOADS_DIR

    db = ctx["db"]
    filename = f"bitacora_test_{uuid.uuid4().hex}.ogg"
    audio_file = UPLOADS_DIR / filename
    audio_file.write_bytes(b"audio de prueba")
    try:
        entry = BitacoraEntry(
            obra_id=ctx["obra_id"], source="web", audio_path=f"/uploads/{filename}",
            status="procesado", created_by=ctx["user_id"],
        )
        db.add(entry)
        await db.commit()

        await ObraService(db).delete(ctx["obra_id"], ctx["user_id"])
        await db.commit()

        assert not audio_file.exists()
    finally:
        audio_file.unlink(missing_ok=True)


# ── Reprocesar: hallazgos N6/N7 ──────────────────────────────────────────────

async def test_reprocess_blocked_when_suggestions_already_applied(client, ctx):
    """N6: reprocesar una entrada `procesado` con al menos una sugerencia
    aplicada reemplazaría `suggestions` entero perdiendo ese registro — debe
    rechazarse en vez de pisarlo silenciosamente."""
    entry = BitacoraEntry(
        obra_id=ctx["obra_id"], source="web", transcript="ya se aplicó algo",
        status="procesado",
        suggestions=[_base_suggestion(type="note", applied=True)],
    )
    ctx["db"].add(entry)
    await ctx["db"].commit()

    r = await client.post(f"{API}/bitacora/{entry.id}/reprocess", headers=_auth(ctx["token"]))
    assert r.status_code == 422, r.text


async def test_reprocess_allowed_when_no_suggestion_applied(client, ctx):
    """Contraparte: `procesado` sin nada aplicado (todo descartado o sin
    sugerencias) no tiene nada que perder — reprocesar debe seguir permitido."""
    entry = BitacoraEntry(
        obra_id=ctx["obra_id"], source="web", transcript="nada aplicado todavía",
        status="procesado",
        suggestions=[_base_suggestion(type="note", dismissed=True)],
    )
    ctx["db"].add(entry)
    await ctx["db"].commit()

    r = await client.post(f"{API}/bitacora/{entry.id}/reprocess", headers=_auth(ctx["token"]))
    # Sin ANTHROPIC_API_KEY en el entorno de test, el análisis en sí falla y
    # deja status="error" — lo que importa acá es que NO sea el 422 del guard
    # de N6 (o sea, que haya llegado a intentar procesar).
    assert r.status_code == 200, r.text


async def test_reprocess_missing_audio_file_returns_clear_error(client, ctx):
    """N7: si el audio ya no está en disco y no hay transcript, reprocess()
    antes devolvía 200 sin cambiar nada — ahora un error explícito."""
    entry = BitacoraEntry(
        obra_id=ctx["obra_id"], source="whatsapp",
        audio_path="/uploads/bitacora_no_existe_en_disco.ogg",
        status="pendiente_transcripcion",
    )
    ctx["db"].add(entry)
    await ctx["db"].commit()

    r = await client.post(f"{API}/bitacora/{entry.id}/reprocess", headers=_auth(ctx["token"]))
    assert r.status_code == 422, r.text
    assert "ya no está disponible" in r.json()["detail"]


# ── Formato AMR: hallazgo 8.7 ────────────────────────────────────────────────

async def test_transcribe_amr_gives_specific_error(ctx, monkeypatch):
    """8.7: Whisper rechaza AMR (WhatsApp en Android viejos) — antes el error
    quedaba genérico ('Error en el procesamiento: ...'), ahora es específico."""
    import requests as _requests
    from app.core.config import settings as _settings
    from app.core.exceptions import UnprocessableError
    from app.services.bitacora_service import BitacoraService

    monkeypatch.setattr(_settings, "OPENAI_API_KEY", "sk-fake-for-test")

    class _FakeResp:
        ok = False
        status_code = 400

    monkeypatch.setattr(_requests, "post", lambda *a, **k: _FakeResp())

    svc = BitacoraService(ctx["db"])
    with pytest.raises(UnprocessableError) as exc:
        svc._transcribe(b"fake audio bytes", "nota.amr")
    assert "AMR" in str(exc.value.detail)


# ── Rate limit por WhatsApp: hallazgo 8.3 ────────────────────────────────────

@pytest_asyncio.fixture
async def staff_ctx(db):
    """Un tenant con un User staff (con login + whatsapp_number, el único que
    puede mandar audios de bitácora — ver migración 0054) y una obra que
    administra."""
    from app.models.tenant_membership import TenantMembership

    tenant = Tenant(name="Empresa Rate Limit")
    db.add(tenant)
    await db.flush()
    staff_phone = "+5493511110000"
    staff = User(
        email="staff@ratelimit.com", hashed_password="x", full_name="Staff",
        role="admin", is_active=True, tenant_id=tenant.id,
    )
    db.add(staff)
    await db.flush()
    # whatsapp_number vive en TenantMembership, no en User (rediseño multi-tenant).
    db.add(TenantMembership(
        user_id=staff.id, tenant_id=tenant.id, role="admin", is_active=True,
        whatsapp_number=staff_phone,
    ))
    obra = Obra(name="Obra Rate Limit", manager_id=staff.id, tenant_id=tenant.id)
    db.add(obra)
    await db.flush()
    await db.commit()
    return {"db": db, "tenant_id": tenant.id, "staff_id": staff.id,
            "obra_id": obra.id, "staff_phone": staff_phone}


async def test_whatsapp_audio_rate_limited_after_threshold(staff_ctx, monkeypatch):
    """8.3: sin límite, un número podía mandar notas de voz sin parar — cada
    una dispara descarga de Twilio + Whisper + Claude. Con 10 entradas del
    mismo staff en la última hora, la número 11 debe rechazarse sin crear
    una entrada nueva ni gastar en IA."""
    from unittest.mock import AsyncMock, patch
    from app.schemas.message import TwilioInboundPayload
    from app.services.message_service import MessageService

    db = staff_ctx["db"]
    now = datetime.now(timezone.utc)
    for i in range(10):
        db.add(BitacoraEntry(
            obra_id=staff_ctx["obra_id"], source="whatsapp", transcript=f"nota {i}",
            created_by=staff_ctx["staff_id"], status="procesado", created_at=now,
        ))
    await db.commit()

    before_count = (await db.execute(
        select(BitacoraEntry).where(BitacoraEntry.obra_id == staff_ctx["obra_id"])
    )).scalars().all()
    assert len(before_count) == 10

    class _FakeGetResp:
        status_code = 200
        content = b"fake audio bytes"
        def raise_for_status(self): pass

    monkeypatch.setattr("requests.get", lambda *a, **k: _FakeGetResp())

    svc = MessageService(db)
    payload = TwilioInboundPayload(
        From=f"whatsapp:{staff_ctx['staff_phone']}",
        To="whatsapp:+14155238886",
        MessageSid="SM_test_rate_limit", AccountSid="AC_test",
        Body="", NumMedia="1",
        MediaUrl0="https://api.twilio.com/fake-audio.ogg",
        MediaContentType0="audio/ogg",
    )
    with patch("app.services.message_service.send_whatsapp_message", new=AsyncMock(return_value="SM_out")):
        await svc.process_inbound(payload, raw_params={})

    from app.models.message import Message, MessageDirection
    out = (await db.execute(
        select(Message).where(
            Message.direction == MessageDirection.OUTBOUND,
            Message.to_number == staff_ctx["staff_phone"],
        ).order_by(Message.id.desc())
    )).scalars().first()
    assert out is not None
    assert "muchas notas de voz" in out.body

    after_count = (await db.execute(
        select(BitacoraEntry).where(BitacoraEntry.obra_id == staff_ctx["obra_id"])
    )).scalars().all()
    assert len(after_count) == 10  # no se creó una entrada nueva
