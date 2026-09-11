"""Sugerencias: porcentaje de avance propuesto.

El audio de obra dice cosas como "la mampostería va al 75%" y el pipeline
no tenía dónde ponerlo: el tipo update_status solo cambiaba el estado y el
porcentaje se perdía (quedaba como texto en el resumen). `new_progress`
guarda el avance que propone la IA; se aplica sobre `tasks.estimated_progress`.

Revision ID: 0076
Revises: 0075
"""
from alembic import op
import sqlalchemy as sa

revision = "0076"
down_revision = "0075"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "suggestions",
        sa.Column("new_progress", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("suggestions", "new_progress")
