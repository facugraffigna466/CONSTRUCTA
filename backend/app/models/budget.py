from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, JSON, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Budget(Base):
    """Presupuesto de proveedor: documento (PDF / Excel / imagen / texto pegado)
    leído por IA → datos estructurados + inconsistencias detectadas.

    Base del módulo de Gestión de Presupuestos: carga, lectura inteligente,
    comparación y detección de inconsistencias. Aislado por tenant.
    """

    __tablename__ = "budgets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[int | None] = mapped_column(ForeignKey("tenants.id"), nullable=True, index=True)
    obra_id: Mapped[int | None] = mapped_column(ForeignKey("obras.id", ondelete="SET NULL"), nullable=True, index=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    supplier_id: Mapped[int | None] = mapped_column(ForeignKey("suppliers.id", ondelete="SET NULL"), nullable=True)

    supplier_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    rubro: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # pdf | image | excel | texto
    source_type: Mapped[str] = mapped_column(String(20), default="texto", nullable=False)
    source_filename: Mapped[str | None] = mapped_column(String(500), nullable=True)

    raw_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    inconsistencies: Mapped[list | None] = mapped_column(JSON, nullable=True)
    total: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    currency: Mapped[str] = mapped_column(String(8), default="ARS", nullable=False)

    # procesado | error
    status: Mapped[str] = mapped_column(String(20), default="procesado", nullable=False)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Vinculación con solicitud de cotización (respuesta de proveedor vía WA)
    solicitud_id: Mapped[int | None] = mapped_column(
        ForeignKey("solicitudes_cotizacion.id", ondelete="SET NULL"), nullable=True, index=True
    )
    ai_analysis: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    obra: Mapped["Obra | None"] = relationship("Obra")
    supplier: Mapped["Supplier | None"] = relationship("Supplier")
