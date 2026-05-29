from datetime import datetime, timezone
from sqlalchemy import Text, ForeignKey, DateTime, String, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class HistorialEvento(Base):
    __tablename__ = "historial_eventos"

    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int | None] = mapped_column(ForeignKey("tasks.id"), nullable=True)
    obra_id: Mapped[int | None] = mapped_column(ForeignKey("obras.id"), nullable=True)

    event_type: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)

    # Snapshot of what changed: {"field": "status", "from": "pendiente", "to": "en_progreso"}
    payload: Mapped[dict | None] = mapped_column(JSON)

    triggered_by: Mapped[str | None] = mapped_column(String(50))  # "chatbot", "system", "user"

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    task: Mapped["Task | None"] = relationship("Task", back_populates="historial")
