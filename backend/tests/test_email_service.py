"""Tests del email_service (Fase 6 emails).

Cubre lo que la auditoría 01 §8.9 marcaba como gap: hasta ahora ningún test
validaba que el sender, el subject o el HTML del email fueran los esperados.
Ahora se mockea `httpx.AsyncClient.post` y se verifica:

  - Sender configurado desde settings (`BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`).
  - Subject correcto por tipo de email.
  - HTML/text contienen el link correspondiente (`invite_url`/`reset_url`/`verify_url`).
  - Sin `BREVO_API_KEY`, las funciones devuelven False/None sin explotar.
  - Retry sobre 429/503/timeout; NO retry sobre 400/401/422.
  - Tras agotar los retries, devuelve False (fire-and-forget para el caller).
"""
from __future__ import annotations

import re
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from app.core.config import settings
from app.services import email_service


# ─────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────


def _fake_response(status_code: int, body: dict | None = None) -> httpx.Response:
    body = body or {"messageId": "<test>"}
    return httpx.Response(status_code=status_code, json=body)


class _MockAsyncClient:
    """Reemplazo mínimo de httpx.AsyncClient que devuelve respuestas fake
    encoladas. Compatible con `async with`."""

    def __init__(self, responses: list[httpx.Response | Exception]):
        self.responses = list(responses)
        self.calls: list[dict] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return False

    async def post(self, url, json=None, headers=None):  # noqa: A002 — matches httpx signature
        self.calls.append({"url": url, "json": json, "headers": headers})
        if not self.responses:
            raise AssertionError("Mock: no hay respuestas encoladas")
        r = self.responses.pop(0)
        if isinstance(r, Exception):
            raise r
        return r


@pytest.fixture
def brevo_configured(monkeypatch):
    """Setea variables de Brevo para que las funciones no salgan por 'skip'."""
    monkeypatch.setattr(settings, "BREVO_API_KEY", "test-key-xyz", raising=False)
    monkeypatch.setattr(settings, "BREVO_SENDER_EMAIL", "hola@constructa.test", raising=False)
    monkeypatch.setattr(settings, "BREVO_SENDER_NAME", "Constructa Test", raising=False)
    monkeypatch.setattr(settings, "FRONTEND_URL", "https://app.constructa.test", raising=False)


@pytest.fixture(autouse=True)
def _no_backoff_sleep(monkeypatch):
    """Elimina el sleep del backoff en tests para no gastar 7 segundos por retry."""
    async def _no_sleep(*_args, **_kwargs):
        return None
    import tenacity.nap
    monkeypatch.setattr(tenacity.nap, "sleep", _no_sleep, raising=False)


# ─────────────────────────────────────────────────────────────
# Sender + payload correcto
# ─────────────────────────────────────────────────────────────


async def test_invite_email_manda_sender_configurado(brevo_configured):
    mock = _MockAsyncClient([_fake_response(201)])
    with patch("app.services.email_service.httpx.AsyncClient", return_value=mock):
        await email_service.send_invite_email(
            to_email="alguien@ejemplo.com",
            invite_url="https://app.constructa.test/invite/abc",
            role="collaborator",
        )
    assert len(mock.calls) == 1
    payload = mock.calls[0]["json"]
    assert payload["sender"] == {"name": "Constructa Test", "email": "hola@constructa.test"}
    assert payload["to"] == [{"email": "alguien@ejemplo.com"}]
    assert mock.calls[0]["headers"]["api-key"] == "test-key-xyz"


async def test_invite_email_subject_correcto(brevo_configured):
    mock = _MockAsyncClient([_fake_response(201)])
    with patch("app.services.email_service.httpx.AsyncClient", return_value=mock):
        await email_service.send_invite_email(
            to_email="x@y.com", invite_url="https://app.constructa.test/invite/aaa",
            role="admin",
        )
    assert mock.calls[0]["json"]["subject"] == "Te invitaron a Constructa"


async def test_invite_email_html_contiene_url(brevo_configured):
    invite_url = "https://app.constructa.test/invite/token-unico-123"
    mock = _MockAsyncClient([_fake_response(201)])
    with patch("app.services.email_service.httpx.AsyncClient", return_value=mock):
        await email_service.send_invite_email("x@y.com", invite_url, "collaborator")
    html = mock.calls[0]["json"]["htmlContent"]
    assert invite_url in html
    text = mock.calls[0]["json"]["textContent"]
    assert invite_url in text


async def test_reset_password_email_html_contiene_url(brevo_configured):
    reset_url = "https://app.constructa.test/reset/reset-token-456"
    mock = _MockAsyncClient([_fake_response(201)])
    with patch("app.services.email_service.httpx.AsyncClient", return_value=mock):
        ok = await email_service.send_password_reset_email("u@ejemplo.com", reset_url)
    assert ok is True
    payload = mock.calls[0]["json"]
    assert payload["subject"] == "Recuperá tu contraseña — Constructa"
    assert reset_url in payload["htmlContent"]
    assert reset_url in payload["textContent"]


async def test_verification_email_html_contiene_url(brevo_configured):
    verify_url = "https://app.constructa.test/verify/verif-token-789"
    mock = _MockAsyncClient([_fake_response(201)])
    with patch("app.services.email_service.httpx.AsyncClient", return_value=mock):
        ok = await email_service.send_verification_email("u@ejemplo.com", verify_url)
    assert ok is True
    payload = mock.calls[0]["json"]
    assert payload["subject"] == "Confirmá tu email — Constructa"
    assert verify_url in payload["htmlContent"]
    assert verify_url in payload["textContent"]


async def test_plan_warning_email_contiene_datos_y_cta(brevo_configured):
    mock = _MockAsyncClient([_fake_response(201)])
    with patch("app.services.email_service.httpx.AsyncClient", return_value=mock):
        ok = await email_service.send_plan_warning_email(
            to_email="admin@ejemplo.com",
            admin_name="Juan Admin",
            tenant_name="Constructora Sur",
            resource_label="obras",
            current=8,
            limit=10,
            plan_label="Pro",
        )
    assert ok is True
    payload = mock.calls[0]["json"]
    assert payload["subject"] == "Estás usando 8 de 10 obras — Constructa"
    # HTML incluye nombre del admin, tenant, contadores y CTA al frontend.
    html = payload["htmlContent"]
    assert "Juan Admin" in html
    assert "Constructora Sur" in html
    assert "8" in html and "10" in html
    assert "https://app.constructa.test/configuracion#plan" in html
    # Menciona el porcentaje calculado (80%).
    assert re.search(r"80\s*%", html)


# ─────────────────────────────────────────────────────────────
# Degradación silenciosa sin BREVO_API_KEY
# ─────────────────────────────────────────────────────────────


async def test_sin_api_key_devuelve_false_y_no_hace_request(monkeypatch):
    monkeypatch.setattr(settings, "BREVO_API_KEY", "", raising=False)
    mock = _MockAsyncClient([])  # NO debería haber ningún POST
    with patch("app.services.email_service.httpx.AsyncClient", return_value=mock):
        result = await email_service.send_email(
            "x@y.com", "subj", "<p>html</p>", "text",
        )
    assert result is False
    assert mock.calls == []  # nunca llamó


async def test_sin_api_key_invite_devuelve_none_sin_explotar(monkeypatch):
    monkeypatch.setattr(settings, "BREVO_API_KEY", "", raising=False)
    mock = _MockAsyncClient([])
    with patch("app.services.email_service.httpx.AsyncClient", return_value=mock):
        result = await email_service.send_invite_email(
            "x@y.com", "https://irrelevante", "collaborator",
        )
    assert result is None
    assert mock.calls == []


# ─────────────────────────────────────────────────────────────
# Retry / no-retry por tipo de error
# ─────────────────────────────────────────────────────────────


async def test_retry_sobre_503(brevo_configured):
    """3 intentos: 2 con 503, el 3ro OK. Debe devolver True."""
    mock = _MockAsyncClient([
        _fake_response(503, {"message": "temporarily unavailable"}),
        _fake_response(503, {"message": "still busy"}),
        _fake_response(201),
    ])
    with patch("app.services.email_service.httpx.AsyncClient", return_value=mock):
        ok = await email_service.send_email("x@y.com", "s", "<p>h</p>", "t")
    assert ok is True
    assert len(mock.calls) == 3


async def test_retry_sobre_429(brevo_configured):
    """Rate limit: reintenta hasta que salga."""
    mock = _MockAsyncClient([_fake_response(429), _fake_response(201)])
    with patch("app.services.email_service.httpx.AsyncClient", return_value=mock):
        ok = await email_service.send_email("x@y.com", "s", "<p>h</p>", "t")
    assert ok is True
    assert len(mock.calls) == 2


async def test_retry_sobre_timeout(brevo_configured):
    """TimeoutException del cliente HTTP: retry."""
    mock = _MockAsyncClient([
        httpx.ConnectTimeout("timeout"),
        _fake_response(201),
    ])
    with patch("app.services.email_service.httpx.AsyncClient", return_value=mock):
        ok = await email_service.send_email("x@y.com", "s", "<p>h</p>", "t")
    assert ok is True
    assert len(mock.calls) == 2


async def test_agotamiento_de_retries_devuelve_false(brevo_configured):
    """3 intentos consecutivos de 503 → devuelve False (no explota)."""
    mock = _MockAsyncClient([_fake_response(503)] * 3)
    with patch("app.services.email_service.httpx.AsyncClient", return_value=mock):
        ok = await email_service.send_email("x@y.com", "s", "<p>h</p>", "t")
    assert ok is False
    assert len(mock.calls) == 3  # exactamente los 3 intentos, sin retry adicional


async def test_no_retry_sobre_400(brevo_configured):
    """Error no transitorio (400/401/422) NO se reintenta — reintentar no
    lo arregla y sumaría 3 requests inútiles a Brevo."""
    mock = _MockAsyncClient([_fake_response(400, {"message": "bad payload"})])
    with patch("app.services.email_service.httpx.AsyncClient", return_value=mock):
        ok = await email_service.send_email("x@y.com", "s", "<p>h</p>", "t")
    assert ok is False
    assert len(mock.calls) == 1


async def test_no_retry_sobre_401(brevo_configured):
    mock = _MockAsyncClient([_fake_response(401, {"message": "unauthorized"})])
    with patch("app.services.email_service.httpx.AsyncClient", return_value=mock):
        ok = await email_service.send_email("x@y.com", "s", "<p>h</p>", "t")
    assert ok is False
    assert len(mock.calls) == 1


# ─────────────────────────────────────────────────────────────
# Rol → label del HTML de invitación
# ─────────────────────────────────────────────────────────────


async def test_invite_role_admin_label_html(brevo_configured):
    mock = _MockAsyncClient([_fake_response(201)])
    with patch("app.services.email_service.httpx.AsyncClient", return_value=mock):
        await email_service.send_invite_email("x@y.com", "https://irrelevante", "admin")
    html = mock.calls[0]["json"]["htmlContent"]
    assert "Administrador" in html


async def test_invite_role_collaborator_label_html(brevo_configured):
    mock = _MockAsyncClient([_fake_response(201)])
    with patch("app.services.email_service.httpx.AsyncClient", return_value=mock):
        await email_service.send_invite_email("x@y.com", "https://irrelevante", "collaborator")
    html = mock.calls[0]["json"]["htmlContent"]
    assert "Colaborador" in html
