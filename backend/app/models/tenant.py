from datetime import datetime, timezone
from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class Tenant(Base):
    __tablename__ = "tenants"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    plan_id: Mapped[int | None] = mapped_column(ForeignKey("plans.id"), nullable=True)
    owner_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    active_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Timestamp del último email preventivo enviado cuando el tenant se acercó
    # al límite de su plan. Se usa como dedupe: no mandamos otro dentro de los
    # 7 días siguientes. NULL = nunca se envió (o todavía no cruzó el umbral).
    last_plan_warning_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )

    plan: Mapped["Plan"] = relationship("Plan", back_populates="tenants")
    users: Mapped[list["User"]] = relationship("User", back_populates="tenant", foreign_keys="User.tenant_id")
    obras: Mapped[list["Obra"]] = relationship("Obra", back_populates="tenant", foreign_keys="Obra.tenant_id")
