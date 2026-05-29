import enum
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import DateTime, Enum as SAEnum, ForeignKey, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class ConversationStep(str, enum.Enum):
    IDLE = "idle"
    OBRA_SELECT = "obra_select"
    TASK_SELECT = "task_select"
    STATUS_MENU = "status_menu"
    AWAIT_DATE = "await_date"


class ConversationSession(Base):
    __tablename__ = "conversation_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    responsible_id: Mapped[int] = mapped_column(
        ForeignKey("responsibles.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    step: Mapped[ConversationStep] = mapped_column(
        SAEnum(
            ConversationStep,
            name="conversation_step",
            values_callable=lambda e: [m.value for m in e],
        ),
        nullable=False,
        default=ConversationStep.IDLE,
    )
    selected_task_id: Mapped[int | None] = mapped_column(
        ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True
    )
    # [{idx, id, title, obra_name, due_date}, ...]
    task_options: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON, nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
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

    responsible: Mapped["Responsible"] = relationship("Responsible")
    selected_task: Mapped["Task | None"] = relationship(
        "Task", foreign_keys=[selected_task_id]
    )
