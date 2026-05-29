import logging
from functools import lru_cache

import anyio
from twilio.rest import Client

from app.core.config import settings

logger = logging.getLogger(__name__)

_WA_PREFIX = "whatsapp:"


def _ensure_wa_prefix(number: str) -> str:
    return number if number.startswith(_WA_PREFIX) else f"{_WA_PREFIX}{number}"


@lru_cache(maxsize=1)
def _get_client() -> Client:
    return Client(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)


async def send_whatsapp_message(to_number: str, body: str) -> str | None:
    """
    Send a WhatsApp message via the Twilio REST API.

    Returns the Twilio MessageSid on success, or None if Twilio is not
    configured (so the rest of the flow continues in development).

    Twilio's SDK is synchronous; we run it in a thread to avoid blocking
    the async event loop.
    """
    if not settings.TWILIO_ACCOUNT_SID or not settings.TWILIO_AUTH_TOKEN:
        logger.warning(
            "Twilio not configured — skipping outbound message to %s: %s",
            to_number,
            body[:80],
        )
        return None

    from_wa = _ensure_wa_prefix(settings.TWILIO_WHATSAPP_NUMBER)
    to_wa = _ensure_wa_prefix(to_number)

    def _send() -> str:
        msg = _get_client().messages.create(from_=from_wa, to=to_wa, body=body)
        return msg.sid

    try:
        sid = await anyio.to_thread.run_sync(_send)
        logger.info("Outbound WhatsApp sent to %s, sid=%s", to_number, sid)
        return sid
    except Exception:
        logger.exception("Failed to send WhatsApp message to %s", to_number)
        return None
