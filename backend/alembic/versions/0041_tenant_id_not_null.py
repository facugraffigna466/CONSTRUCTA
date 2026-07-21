"""tenant_id NOT NULL en obras y tablas hijas siempre-parentadas (denormalización Fase 2)

Re-backfillea por seguridad y luego pone tenant_id NOT NULL en `obras` y en las 6
tablas hijas cuyo `obra_id` es NOT NULL (siempre tienen obra → siempre tienen tenant).
`alerts` e `historial_eventos` quedan nullable porque su `obra_id` es nullable
(pueden existir sin obra → sin tenant).

Si hay obras legacy con tenant_id NULL, el ALTER de `obras` falla ruidosamente:
son datos a asignar a un tenant antes de migrar (el flujo actual no genera NULLs).

Revision ID: 0041
Revises: 0040
Create Date: 2026-07-18
"""
from alembic import op

revision = "0041"
down_revision = "0040"
branch_labels = None
depends_on = None

# Hijas con obra_id NOT NULL → tenant_id puede ser NOT NULL.
_NOT_NULL_TABLES = [
    "tasks",
    "working_calendars",
    "task_baselines",
    "solicitudes_cotizacion",
    "obra_team_members",
]


def upgrade() -> None:
    # 1) Re-backfill de seguridad (idempotente) por si algún row quedó sin tenant.
    for table in _NOT_NULL_TABLES + ["alerts", "historial_eventos"]:
        op.execute(
            f"UPDATE {table} SET tenant_id = o.tenant_id "
            f"FROM obras o WHERE o.id = {table}.obra_id AND {table}.tenant_id IS NULL"
        )
    op.execute(
        "UPDATE task_materials SET tenant_id = o.tenant_id "
        "FROM tasks t JOIN obras o ON o.id = t.obra_id "
        "WHERE t.id = task_materials.task_id AND task_materials.tenant_id IS NULL"
    )

    # 2) NOT NULL en obras (falla si hay obras legacy sin tenant → dato a limpiar).
    op.alter_column("obras", "tenant_id", nullable=False)

    # 3) NOT NULL en las hijas siempre-parentadas.
    for table in _NOT_NULL_TABLES + ["task_materials"]:
        op.alter_column(table, "tenant_id", nullable=False)


def downgrade() -> None:
    for table in _NOT_NULL_TABLES + ["task_materials"]:
        op.alter_column(table, "tenant_id", nullable=True)
    op.alter_column("obras", "tenant_id", nullable=True)
