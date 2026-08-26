"""Recuerda, por número de WhatsApp, en qué tenant opera el staff cuando ese
número tiene membership activa en más de uno (Fase 3 rediseño multi-tenant —
antes de este rediseño era imposible que un mismo whatsapp_number apareciera
en dos tenants a la vez).

Sin infraestructura para distinguir el tenant por el número de destino (todo
Constructa usa un único número de Twilio, ver `settings.TWILIO_WHATSAPP_NUMBER`),
la desambiguación es conversacional: se le pregunta una vez con un menú
numerado y se recuerda la respuesta."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class WhatsappTenantContext(Base):
    __tablename__ = "whatsapp_tenant_context"

    phone_number: Mapped[str] = mapped_column(String(20), primary_key=True)
    # Tenant elegido la última vez que hubo que desambiguar. Se sigue usando
    # mientras siga siendo una de las membership activas del número.
    active_tenant_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True
    )
    # Menú pendiente de respuesta: [{"idx": 1, "tenant_id": 5, "tenant_name": "..."}]
    # NULL cuando no hay una pregunta esperando contestación.
    pending_options: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
