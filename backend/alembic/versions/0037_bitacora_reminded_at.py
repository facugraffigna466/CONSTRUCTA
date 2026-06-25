"""add reminded_at to bitacora_entries

Revision ID: 0037
Revises: 0036
Create Date: 2026-06-25
"""
from alembic import op
import sqlalchemy as sa

revision = "0037"
down_revision = "0036"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Último recordatorio enviado a quien mandó la nota de voz pidiéndole que
    # asigne una obra (para repetir cada 30 min hasta que responda, sin spamear).
    op.add_column(
        "bitacora_entries",
        sa.Column("reminded_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("bitacora_entries", "reminded_at")
