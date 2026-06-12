"""responsibles.tenant_id — aislamiento del directorio de equipo por empresa

Revision ID: 0026
Revises: 0025
Create Date: 2026-06-12
"""
from alembic import op
import sqlalchemy as sa

revision = "0026"
down_revision = "0025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "responsibles",
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id"), nullable=True),
    )
    # backfill: todo el directorio existente pertenece a la empresa original (tenant 1)
    op.execute("UPDATE responsibles SET tenant_id = 1 WHERE tenant_id IS NULL")


def downgrade() -> None:
    op.drop_column("responsibles", "tenant_id")
