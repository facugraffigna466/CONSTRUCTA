"""add task_dependencies many-to-many table

Revision ID: 0015
Revises: 0014
Create Date: 2026-05-22

"""
from alembic import op
import sqlalchemy as sa

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "task_dependencies",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("task_id",      sa.Integer, sa.ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("depends_on_id", sa.Integer, sa.ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False),
        sa.UniqueConstraint("task_id", "depends_on_id", name="uq_task_dependencies"),
    )
    op.create_index("ix_task_dependencies_task_id",      "task_dependencies", ["task_id"])
    op.create_index("ix_task_dependencies_depends_on_id", "task_dependencies", ["depends_on_id"])


def downgrade() -> None:
    op.drop_index("ix_task_dependencies_depends_on_id", table_name="task_dependencies")
    op.drop_index("ix_task_dependencies_task_id",       table_name="task_dependencies")
    op.drop_table("task_dependencies")
