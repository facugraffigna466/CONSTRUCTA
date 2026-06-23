"""add plano_obra_select to conversation_step enum

Revision ID: 0032
Revises: 0031
Create Date: 2026-06-23
"""
from alembic import op

revision = "0032"
down_revision = "0031"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE conversation_step ADD VALUE IF NOT EXISTS 'plano_obra_select'")


def downgrade() -> None:
    pass  # Postgres no soporta DROP VALUE en enums
