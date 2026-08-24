"""add tenants.last_plan_warning_at (aviso 80% del plan — Fase 6 emails)

Columna nullable que guarda el timestamp del último email preventivo enviado al
admin del tenant cuando el uso del plan cruzó el 80%. Se usa como dedupe: no
mandamos otro dentro de los 7 días siguientes para no molestar.

NULL = nunca se envió (o todavía no cruzó el umbral). El check en
`app/core/plan_limits.py` compara ``NOW() - INTERVAL '7 days'`` contra este
timestamp antes de encolar el email.

Revision ID: 0050
Revises: 0049
Create Date: 2026-08-24
"""
from alembic import op
import sqlalchemy as sa


revision = "0050"
down_revision = "0049"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tenants",
        sa.Column("last_plan_warning_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("tenants", "last_plan_warning_at")
