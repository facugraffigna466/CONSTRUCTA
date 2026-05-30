"""add obra client fields

Revision ID: 0020
Revises: 0019
Create Date: 2026-05-30
"""
from alembic import op
import sqlalchemy as sa

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("obras", sa.Column("client_name", sa.String(255), nullable=True))
    op.add_column("obras", sa.Column("client_email", sa.String(255), nullable=True))
    op.add_column("obras", sa.Column("client_phone", sa.String(50), nullable=True))


def downgrade() -> None:
    op.drop_column("obras", "client_phone")
    op.drop_column("obras", "client_email")
    op.drop_column("obras", "client_name")
