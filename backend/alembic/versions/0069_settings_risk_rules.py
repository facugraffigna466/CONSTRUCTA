"""configuración por tenant de las reglas de detección de riesgo

Un toggle por cada una de las 11 reglas de docs/propuesta-reglas-riesgo.md más su
umbral, para que cada empresa decida qué evaluar y con qué tolerancia. Todas
arrancan habilitadas con los umbrales sugeridos por la propuesta: apagarlas por
defecto haría que la funcionalidad quede invisible hasta que alguien entre a
Configuración.

Se agregan con server_default para no romper las filas existentes; el default de
la aplicación vive en el modelo (app/models/settings.py).

Revision ID: 0069
Revises: 0068
Create Date: 2026-09-03
"""
import sqlalchemy as sa
from alembic import op

revision = "0069"
down_revision = "0068"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "system_settings",
        sa.Column("risk_critical_task_delayed", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column(
        "system_settings",
        sa.Column("risk_critical_delay_lookahead_days", sa.Integer(), nullable=False, server_default="3"),
    )
    op.add_column(
        "system_settings",
        sa.Column("risk_float_shrinking", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column(
        "system_settings",
        sa.Column("risk_float_threshold_days", sa.Integer(), nullable=False, server_default="3"),
    )
    op.add_column(
        "system_settings",
        sa.Column("risk_baseline_deviation", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column(
        "system_settings",
        sa.Column("risk_baseline_deviation_days", sa.Integer(), nullable=False, server_default="5"),
    )
    op.add_column(
        "system_settings",
        sa.Column("risk_material_pending", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column(
        "system_settings",
        sa.Column("risk_material_pending_days", sa.Integer(), nullable=False, server_default="7"),
    )
    op.add_column(
        "system_settings",
        sa.Column("risk_order_no_confirmation", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column(
        "system_settings",
        sa.Column("risk_order_confirmation_days", sa.Integer(), nullable=False, server_default="7"),
    )
    op.add_column(
        "system_settings",
        sa.Column("risk_material_blocking_task", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column(
        "system_settings",
        sa.Column("risk_material_blocking_days", sa.Integer(), nullable=False, server_default="5"),
    )
    op.add_column(
        "system_settings",
        sa.Column("risk_progress_stalled", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column(
        "system_settings",
        sa.Column("risk_progress_stalled_days", sa.Integer(), nullable=False, server_default="7"),
    )
    op.add_column(
        "system_settings",
        sa.Column("risk_deadline_holiday", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column(
        "system_settings",
        sa.Column("risk_holiday_lookahead_days", sa.Integer(), nullable=False, server_default="14"),
    )
    op.add_column(
        "system_settings",
        sa.Column("risk_recurring_blocker", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column(
        "system_settings",
        sa.Column("risk_recurring_blocker_count", sa.Integer(), nullable=False, server_default="3"),
    )
    op.add_column(
        "system_settings",
        sa.Column("risk_chronic_no_response", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column(
        "system_settings",
        sa.Column("risk_chronic_no_response_count", sa.Integer(), nullable=False, server_default="3"),
    )
    op.add_column(
        "system_settings",
        sa.Column("risk_chronic_no_response_window_days", sa.Integer(), nullable=False, server_default="30"),
    )
    op.add_column(
        "system_settings",
        sa.Column("risk_milestone_at_risk", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column(
        "system_settings",
        sa.Column("risk_milestone_lookahead_days", sa.Integer(), nullable=False, server_default="7"),
    )


def downgrade() -> None:
    op.drop_column("system_settings", "risk_milestone_lookahead_days")
    op.drop_column("system_settings", "risk_milestone_at_risk")
    op.drop_column("system_settings", "risk_chronic_no_response_window_days")
    op.drop_column("system_settings", "risk_chronic_no_response_count")
    op.drop_column("system_settings", "risk_chronic_no_response")
    op.drop_column("system_settings", "risk_recurring_blocker_count")
    op.drop_column("system_settings", "risk_recurring_blocker")
    op.drop_column("system_settings", "risk_holiday_lookahead_days")
    op.drop_column("system_settings", "risk_deadline_holiday")
    op.drop_column("system_settings", "risk_progress_stalled_days")
    op.drop_column("system_settings", "risk_progress_stalled")
    op.drop_column("system_settings", "risk_material_blocking_days")
    op.drop_column("system_settings", "risk_material_blocking_task")
    op.drop_column("system_settings", "risk_order_confirmation_days")
    op.drop_column("system_settings", "risk_order_no_confirmation")
    op.drop_column("system_settings", "risk_material_pending_days")
    op.drop_column("system_settings", "risk_material_pending")
    op.drop_column("system_settings", "risk_baseline_deviation_days")
    op.drop_column("system_settings", "risk_baseline_deviation")
    op.drop_column("system_settings", "risk_float_threshold_days")
    op.drop_column("system_settings", "risk_float_shrinking")
    op.drop_column("system_settings", "risk_critical_delay_lookahead_days")
    op.drop_column("system_settings", "risk_critical_task_delayed")
