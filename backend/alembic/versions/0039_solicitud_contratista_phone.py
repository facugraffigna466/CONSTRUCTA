"""solicitudes_cotizacion: agrega contratista_phone para rastrear envíos directos por WA.

Revision ID: 0039
Revises: 0038
Create Date: 2026-06-26
"""

from alembic import op
import sqlalchemy as sa

revision = "0039"
down_revision = "0038"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "solicitudes_cotizacion",
        sa.Column("contratista_phone", sa.String(50), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("solicitudes_cotizacion", "contratista_phone")
