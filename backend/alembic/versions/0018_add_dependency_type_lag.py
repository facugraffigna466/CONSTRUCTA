"""add dependency_type and lag_days to task_dependencies

Revision ID: 0018
Revises: 0017
Create Date: 2026-05-26
"""
from alembic import op
import sqlalchemy as sa

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "task_dependencies",
        sa.Column("dependency_type", sa.String(2), nullable=False, server_default="FS"),
    )
    op.add_column(
        "task_dependencies",
        sa.Column("lag_days", sa.Integer, nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("task_dependencies", "lag_days")
    op.drop_column("task_dependencies", "dependency_type")
