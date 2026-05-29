"""add obra_select to conversation_step enum

Revision ID: 0012
Revises: 0011
Create Date: 2026-05-19

"""
from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE conversation_step ADD VALUE IF NOT EXISTS 'obra_select'")


def downgrade() -> None:
    # PostgreSQL does not support DROP VALUE on enums.
    # Rows with obra_select must be cleared before downgrading.
    op.execute(
        "UPDATE conversation_sessions SET step = 'idle' WHERE step = 'obra_select'"
    )
