"""add obra_team_members junction table

Revision ID: 0021
Revises: 0020
Create Date: 2026-06-10
"""
from alembic import op
import sqlalchemy as sa

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "obra_team_members",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("obra_id", sa.Integer(), sa.ForeignKey("obras.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("responsible_id", sa.Integer(), sa.ForeignKey("responsibles.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("role", sa.String(100), nullable=True),
        sa.UniqueConstraint("obra_id", "responsible_id", name="uq_obra_team_member"),
    )


def downgrade() -> None:
    op.drop_table("obra_team_members")
