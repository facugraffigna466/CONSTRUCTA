from datetime import date, datetime, timezone
from sqlalchemy import Date, DateTime, ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class TaskBaseline(Base):
    __tablename__ = "task_baselines"

    id:               Mapped[int]           = mapped_column(primary_key=True)
    obra_id:          Mapped[int]           = mapped_column(ForeignKey("obras.id",  ondelete="CASCADE"), nullable=False, index=True)
    task_id:          Mapped[int]           = mapped_column(ForeignKey("tasks.id",  ondelete="CASCADE"), nullable=False, index=True)
    tenant_id:        Mapped[int | None]    = mapped_column(ForeignKey("tenants.id"), nullable=True, index=True)  # denormalizado desde la obra
    baseline_start:   Mapped[date | None]   = mapped_column(Date,  nullable=True)
    baseline_finish:  Mapped[date | None]   = mapped_column(Date,  nullable=True)
    saved_at:         Mapped[datetime]      = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    task: Mapped["Task"] = relationship("Task")  # type: ignore[name-defined]
