"""unique partial index: un solo plano "vigente" por (obra, disciplina, nombre)

Cierra la condición de carrera de PlanoService.create(): dos uploads concurrentes
del mismo grupo podían terminar ambos con is_latest=true. El SELECT FOR UPDATE en
el servicio reduce la ventana, pero cuando el grupo arranca vacío no hay fila que
lockear — este índice es el backstop real (el segundo insert falla con
IntegrityError, que el servicio traduce a un 409 limpio).

Revision ID: 0045
Revises: 0044
Create Date: 2026-08-21
"""
from alembic import op
import sqlalchemy as sa

revision = "0045"
down_revision = "0044"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Normalizar duplicados que ya existan (de la condición de carrera, ya cerrada
    # en el servicio) antes de crear el índice — si no, la migración falla en
    # cualquier entorno que ya tenga dos "is_latest=true" del mismo grupo.
    op.execute("""
        WITH ranked AS (
            SELECT id, row_number() OVER (
                PARTITION BY obra_id, discipline, COALESCE(name, '')
                ORDER BY created_at DESC, id DESC
            ) AS rn
            FROM planos
            WHERE is_latest = true
        )
        UPDATE planos SET is_latest = false
        WHERE id IN (SELECT id FROM ranked WHERE rn > 1)
    """)
    op.create_index(
        "idx_plano_latest_per_group",
        "planos",
        ["obra_id", "discipline", sa.text("COALESCE(name, '')")],
        unique=True,
        postgresql_where=sa.text("is_latest = true"),
    )


def downgrade() -> None:
    op.drop_index("idx_plano_latest_per_group", table_name="planos")
