"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-04-23

Tables: users, responsibles, obras, tasks, historial_eventos
Enums:  obra_status, task_status
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── users ─────────────────────────────────────────────────────────────────
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("hashed_password", sa.String(255), nullable=False),
        sa.Column("full_name", sa.String(255), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    # unique=True here doubles as the uniqueness constraint and the lookup index
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    # ── responsibles ──────────────────────────────────────────────────────────
    op.create_table(
        "responsibles",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("full_name", sa.String(255), nullable=False),
        sa.Column("whatsapp_number", sa.String(20), nullable=False),
        sa.Column("role", sa.String(100), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    # Critical for Phase 2: chatbot looks up responsibles by phone number
    op.create_index(
        "ix_responsibles_whatsapp_number",
        "responsibles",
        ["whatsapp_number"],
        unique=True,
    )

    # ── obras ─────────────────────────────────────────────────────────────────
    op.create_table(
        "obras",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("location", sa.String(500), nullable=True),
        sa.Column(
            "status",
            sa.Enum(
                "planificada",
                "en_progreso",
                "pausada",
                "completada",
                "cancelada",
                name="obra_status",
            ),
            nullable=False,
        ),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("expected_end_date", sa.Date(), nullable=True),
        sa.Column("actual_end_date", sa.Date(), nullable=True),
        sa.Column("manager_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["manager_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_obras_manager_id", "obras", ["manager_id"])

    # ── tasks ─────────────────────────────────────────────────────────────────
    op.create_table(
        "tasks",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("obra_id", sa.Integer(), nullable=False),
        sa.Column("responsible_id", sa.Integer(), nullable=True),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "status",
            sa.Enum(
                "pendiente",
                "en_progreso",
                "bloqueada",
                "en_revision",
                "completada",
                "cancelada",
                name="task_status",
            ),
            nullable=False,
        ),
        sa.Column("estimated_progress", sa.Integer(), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("completed_date", sa.Date(), nullable=True),
        sa.Column("order_index", sa.Integer(), nullable=False),
        sa.Column("depends_on_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["obra_id"], ["obras.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["responsible_id"], ["responsibles.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["depends_on_id"], ["tasks.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_tasks_obra_id", "tasks", ["obra_id"])
    op.create_index("ix_tasks_responsible_id", "tasks", ["responsible_id"])
    op.create_index("ix_tasks_depends_on_id", "tasks", ["depends_on_id"])

    # ── historial_eventos ─────────────────────────────────────────────────────
    op.create_table(
        "historial_eventos",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("obra_id", sa.Integer(), nullable=True),
        sa.Column("task_id", sa.Integer(), nullable=True),
        sa.Column("event_type", sa.String(100), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=True),
        sa.Column("triggered_by", sa.String(50), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["obra_id"], ["obras.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_historial_eventos_obra_id", "historial_eventos", ["obra_id"])
    op.create_index("ix_historial_eventos_task_id", "historial_eventos", ["task_id"])
    op.create_index(
        "ix_historial_eventos_event_type", "historial_eventos", ["event_type"]
    )


def downgrade() -> None:
    # Drop in reverse dependency order
    op.drop_table("historial_eventos")

    op.drop_index("ix_tasks_depends_on_id", table_name="tasks")
    op.drop_index("ix_tasks_responsible_id", table_name="tasks")
    op.drop_index("ix_tasks_obra_id", table_name="tasks")
    op.drop_table("tasks")

    op.drop_index("ix_obras_manager_id", table_name="obras")
    op.drop_table("obras")

    op.drop_index(
        "ix_responsibles_whatsapp_number", table_name="responsibles"
    )
    op.drop_table("responsibles")

    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")

    # Drop PostgreSQL enum types after all tables are gone
    op.execute(sa.text("DROP TYPE IF EXISTS task_status"))
    op.execute(sa.text("DROP TYPE IF EXISTS obra_status"))
