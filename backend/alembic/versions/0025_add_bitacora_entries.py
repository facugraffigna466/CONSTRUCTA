"""add bitacora entries

Revision ID: 0025
Revises: 0024
Create Date: 2026-06-12
"""
from alembic import op
import sqlalchemy as sa

revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "bitacora_entries",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("obra_id", sa.Integer(), sa.ForeignKey("obras.id", ondelete="CASCADE"), nullable=True, index=True),
        sa.Column("responsible_id", sa.Integer(), sa.ForeignKey("responsibles.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("source", sa.String(20), nullable=False, server_default="web"),  # web | whatsapp
        sa.Column("audio_path", sa.String(500), nullable=True),
        sa.Column("transcript", sa.Text(), nullable=True),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("key_points", sa.JSON(), nullable=True),
        sa.Column("suggestions", sa.JSON(), nullable=True),
        # pendiente_transcripcion → pendiente_analisis → procesado | error
        sa.Column("status", sa.String(30), nullable=False, server_default="pendiente_transcripcion"),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("bitacora_entries")
