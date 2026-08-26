from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Table, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


# ── Tabla M2M solicitud ↔ material ────────────────────────────────────────────
solicitud_materiales = Table(
    "solicitud_materiales",
    Base.metadata,
    Column("solicitud_id", Integer, ForeignKey("solicitudes_cotizacion.id", ondelete="CASCADE"), primary_key=True),
    Column("material_id",  Integer, ForeignKey("task_materials.id",          ondelete="CASCADE"), primary_key=True),
)


class SolicitudSupplier(Base):
    """Relación solicitud ↔ proveedor con estado propio (enviada/respondida)."""

    __tablename__ = "solicitud_suppliers"

    solicitud_id: Mapped[int] = mapped_column(
        ForeignKey("solicitudes_cotizacion.id", ondelete="CASCADE"),
        primary_key=True,
    )
    supplier_id: Mapped[int] = mapped_column(
        ForeignKey("suppliers.id", ondelete="CASCADE"),
        primary_key=True,
    )
    # enviada | respondida
    status: Mapped[str] = mapped_column(String(20), default="enviada", nullable=False)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    solicitud: Mapped["SolicitudCotizacion"] = relationship(
        "SolicitudCotizacion", back_populates="supplier_links"
    )
    supplier: Mapped["Supplier"] = relationship("Supplier")  # type: ignore[name-defined]


class SolicitudCotizacion(Base):
    """Solicitud de cotización enviada a uno o más proveedores.

    Flujo de status:
      borrador    → creada, sin enviar aún
      enviada     → PDF enviado al menos a un proveedor
      respondida  → al menos un proveedor respondió con presupuesto
      confirmada  → proveedor elegido, orden de compra generada
    """

    __tablename__ = "solicitudes_cotizacion"
    # ref_code ("COT-01", "COT-02"...) se genera por obra (_next_ref_code cuenta
    # solicitudes de esa obra) — la unicidad tiene que ser (obra_id, ref_code),
    # no global, o la primera solicitud de cualquier obra choca contra el
    # COT-01 de otra.
    __table_args__ = (
        UniqueConstraint("obra_id", "ref_code", name="uq_solicitud_obra_refcode"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    obra_id: Mapped[int] = mapped_column(
        ForeignKey("obras.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Denormalizado desde la obra (aislamiento por tenant sin join). NOT NULL (Fase 2).
    tenant_id: Mapped[int] = mapped_column(
        ForeignKey("tenants.id"), nullable=False, index=True
    )
    created_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    ref_code: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="borrador", nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    pdf_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    contratista_phone: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Materiales incluidos (M2M a través de solicitud_materiales)
    materials: Mapped[list["TaskMaterial"]] = relationship(  # type: ignore[name-defined]
        "TaskMaterial",
        secondary=solicitud_materiales,
        lazy="selectin",
    )

    # Proveedores a quienes se envió
    supplier_links: Mapped[list["SolicitudSupplier"]] = relationship(
        "SolicitudSupplier",
        back_populates="solicitud",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    # Respuestas de proveedores (Budget con solicitud_id seteado)
    respuestas: Mapped[list["Budget"]] = relationship(  # type: ignore[name-defined]
        "Budget",
        foreign_keys="[Budget.solicitud_id]",
        lazy="selectin",
        order_by="Budget.created_at",
    )
