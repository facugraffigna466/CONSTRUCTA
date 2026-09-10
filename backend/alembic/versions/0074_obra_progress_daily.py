"""obra_progress_daily — historial diario para la curva S (I-05)

El indicador I-05 del dashboard de obra (docs/features/dashboard-indicadores-obra.md,
§5) compara avance real vs. planificado a lo largo del tiempo. El sistema ya
sabe calcular el avance real de HOY (ObraDashboardService), pero no guarda
cuál era el avance el mes pasado — reconstruirlo desde historial_eventos es
frágil (eventos viejos no siempre traen el payload completo). Se historiza
hacia adelante: una fila por obra por día, escrita por un job diario nuevo.
No se backfillea — la serie real arranca vacía desde el día del deploy.

Único por (obra_id, date): correr el job dos veces el mismo día pisa la fila
en vez de duplicarla (upsert idempotente).

Revision ID: 0074
Revises: 0073
Create Date: 2026-09-09
"""
import sqlalchemy as sa
from alembic import op

revision = "0074"
down_revision = "0073"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "obra_progress_daily",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("obra_id", sa.Integer(), nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("progress_real", sa.Numeric(5, 2), nullable=True),
        sa.Column("progress_planned", sa.Numeric(5, 2), nullable=True),
        sa.Column("spi", sa.Numeric(5, 3), nullable=True),
        sa.Column("tasks_total", sa.Integer(), nullable=True),
        sa.Column("tasks_completed", sa.Integer(), nullable=True),
        sa.Column("critical_task_count", sa.Integer(), nullable=True),
        sa.Column("median_float_days", sa.Numeric(6, 2), nullable=True),
        sa.ForeignKeyConstraint(["obra_id"], ["obras.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.UniqueConstraint("obra_id", "date", name="uq_obra_progress_daily_obra_date"),
    )
    op.create_index("ix_obra_progress_daily_obra_date", "obra_progress_daily", ["obra_id", "date"])


def downgrade() -> None:
    op.drop_index("ix_obra_progress_daily_obra_date", table_name="obra_progress_daily")
    op.drop_table("obra_progress_daily")
