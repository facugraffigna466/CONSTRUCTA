"""denormalizar tenant_id en bitacora_entries + backfill

Revision ID: 0060
Revises: 0059
Create Date: 2026-08-26

Audit 08-bitácora, hallazgo N3: `BitacoraEntry` es el único modelo con
`allow_null_obra=True` en `obra_permissions.py` que no tiene `tenant_id`
propio (Task/Alert/Budget/Plano sí lo tienen). Para una entrada sin obra
(nota de WhatsApp todavía sin asignar), `_resolve_and_assert` salta el
chequeo de tenant por completo (`hasattr(row, "tenant_id")` da False) y
solo exige "sea admin de empresa" — sin comparar de qué empresa. Un admin
de un tenant ajeno puede leer/descartar la sugerencia de una nota de otro
tenant que todavía no tiene obra asignada.

Con la columna presente, `_resolve_and_assert` aplica su chequeo de tenant
existente sin cambios en `obra_permissions.py`.

Backfill: obra.tenant_id si la entrada ya tiene obra; si no, el tenant del
creador (`created_by`) o, en su defecto, del responsable (`responsible_id`).
"""
from alembic import op
import sqlalchemy as sa

revision = "0060"
down_revision = "0059"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "bitacora_entries",
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id"), nullable=True),
    )
    op.create_index("ix_bitacora_entries_tenant_id", "bitacora_entries", ["tenant_id"])

    op.execute(
        """
        UPDATE bitacora_entries
           SET tenant_id = obras.tenant_id
          FROM obras
         WHERE bitacora_entries.obra_id = obras.id
        """
    )
    op.execute(
        """
        UPDATE bitacora_entries
           SET tenant_id = users.tenant_id
          FROM users
         WHERE bitacora_entries.tenant_id IS NULL
           AND bitacora_entries.created_by = users.id
        """
    )
    op.execute(
        """
        UPDATE bitacora_entries
           SET tenant_id = responsibles.tenant_id
          FROM responsibles
         WHERE bitacora_entries.tenant_id IS NULL
           AND bitacora_entries.responsible_id = responsibles.id
        """
    )


def downgrade() -> None:
    op.drop_index("ix_bitacora_entries_tenant_id", table_name="bitacora_entries")
    op.drop_column("bitacora_entries", "tenant_id")
