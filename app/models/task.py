import enum
from datetime import datetime, date, timezone
from sqlalchemy import String, Text, ForeignKey, Date, DateTime, Integer, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class TaskStatus(str, enum.Enum):
    PENDIENTE = "pendiente"
    EN_PROGRESO = "en_progreso"
    BLOQUEADA = "bloqueada"
    COMPLETADA = "completada"
    CANCELADA = "cancelada"


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(primary_key=True)
    obra_id: Mapped[int] = mapped_column(ForeignKey("obras.id", ondelete="CASCADE"), nullable=False)
    responsible_id: Mapped[int | None] = mapped_column(ForeignKey("responsibles.id"), nullable=True)

    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[TaskStatus] = mapped_column(
        SAEnum(TaskStatus), default=TaskStatus.PENDIENTE, nullable=False
    )

    # Planning
    start_date: Mapped[date | None] = mapped_column(Date)
    due_date: Mapped[date | None] = mapped_column(Date)
    completed_date: Mapped[date | None] = mapped_column(Date)

    # Progress from AI interpretation (0–100)
    estimated_progress: Mapped[int] = mapped_column(Integer, default=0)

    # For Gantt ordering / dependencies (simple approach)
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    depends_on_id: Mapped[int | None] = mapped_column(
        ForeignKey("tasks.id"), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    obra: Mapped["Obra"] = relationship("Obra", back_populates="tasks")
    responsible: Mapped["Responsible | None"] = relationship(
        "Responsible", back_populates="tasks"
    )
    depends_on: Mapped["Task | None"] = relationship("Task", remote_side="Task.id")
    messages: Mapped[list["Message"]] = relationship("Message", back_populates="task")
    historial: Mapped[list["HistorialEvento"]] = relationship(
        "HistorialEvento", back_populates="task"
    )
    alerts: Mapped[list["Alert"]] = relationship("Alert", back_populates="task")
