"""Add image_url to obras

Revision ID: 0008
Revises: 0007
Create Date: 2026-05-12

Stores an optional photo URL per obra, shown in the portfolio card.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("obras", sa.Column("image_url", sa.String(1000), nullable=True))


def downgrade() -> None:
    op.drop_column("obras", "image_url")
