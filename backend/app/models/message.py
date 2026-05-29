import enum
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import DateTime, Enum as SAEnum, ForeignKey, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class MessageDirection(str, enum.Enum):
    INBOUND = "inbound"
    OUTBOUND = "outbound"


class MessageChannel(str, enum.Enum):
    WHATSAPP = "whatsapp"


class MessageType(str, enum.Enum):
    TEXT = "text"
    AUDIO = "audio"
    IMAGE = "image"
    UNKNOWN = "unknown"


class MessageProcessingStatus(str, enum.Enum):
    PENDING = "pending"      # saved, waiting for AI (Phase 3)
    PROCESSED = "processed"  # AI interpretation complete
    FAILED = "failed"        # processing error


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(primary_key=True)

    responsible_id: Mapped[int | None] = mapped_column(
        ForeignKey("responsibles.id", ondelete="SET NULL"), nullable=True, index=True
    )
    task_id: Mapped[int | None] = mapped_column(
        ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True, index=True
    )

    direction: Mapped[MessageDirection] = mapped_column(
        SAEnum(
            MessageDirection,
            name="message_direction",
            values_callable=lambda e: [m.value for m in e],
        ),
        nullable=False,
    )
    channel: Mapped[MessageChannel] = mapped_column(
        SAEnum(
            MessageChannel,
            name="message_channel",
            values_callable=lambda e: [m.value for m in e],
        ),
        nullable=False,
        default=MessageChannel.WHATSAPP,
    )
    message_type: Mapped[MessageType] = mapped_column(
        SAEnum(
            MessageType,
            name="message_type",
            values_callable=lambda e: [m.value for m in e],
        ),
        nullable=False,
        default=MessageType.TEXT,
    )
    processing_status: Mapped[MessageProcessingStatus] = mapped_column(
        SAEnum(
            MessageProcessingStatus,
            name="message_processing_status",
            values_callable=lambda e: [m.value for m in e],
        ),
        nullable=False,
        default=MessageProcessingStatus.PENDING,
    )

    from_number: Mapped[str] = mapped_column(String(30), nullable=False)
    to_number: Mapped[str] = mapped_column(String(30), nullable=False)

    body: Mapped[str | None] = mapped_column(Text)
    media_url: Mapped[str | None] = mapped_column(String(500))

    # Populated by Whisper in Phase 3
    transcription: Mapped[str | None] = mapped_column(Text)
    # Populated by Claude in Phase 3
    ai_interpretation: Mapped[dict[str, Any] | None] = mapped_column(JSON)

    # Twilio's MessageSid — unique so duplicate webhooks are idempotent
    external_message_id: Mapped[str | None] = mapped_column(
        String(64), unique=True, nullable=True, index=True
    )
    # Full Twilio form payload for debugging and auditability
    raw_payload: Mapped[dict[str, Any] | None] = mapped_column(JSON)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    responsible: Mapped["Responsible | None"] = relationship(
        "Responsible", back_populates="messages"
    )
    task: Mapped["Task | None"] = relationship("Task", back_populates="messages")
