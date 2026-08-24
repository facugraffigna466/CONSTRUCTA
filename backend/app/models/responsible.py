from datetime import datetime, timezone
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class Responsible(Base):
    __tablename__ = "responsibles"

    id: Mapped[int] = mapped_column(primary_key=True)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    # E.164 format: +5491112345678 — the chatbot key in Phase 2
    whatsapp_number: Mapped[str] = mapped_column(
        String(20), unique=True, nullable=False, index=True
    )
    role: Mapped[str | None] = mapped_column(String(100))
    # directorio de equipo aislado por empresa (migration 0026)
    tenant_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("tenants.id"), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
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
    # NULL = todavía no confirmó su acceso vía WhatsApp (respondiendo "SI" al
    # mensaje de bienvenida). Mientras esté en NULL, el bot solo le responde
    # con el pedido de confirmación — ninguna otra funcionalidad se procesa.
    # La confirmación es POR PERSONA (una vez), no por obra — sumar al equipo
    # de otra obra no requiere volver a confirmar.
    # Ver docs/roles-redesign/whatsapp-identidad-permisos.md §"Alcance de la confirmación".
    confirmed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )

    tasks: Mapped[list["Task"]] = relationship("Task", back_populates="responsible")
    messages: Mapped[list["Message"]] = relationship("Message", back_populates="responsible")
