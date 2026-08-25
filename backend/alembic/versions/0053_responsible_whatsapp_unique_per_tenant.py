"""responsibles + users: whatsapp_number unique per tenant

Hallazgos 6.3 y 6.6 de docs/auditoria/04-responsables.md.

- `responsibles.whatsapp_number` tenía UNIQUE global → impedía multi-tenant real
  (un contratista para dos empresas distintas no podía estar cargado en ambas).
- `users.whatsapp_number` no tenía unicidad → dos users del mismo tenant con el
  mismo whatsapp rompen la resolución de sender en el bot.

Cambio: en ambas tablas, (tenant_id, whatsapp_number) es UNIQUE. Los índices
simples sobre whatsapp_number quedan para lookups del bot que reciben número
sin tenant (el service después filtra por tenant).

Revision ID: 0053
Revises: 0052
Create Date: 2026-08-24
"""
from alembic import op


revision = "0053"
down_revision = "0052"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Responsibles: bajar unique global + subir unique por tenant.
    op.execute("ALTER TABLE responsibles DROP CONSTRAINT IF EXISTS responsibles_whatsapp_number_key")
    op.create_unique_constraint(
        "uq_responsibles_tenant_whatsapp",
        "responsibles",
        ["tenant_id", "whatsapp_number"],
    )
    # Users: solo subir el unique por tenant (no había unique global).
    op.create_unique_constraint(
        "uq_users_tenant_whatsapp",
        "users",
        ["tenant_id", "whatsapp_number"],
    )


def downgrade() -> None:
    # IF EXISTS para permitir bajar cuando la migración quedó a medio aplicar
    # (por ejemplo, si se editó el upgrade y hay que re-correrlo).
    op.execute("ALTER TABLE users DROP CONSTRAINT IF EXISTS uq_users_tenant_whatsapp")
    op.execute("ALTER TABLE responsibles DROP CONSTRAINT IF EXISTS uq_responsibles_tenant_whatsapp")
    op.execute(
        "ALTER TABLE responsibles ADD CONSTRAINT responsibles_whatsapp_number_key "
        "UNIQUE (whatsapp_number)"
    )
