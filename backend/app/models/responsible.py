from datetime import datetime, timezone
from sqlalchemy import Boolean, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class Responsible(Base):
    __tablename__ = "responsibles"

    id: Mapped[int] = mapped_column(primary_key=True)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    # E.164 format: +5491112345678 — the chatbot key in Phase 2
    whatsapp_number: Mapped[str] = mapped_column(
        String(20), unique=True, nullable=False, index=True
    )
    role: Mapped[str | None] = mapped_column(String(100))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    tasks: Mapped[list["Task"]] = relationship("Task", back_populates="responsible")
    messages: Mapped[list["Message"]] = relationship("Message", back_populates="responsible")
