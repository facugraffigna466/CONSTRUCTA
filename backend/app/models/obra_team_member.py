from typing import Any
from sqlalchemy import ForeignKey, JSON, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class ObraTeamMember(Base):
    __tablename__ = "obra_team_members"
    __table_args__ = (UniqueConstraint("obra_id", "responsible_id", name="uq_obra_team_member"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    obra_id: Mapped[int] = mapped_column(ForeignKey("obras.id", ondelete="CASCADE"), nullable=False, index=True)
    responsible_id: Mapped[int] = mapped_column(ForeignKey("responsibles.id", ondelete="CASCADE"), nullable=False, index=True)
    role: Mapped[str | None] = mapped_column(String(100), nullable=True)
    member_type: Mapped[str] = mapped_column(String(20), nullable=False, default="equipo")
    # null = acceso a todos los planos; ["electricidad", "gas"] = solo esas disciplinas
    plan_disciplines: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)

    obra: Mapped["Obra"] = relationship("Obra", back_populates="team_members")
    responsible: Mapped["Responsible"] = relationship("Responsible")
