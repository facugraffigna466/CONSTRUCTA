"""add responsibles.confirmed_at (WhatsApp confirmation gate)

Rediseño de identidad + permisos del canal de WhatsApp
(docs/roles-redesign/whatsapp-identidad-permisos.md).

Semántica del campo:
  - NULL     → el responsable NO confirmó todavía su participación. El bot
               le responde SOLO con el mensaje "respondé SI para activar
               tu acceso" y bloquea cualquier otro flujo (bitácora, planos,
               tareas, etc.).
  - TIMESTAMP → el responsable confirmó (respondió SI en el WhatsApp de
                bienvenida). A partir de ese instante puede usar los demás
                flujos según su member_type y sus asignaciones.

**Backfill**: los responsables ya existentes al momento del deploy se dan
por confirmados (para no bloquearlos de golpe). El SQL de abajo setea
`confirmed_at = created_at` para las filas existentes. El downgrade
elimina la columna.

Revision ID: 0051
Revises: 0050
Create Date: 2026-08-24
"""
from alembic import op
import sqlalchemy as sa


revision = "0051"
down_revision = "0050"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "responsibles",
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
    )
    # Backfill defensivo: no queremos que responsables activos hoy queden en
    # limbo el día del deploy. `created_at` es siempre != NULL por schema.
    op.execute(
        "UPDATE responsibles SET confirmed_at = created_at WHERE confirmed_at IS NULL"
    )


def downgrade() -> None:
    op.drop_column("responsibles", "confirmed_at")
