"""Sugerencias: nuevo tipo reassign_responsible + campo new_responsible_id.

Hallazgo de uso real: si el audio dice "Fulano dejó la obra, poné a Mengano
en la tarea de instalación eléctrica", el análisis no tenía ningún tipo de
sugerencia para eso — lo forzaba dentro de update_status (guardaba el nombre
en un campo que la aplicación ignora, dejaba new_status en null) y al
aplicarla tiraba "La sugerencia no tiene tarea o estado válido". No caía
como nota — quedaba como una sugerencia rota que parecía accionable.

new_responsible_id (FK, no texto): a diferencia de responsible_name (que se
resuelve por ILIKE al aplicar, ambiguo con nombres repetidos), acá el
análisis matchea contra el directorio completo de responsables ANTES de
generar la sugerencia, así lo que el jefe ve en la tarjeta ya es la persona
real, no un nombre a interpretar después.

Revision ID: 0077
Revises: 0076
"""
from alembic import op
import sqlalchemy as sa

revision = "0077"
down_revision = "0076"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ALTER TYPE ... ADD VALUE no puede correr dentro de una transacción en
    # Postgres — autocommit_block() lo saca de la transacción de la migración.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE suggestion_type ADD VALUE 'reassign_responsible'")

    op.add_column(
        "suggestions",
        sa.Column(
            "new_responsible_id", sa.Integer(),
            sa.ForeignKey("responsibles.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "suggestions",
        sa.Column("new_responsible_name", sa.String(255), nullable=True),
    )


def downgrade() -> None:
    # Postgres no soporta quitar un valor de un enum — downgrade deja el tipo
    # de más (values_callable en el modelo controla qué se puede escribir
    # desde la app; el valor extra en el enum de BD queda inerte).
    op.drop_column("suggestions", "new_responsible_name")
    op.drop_column("suggestions", "new_responsible_id")
