"""Extend alert_type enum with task_overdue and no_response

Revision ID: 0004
Revises: 0003
Create Date: 2026-05-11

PostgreSQL note: ALTER TYPE ADD VALUE cannot run inside a transaction
in PG < 12. In PG 12+ it works as long as the new values are not used
in the same transaction. We add them in isolation here.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(sa.text("ALTER TYPE alert_type ADD VALUE IF NOT EXISTS 'task_overdue'"))
    op.execute(sa.text("ALTER TYPE alert_type ADD VALUE IF NOT EXISTS 'no_response'"))


def downgrade() -> None:
    # PostgreSQL does not support removing enum values.
    pass
