"""decisión e impacto en las conclusiones de insights

El informe pasa a estar escrito para el dueño de la obra, que necesita decidir,
no analizar. Cada conclusión ahora lleva además:

  impact   — qué se destraba si toma la decisión, en días o tareas concretas
  priority — alta/media/baja, para ordenar el informe por lo que más mueve la aguja

`recommendation` ya existía y pasa a ser la decisión concreta (antes era una
"lección para la próxima obra", más genérica).

Revision ID: 0065
Revises: 0064
Create Date: 2026-09-02
"""
import sqlalchemy as sa
from alembic import op

revision = "0065"
down_revision = "0064"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("obra_insights", sa.Column("impact", sa.Text(), nullable=True))
    op.add_column("obra_insights", sa.Column("priority", sa.String(length=10), nullable=True))


def downgrade() -> None:
    op.drop_column("obra_insights", "priority")
    op.drop_column("obra_insights", "impact")
