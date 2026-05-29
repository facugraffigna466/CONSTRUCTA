import hmac
import logging

from fastapi import HTTPException, Request, status
from twilio.request_validator import RequestValidator

from app.core.config import settings

logger = logging.getLogger(__name__)


def _build_webhook_url(request: Request) -> str:
    """
    Return the URL Twilio used to call this webhook.

    When running behind ngrok or a reverse proxy, the URL Twilio signed is the
    PUBLIC_BASE_URL, not the internal host. We reconstruct it from settings so
    the HMAC validates correctly in all environments.
    """
    if settings.PUBLIC_BASE_URL:
        base = settings.PUBLIC_BASE_URL.rstrip("/")
        return f"{base}{request.url.path}"
    return str(request.url)


async def verify_twilio_signature(request: Request, params: dict) -> None:
    """
    FastAPI dependency — raises 403 if the Twilio HMAC signature is invalid.

    Signature validation is skipped when:
    - DEBUG mode is active (local development without ngrok)
    - TWILIO_AUTH_TOKEN is not configured

    Both cases are safe for development; always configure the token in production.
    """
    if settings.DEBUG or not settings.TWILIO_AUTH_TOKEN:
        logger.warning(
            "Twilio signature validation SKIPPED "
            "(DEBUG=%s, auth_token_set=%s)",
            settings.DEBUG,
            bool(settings.TWILIO_AUTH_TOKEN),
        )
        return

    signature = request.headers.get("X-Twilio-Signature", "")
    url = _build_webhook_url(request)

    validator = RequestValidator(settings.TWILIO_AUTH_TOKEN)
    if not validator.validate(url, params, signature):
        logger.warning("Twilio signature validation FAILED for url=%s", url)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid Twilio signature",
        )
