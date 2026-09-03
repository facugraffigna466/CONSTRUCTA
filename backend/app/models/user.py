from datetime import datetime, timezone
from typing import Any
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class User(Base):
    __tablename__ = "users"
    # Hallazgo 6.6 auditoría 04: si un mismo humano se carga dos veces con el
    # mismo whatsapp dentro del mismo tenant, se rompe la resolución de sender
    # en el bot. Unicidad por tenant sin afectar la posibilidad de que la misma
    # persona sea staff de varias empresas (tenant_id distintos).
    __table_args__ = (
        UniqueConstraint("tenant_id", "whatsapp_number", name="uq_users_tenant_whatsapp"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="collaborator")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    invitation_token: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True)
    invitation_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Asignaciones de ObraUserRole que quien invita eligió para el nuevo user,
    # pendientes de materializarse hasta que se acepte la invitación. Lista de
    # dicts [{"obra_id": int, "role": "jefe_obra"|"colaborador"|"solo_lectura"}].
    # NULL después del accept (ya se materializaron) o si no hubo asignaciones.
    pending_obra_assignments: Mapped[list[dict[str, Any]] | None] = mapped_column(
        JSON, nullable=True
    )
    reset_token: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True)
    reset_token_expires: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    verification_token: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True)
    verification_expires: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    refresh_token: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True)
    refresh_token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    # E.164 — habilita al staff (arquitecto/jefe/admin) a usar el chatbot de WhatsApp
    whatsapp_number: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)
    # Último resumen semanal de staff enviado. El job corre cada hora los lunes
    # (para esperar a que abra la ventana horaria), así que hace falta saber si
    # el de esta semana ya salió.
    last_weekly_digest_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    tenant_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("tenants.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    obras: Mapped[list["Obra"]] = relationship("Obra", back_populates="manager")
    tenant: Mapped["Tenant | None"] = relationship("Tenant", back_populates="users", foreign_keys=[tenant_id])
    # Fase 1 del rediseño multi-tenant (ver tenant_membership.py): espejo de
    # role/is_active/whatsapp/invitación por tenant, en paralelo a las columnas
    # de arriba mientras dura el dual-write.
    memberships: Mapped[list["TenantMembership"]] = relationship(
        "TenantMembership", back_populates="user"
    )
