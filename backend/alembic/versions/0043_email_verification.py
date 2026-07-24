"""add is_verified / verification_token / verification_expires to users (email verification)

Los usuarios EXISTENTES se grandfatherean como verificados (ya venían usando la app);
los nuevos arrancan sin verificar.

Revision ID: 0043
Revises: 0042
Create Date: 2026-07-18
"""
from alembic import op
import sqlalchemy as sa

revision = "0043"
down_revision = "0042"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("is_verified", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("users", sa.Column("verification_token", sa.String(length=64), nullable=True))
    op.add_column("users", sa.Column("verification_expires", sa.DateTime(timezone=True), nullable=True))
    op.create_unique_constraint("uq_users_verification_token", "users", ["verification_token"])
    # Grandfather: los que ya existían quedan verificados.
    op.execute("UPDATE users SET is_verified = true")


def downgrade() -> None:
    op.drop_constraint("uq_users_verification_token", "users", type_="unique")
    op.drop_column("users", "verification_expires")
    op.drop_column("users", "verification_token")
    op.drop_column("users", "is_verified")
