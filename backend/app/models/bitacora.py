from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class BitacoraEntry(Base):
    """Entrada de bitácora de obra: audio de WhatsApp o web → transcripción →
    resumen + puntos clave + sugerencias de acción generadas por IA."""

    __tablename__ = "bitacora_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # Denormalizado desde la obra (o, si todavía no tiene obra, desde el
    # creador/responsable) para que el aislamiento multi-tenant no dependa de
    # tener obra_id — ver obra_permissions.py::_resolve_and_assert.
    tenant_id: Mapped[int | None] = mapped_column(
        ForeignKey("tenants.id"), nullable=True, index=True
    )
    obra_id: Mapped[int | None] = mapped_column(
        ForeignKey("obras.id", ondelete="CASCADE"), nullable=True, index=True
    )
    responsible_id: Mapped[int | None] = mapped_column(
        ForeignKey("responsibles.id", ondelete="SET NULL"), nullable=True
    )
    created_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    source: Mapped[str] = mapped_column(String(20), default="web", nullable=False)
    audio_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    transcript: Mapped[str | None] = mapped_column(Text, nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    key_points: Mapped[list | None] = mapped_column(JSON, nullable=True)
    suggestions: Mapped[list | None] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(
        String(30), default="pendiente_transcripcion", nullable=False
    )
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Último recordatorio "elegí la obra" enviado al emisor (para repetir cada 30 min)
    reminded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    obra: Mapped["Obra | None"] = relationship("Obra")
    responsible: Mapped["Responsible | None"] = relationship("Responsible")
