"""drop obra_team_members.member_type

Decisión de producto: eliminar la distinción equipo/contratista dentro de
una obra. A partir de ahora hay una sola entidad "responsable de obra".

- `plan_disciplines` se mantiene como filtro opcional para TODOS los
  responsables. Default `NULL` = acceso total (equivalente al viejo "equipo").
- La bitácora por audio pasa a ser exclusiva de staff (users con login).
  El gate anterior por member_type se reemplaza por "solo staff".

Los datos existentes (equipo y contratista) se colapsan al perder la
columna — todos quedan como responsables sin distinción de tipo.

Revision ID: 0054
Revises: 0053
Create Date: 2026-08-24
"""
from alembic import op


revision = "0054"
down_revision = "0053"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("obra_team_members", "member_type")


def downgrade() -> None:
    import sqlalchemy as sa
    op.add_column(
        "obra_team_members",
        sa.Column("member_type", sa.String(20), nullable=False, server_default="equipo"),
    )
