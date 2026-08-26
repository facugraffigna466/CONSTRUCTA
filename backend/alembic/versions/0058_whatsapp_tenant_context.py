"""add whatsapp_tenant_context table (Fase 3 rediseño multi-tenant)

Desambiguación conversacional del webhook de WhatsApp: si el mismo teléfono
tiene membership de staff activa en más de un tenant (posible desde que una
identidad puede pertenecer a varias empresas), el bot pregunta una vez con
un menú numerado y recuerda la elección acá. Constructa usa un único número
de Twilio para toda la plataforma — no hay señal de infraestructura para
resolverlo sin preguntar.

Revision ID: 0058
Revises: 0057
Create Date: 2026-08-26
"""
from alembic import op
import sqlalchemy as sa


revision = "0058"
down_revision = "0057"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "whatsapp_tenant_context",
        sa.Column("phone_number", sa.String(20), primary_key=True),
        sa.Column(
            "active_tenant_id",
            sa.Integer(),
            sa.ForeignKey("tenants.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("pending_options", sa.JSON(), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
    )


def downgrade() -> None:
    op.drop_table("whatsapp_tenant_context")
