"""add purchase orders

Revision ID: 0024
Revises: 0023
Create Date: 2026-06-11
"""
from alembic import op
import sqlalchemy as sa

revision = "0024"
down_revision = "0023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Nuevo tipo de alerta para recepción de pedidos (PG 12+ permite ADD VALUE en transacción)
    op.execute("ALTER TYPE alert_type ADD VALUE IF NOT EXISTS 'order_received'")

    op.create_table(
        "purchase_orders",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("obra_id", sa.Integer(), sa.ForeignKey("obras.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("supplier_id", sa.Integer(), sa.ForeignKey("suppliers.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="borrador"),  # borrador/enviado/recibido
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "purchase_order_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("order_id", sa.Integer(), sa.ForeignKey("purchase_orders.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("material_id", sa.Integer(), sa.ForeignKey("task_materials.id", ondelete="SET NULL"), nullable=True),
        sa.Column("name", sa.String(255), nullable=False),          # snapshot del material
        sa.Column("quantity", sa.Numeric(10, 3), nullable=True),
        sa.Column("unit", sa.String(50), nullable=True),
        sa.Column("unit_price", sa.Numeric(12, 2), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("purchase_order_items")
    op.drop_table("purchase_orders")
