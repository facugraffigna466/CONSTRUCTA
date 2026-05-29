from datetime import datetime, timezone
from typing import Any
from sqlalchemy import DateTime, ForeignKey, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class HistorialEvento(Base):
    """Append-only event log. Written by services, never updated."""

    __tablename__ = "historial_eventos"

    id: Mapped[int] = mapped_column(primary_key=True)
    obra_id: Mapped[int | None] = mapped_column(
        ForeignKey("obras.id", ondelete="SET NULL"), nullable=True, index=True
    )
    task_id: Mapped[int | None] = mapped_column(
        ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True, index=True
    )

    event_type: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    description: Mapped[str] = mapped_column(Text, nullable=False)

    # {"field": "status", "from": "pendiente", "to": "en_progreso"}
    payload: Mapped[dict[str, Any] | None] = mapped_column(JSON)

    # "user" | "chatbot" | "system"
    triggered_by: Mapped[str] = mapped_column(String(50), nullable=False, default="system")

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    obra: Mapped["Obra | None"] = relationship("Obra", back_populates="historial")
    task: Mapped["Task | None"] = relationship("Task", back_populates="historial")
