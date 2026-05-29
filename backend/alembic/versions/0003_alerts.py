"""alerts table

Revision ID: 0003
Revises: 0002
Create Date: 2026-04-24

Adds: alerts table with AlertType enum.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "alerts",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("obra_id", sa.Integer(), nullable=True),
        sa.Column("task_id", sa.Integer(), nullable=True),
        sa.Column(
            "type",
            sa.Enum("task_blocked", "delay_risk", name="alert_type"),
            nullable=False,
        ),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("is_read", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["obra_id"], ["obras.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_alerts_obra_id", "alerts", ["obra_id"])
    op.create_index("ix_alerts_task_id", "alerts", ["task_id"])
    op.create_index("ix_alerts_type", "alerts", ["type"])
    # Primary query pattern: unread alerts dashboard
    op.create_index("ix_alerts_is_read", "alerts", ["is_read"])


def downgrade() -> None:
    op.drop_index("ix_alerts_is_read", table_name="alerts")
    op.drop_index("ix_alerts_type", table_name="alerts")
    op.drop_index("ix_alerts_task_id", table_name="alerts")
    op.drop_index("ix_alerts_obra_id", table_name="alerts")
    op.drop_table("alerts")
    op.execute(sa.text("DROP TYPE IF EXISTS alert_type"))
