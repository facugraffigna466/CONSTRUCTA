"""módulo de presupuestos — tabla budgets (lectura IA + comparación)

Revision ID: 0027
Revises: 0026
Create Date: 2026-06-13
"""
from alembic import op
import sqlalchemy as sa

revision = "0027"
down_revision = "0026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "budgets",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id"), nullable=True, index=True),
        sa.Column("obra_id", sa.Integer(), sa.ForeignKey("obras.id", ondelete="SET NULL"), nullable=True, index=True),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("supplier_id", sa.Integer(), sa.ForeignKey("suppliers.id", ondelete="SET NULL"), nullable=True),
        sa.Column("supplier_name", sa.String(255), nullable=True),
        sa.Column("rubro", sa.String(255), nullable=True),
        sa.Column("source_type", sa.String(20), nullable=False, server_default="texto"),
        sa.Column("source_filename", sa.String(500), nullable=True),
        sa.Column("raw_text", sa.Text(), nullable=True),
        sa.Column("data", sa.JSON(), nullable=True),
        sa.Column("inconsistencies", sa.JSON(), nullable=True),
        sa.Column("total", sa.Numeric(14, 2), nullable=True),
        sa.Column("currency", sa.String(8), nullable=False, server_default="ARS"),
        sa.Column("status", sa.String(20), nullable=False, server_default="procesado"),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("budgets")
