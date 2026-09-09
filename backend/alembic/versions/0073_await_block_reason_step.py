"""Paso de conversación para preguntar el motivo del bloqueo

El menú del chatbot le permitía al responsable informar QUÉ pasó —"la tarea está
bloqueada"— pero nunca POR QUÉ. El motivo quedaba en una cadena fija
("Demorada vía WhatsApp") y la alerta que le llegaba al jefe decía solamente
"La tarea X fue bloqueada", obligándolo a levantar el teléfono para averiguar si
faltaba material, faltaba gente o había llovido. Es exactamente la comunicación
informal que el sistema existe para eliminar, y es el dato que decide si hay que
comprar, llamar al proveedor o reprogramar.

Se resuelve dentro del modelo que ya usa el responsable —una pregunta numerada
más, sin texto libre— y eso necesita un estado nuevo en la máquina de
conversación.

`conversation_step` es un enum nativo de PostgreSQL, así que agregar el valor
requiere `ALTER TYPE`. No se puede correr dentro de una transacción en versiones
de PostgreSQL anteriores a la 12; se usa `COMMIT` explícito para que funcione en
todas. El `downgrade` no elimina el valor: PostgreSQL no soporta quitar valores
de un enum, y reconstruir el tipo entero para revertir un paso de conversación
—efímero, con expiración— cuesta más de lo que vale.

Revision ID: 0073
Revises: 0072
Create Date: 2026-09-09
"""
from alembic import op

revision = "0073"
down_revision = "0072"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return  # SQLite representa el enum como texto: no hay nada que alterar
    op.execute("COMMIT")
    op.execute("ALTER TYPE conversation_step ADD VALUE IF NOT EXISTS 'await_block_reason'")


def downgrade() -> None:
    # PostgreSQL no permite quitar valores de un enum. Las sesiones que hayan
    # quedado en este paso expiran solas, así que dejar el valor huérfano es
    # inocuo; reconstruir el tipo no lo sería.
    pass
