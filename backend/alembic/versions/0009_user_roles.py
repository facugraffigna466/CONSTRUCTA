"""Add role and invitation fields to users

Revision ID: 0009
Revises: 0008
Create Date: 2026-05-14

Adds:
  - role: "admin" | "collaborator" (default collaborator)
  - invitation_token: UUID-like string, set when an admin invites someone
  - invitation_expires_at: token TTL
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: Union[str, None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("role", sa.String(20), nullable=False, server_default="collaborator"),
    )
    op.add_column(
        "users",
        sa.Column("invitation_token", sa.String(64), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column("invitation_expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_users_invitation_token", "users", ["invitation_token"], unique=True
    )


def downgrade() -> None:
    op.drop_index("ix_users_invitation_token", table_name="users")
    op.drop_column("users", "invitation_expires_at")
    op.drop_column("users", "invitation_token")
    op.drop_column("users", "role")
