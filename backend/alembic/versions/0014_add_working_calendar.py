"""add working_calendars and calendar_exceptions tables

Revision ID: 0014
Revises: 0013
Create Date: 2026-05-22

"""
from alembic import op
import sqlalchemy as sa

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "working_calendars",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("obra_id", sa.Integer, sa.ForeignKey("obras.id", ondelete="CASCADE"), unique=True, nullable=False),
        sa.Column("working_days", sa.Integer, nullable=False, server_default="63"),
        sa.Column("hour_from", sa.Integer, nullable=False, server_default="7"),
        sa.Column("hour_to", sa.Integer, nullable=False, server_default="18"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_working_calendars_obra_id", "working_calendars", ["obra_id"])

    op.create_table(
        "calendar_exceptions",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("calendar_id", sa.Integer, sa.ForeignKey("working_calendars.id", ondelete="CASCADE"), nullable=False),
        sa.Column("date", sa.Date, nullable=False),
        sa.Column("is_working", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("label", sa.String(255), nullable=True),
        sa.UniqueConstraint("calendar_id", "date", name="uq_calendar_exceptions_date"),
    )
    op.create_index("ix_calendar_exceptions_calendar_id", "calendar_exceptions", ["calendar_id"])


def downgrade() -> None:
    op.drop_index("ix_calendar_exceptions_calendar_id", table_name="calendar_exceptions")
    op.drop_table("calendar_exceptions")
    op.drop_index("ix_working_calendars_obra_id", table_name="working_calendars")
    op.drop_table("working_calendars")
