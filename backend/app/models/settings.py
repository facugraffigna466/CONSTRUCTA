from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class SystemSettings(Base):
    """Configuración del chatbot/alertas — una por EMPRESA, no por usuario (ver
    docs/auditoria/11-panel-configuracion.md, hallazgo 1). Son reglas que pone
    la empresa (horario de atención, qué alertas mostrar), no una preferencia
    personal del manager que las cargó — antes ligarlas a `manager_id` hacía
    que dos obras de la misma empresa, con managers distintos, terminaran con
    el chatbot operando en horarios completamente distintos."""

    __tablename__ = "system_settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("tenants.id", ondelete="CASCADE"),
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

    # ── Detección de riesgo (docs/propuesta-reglas-riesgo.md) ─────────────────
    # Un toggle por regla + su umbral. Los umbrales son días salvo donde se aclare.
    # OJO: si agregás un campo acá, agregalo también a _defaults() en
    # repositories/settings.py — esa función devuelve una instancia NO persistida,
    # así que los default= de SQLAlchemy todavía no se aplicaron y quedarían en None.
    risk_critical_task_delayed: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    risk_critical_delay_lookahead_days: Mapped[int] = mapped_column(Integer, default=3, nullable=False)

    risk_float_shrinking: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    risk_float_threshold_days: Mapped[int] = mapped_column(Integer, default=3, nullable=False)

    risk_baseline_deviation: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    risk_baseline_deviation_days: Mapped[int] = mapped_column(Integer, default=5, nullable=False)

    risk_material_pending: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    risk_material_pending_days: Mapped[int] = mapped_column(Integer, default=7, nullable=False)

    risk_order_no_confirmation: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    risk_order_confirmation_days: Mapped[int] = mapped_column(Integer, default=7, nullable=False)

    risk_material_blocking_task: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    risk_material_blocking_days: Mapped[int] = mapped_column(Integer, default=5, nullable=False)

    risk_progress_stalled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    risk_progress_stalled_days: Mapped[int] = mapped_column(Integer, default=7, nullable=False)

    risk_deadline_holiday: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    risk_holiday_lookahead_days: Mapped[int] = mapped_column(Integer, default=14, nullable=False)

    risk_recurring_blocker: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    risk_recurring_blocker_count: Mapped[int] = mapped_column(Integer, default=3, nullable=False)

    risk_chronic_no_response: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    risk_chronic_no_response_count: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    risk_chronic_no_response_window_days: Mapped[int] = mapped_column(Integer, default=30, nullable=False)

    risk_milestone_at_risk: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    risk_milestone_lookahead_days: Mapped[int] = mapped_column(Integer, default=7, nullable=False)

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
