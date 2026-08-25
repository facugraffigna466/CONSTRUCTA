"""system_settings: de una fila por manager a una fila por tenant

Hallazgo 1 de docs/auditoria/11-panel-configuracion.md: las reglas de
`system_settings` (horario del chatbot, qué alertas mostrar, etc.) las
define la EMPRESA, no cada manager — pero la tabla estaba ligada 1:1 a
`users.id` (manager_id). Dos obras del mismo tenant, con managers
distintos, terminaban con el chatbot operando en horarios completamente
distintos, verificado en vivo.

Backfill: si un tenant ya tiene más de una fila de settings (un manager por
obra, cada uno con la suya), gana la del OWNER del tenant (tenants.owner_
user_id) — es quien creó la empresa, la config más "oficial" disponible.
Si el owner no tiene fila propia, gana la más antigua (created_at ASC)
entre las que sí existen para ese tenant. El resto se borra.

Revision ID: 0055
Revises: 0054
Create Date: 2026-08-25
"""
from alembic import op
import sqlalchemy as sa

revision = "0055"
down_revision = "0054"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("system_settings", sa.Column("tenant_id", sa.Integer(), nullable=True))

    op.execute("""
        UPDATE system_settings ss
           SET tenant_id = u.tenant_id
          FROM users u
         WHERE ss.manager_id = u.id
    """)

    # Deduplicar: 1 fila por tenant. Gana la del owner; si el owner no tiene
    # fila propia, la más antigua entre las existentes.
    op.execute("""
        WITH ranked AS (
            SELECT ss.id,
                   row_number() OVER (
                       PARTITION BY ss.tenant_id
                       ORDER BY (t.owner_user_id = ss.manager_id) DESC, ss.created_at ASC
                   ) AS rn
              FROM system_settings ss
              JOIN tenants t ON t.id = ss.tenant_id
             WHERE ss.tenant_id IS NOT NULL
        )
        DELETE FROM system_settings
         WHERE id IN (SELECT id FROM ranked WHERE rn > 1)
    """)

    # Filas huérfanas (manager sin tenant asignado) no tienen dueño posible —
    # se descartan; get_or_create() arma una fila nueva con defaults cuando
    # la empresa entre a Configuración por primera vez.
    op.execute("DELETE FROM system_settings WHERE tenant_id IS NULL")

    op.drop_constraint("system_settings_manager_id_fkey", "system_settings", type_="foreignkey")
    op.drop_constraint("uq_system_settings_manager_id", "system_settings", type_="unique")
    op.drop_index("ix_system_settings_manager_id", table_name="system_settings")
    op.drop_column("system_settings", "manager_id")

    op.alter_column("system_settings", "tenant_id", nullable=False)
    op.create_unique_constraint("uq_system_settings_tenant_id", "system_settings", ["tenant_id"])
    op.create_index("ix_system_settings_tenant_id", "system_settings", ["tenant_id"])
    op.create_foreign_key(
        "system_settings_tenant_id_fkey", "system_settings", "tenants",
        ["tenant_id"], ["id"], ondelete="CASCADE",
    )


def downgrade() -> None:
    op.drop_constraint("system_settings_tenant_id_fkey", "system_settings", type_="foreignkey")
    op.drop_index("ix_system_settings_tenant_id", table_name="system_settings")
    op.drop_constraint("uq_system_settings_tenant_id", "system_settings", type_="unique")

    op.add_column("system_settings", sa.Column("manager_id", sa.Integer(), nullable=True))
    op.execute("""
        UPDATE system_settings ss
           SET manager_id = t.owner_user_id
          FROM tenants t
         WHERE ss.tenant_id = t.id
    """)
    op.execute("DELETE FROM system_settings WHERE manager_id IS NULL")

    op.drop_column("system_settings", "tenant_id")
    op.alter_column("system_settings", "manager_id", nullable=False)
    op.create_unique_constraint("uq_system_settings_manager_id", "system_settings", ["manager_id"])
    op.create_index("ix_system_settings_manager_id", "system_settings", ["manager_id"])
    op.create_foreign_key(
        "system_settings_manager_id_fkey", "system_settings", "users",
        ["manager_id"], ["id"], ondelete="CASCADE",
    )
