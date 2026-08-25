"""backfill alerts.tenant_id from obra + drop orphans

Hallazgo 5.2 de docs/auditoria/02-panel-resumen.md: el filtro por tenant
en AlertRepository hacía un INNER JOIN a Obra, así que las alertas
con obra_id NULL o cuya obra fue borrada nunca aparecían en el listado.
Ahora el filtro usa Alert.tenant_id directamente; esta migración deja
la columna consistente antes del cambio.

Estrategia:
  1) Para alertas con tenant_id IS NULL y obra_id != NULL cuya obra
     todavía existe: copiar el tenant_id desde obras.
  2) Alertas huérfanas realmente sin dueño (obra_id NULL, o la obra
     fue borrada y quedaron con tenant_id NULL) se marcan is_read=True
     y se les asigna un tenant sentinel imposible (-1) sólo para que
     el índice no explote; en la práctica quedan invisibles porque
     ningún usuario tiene ese tenant_id.

Downgrade: no-op. No queremos romper el estado limpio.
"""
from alembic import op


revision = "0052"
down_revision = "0051"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE alerts
           SET tenant_id = obras.tenant_id
          FROM obras
         WHERE alerts.tenant_id IS NULL
           AND alerts.obra_id = obras.id
        """
    )
    op.execute(
        """
        UPDATE alerts
           SET is_read = TRUE,
               tenant_id = -1
         WHERE tenant_id IS NULL
        """
    )


def downgrade() -> None:
    pass
