"""add users.pending_obra_assignments (Fase 3 rediseño de roles)

Guarda las asignaciones de ObraUserRole que quien invita eligió para el nuevo
usuario, en el espacio entre `POST /users/invite` (invitación emitida) y
`POST /auth/accept-invite` (usuario activado). Al aceptar, esas asignaciones
se materializan como filas reales en `obra_user_roles` en la misma transacción
que activa al usuario; después la columna se limpia (setea a NULL).

Formato: JSON con lista de dicts `[{"obra_id": <int>, "role": "<rol>"}, ...]`
donde `role` matchea el enum `obra_user_role_type` (jefe_obra / colaborador /
solo_lectura). Es NULL cuando no hay pendientes (ya se aceptó, o se invitó
sin asignaciones — el user queda sin obras hasta que un admin lo asigne).

Revision ID: 0047
Revises: 0046
Create Date: 2026-08-23
"""
from alembic import op
import sqlalchemy as sa


revision = "0047"
down_revision = "0046"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("pending_obra_assignments", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "pending_obra_assignments")
