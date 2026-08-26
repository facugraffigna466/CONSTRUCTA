"""Membresía de una identidad (`User`) en un `Tenant`.

Fase 1 del rediseño multi-tenant: hoy `users.tenant_id` es una FK simple (un
usuario = un tenant), lo que impide que la misma persona (mismo email) trabaje
en dos empresas. Esta tabla es el destino final de los campos que en realidad
son por-empresa y no por-identidad: `role`, `is_active` (¿aceptó la invitación
en ESTA empresa?), `whatsapp_number`, `invitation_token`/`invitation_expires_at`,
`pending_obra_assignments`.

Fase 1: tabla aditiva, se llena por backfill + dual-write desde `auth_service.py`
y `routes/users.py`, pero `User` sigue siendo la fuente de verdad leída por el
resto del código. Fase 2 corta las lecturas hacia acá; Fase 5 borra las
columnas viejas de `users`. Ver el plan de migración para el detalle completo.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class TenantMembership(Base):
    __tablename__ = "tenant_memberships"
    __table_args__ = (
        UniqueConstraint("tenant_id", "user_id", name="uq_membership_tenant_user"),
        UniqueConstraint("tenant_id", "whatsapp_number", name="uq_membership_tenant_whatsapp"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    tenant_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="collaborator")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    invitation_token: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True)
    invitation_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    pending_obra_assignments: Mapped[list[dict[str, Any]] | None] = mapped_column(
        JSON, nullable=True
    )
    whatsapp_number: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)
    # Fase 3: la sesión (refresh token) es por membership, no por identidad —
    # dos empresas de la misma persona son dos sesiones independientes.
    refresh_token: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True)
    refresh_token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    user: Mapped["User"] = relationship("User", back_populates="memberships")
    tenant: Mapped["Tenant"] = relationship("Tenant", back_populates="memberships")
