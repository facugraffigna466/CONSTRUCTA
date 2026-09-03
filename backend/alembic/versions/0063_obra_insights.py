"""conclusiones narrativas por obra (insights etapa 3)

Tabla `obra_insights`: lo que la IA redacta a partir del `ObraStatsSnapshot` de
la etapa 2, con ciclo de vida propio (nueva/vista/aplicada/descartada,
refuerzos y resurgimiento de descartadas).

`topic_key` es la clave del ciclo de vida: se calcula en código (no la elige la
IA) como "<métrica>:<sujeto normalizado>" y es lo que decide si una conclusión
nueva es "la misma" que una ya existente — por eso va indexada junto con obra_id.

Revision ID: 0063
Revises: 0062
Create Date: 2026-09-02
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0063"
down_revision = "0062"
branch_labels = None
depends_on = None

INSIGHT_STATUSES = ("nueva", "vista", "aplicada", "descartada")


def upgrade() -> None:
    # El tipo se crea explícitamente y la columna lo referencia con
    # create_type=False: si no, create_table intenta crearlo de nuevo y falla
    # con "type insight_status already exists".
    sa.Enum(*INSIGHT_STATUSES, name="insight_status").create(op.get_bind(), checkfirst=True)
    insight_status = postgresql.ENUM(*INSIGHT_STATUSES, name="insight_status", create_type=False)

    op.create_table(
        "obra_insights",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("obra_id", sa.Integer(), nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=True),
        sa.Column("metric", sa.String(length=40), nullable=False),
        sa.Column("topic_key", sa.String(length=160), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("evidence", sa.JSON(), nullable=True),
        sa.Column("recommendation", sa.Text(), nullable=True),
        sa.Column("status", insight_status, nullable=False, server_default="nueva"),
        sa.Column("reinforcement_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("strength", sa.Float(), nullable=True),
        sa.Column("first_period", sa.String(length=7), nullable=False),
        sa.Column("last_period", sa.String(length=7), nullable=False),
        sa.Column("resurfaced_from_insight_id", sa.Integer(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False,
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False,
        ),
        sa.Column("dismissed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["obra_id"], ["obras.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.ForeignKeyConstraint(
            ["resurfaced_from_insight_id"], ["obra_insights.id"], ondelete="SET NULL"
        ),
    )
    op.create_index("ix_obra_insights_obra_id", "obra_insights", ["obra_id"])
    op.create_index("ix_obra_insights_tenant_id", "obra_insights", ["tenant_id"])
    op.create_index("ix_obra_insights_status", "obra_insights", ["status"])
    # El lookup del ciclo de vida: "¿ya existe este patrón en esta obra?"
    op.create_index("ix_obra_insights_obra_topic", "obra_insights", ["obra_id", "topic_key"])


def downgrade() -> None:
    op.drop_index("ix_obra_insights_obra_topic", table_name="obra_insights")
    op.drop_index("ix_obra_insights_status", table_name="obra_insights")
    op.drop_index("ix_obra_insights_tenant_id", table_name="obra_insights")
    op.drop_index("ix_obra_insights_obra_id", table_name="obra_insights")
    op.drop_table("obra_insights")
    sa.Enum(name="insight_status").drop(op.get_bind(), checkfirst=True)
