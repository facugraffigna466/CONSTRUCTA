import enum
from datetime import datetime, timezone
from sqlalchemy import String, Text, ForeignKey, DateTime, Enum as SAEnum, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class MessageType(str, enum.Enum):
    TEXT = "text"
    AUDIO = "audio"
    IMAGE = "image"
    DOCUMENT = "document"


class MessageDirection(str, enum.Enum):
    INBOUND = "inbound"    # from responsible → system
    OUTBOUND = "outbound"  # from system → responsible


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int | None] = mapped_column(ForeignKey("tasks.id"), nullable=True)
    responsible_id: Mapped[int | None] = mapped_column(
        ForeignKey("responsibles.id"), nullable=True
    )

    direction: Mapped[MessageDirection] = mapped_column(SAEnum(MessageDirection), nullable=False)
    message_type: Mapped[MessageType] = mapped_column(SAEnum(MessageType), nullable=False)

    raw_content: Mapped[str | None] = mapped_column(Text)        # original text / media URL
    transcription: Mapped[str | None] = mapped_column(Text)      # Whisper output for audio
    ai_interpretation: Mapped[dict | None] = mapped_column(JSON) # Claude structured output

    twilio_sid: Mapped[str | None] = mapped_column(String(64), unique=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    task: Mapped["Task | None"] = relationship("Task", back_populates="messages")
    responsible: Mapped["Responsible | None"] = relationship(
        "Responsible", back_populates="messages"
    )
