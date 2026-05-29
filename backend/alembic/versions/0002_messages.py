"""messages table

Revision ID: 0002
Revises: 0001
Create Date: 2026-04-24

Adds: messages table with all enums and indexes.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "messages",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("responsible_id", sa.Integer(), nullable=True),
        sa.Column("task_id", sa.Integer(), nullable=True),
        sa.Column(
            "direction",
            sa.Enum("inbound", "outbound", name="message_direction"),
            nullable=False,
        ),
        sa.Column(
            "channel",
            sa.Enum("whatsapp", name="message_channel"),
            nullable=False,
        ),
        sa.Column(
            "message_type",
            sa.Enum("text", "audio", "image", "unknown", name="message_type"),
            nullable=False,
        ),
        sa.Column(
            "processing_status",
            sa.Enum(
                "pending", "processed", "failed",
                name="message_processing_status",
            ),
            nullable=False,
        ),
        sa.Column("from_number", sa.String(30), nullable=False),
        sa.Column("to_number", sa.String(30), nullable=False),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("media_url", sa.String(500), nullable=True),
        sa.Column("transcription", sa.Text(), nullable=True),
        sa.Column("ai_interpretation", sa.JSON(), nullable=True),
        sa.Column("external_message_id", sa.String(64), nullable=True),
        sa.Column("raw_payload", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["responsible_id"], ["responsibles.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["task_id"], ["tasks.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("external_message_id", name="uq_messages_external_id"),
    )
    op.create_index("ix_messages_responsible_id", "messages", ["responsible_id"])
    op.create_index("ix_messages_task_id", "messages", ["task_id"])
    op.create_index(
        "ix_messages_external_message_id",
        "messages",
        ["external_message_id"],
        unique=True,
    )
    # Querying pending inbound messages is the Phase 3 AI-processing hot path
    op.create_index(
        "ix_messages_direction_status",
        "messages",
        ["direction", "processing_status"],
    )


def downgrade() -> None:
    op.drop_index("ix_messages_direction_status", table_name="messages")
    op.drop_index("ix_messages_external_message_id", table_name="messages")
    op.drop_index("ix_messages_task_id", table_name="messages")
    op.drop_index("ix_messages_responsible_id", table_name="messages")
    op.drop_table("messages")

    op.execute(sa.text("DROP TYPE IF EXISTS message_processing_status"))
    op.execute(sa.text("DROP TYPE IF EXISTS message_type"))
    op.execute(sa.text("DROP TYPE IF EXISTS message_channel"))
    op.execute(sa.text("DROP TYPE IF EXISTS message_direction"))
