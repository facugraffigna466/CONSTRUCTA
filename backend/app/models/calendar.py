from datetime import date, datetime, timezone

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class WorkingCalendar(Base):
    __tablename__ = "working_calendars"

    id: Mapped[int] = mapped_column(primary_key=True)
    obra_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("obras.id", ondelete="CASCADE"),
        unique=True, nullable=False, index=True,
    )
    # Denormalizado desde la obra (aislamiento por tenant sin join). NOT NULL (Fase 2).
    tenant_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("tenants.id"), nullable=False, index=True
    )
    # Bitmask: bit0=Lun, bit1=Mar, bit2=Mié, bit3=Jue, bit4=Vie, bit5=Sáb, bit6=Dom
    # Default 0b0111111 = Lun–Sáb (63)
    working_days: Mapped[int] = mapped_column(Integer, default=63, nullable=False)
    hour_from: Mapped[int] = mapped_column(Integer, default=7, nullable=False)
    hour_to: Mapped[int] = mapped_column(Integer, default=18, nullable=False)

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

    exceptions: Mapped[list["CalendarException"]] = relationship(
        "CalendarException", back_populates="calendar",
        cascade="all, delete-orphan", lazy="select",
    )


class CalendarException(Base):
    __tablename__ = "calendar_exceptions"
    __table_args__ = (
        UniqueConstraint("calendar_id", "date", name="uq_calendar_exceptions_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    calendar_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("working_calendars.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    date: Mapped[date] = mapped_column(Date, nullable=False)
    is_working: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    label: Mapped[str | None] = mapped_column(String(255), nullable=True)

    calendar: Mapped["WorkingCalendar"] = relationship("WorkingCalendar", back_populates="exceptions")
