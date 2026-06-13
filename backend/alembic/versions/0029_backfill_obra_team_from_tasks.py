"""backfill obra_team_members desde los responsables ya asignados a tareas

Cierra el desacople: obras viejas tienen tareas con responsable pero el equipo
de la obra estaba vacío. De acá en más el task_service los vincula solo.

Revision ID: 0029
Revises: 0028
Create Date: 2026-06-13
"""
from alembic import op

revision = "0029"
down_revision = "0028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO obra_team_members (obra_id, responsible_id)
        SELECT DISTINCT t.obra_id, t.responsible_id
        FROM tasks t
        WHERE t.responsible_id IS NOT NULL
        ON CONFLICT (obra_id, responsible_id) DO NOTHING
        """
    )


def downgrade() -> None:
    # No-op: no podemos distinguir los miembros backfilleados de los agregados a mano.
    pass
