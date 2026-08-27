"""índice compuesto (obra_id, created_at DESC) en historial_eventos

Auditoría 07-historial, hallazgo 7.10/8.9: la query principal del módulo
(`WHERE obra_id = :id ORDER BY created_at DESC LIMIT :n`) usaba el índice
simple de obra_id para filtrar y después ordenaba en memoria — para obras
con cientos de eventos, un índice compuesto lo resuelve como index scan puro.
El índice simple en obra_id se deja como está (lo sigue usando el resto de
queries de historial que no ordenan por fecha).

Revision ID: 0061
Revises: 0060
Create Date: 2026-08-27
"""
from alembic import op

revision = "0061"
down_revision = "0060"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "idx_historial_obra_created",
        "historial_eventos",
        ["obra_id", "created_at"],
        postgresql_ops={"created_at": "DESC"},
    )


def downgrade() -> None:
    op.drop_index("idx_historial_obra_created", table_name="historial_eventos")
