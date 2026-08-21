from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Plano(Base):
    """Plano de obra (documento técnico) con versionado.

    Se agrupan por (obra_id, discipline, name). Cada carga nueva del grupo
    incrementa `version` y pasa a ser la vigente; `is_latest` marca cuál manda hoy
    y se puede corregir a mano si se cargó una revisión vieja por error.

    El chatbot de WhatsApp responde con la vigente de la disciplina pedida
    (ej: "mandame el plano de electricidad").
    """

    __tablename__ = "planos"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[int | None] = mapped_column(ForeignKey("tenants.id"), nullable=True, index=True)
    obra_id: Mapped[int] = mapped_column(ForeignKey("obras.id", ondelete="CASCADE"), nullable=False, index=True)
    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    # disciplina: electricidad, sanitarios, estructura, arquitectura, gas, etc.
    discipline: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    is_latest: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    file_path: Mapped[str] = mapped_column(String(500), nullable=False)  # nombre guardado en /uploads
    original_filename: Mapped[str | None] = mapped_column(String(500), nullable=True)
    content_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    file_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    obra: Mapped["Obra"] = relationship("Obra")
