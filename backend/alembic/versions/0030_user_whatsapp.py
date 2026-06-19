"""users.whatsapp_number — el staff (arquitecto/jefe/admin) puede usar el chatbot

Revision ID: 0030
Revises: 0029
Create Date: 2026-06-13
"""
from alembic import op
import sqlalchemy as sa

revision = "0030"
down_revision = "0029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("whatsapp_number", sa.String(20), nullable=True))
    op.create_index("ix_users_whatsapp_number", "users", ["whatsapp_number"])


def downgrade() -> None:
    op.drop_index("ix_users_whatsapp_number", table_name="users")
    op.drop_column("users", "whatsapp_number")
