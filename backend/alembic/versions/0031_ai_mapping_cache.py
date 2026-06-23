"""ai mapping cache

Revision ID: 0031
Revises: 0030
Create Date: 2026-06-23
"""
from alembic import op
import sqlalchemy as sa

revision = "0031"
down_revision = "0030"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ai_mapping_cache",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("tenant_id", sa.Integer, sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=True),
        sa.Column("headers_hash", sa.String(64), nullable=False),
        sa.Column("mapping", sa.Text, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("tenant_id", "headers_hash", name="uq_ai_mapping_tenant_hash"),
    )
    op.create_index("ix_ai_mapping_tenant_created", "ai_mapping_cache", ["tenant_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_ai_mapping_tenant_created", "ai_mapping_cache")
    op.drop_table("ai_mapping_cache")
