from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class TaskRiskSnapshot(Base):
    """Última holgura (float CPM) calculada para una tarea.

    La regla `float_shrinking` (docs/propuesta-reglas-riesgo.md §1.2) compara el
    float de hoy contra el de la corrida anterior, y el CPM se recalcula al vuelo
    sin persistirse en ningún lado. Es una tabla chica —una fila por tarea, se
    pisa en cada corrida— en vez de columnas nuevas en `tasks`: el dato es
    derivado y volátil, no parte de la definición de la tarea.
    """

    __tablename__ = "task_risk_snapshots"

    task_id: Mapped[int] = mapped_column(
        ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True
    )
    # Denormalizado desde la obra (aislamiento por tenant sin join), igual que el resto.
    tenant_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("tenants.id"), nullable=False, index=True
    )
    # Holgura en días de la última corrida. 9999 = tarea sin restricciones (mismo
    # centinela que devuelve compute_critical_path).
    float_days: Mapped[int] = mapped_column(Integer, nullable=False)
    computed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    task: Mapped["Task"] = relationship("Task")  # type: ignore[name-defined]
