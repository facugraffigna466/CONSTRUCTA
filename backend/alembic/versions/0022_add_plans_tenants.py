"""add plans and tenants

Revision ID: 0022
Revises: 0021
Create Date: 2026-06-10
"""
from alembic import op
import sqlalchemy as sa

revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ─── plans ───────────────────────────────────────────────────────────────
    op.create_table(
        "plans",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(50), nullable=False, unique=True),
        sa.Column("max_obras", sa.Integer(), nullable=True),          # NULL = ilimitado
        sa.Column("max_users", sa.Integer(), nullable=True),
        sa.Column("max_tasks_per_obra", sa.Integer(), nullable=True),
        sa.Column("price_monthly", sa.Numeric(10, 2), nullable=True),
    )

    # Seed plans
    op.execute("""
        INSERT INTO plans (name, max_obras, max_users, max_tasks_per_obra, price_monthly)
        VALUES
          ('basico',     3,    6,   50,   29.00),
          ('pro',       20,   30, NULL,   99.00),
          ('enterprise', NULL, NULL, NULL, NULL)
    """)

    # ─── tenants ─────────────────────────────────────────────────────────────
    op.create_table(
        "tenants",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("plan_id", sa.Integer(), sa.ForeignKey("plans.id"), nullable=True),
        sa.Column("owner_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("active_until", sa.DateTime(timezone=True), nullable=True),
    )

    # ─── tenant_id en users y obras ──────────────────────────────────────────
    op.add_column("users", sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id"), nullable=True))
    op.add_column("obras", sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id"), nullable=True))

    # ─── tenant por defecto — asignar todos los registros existentes ─────────
    # Crear tenant default usando el plan "pro" como base (sin restricciones al migrar)
    op.execute("""
        INSERT INTO tenants (name, plan_id, owner_user_id)
        SELECT 'Empresa por defecto', p.id, u.id
        FROM plans p, (SELECT id FROM users ORDER BY id LIMIT 1) u
        WHERE p.name = 'pro'
        LIMIT 1
    """)

    op.execute("""
        UPDATE users SET tenant_id = (SELECT id FROM tenants LIMIT 1)
        WHERE tenant_id IS NULL
    """)

    op.execute("""
        UPDATE obras SET tenant_id = (SELECT id FROM tenants LIMIT 1)
        WHERE tenant_id IS NULL
    """)


def downgrade() -> None:
    op.drop_column("obras", "tenant_id")
    op.drop_column("users", "tenant_id")
    op.drop_table("tenants")
    op.drop_table("plans")
