from sqlalchemy import Integer, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class Plan(Base):
    __tablename__ = "plans"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    max_obras: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_users: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_tasks_per_obra: Mapped[int | None] = mapped_column(Integer, nullable=True)
    price_monthly: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)

    tenants: Mapped[list["Tenant"]] = relationship("Tenant", back_populates="plan")
