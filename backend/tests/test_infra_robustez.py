"""Tests de robustez de infra:
- Rate-limit del webhook de WhatsApp (check_wa_limit)
- Limpieza de conversation_sessions vencidas
- Logging estructurado (JSON en prod, texto en dev)
"""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from app.core.rate_limit import _hits, check_wa_limit
from app.core.logging_config import setup_logging, _JsonFormatter
import logging
import json


# ── Fixture: limpiar el estado in-memory del rate limiter entre tests ───────

@pytest.fixture(autouse=True)
def clear_rate_limit_state():
    _hits.clear()
    yield
    _hits.clear()


# ── Rate-limit WhatsApp ──────────────────────────────────────────────────────

def test_wa_rate_limit_permite_hasta_el_maximo():
    numero = "whatsapp:+5491112345678"
    # Los primeros 10 mensajes deben pasar sin error
    for _ in range(10):
        check_wa_limit(numero)  # no debe lanzar


def test_wa_rate_limit_bloquea_al_superar_limite():
    numero = "whatsapp:+5491199999999"
    for _ in range(10):
        check_wa_limit(numero)
    with pytest.raises(HTTPException) as exc:
        check_wa_limit(numero)
    assert exc.value.status_code == 429
    assert "Retry-After" in exc.value.headers


def test_wa_rate_limit_ignora_numero_vacio():
    # Sin número (From vacío) no debe lanzar
    check_wa_limit("")
    check_wa_limit(None)


def test_wa_rate_limit_aislado_por_numero():
    num_a = "whatsapp:+5491100000001"
    num_b = "whatsapp:+5491100000002"
    for _ in range(10):
        check_wa_limit(num_a)
    # num_b no debe estar limitado por los hits de num_a
    check_wa_limit(num_b)


# ── Limpieza de conversation_sessions ───────────────────────────────────────

async def test_cleanup_elimina_sesiones_vencidas(db):
    """El job de limpieza debe borrar sesiones cuyo expires_at ya pasó."""
    from datetime import datetime, timezone, timedelta
    from sqlalchemy import select, func, delete
    from app.models.conversation_session import ConversationSession, ConversationStep
    from app.models.responsible import Responsible
    from app.models.obra import Obra
    from app.models.user import User

    user = User(
        email="sched@test.com",
        full_name="Sched User",
        hashed_password="x",
        tenant_id=1,
        is_active=True,
    )
    db.add(user)
    await db.flush()

    obra = Obra(name="Obra Sched", tenant_id=1, manager_id=user.id)
    db.add(obra)
    await db.flush()

    responsible = Responsible(
        full_name="Resp Sched",
        whatsapp_number="+5491100000099",
        tenant_id=1,
    )
    db.add(responsible)
    await db.flush()

    now = datetime.now(timezone.utc)

    expired = ConversationSession(
        responsible_id=responsible.id,
        step=ConversationStep.IDLE,
        expires_at=now - timedelta(hours=2),
    )
    db.add(expired)
    await db.flush()

    count_before = (await db.execute(select(func.count()).select_from(ConversationSession))).scalar()
    assert count_before >= 1

    # Lógica del job de limpieza ejecutada directamente
    result = await db.execute(
        delete(ConversationSession).where(ConversationSession.expires_at < now)
    )
    await db.flush()

    count_after = (await db.execute(select(func.count()).select_from(ConversationSession))).scalar()
    assert count_after == count_before - 1


# ── Logging estructurado ─────────────────────────────────────────────────────

def test_json_formatter_produce_json_valido():
    formatter = _JsonFormatter()
    record = logging.LogRecord(
        name="test", level=logging.INFO, pathname="", lineno=0,
        msg="mensaje de prueba", args=(), exc_info=None,
    )
    output = formatter.format(record)
    parsed = json.loads(output)
    assert parsed["level"] == "INFO"
    assert parsed["msg"] == "mensaje de prueba"
    assert "ts" in parsed


def test_setup_logging_debug_usa_formato_texto():
    setup_logging(debug=True)
    root = logging.getLogger()
    assert root.level == logging.DEBUG
    handler = root.handlers[0]
    assert not isinstance(handler.formatter, _JsonFormatter)


def test_setup_logging_prod_usa_json():
    setup_logging(debug=False)
    root = logging.getLogger()
    assert root.level == logging.INFO
    handler = root.handlers[0]
    assert isinstance(handler.formatter, _JsonFormatter)
