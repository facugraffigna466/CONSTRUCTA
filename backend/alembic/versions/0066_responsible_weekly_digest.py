"""marca del último resumen semanal enviado a cada responsable

El job del resumen de los lunes corre cada hora (no una sola vez a las 8) para
poder esperar a que abra la ventana horaria configurada por el tenant: si la
empresa arranca a las 9, un job de las 8 en punto nunca enviaría. Con la corrida
horaria hace falta saber si el resumen de esta semana ya salió.

Revision ID: 0066
Revises: 0065
Create Date: 2026-09-02
"""
import sqlalchemy as sa
from alembic import op

revision = "0066"
down_revision = "0065"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "responsibles",
        sa.Column("last_weekly_digest_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("responsibles", "last_weekly_digest_at")
