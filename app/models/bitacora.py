from datetime import datetime, timezone
from sqlalchemy import Text, ForeignKey, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class BitacoraItem(Base):
    __tablename__ = "bitacora"

    id: Mapped[int] = mapped_column(primary_key=True)
    obra_id: Mapped[int] = mapped_column(ForeignKey("obras.id"), nullable=False)
    responsible_id: Mapped[int | None] = mapped_column(ForeignKey("responsibles.id"))

    # Original audio stored somewhere (S3/local path or Twilio media URL)
    audio_url: Mapped[str | None] = mapped_column(String(500))
    transcription: Mapped[str | None] = mapped_column(Text)
    summary: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    obra: Mapped["Obra"] = relationship("Obra", back_populates="bitacora")
