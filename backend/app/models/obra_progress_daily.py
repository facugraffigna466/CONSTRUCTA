from datetime import date
from sqlalchemy import Date, ForeignKey, Integer, Numeric, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class ObraProgressDaily(Base):
    """Historial diario de avance — I-05 (curva S). Una fila por obra por día,
    escrita por el job `obra_progress_daily` (app/core/scheduler.py). Se
    guarda el resultado ya calculado, no los insumos: si la fórmula de avance
    cambia, la historia vieja queda con la fórmula vieja — es el precio de no
    tener replay, y es aceptable (docs/features/dashboard-indicadores-obra.md §5).
    """
    __tablename__ = "obra_progress_daily"
    __table_args__ = (
        UniqueConstraint("obra_id", "date", name="uq_obra_progress_daily_obra_date"),
    )

    id:                   Mapped[int]         = mapped_column(primary_key=True)
    obra_id:              Mapped[int]         = mapped_column(ForeignKey("obras.id", ondelete="CASCADE"), nullable=False, index=True)
    tenant_id:            Mapped[int]         = mapped_column(ForeignKey("tenants.id"), nullable=False, index=True)
    date:                 Mapped[date]        = mapped_column(Date, nullable=False)
    progress_real:        Mapped[float | None] = mapped_column(Numeric(5, 2), nullable=True)
    progress_planned:     Mapped[float | None] = mapped_column(Numeric(5, 2), nullable=True)
    spi:                  Mapped[float | None] = mapped_column(Numeric(5, 3), nullable=True)
    tasks_total:          Mapped[int | None]  = mapped_column(Integer, nullable=True)
    tasks_completed:      Mapped[int | None]  = mapped_column(Integer, nullable=True)
    critical_task_count:  Mapped[int | None]  = mapped_column(Integer, nullable=True)
    median_float_days:    Mapped[float | None] = mapped_column(Numeric(6, 2), nullable=True)
