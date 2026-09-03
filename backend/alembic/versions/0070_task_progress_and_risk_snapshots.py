"""tasks.last_progress_at + tabla task_risk_snapshots

Insumos de las dos reglas de la propuesta que comparan estado contra el pasado
(docs/propuesta-reglas-riesgo.md §1.2 y §4.1):

- `tasks.last_progress_at` — última vez que se movió `estimated_progress`. La
  alternativa sin migración era buscar el último evento relevante en
  `historial_eventos` por tarea en cada corrida del cron; la propuesta la
  descarta por costo de query.
  Backfill: `updated_at`, la mejor aproximación disponible para filas viejas.
  Sin backfill, cada tarea en progreso preexistente dispararía `progress_stalled`
  en la primera corrida.

- `task_risk_snapshots` — última holgura (float CPM) calculada por tarea, una
  fila por tarea que se pisa en cada corrida. El CPM hoy se calcula al vuelo y no
  se persiste, así que no hay contra qué comparar para detectar que una holgura
  se está achicando.

Revision ID: 0070
Revises: 0069
Create Date: 2026-09-03
"""
import sqlalchemy as sa
from alembic import op

revision = "0070"
down_revision = "0069"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tasks",
        sa.Column("last_progress_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.execute(sa.text("UPDATE tasks SET last_progress_at = updated_at"))

    op.create_table(
        "task_risk_snapshots",
        sa.Column(
            "task_id",
            sa.Integer(),
            sa.ForeignKey("tasks.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "tenant_id",
            sa.Integer(),
            sa.ForeignKey("tenants.id"),
            nullable=False,
        ),
        sa.Column("float_days", sa.Integer(), nullable=False),
        sa.Column(
            "computed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )
    op.create_index(
        "idx_task_risk_snapshots_tenant", "task_risk_snapshots", ["tenant_id"]
    )


def downgrade() -> None:
    op.drop_index("idx_task_risk_snapshots_tenant", table_name="task_risk_snapshots")
    op.drop_table("task_risk_snapshots")
    op.drop_column("tasks", "last_progress_at")
