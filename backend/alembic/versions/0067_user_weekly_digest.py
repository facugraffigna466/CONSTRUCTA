"""marca del último resumen semanal de staff enviado

El resumen semanal para arquitectos/administradores corre cada hora los lunes
(para esperar a que abra la ventana horaria del tenant), así que hace falta
saber si el de esta semana ya salió. Mismo criterio que
`responsibles.last_weekly_digest_at` (migración 0066).

Revision ID: 0067
Revises: 0066
Create Date: 2026-09-03
"""
import sqlalchemy as sa
from alembic import op

revision = "0067"
down_revision = "0066"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("last_weekly_digest_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "last_weekly_digest_at")
