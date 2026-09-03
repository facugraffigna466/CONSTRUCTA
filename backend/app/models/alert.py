import enum
from datetime import datetime, timezone
from sqlalchemy import Boolean, DateTime, Enum as SAEnum, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class AlertType(str, enum.Enum):
    # ── Reglas originales (6) ─────────────────────────────────────────────────
    TASK_BLOCKED = "task_blocked"
    DELAY_RISK = "delay_risk"
    TASK_OVERDUE = "task_overdue"
    NO_RESPONSE = "no_response"
    RESCHEDULE_REQUESTED = "reschedule_requested"
    ORDER_RECEIVED = "order_received"

    # ── Detección de riesgo (docs/propuesta-reglas-riesgo.md) ─────────────────
    # Bloque 1 — ruta crítica (CPM)
    CRITICAL_TASK_DELAYED = "critical_task_delayed"
    FLOAT_SHRINKING = "float_shrinking"
    # Bloque 2 — baseline
    BASELINE_DEVIATION = "baseline_deviation"
    # Bloque 3 — materiales / compras
    MATERIAL_PENDING_TOO_LONG = "material_pending_too_long"
    ORDER_SENT_NO_CONFIRMATION = "order_sent_no_confirmation"
    MATERIAL_BLOCKING_TASK = "material_blocking_task"
    # Bloque 4 — progreso
    PROGRESS_STALLED = "progress_stalled"
    # Bloque 5 — calendario laboral
    DEADLINE_CONFLICTS_HOLIDAY = "deadline_conflicts_holiday"
    # Bloque 6 — patrones sobre historial
    RECURRING_BLOCKER = "recurring_blocker"
    CHRONIC_NO_RESPONSE = "chronic_no_response"
    # Bloque 7 — hitos
    MILESTONE_AT_RISK = "milestone_at_risk"


class AlertSeverity(str, enum.Enum):
    """Peso de la alerta. Se guarda como VARCHAR (no como enum de PG) a propósito:
    la propuesta anticipa más reglas y un VARCHAR evita una migración ALTER TYPE
    por cada nivel nuevo. El orden de importancia es CRITICA > ALTA > MEDIA > BAJA."""

    CRITICA = "critica"
    ALTA = "alta"
    MEDIA = "media"
    BAJA = "baja"


# Severidad por defecto de cada tipo. Las reglas que mueven la fecha fin de la obra
# (ruta crítica, hitos) pesan más que un vencimiento aislado — ver la sección
# "Consideraciones transversales" de docs/propuesta-reglas-riesgo.md.
DEFAULT_SEVERITY: dict[AlertType, AlertSeverity] = {
    AlertType.TASK_BLOCKED: AlertSeverity.ALTA,
    AlertType.DELAY_RISK: AlertSeverity.MEDIA,
    AlertType.TASK_OVERDUE: AlertSeverity.ALTA,
    AlertType.NO_RESPONSE: AlertSeverity.MEDIA,
    AlertType.RESCHEDULE_REQUESTED: AlertSeverity.MEDIA,
    AlertType.ORDER_RECEIVED: AlertSeverity.BAJA,
    AlertType.CRITICAL_TASK_DELAYED: AlertSeverity.CRITICA,
    AlertType.FLOAT_SHRINKING: AlertSeverity.MEDIA,
    AlertType.BASELINE_DEVIATION: AlertSeverity.ALTA,
    AlertType.MATERIAL_PENDING_TOO_LONG: AlertSeverity.MEDIA,
    AlertType.ORDER_SENT_NO_CONFIRMATION: AlertSeverity.MEDIA,
    AlertType.MATERIAL_BLOCKING_TASK: AlertSeverity.ALTA,
    AlertType.PROGRESS_STALLED: AlertSeverity.MEDIA,
    AlertType.DEADLINE_CONFLICTS_HOLIDAY: AlertSeverity.BAJA,
    AlertType.RECURRING_BLOCKER: AlertSeverity.ALTA,
    AlertType.CHRONIC_NO_RESPONSE: AlertSeverity.ALTA,
    AlertType.MILESTONE_AT_RISK: AlertSeverity.CRITICA,
}


class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(primary_key=True)
    obra_id: Mapped[int | None] = mapped_column(
        ForeignKey("obras.id", ondelete="SET NULL"), nullable=True, index=True
    )
    task_id: Mapped[int | None] = mapped_column(
        ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Denormalizado desde la obra (aislamiento por tenant sin join).
    tenant_id: Mapped[int | None] = mapped_column(
        ForeignKey("tenants.id"), nullable=True, index=True
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
    severity: Mapped[str] = mapped_column(
        String(10), default=AlertSeverity.MEDIA.value, nullable=False, index=True
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
