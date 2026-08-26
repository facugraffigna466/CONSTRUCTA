"""add refresh_token to tenant_memberships (Fase 3 rediseño multi-tenant)

La sesión (refresh token) pasa a ser por membership, no por identidad: dos
empresas de la misma persona son dos sesiones independientes, cada una con
su propio refresh token — si viviera en `users` una sesión pisaría a la
otra apenas la persona tuviera membership activa en dos tenants a la vez.

Backfill: copia el refresh_token vigente de cada `User` a su (única, hasta
ahora) membership — nadie pierde la sesión activa en el corte.

Revision ID: 0057
Revises: 0056
Create Date: 2026-08-26
"""
from alembic import op
import sqlalchemy as sa


revision = "0057"
down_revision = "0056"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tenant_memberships", sa.Column("refresh_token", sa.String(64), nullable=True))
    op.add_column(
        "tenant_memberships",
        sa.Column("refresh_token_expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_unique_constraint(
        "uq_tenant_memberships_refresh_token", "tenant_memberships", ["refresh_token"]
    )
    op.execute("""
        UPDATE tenant_memberships tm
           SET refresh_token = u.refresh_token,
               refresh_token_expires_at = u.refresh_token_expires_at
          FROM users u
         WHERE tm.user_id = u.id AND u.refresh_token IS NOT NULL
    """)


def downgrade() -> None:
    op.drop_constraint(
        "uq_tenant_memberships_refresh_token", "tenant_memberships", type_="unique"
    )
    op.drop_column("tenant_memberships", "refresh_token_expires_at")
    op.drop_column("tenant_memberships", "refresh_token")
