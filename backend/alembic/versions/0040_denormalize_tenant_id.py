"""denormalize tenant_id onto obra child tables

Agrega una columna `tenant_id` (nullable, indexada, FK a tenants) a las 8 tablas
hijas de obra y la backfillea desde la obra padre. Permite filtrar por tenant en
una sola cláusula WHERE (sin join) y previene la clase de bug IDOR a futuro.
Nullable a propósito: `obras.tenant_id` también es nullable.

Revision ID: 0040
Revises: 0039
Create Date: 2026-07-18
"""
from alembic import op
import sqlalchemy as sa

revision = "0040"
down_revision = "0039"
branch_labels = None
depends_on = None

# Tablas hijas con FK directa a la obra (`obra_id`) → backfill directo.
_OBRA_TABLES = [
    "tasks",
    "alerts",
    "working_calendars",
    "task_baselines",
    "solicitudes_cotizacion",
    "historial_eventos",
    "obra_team_members",
]

# task_materials llega a la obra vía la tarea (no tiene obra_id).
_ALL_TABLES = _OBRA_TABLES + ["task_materials"]


def upgrade() -> None:
    # 1) columna + índice en cada tabla hija
    for table in _ALL_TABLES:
        op.add_column(
            table,
            sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id"), nullable=True),
        )
        op.create_index(f"ix_{table}_tenant_id", table, ["tenant_id"])

    # 2) backfill de filas existentes desde la obra padre
    for table in _OBRA_TABLES:
        op.execute(
            f"UPDATE {table} SET tenant_id = o.tenant_id "
            f"FROM obras o WHERE o.id = {table}.obra_id"
        )
    # task_materials: tarea → obra → tenant
    op.execute(
        "UPDATE task_materials SET tenant_id = o.tenant_id "
        "FROM tasks t JOIN obras o ON o.id = t.obra_id "
        "WHERE t.id = task_materials.task_id"
    )


def downgrade() -> None:
    for table in _ALL_TABLES:
        op.drop_index(f"ix_{table}_tenant_id", table_name=table)
        op.drop_column(table, "tenant_id")
