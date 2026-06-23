"""add responsible_id to task_materials

Revision ID: 0035
Revises: 0034
Create Date: 2026-06-23
"""
from alembic import op
import sqlalchemy as sa

revision = "0035"
down_revision = "0034"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "task_materials",
        sa.Column(
            "responsible_id",
            sa.Integer(),
            sa.ForeignKey("responsibles.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("task_materials", "responsible_id")
