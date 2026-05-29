"""Add start_time and due_time to tasks

Revision ID: 0007
Revises: 0006
Create Date: 2026-05-12

Adds optional time-of-day columns to tasks so dates can be specified
with an exact hour (e.g. "vencimiento: 2026-05-15 a las 08:00").
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("start_time", sa.Time(), nullable=True))
    op.add_column("tasks", sa.Column("due_time", sa.Time(), nullable=True))


def downgrade() -> None:
    op.drop_column("tasks", "due_time")
    op.drop_column("tasks", "start_time")
