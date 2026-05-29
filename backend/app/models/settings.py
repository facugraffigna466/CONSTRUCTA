from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class SystemSettings(Base):
    __tablename__ = "system_settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    manager_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
        index=True,
    )

    # ── Chatbot ───────────────────────────────────────────────────────────────
    chatbot_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    send_hour_from: Mapped[int] = mapped_column(Integer, default=8, nullable=False)
    send_hour_to: Mapped[int] = mapped_column(Integer, default=20, nullable=False)
    max_response_hours: Mapped[int] = mapped_column(Integer, default=24, nullable=False)
    auto_reminders: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # ── Automatizaciones ──────────────────────────────────────────────────────
    reminder_3days: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    reminder_1day: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    alert_overdue: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    alert_no_response: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    retry_failed: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # ── Alertas ───────────────────────────────────────────────────────────────
    notify_task_overdue: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    notify_task_blocked: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    notify_no_response: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    notify_rescheduled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # ── General ───────────────────────────────────────────────────────────────
    company_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    main_responsible: Mapped[str | None] = mapped_column(String(255), nullable=True)
    company_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    company_phone: Mapped[str | None] = mapped_column(String(50), nullable=True)

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
