"""Modelo del rol que un `User` (con login) tiene sobre una `Obra` específica.

Fase 1 del rediseño de roles. Complementa — sin reemplazar — el rol de empresa
que ya vive en `users.role` (admin/collaborator). Un usuario con rol de empresa
`admin` tiene control total en todas las obras del tenant sin necesidad de una
fila acá; para los usuarios `collaborator` el permiso deja de ser global y
pasa a decidirse obra-por-obra a través de esta tabla.

Deliberadamente **paralela** a `ObraTeamMember` (que vincula `Responsible` — el
contacto de WhatsApp sin login). La auditoría 04 dejó pendiente unificar
`User` y `Responsible`; hasta entonces cada uno tiene su propia junction para
no arrastrar más deuda conceptual.
"""
from __future__ import annotations

import enum
from datetime import datetime, timezone

from sqlalchemy import DateTime, Enum as SAEnum, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class ObraUserRoleType(str, enum.Enum):
    """Rol del usuario en la obra. La semántica de cada valor la implementa
    la Fase 2 (guards). Ver docs/roles-redesign/fase-1-modelo.md §Definición de roles."""

    JEFE_OBRA = "jefe_obra"
    COLABORADOR = "colaborador"
    SOLO_LECTURA = "solo_lectura"


class ObraUserRole(Base):
    __tablename__ = "obra_user_roles"
    __table_args__ = (
        UniqueConstraint("obra_id", "user_id", name="uq_obra_user_role"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    obra_id: Mapped[int] = mapped_column(
        ForeignKey("obras.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Denormalizado desde la obra (aislamiento por tenant sin join). Sigue la
    # misma política que Task/Alert/ObraTeamMember desde la migración 0041.
    tenant_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("tenants.id"), nullable=False, index=True
    )
    role: Mapped[ObraUserRoleType] = mapped_column(
        SAEnum(
            ObraUserRoleType,
            name="obra_user_role_type",
            values_callable=lambda enum_cls: [e.value for e in enum_cls],
        ),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    # Marca de procedencia. NULL = flujo normal (invite/assign endpoint).
    # 'backfill_fase5' = migración 0049 de preservación de acceso pre-rediseño.
    # Usar solo para trazabilidad y para que el rollback del backfill sea
    # determinista — la lógica de permisos NO mira esta columna.
    origin: Mapped[str | None] = mapped_column(String(32), nullable=True)

    obra: Mapped["Obra"] = relationship("Obra", back_populates="user_roles")
    user: Mapped["User"] = relationship("User")
