"""add reset_token / reset_token_expires to users (password recovery)

Revision ID: 0042
Revises: 0041
Create Date: 2026-07-18
"""
from alembic import op
import sqlalchemy as sa

revision = "0042"
down_revision = "0041"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("reset_token", sa.String(length=64), nullable=True))
    op.add_column("users", sa.Column("reset_token_expires", sa.DateTime(timezone=True), nullable=True))
    op.create_unique_constraint("uq_users_reset_token", "users", ["reset_token"])


def downgrade() -> None:
    op.drop_constraint("uq_users_reset_token", "users", type_="unique")
    op.drop_column("users", "reset_token_expires")
    op.drop_column("users", "reset_token")
