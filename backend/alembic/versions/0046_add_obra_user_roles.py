"""add obra_user_roles table (Fase 1 rediseño de roles)

Tabla nueva y vacía. Vincula usuarios con login (users) a obras mediante un rol
específico por obra (jefe_obra / colaborador / solo_lectura). Reemplaza — en
Fase 2 — al chequeo binario de users.role='admin' para todo lo que sea
"permisos a nivel obra". Ver docs/roles-redesign/fase-1-modelo.md.

Sin backfill de datos existentes: los usuarios ya activos siguen operando bajo
users.role (admin sigue haciendo todo; collaborator queda sin acceso concreto
a ninguna obra hasta que Fase 5 le asigne rol explícito). Esa migración de
datos es responsabilidad de la Fase 5.

Revision ID: 0046
Revises: 0045
Create Date: 2026-08-23
"""
from alembic import op
import sqlalchemy as sa


revision = "0046"
down_revision = "0045"
branch_labels = None
depends_on = None


ROLE_ENUM_NAME = "obra_user_role_type"
ROLE_ENUM_VALUES = ("jefe_obra", "colaborador", "solo_lectura")


def upgrade() -> None:
    # El tipo ENUM lo crea SQLAlchemy al crear la tabla (comportamiento por
    # defecto). El downgrade se encarga del cleanup manual del tipo huérfano.
    op.create_table(
        "obra_user_roles",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "obra_id",
            sa.Integer(),
            sa.ForeignKey("obras.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "tenant_id",
            sa.Integer(),
            sa.ForeignKey("tenants.id"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "role",
            sa.Enum(*ROLE_ENUM_VALUES, name=ROLE_ENUM_NAME),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.UniqueConstraint("obra_id", "user_id", name="uq_obra_user_role"),
    )


def downgrade() -> None:
    op.drop_table("obra_user_roles")
    # El tipo ENUM en Postgres NO se dropea con drop_table — hay que hacerlo aparte.
    sa.Enum(name=ROLE_ENUM_NAME).drop(op.get_bind(), checkfirst=True)
