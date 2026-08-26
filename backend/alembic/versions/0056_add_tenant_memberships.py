"""add tenant_memberships table + backfill (Fase 1 rediseño multi-tenant)

Tabla nueva y aditiva: destino final de los campos de `users` que en realidad
son por-empresa, no por-identidad (`role`, `is_active`, `whatsapp_number`,
`invitation_token`/`invitation_expires_at`, `pending_obra_assignments`). Objetivo
del rediseño: que la misma persona (mismo email) pueda pertenecer a más de un
tenant, algo imposible hoy porque `users.tenant_id` es una FK simple.

Backfill: una fila de membership por cada `User` que ya tiene `tenant_id`
asignado, copiando el estado actual 1:1. Las columnas viejas de `users` NO se
tocan en esta fase — el resto del código las sigue leyendo hasta la Fase 2;
esta migración solo deja la tabla nueva poblada y lista.

Revision ID: 0056
Revises: 0055
Create Date: 2026-08-26
"""
from alembic import op
import sqlalchemy as sa


revision = "0056"
down_revision = "0055"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tenant_memberships",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "tenant_id",
            sa.Integer(),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("role", sa.String(20), nullable=False, server_default="collaborator"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("invitation_token", sa.String(64), nullable=True, unique=True),
        sa.Column("invitation_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("pending_obra_assignments", sa.JSON(), nullable=True),
        sa.Column("whatsapp_number", sa.String(20), nullable=True, index=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.UniqueConstraint("tenant_id", "user_id", name="uq_membership_tenant_user"),
        sa.UniqueConstraint("tenant_id", "whatsapp_number", name="uq_membership_tenant_whatsapp"),
    )

    op.execute("""
        INSERT INTO tenant_memberships (
            user_id, tenant_id, role, is_active, invitation_token,
            invitation_expires_at, pending_obra_assignments, whatsapp_number, created_at
        )
        SELECT id, tenant_id, role, is_active, invitation_token,
               invitation_expires_at, pending_obra_assignments, whatsapp_number, created_at
          FROM users
         WHERE tenant_id IS NOT NULL
    """)


def downgrade() -> None:
    op.drop_table("tenant_memberships")
