"""add member_type to obra_team_members

Revision ID: 0034
Revises: 0033
Create Date: 2026-06-23
"""
from alembic import op
import sqlalchemy as sa

revision = "0034"
down_revision = "0033"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "obra_team_members",
        sa.Column("member_type", sa.String(20), nullable=False, server_default="equipo"),
    )


def downgrade() -> None:
    op.drop_column("obra_team_members", "member_type")
