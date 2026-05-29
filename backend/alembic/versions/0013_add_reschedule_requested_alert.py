"""add reschedule_requested to alert_type enum

Revision ID: 0013
Revises: 0012
Create Date: 2026-05-19

"""
from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE alert_type ADD VALUE IF NOT EXISTS 'reschedule_requested'")


def downgrade() -> None:
    # PostgreSQL does not support DROP VALUE on enums.
    op.execute(
        "UPDATE alerts SET type = 'delay_risk' WHERE type = 'reschedule_requested'"
    )
