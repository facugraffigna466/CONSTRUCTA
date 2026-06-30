"""Módulo compras: solicitudes_cotizacion, solicitud_materiales, solicitud_suppliers.
   + columnas solicitud_id y ai_analysis en budgets.

Revision ID: 0038
Revises: 0037
Create Date: 2026-06-26
"""

from alembic import op
import sqlalchemy as sa

revision = "0038"
down_revision = "0037"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── solicitudes_cotizacion ────────────────────────────────────────────────
    op.create_table(
        "solicitudes_cotizacion",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("obra_id", sa.Integer, sa.ForeignKey("obras.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("created_by", sa.Integer, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("ref_code", sa.String(20), nullable=False, unique=True),
        # borrador | enviada | respondida | confirmada
        sa.Column("status", sa.String(20), nullable=False, server_default="borrador"),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("pdf_url", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
    )

    # ── solicitud_materiales (M2M) ────────────────────────────────────────────
    op.create_table(
        "solicitud_materiales",
        sa.Column("solicitud_id", sa.Integer, sa.ForeignKey("solicitudes_cotizacion.id", ondelete="CASCADE"), nullable=False),
        sa.Column("material_id", sa.Integer, sa.ForeignKey("task_materials.id", ondelete="CASCADE"), nullable=False),
        sa.PrimaryKeyConstraint("solicitud_id", "material_id"),
    )

    # ── solicitud_suppliers ───────────────────────────────────────────────────
    op.create_table(
        "solicitud_suppliers",
        sa.Column("solicitud_id", sa.Integer, sa.ForeignKey("solicitudes_cotizacion.id", ondelete="CASCADE"), nullable=False),
        sa.Column("supplier_id", sa.Integer, sa.ForeignKey("suppliers.id", ondelete="CASCADE"), nullable=False),
        # enviada | respondida
        sa.Column("status", sa.String(20), nullable=False, server_default="enviada"),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("solicitud_id", "supplier_id"),
    )

    # ── budgets: vincular respuesta a solicitud + análisis IA ─────────────────
    op.add_column("budgets", sa.Column(
        "solicitud_id", sa.Integer,
        sa.ForeignKey("solicitudes_cotizacion.id", ondelete="SET NULL"),
        nullable=True, index=True,
    ))
    op.add_column("budgets", sa.Column("ai_analysis", sa.Text, nullable=True))


def downgrade() -> None:
    op.drop_column("budgets", "ai_analysis")
    op.drop_column("budgets", "solicitud_id")
    op.drop_table("solicitud_suppliers")
    op.drop_table("solicitud_materiales")
    op.drop_table("solicitudes_cotizacion")
