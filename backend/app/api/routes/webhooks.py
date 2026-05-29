import logging

from fastapi import APIRouter, Request
from fastapi.responses import Response

from app.core.deps import DbSession
from app.integrations.twilio.parser import parse_twilio_payload
from app.integrations.twilio.security import verify_twilio_signature
from app.services.message_service import MessageService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/webhooks", tags=["webhooks"])

_EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'


@router.post("/twilio")
async def twilio_inbound(request: Request, db: DbSession) -> Response:
    """
    Receives inbound WhatsApp messages from Twilio.

    Authentication: Twilio HMAC-SHA1 signature (not JWT).
    Always returns 200 with empty TwiML — actual reply is sent via REST API.
    Errors are logged but never propagate as HTTP errors to prevent Twilio retries
    for messages we have already saved (idempotency guard handles duplicates).
    """
    form_data = await request.form()
    params = dict(form_data)

    await verify_twilio_signature(request, params)

    try:
        payload = parse_twilio_payload(params)
        await MessageService(db).process_inbound(payload, params)
    except Exception:
        logger.exception(
            "Error processing Twilio webhook (MessageSid=%s)",
            params.get("MessageSid", "unknown"),
        )

    return Response(content=_EMPTY_TWIML, media_type="application/xml")
