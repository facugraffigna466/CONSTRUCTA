"""tracking de entrega del informe de insights (etapa 5)

Columnas de entrega sobre `obra_stats_snapshots`. La tabla ya es única por
(obra_id, period), así que es el lugar natural para la idempotencia del envío:
si `email_status` ya es 'sent', el job mensual puede reintentarse sin que el
owner reciba dos veces el mismo informe.

No se creó una tabla aparte de tracking porque no aporta nada: la relación con
el snapshot es 1 a 1 y el ciclo de vida es el mismo.

Revision ID: 0064
Revises: 0063
Create Date: 2026-09-02
"""
import sqlalchemy as sa
from alembic import op

revision = "0064"
down_revision = "0063"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("obra_stats_snapshots", sa.Column("email_status", sa.String(length=20), nullable=True))
    op.add_column("obra_stats_snapshots", sa.Column("email_sent_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("obra_stats_snapshots", sa.Column("email_recipient", sa.String(length=255), nullable=True))
    op.add_column("obra_stats_snapshots", sa.Column("email_error", sa.Text(), nullable=True))
    op.add_column("obra_stats_snapshots", sa.Column("whatsapp_status", sa.String(length=20), nullable=True))
    op.add_column("obra_stats_snapshots", sa.Column("whatsapp_sent_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("obra_stats_snapshots", "whatsapp_sent_at")
    op.drop_column("obra_stats_snapshots", "whatsapp_status")
    op.drop_column("obra_stats_snapshots", "email_error")
    op.drop_column("obra_stats_snapshots", "email_recipient")
    op.drop_column("obra_stats_snapshots", "email_sent_at")
    op.drop_column("obra_stats_snapshots", "email_status")
