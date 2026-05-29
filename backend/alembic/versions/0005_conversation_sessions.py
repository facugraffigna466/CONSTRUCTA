"""Add conversation_sessions table

Revision ID: 0005
Revises: 0004
Create Date: 2026-05-11

Stores per-responsible chatbot conversation state for multi-turn WhatsApp flows.
One row per responsible (UNIQUE constraint on responsible_id).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "conversation_sessions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("responsible_id", sa.Integer(), nullable=False),
        sa.Column("selected_task_id", sa.Integer(), nullable=True),
        sa.Column(
            "step",
            sa.Enum(
                "idle", "task_select", "status_menu", "await_date",
                name="conversation_step",
            ),
            nullable=False,
            server_default="idle",
        ),
        sa.Column("task_options", sa.JSON(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["responsible_id"], ["responsibles.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["selected_task_id"], ["tasks.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("responsible_id", name="uq_conversation_sessions_responsible_id"),
    )
    op.create_index(
        "ix_conversation_sessions_responsible_id",
        "conversation_sessions",
        ["responsible_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_conversation_sessions_responsible_id",
        table_name="conversation_sessions",
    )
    op.drop_table("conversation_sessions")
    op.execute(sa.text("DROP TYPE IF EXISTS conversation_step"))
