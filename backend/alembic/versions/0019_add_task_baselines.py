"""add task_baselines table

Revision ID: 0019
Revises: 0018
Create Date: 2026-05-26
"""
from alembic import op
import sqlalchemy as sa

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "task_baselines",
        sa.Column("id",               sa.Integer,                    primary_key=True),
        sa.Column("obra_id",          sa.Integer,                    sa.ForeignKey("obras.id",  ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("task_id",          sa.Integer,                    sa.ForeignKey("tasks.id",  ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("baseline_start",   sa.Date,                       nullable=True),
        sa.Column("baseline_finish",  sa.Date,                       nullable=True),
        sa.Column("saved_at",         sa.DateTime(timezone=True),    nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("task_baselines")
