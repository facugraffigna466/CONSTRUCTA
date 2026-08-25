from sqlalchemy import ForeignKey, JSON, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class ObraTeamMember(Base):
    __tablename__ = "obra_team_members"
    __table_args__ = (UniqueConstraint("obra_id", "responsible_id", name="uq_obra_team_member"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    obra_id: Mapped[int] = mapped_column(ForeignKey("obras.id", ondelete="CASCADE"), nullable=False, index=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False, index=True)  # denormalizado desde la obra (Fase 2: NOT NULL)
    responsible_id: Mapped[int] = mapped_column(ForeignKey("responsibles.id", ondelete="CASCADE"), nullable=False, index=True)
    role: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # null = acceso a todos los planos; ["electricidad", "gas"] = solo esas disciplinas.
    # Antes existía un `member_type` (equipo/contratista) que se eliminó — ahora
    # hay una sola entidad "responsable de obra" y `plan_disciplines` es el único
    # filtro de acceso a planos.
    plan_disciplines: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)

    obra: Mapped["Obra"] = relationship("Obra", back_populates="team_members")
    responsible: Mapped["Responsible"] = relationship("Responsible")
