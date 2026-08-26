"""solicitudes_cotizacion: ref_code unique por obra, no global

Bug real detectado en testing manual del módulo Compras: `ref_code` tenía
UNIQUE global, pero `_next_ref_code()` (solicitud_service.py) lo genera
contando solicitudes de la MISMA obra ("COT-01", "COT-02"...). Resultado: la
primera solicitud de cualquier obra intenta "COT-01" y choca contra el
COT-01 de la primera obra que ya tenga una — 500 en cualquier obra que no
sea esa.

Cambio: (obra_id, ref_code) UNIQUE en vez de ref_code UNIQUE global. Mismo
patrón que 0053 (whatsapp_number).

Revision ID: 0059
Revises: 0058
Create Date: 2026-08-26
"""
from alembic import op


revision = "0059"
down_revision = "0058"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE solicitudes_cotizacion "
        "DROP CONSTRAINT IF EXISTS solicitudes_cotizacion_ref_code_key"
    )
    op.create_unique_constraint(
        "uq_solicitud_obra_refcode",
        "solicitudes_cotizacion",
        ["obra_id", "ref_code"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_solicitud_obra_refcode", "solicitudes_cotizacion", type_="unique"
    )
    op.create_unique_constraint(
        "solicitudes_cotizacion_ref_code_key",
        "solicitudes_cotizacion",
        ["ref_code"],
    )
