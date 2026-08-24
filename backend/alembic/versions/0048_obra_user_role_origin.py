"""add obra_user_roles.origin (marca de procedencia — Fase 5)

Columna nullable para marcar cómo se creó cada asignación:
  - NULL           : creada por el flujo normal (invite/accept o assign endpoint).
                     Comportamiento por defecto, no requiere setear el campo.
  - 'backfill_fase5': creada por la migración 0049 que preserva acceso de los
                     collaborators pre-rediseño.

El objetivo es que el downgrade de 0049 pueda borrar SOLO las filas del backfill
sin tocar asignaciones manuales que se hayan agregado después. Sin este marker
el rollback tendría que compararse contra timestamps o backups.

Revision ID: 0048
Revises: 0047
Create Date: 2026-08-23
"""
from alembic import op
import sqlalchemy as sa


revision = "0048"
down_revision = "0047"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "obra_user_roles",
        sa.Column("origin", sa.String(length=32), nullable=True),
    )
    # Índice parcial solo sobre filas del backfill — hace O(1) el conteo y el
    # DELETE del downgrade. Marginal para volúmenes chicos (docenas de miles),
    # pero cuesta poco y evita full scans si escala.
    op.create_index(
        "idx_obra_user_roles_origin",
        "obra_user_roles",
        ["origin"],
        postgresql_where=sa.text("origin IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("idx_obra_user_roles_origin", table_name="obra_user_roles")
    op.drop_column("obra_user_roles", "origin")
