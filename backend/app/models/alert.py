import enum
from datetime import datetime, timezone
from sqlalchemy import Boolean, DateTime, Enum as SAEnum, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class AlertType(str, enum.Enum):
    TASK_BLOCKED = "task_blocked"
    DELAY_RISK = "delay_risk"
    TASK_OVERDUE = "task_overdue"
    NO_RESPONSE = "no_response"
    RESCHEDULE_REQUESTED = "reschedule_requested"


class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(primary_key=True)
    obra_id: Mapped[int | None] = mapped_column(
        ForeignKey("obras.id", ondelete="SET NULL"), nullable=True, index=True
    )
    task_id: Mapped[int | None] = mapped_column(
        ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True, index=True
    )
    type: Mapped[AlertType] = mapped_column(
        SAEnum(
            AlertType,
            name="alert_type",
            values_callable=lambda e: [m.value for m in e],
        ),
        nullable=False,
        index=True,
    )
    message: Mapped[str] = mapped_column(Text, nullable=False)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    obra: Mapped["Obra | None"] = relationship("Obra", back_populates="alerts")
    task: Mapped["Task | None"] = relationship("Task", back_populates="alerts")
