from datetime import datetime, timezone
from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class AiMappingCache(Base):
    __tablename__ = "ai_mapping_cache"
    __table_args__ = (UniqueConstraint("tenant_id", "headers_hash", name="uq_ai_mapping_tenant_hash"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True)
    headers_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    mapping: Mapped[str] = mapped_column(Text, nullable=False)  # JSON string
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
