from datetime import datetime, timezone
from typing import Any

from sqlalchemy import DateTime, ForeignKey, JSON, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class ObraStatsSnapshot(Base):
    """Foto mensual de las 5 métricas determinísticas de una obra (motor de insights).

    Etapa 2 del motor de insights: acá NO interviene ninguna IA — todo lo que se
    guarda en `metrics` sale de SQL/Python puro y es verificable a mano. La etapa
    siguiente (redacción del informe) lee exactamente esta estructura; el contrato
    del JSON está documentado en `docs/features/insights-etapa-2-estadisticas.md`
    y versionado en `metrics["schema_version"]`.

    Un snapshot por (obra, period). Recalcular el mismo período pisa el anterior
    (`computed_at` deja constancia de cuándo se recalculó).
    """

    __tablename__ = "obra_stats_snapshots"
    __table_args__ = (
        UniqueConstraint("obra_id", "period", name="uq_obra_stats_obra_period"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    obra_id: Mapped[int] = mapped_column(
        ForeignKey("obras.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Denormalizado desde la obra (aislamiento por tenant sin join), igual que
    # tasks/alerts/historial.
    tenant_id: Mapped[int | None] = mapped_column(
        ForeignKey("tenants.id"), nullable=True, index=True
    )

    # Mes que cubre el snapshot, en formato "YYYY-MM" (ej: "2026-08").
    period: Mapped[str] = mapped_column(String(7), nullable=False, index=True)

    computed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    # Las 5 métricas. Contrato en docs/features/insights-etapa-2-estadisticas.md.
    metrics: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)

    obra: Mapped["Obra"] = relationship("Obra")
