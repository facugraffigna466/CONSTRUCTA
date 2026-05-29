from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, field_validator

from app.models.message import (
    MessageChannel,
    MessageDirection,
    MessageProcessingStatus,
    MessageType,
)


class TwilioInboundPayload(BaseModel):
    """Parsed from Twilio's application/x-www-form-urlencoded webhook body."""

    MessageSid: str
    AccountSid: str
    From: str  # "whatsapp:+5491112345678"
    To: str    # "whatsapp:+14155238886"
    Body: str | None = None
    NumMedia: int = 0
    MediaUrl0: str | None = None
    MediaContentType0: str | None = None

    model_config = {"populate_by_name": True}

    @field_validator("NumMedia", mode="before")
    @classmethod
    def coerce_num_media(cls, v: Any) -> int:
        # Twilio sends all form values as strings
        return int(v) if v else 0

    @property
    def from_number(self) -> str:
        """E.164 number without the 'whatsapp:' prefix."""
        return self.From.replace("whatsapp:", "")

    @property
    def to_number(self) -> str:
        return self.To.replace("whatsapp:", "")

    @property
    def detected_type(self) -> MessageType:
        if self.NumMedia and self.NumMedia > 0:
            ct = (self.MediaContentType0 or "").lower()
            if ct.startswith("audio"):
                return MessageType.AUDIO
            if ct.startswith("image"):
                return MessageType.IMAGE
            return MessageType.UNKNOWN
        return MessageType.TEXT


class MessageCreateInternal(BaseModel):
    """Internal DTO — never exposed via HTTP."""

    direction: MessageDirection
    channel: MessageChannel = MessageChannel.WHATSAPP
    message_type: MessageType
    from_number: str
    to_number: str
    body: str | None = None
    media_url: str | None = None
    responsible_id: int | None = None
    task_id: int | None = None
    external_message_id: str | None = None
    raw_payload: dict[str, Any] | None = None
    processing_status: MessageProcessingStatus = MessageProcessingStatus.PENDING


class MessageRead(BaseModel):
    id: int
    direction: MessageDirection
    channel: MessageChannel
    message_type: MessageType
    processing_status: MessageProcessingStatus
    from_number: str
    to_number: str
    body: str | None
    media_url: str | None
    transcription: str | None
    responsible_id: int | None
    task_id: int | None
    external_message_id: str | None
    created_at: datetime

    model_config = {"from_attributes": True}
