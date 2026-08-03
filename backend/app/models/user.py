from datetime import datetime, timezone
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="collaborator")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    invitation_token: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True)
    invitation_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
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
    tenant_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("tenants.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    obras: Mapped[list["Obra"]] = relationship("Obra", back_populates="manager")
    tenant: Mapped["Tenant | None"] = relationship("Tenant", back_populates="users", foreign_keys=[tenant_id])
