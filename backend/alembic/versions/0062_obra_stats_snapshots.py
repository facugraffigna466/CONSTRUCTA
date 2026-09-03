"""snapshots de estadísticas por obra (insights etapa 2) + alerts.resolved_at

Dos cambios, ambos para el motor de insights determinístico:

1. Tabla `obra_stats_snapshots`: una foto mensual por obra con las 5 métricas
   calculadas en `ObraStatsService`, guardadas en una columna JSON cuyo contrato
   está en docs/features/insights-etapa-2-estadisticas.md. Único por
   (obra_id, period) — recalcular el mismo mes pisa la fila anterior.

2. Columna `alerts.resolved_at`: hasta ahora `is_read` decía SI una alerta se
   resolvió pero no CUÁNDO, así que la velocidad de reacción (métrica 5) no era
   calculable. Las alertas ya resueltas quedan con NULL y se excluyen del
   promedio (el snapshot reporta cuántas fueron en
   `alert_reaction.alerts_resolved_without_timestamp`).

Revision ID: 0062
Revises: 0061
Create Date: 2026-09-02
"""
import sqlalchemy as sa
from alembic import op

revision = "0062"
down_revision = "0061"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("alerts", sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True))

    op.create_table(
        "obra_stats_snapshots",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("obra_id", sa.Integer(), nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=True),
        sa.Column("period", sa.String(length=7), nullable=False),
        sa.Column(
            "computed_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column("metrics", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(["obra_id"], ["obras.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.UniqueConstraint("obra_id", "period", name="uq_obra_stats_obra_period"),
    )
    op.create_index("ix_obra_stats_snapshots_obra_id", "obra_stats_snapshots", ["obra_id"])
    op.create_index("ix_obra_stats_snapshots_tenant_id", "obra_stats_snapshots", ["tenant_id"])
    op.create_index("ix_obra_stats_snapshots_period", "obra_stats_snapshots", ["period"])


def downgrade() -> None:
    op.drop_index("ix_obra_stats_snapshots_period", table_name="obra_stats_snapshots")
    op.drop_index("ix_obra_stats_snapshots_tenant_id", table_name="obra_stats_snapshots")
    op.drop_index("ix_obra_stats_snapshots_obra_id", table_name="obra_stats_snapshots")
    op.drop_table("obra_stats_snapshots")
    op.drop_column("alerts", "resolved_at")
