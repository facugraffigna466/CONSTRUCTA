"""remove en_revision from task_status enum

Revision ID: 0011
Revises: 0010
Create Date: 2026-05-18

"""
from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Migrate any existing rows with en_revision → en_progreso
    op.execute("UPDATE tasks SET status = 'en_progreso' WHERE status = 'en_revision'")

    # PostgreSQL doesn't support DROP VALUE on enums — recreate the type
    op.execute("ALTER TYPE task_status RENAME TO task_status_old")
    op.execute(
        "CREATE TYPE task_status AS ENUM "
        "('pendiente', 'en_progreso', 'bloqueada', 'completada', 'cancelada')"
    )
    op.execute(
        "ALTER TABLE tasks "
        "ALTER COLUMN status TYPE task_status "
        "USING status::text::task_status"
    )
    op.execute("DROP TYPE task_status_old")


def downgrade() -> None:
    op.execute("ALTER TYPE task_status RENAME TO task_status_old")
    op.execute(
        "CREATE TYPE task_status AS ENUM "
        "('pendiente', 'en_progreso', 'bloqueada', 'en_revision', 'completada', 'cancelada')"
    )
    op.execute(
        "ALTER TABLE tasks "
        "ALTER COLUMN status TYPE task_status "
        "USING status::text::task_status"
    )
    op.execute("DROP TYPE task_status_old")
