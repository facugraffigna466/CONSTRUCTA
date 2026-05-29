import enum
from datetime import datetime, date, timezone
from sqlalchemy import String, Text, ForeignKey, Date, DateTime, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class ObraStatus(str, enum.Enum):
    PLANIFICADA = "planificada"
    EN_PROGRESO = "en_progreso"
    PAUSADA = "pausada"
    COMPLETADA = "completada"
    CANCELADA = "cancelada"


class Obra(Base):
    __tablename__ = "obras"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    location: Mapped[str | None] = mapped_column(String(500))
    status: Mapped[ObraStatus] = mapped_column(
        SAEnum(ObraStatus), default=ObraStatus.PLANIFICADA, nullable=False
    )
    start_date: Mapped[date | None] = mapped_column(Date)
    expected_end_date: Mapped[date | None] = mapped_column(Date)
    actual_end_date: Mapped[date | None] = mapped_column(Date)

    manager_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    manager: Mapped["User"] = relationship("User", back_populates="obras")
    tasks: Mapped[list["Task"]] = relationship(
        "Task", back_populates="obra", cascade="all, delete-orphan"
    )
    bitacora: Mapped[list["BitacoraItem"]] = relationship(
        "BitacoraItem", back_populates="obra"
    )
    alerts: Mapped[list["Alert"]] = relationship("Alert", back_populates="obra")
