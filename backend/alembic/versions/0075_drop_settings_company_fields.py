"""drop unused company fields from system_settings

Los campos company_name/main_responsible/company_email/company_phone
(sección "Datos generales" en Configuración) se guardaban pero no
alimentaban ningún mensaje de WhatsApp, export ni alerta — no había
ningún lector en el backend. Se saca la sección y las columnas.

Revision ID: 0075
Revises: 0074
Create Date: 2026-09-11
"""
import sqlalchemy as sa
from alembic import op

revision = "0075"
down_revision = "0074"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("system_settings", "company_name")
    op.drop_column("system_settings", "main_responsible")
    op.drop_column("system_settings", "company_email")
    op.drop_column("system_settings", "company_phone")


def downgrade() -> None:
    op.add_column("system_settings", sa.Column("company_name", sa.String(255), nullable=True))
    op.add_column("system_settings", sa.Column("main_responsible", sa.String(255), nullable=True))
    op.add_column("system_settings", sa.Column("company_email", sa.String(255), nullable=True))
    op.add_column("system_settings", sa.Column("company_phone", sa.String(50), nullable=True))
