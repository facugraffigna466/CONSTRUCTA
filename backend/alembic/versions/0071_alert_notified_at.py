"""alerts.notified_at + interruptor de aviso por WhatsApp de las críticas

Dos piezas para avisar por WhatsApp las alertas de severidad crítica:

- `alerts.notified_at` — cuándo se avisó por WhatsApp. Es lo que hace el envío
  idempotente: el job de riesgo corre cada 4 h y sin esta marca repetiría el
  mismo aviso en cada corrida mientras la condición siguiera vigente. Va en la
  alerta y no en una tabla aparte porque es un atributo de la alerta misma, y
  de paso queda el dato de cuánto tardó en salir.
- `system_settings.risk_whatsapp_critical` — el interruptor por empresa. Arranca
  habilitado, como el resto de las notificaciones proactivas
  (`auto_reminders`, `alert_overdue`), y el envío igual queda sujeto a
  `chatbot_enabled`, a `auto_reminders` y al horario laboral de la obra.

Revision ID: 0071
Revises: 0070
Create Date: 2026-09-04
"""
import sqlalchemy as sa
from alembic import op

revision = "0071"
down_revision = "0070"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "alerts",
        sa.Column("notified_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "system_settings",
        sa.Column(
            "risk_whatsapp_critical",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )


def downgrade() -> None:
    op.drop_column("system_settings", "risk_whatsapp_critical")
    op.drop_column("alerts", "notified_at")
