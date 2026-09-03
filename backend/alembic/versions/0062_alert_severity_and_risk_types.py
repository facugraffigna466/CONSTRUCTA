"""severidad en alerts + 11 tipos nuevos de alerta (detección de riesgo)

Implementa las dos piezas transversales de docs/propuesta-reglas-riesgo.md:

1. Los 11 tipos nuevos en el enum `alert_type`. Se agregan con ADD VALUE IF NOT
   EXISTS y NO se usan en esta misma migración: PostgreSQL no permite usar un
   valor de enum recién agregado dentro de la transacción que lo agregó.
2. `alerts.severity`. La propuesta lo marca como bloqueante para que reglas como
   `critical_task_delayed` o `milestone_at_risk` pesen más que un `task_overdue`
   genérico. Es VARCHAR y no un enum de PG a propósito — agregar un nivel nuevo
   no debería costar un ALTER TYPE.

El backfill mapea los 6 tipos preexistentes a su severidad por defecto (la misma
tabla DEFAULT_SEVERITY de app/models/alert.py); todo lo demás queda en 'media'.

Revision ID: 0062
Revises: 0061
Create Date: 2026-09-03
"""
import sqlalchemy as sa
from alembic import op

revision = "0062"
down_revision = "0061"
branch_labels = None
depends_on = None

_NEW_TYPES = [
    "critical_task_delayed",
    "float_shrinking",
    "baseline_deviation",
    "material_pending_too_long",
    "order_sent_no_confirmation",
    "material_blocking_task",
    "progress_stalled",
    "deadline_conflicts_holiday",
    "recurring_blocker",
    "chronic_no_response",
    "milestone_at_risk",
]

# Severidad inicial de los tipos que ya existían (ver DEFAULT_SEVERITY).
_BACKFILL = {
    "alta": ("task_blocked", "task_overdue"),
    "baja": ("order_received",),
}


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        for value in _NEW_TYPES:
            op.execute(sa.text(f"ALTER TYPE alert_type ADD VALUE IF NOT EXISTS '{value}'"))

    op.add_column(
        "alerts",
        sa.Column("severity", sa.String(10), nullable=False, server_default="media"),
    )
    op.create_index("idx_alerts_severity", "alerts", ["severity"])

    # `type::text`: la columna es el enum alert_type y los parámetros llegan como
    # varchar. Postgres no define el operador `alert_type = varchar`, así que sin
    # el cast explícito la migración falla con UndefinedFunctionError.
    for severity, types in _BACKFILL.items():
        op.execute(
            sa.text(
                "UPDATE alerts SET severity = :sev WHERE type::text IN :types"
            ).bindparams(
                sa.bindparam("types", value=types, expanding=True), sev=severity
            )
        )


def downgrade() -> None:
    op.drop_index("idx_alerts_severity", table_name="alerts")
    op.drop_column("alerts", "severity")
    # PostgreSQL no soporta DROP VALUE sobre un enum: los tipos nuevos quedan
    # declarados. Las alertas que los usen se degradan a delay_risk para que el
    # frontend viejo (que tipa los 6 originales) siga pudiendo renderizarlas.
    op.execute(
        sa.text(
            "UPDATE alerts SET type = 'delay_risk' WHERE type::text IN :types"
        ).bindparams(
            sa.bindparam("types", value=tuple(_NEW_TYPES), expanding=True)
        )
    )
