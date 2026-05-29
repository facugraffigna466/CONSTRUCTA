"""Add system_settings table

Revision ID: 0006
Revises: 0005
Create Date: 2026-05-11

One row per manager. Stores chatbot, automation, alert, and general config.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "system_settings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("manager_id", sa.Integer(), nullable=False),
        # Chatbot
        sa.Column("chatbot_enabled", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("send_hour_from", sa.Integer(), nullable=False, server_default="8"),
        sa.Column("send_hour_to", sa.Integer(), nullable=False, server_default="20"),
        sa.Column("max_response_hours", sa.Integer(), nullable=False, server_default="24"),
        sa.Column("auto_reminders", sa.Boolean(), nullable=False, server_default="true"),
        # Automatizaciones
        sa.Column("reminder_3days", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("reminder_1day", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("alert_overdue", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("alert_no_response", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("retry_failed", sa.Boolean(), nullable=False, server_default="true"),
        # Alertas
        sa.Column("notify_task_overdue", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("notify_task_blocked", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("notify_no_response", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("notify_rescheduled", sa.Boolean(), nullable=False, server_default="true"),
        # General
        sa.Column("company_name", sa.String(255), nullable=True),
        sa.Column("main_responsible", sa.String(255), nullable=True),
        sa.Column("company_email", sa.String(255), nullable=True),
        sa.Column("company_phone", sa.String(50), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["manager_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("manager_id", name="uq_system_settings_manager_id"),
    )
    op.create_index("ix_system_settings_manager_id", "system_settings", ["manager_id"])


def downgrade() -> None:
    op.drop_index("ix_system_settings_manager_id", table_name="system_settings")
    op.drop_table("system_settings")
