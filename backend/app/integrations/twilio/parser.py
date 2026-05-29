from app.schemas.message import TwilioInboundPayload


def parse_twilio_payload(form_params: dict) -> TwilioInboundPayload:
    """
    Convert the raw Twilio form dict into a validated TwilioInboundPayload.

    Twilio sends all values as strings (including NumMedia). Pydantic handles
    the coercion via the NumMedia field_validator in the schema.
    """
    return TwilioInboundPayload.model_validate(form_params)
