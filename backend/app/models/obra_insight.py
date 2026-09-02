import enum
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import (
    DateTime,
    Enum as SAEnum,
    Float,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class InsightStatus(str, enum.Enum):
    NUEVA = "nueva"
    VISTA = "vista"
    APLICADA = "aplicada"
    DESCARTADA = "descartada"


class ObraInsight(Base):
    """Conclusión narrativa sobre una obra, redactada por la IA (insights, etapa 3).

    La IA **redacta, no calcula**: cada número del texto sale del
    `ObraStatsSnapshot` de la etapa 2 y se valida programáticamente antes de
    guardar (ver `ObraInsightService._validate`).

    Ciclo de vida: una conclusión no se duplica mes a mes. Si el mismo patrón
    vuelve a aparecer se refuerza la fila existente (`reinforcement_count`).
    Una descartada solo resurge si la evidencia se duplicó, y en ese caso nace
    una fila nueva que apunta a la descartada por `resurfaced_from_insight_id`.
    """

    __tablename__ = "obra_insights"

    id: Mapped[int] = mapped_column(primary_key=True)
    obra_id: Mapped[int] = mapped_column(
        ForeignKey("obras.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Denormalizado desde la obra, igual que tasks/alerts/historial.
    tenant_id: Mapped[int | None] = mapped_column(
        ForeignKey("tenants.id"), nullable=True, index=True
    )

    # Cuál de las 5 métricas de la etapa 2 originó la conclusión.
    metric: Mapped[str] = mapped_column(String(40), nullable=False)
    # Clave determinística del tema, calculada en código (no por la IA):
    # "<metric>:<subject normalizado>", ej "bitacora_themes:falta_material".
    # Es lo que decide si una conclusión nueva es "la misma" que una existente.
    topic_key: Mapped[str] = mapped_column(String(160), nullable=False, index=True)

    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    # [{"path": "risk_concentration.by_task.concentration_percent", "value": "34.8"}]
    evidence: Mapped[list[Any] | None] = mapped_column(JSON)
    recommendation: Mapped[str | None] = mapped_column(Text)

    status: Mapped[InsightStatus] = mapped_column(
        SAEnum(
            InsightStatus,
            name="insight_status",
            values_callable=lambda enum_cls: [e.value for e in enum_cls],
        ),
        default=InsightStatus.NUEVA,
        nullable=False,
        index=True,
    )
    # Cuántos ciclos posteriores volvieron a encontrar el mismo patrón.
    reinforcement_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Magnitud del patrón (mediciones distintas según la métrica: % de desvío,
    # días de atraso, cantidad de menciones…). Se usa para decidir si una
    # conclusión descartada resurge: hace falta el doble que cuando se descartó.
    strength: Mapped[float | None] = mapped_column(Float)

    first_period: Mapped[str] = mapped_column(String(7), nullable=False)
    last_period: Mapped[str] = mapped_column(String(7), nullable=False)

    # Si esta conclusión resurgió de una que el usuario había descartado.
    resurfaced_from_insight_id: Mapped[int | None] = mapped_column(
        ForeignKey("obra_insights.id", ondelete="SET NULL"), nullable=True
    )

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
    dismissed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    obra: Mapped["Obra"] = relationship("Obra")
