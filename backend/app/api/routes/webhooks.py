import logging

from fastapi import APIRouter, Request
from fastapi.responses import Response
from pydantic import ValidationError

from app.core.deps import DbSession
from app.core.rate_limit import check_wa_limit
from app.integrations.twilio.client import send_whatsapp_message
from app.integrations.twilio.parser import parse_twilio_payload
from app.integrations.twilio.security import verify_twilio_signature
from app.services.message_service import MessageService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/webhooks", tags=["webhooks"])

_EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'

# Hallazgo 7.10 de docs/auditoria/03-tareas.md: si algo revienta en el
# procesamiento (validación de Pydantic, ProgrammingError, bug de código),
# el usuario del WhatsApp quedaba sin respuesta y nadie se enteraba porque
# Twilio veía 200 y no reintenta. Ahora distinguimos:
#   - ValidationError → warning + fallback al remitente (schema roto → probablemente
#     Twilio cambió el payload; hay que investigar pero el usuario avisado).
#   - Exception genérica → error nivel alto (para que Sentry/logs disparen alerta)
#     + mismo fallback al remitente.
_FALLBACK_MESSAGE = (
    "Recibimos tu mensaje pero hubo un problema procesándolo. "
    "Intentá de nuevo en unos minutos. Si el problema persiste, "
    "avisale al encargado de la obra."
)


async def _send_fallback(from_number: str | None) -> None:
    if not from_number:
        return
    try:
        await send_whatsapp_message(from_number, _FALLBACK_MESSAGE)
    except Exception:
        logger.exception("Failed sending Twilio fallback message to %s", from_number)


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

    # Rate-limit por número de WhatsApp: evita que un remitente bombardee el sistema.
    # Se aplica DESPUÉS de validar la firma de Twilio para no bloquear tráfico legítimo
    # ante replays de atacantes con firma inválida (ya rechazados arriba).
    check_wa_limit(params.get("From", ""))

    from_number_raw = params.get("From", "")
    # Normalizamos el "whatsapp:+549..." → "+549..." para que send_whatsapp_message
    # no lo duplique. El cliente le suma el prefix "whatsapp:" internamente.
    from_number = from_number_raw.replace("whatsapp:", "").strip() or None
    message_sid = params.get("MessageSid", "unknown")

    try:
        payload = parse_twilio_payload(params)
    except ValidationError as exc:
        logger.warning(
            "Twilio webhook payload failed validation (MessageSid=%s): %s",
            message_sid,
            exc.errors(),
        )
        await _send_fallback(from_number)
        return Response(content=_EMPTY_TWIML, media_type="application/xml")

    try:
        await MessageService(db).process_inbound(payload, params)
    except Exception:
        # Errores inesperados: log a nivel error para que Sentry/observabilidad los
        # capte. El usuario recibe el fallback para no quedarse mirando el celular.
        logger.exception(
            "Unexpected error processing Twilio webhook (MessageSid=%s)",
            message_sid,
        )
        await _send_fallback(from_number)

    return Response(content=_EMPTY_TWIML, media_type="application/xml")
