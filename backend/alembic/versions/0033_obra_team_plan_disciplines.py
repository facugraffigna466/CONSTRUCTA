"""add plan_disciplines to obra_team_members

Revision ID: 0033
Revises: 0032
Create Date: 2026-06-23
"""
from alembic import op
import sqlalchemy as sa

revision = "0033"
down_revision = "0032"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # null = acceso a todos los planos (capataz, jefe de obra)
    # ["electricidad","gas"] = solo esas disciplinas
    op.add_column(
        "obra_team_members",
        sa.Column("plan_disciplines", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("obra_team_members", "plan_disciplines")
