"""add refresh_token + refresh_token_expires_at to users

Revision ID: 0044
Revises: 0043
Create Date: 2026-08-03
"""
from alembic import op
import sqlalchemy as sa

revision = "0044"
down_revision = "0043"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("refresh_token", sa.String(length=64), nullable=True))
    op.add_column("users", sa.Column("refresh_token_expires_at", sa.DateTime(timezone=True), nullable=True))
    op.create_unique_constraint("uq_users_refresh_token", "users", ["refresh_token"])


def downgrade() -> None:
    op.drop_constraint("uq_users_refresh_token", "users", type_="unique")
    op.drop_column("users", "refresh_token_expires_at")
    op.drop_column("users", "refresh_token")
