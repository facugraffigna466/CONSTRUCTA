"""backfill: preservar acceso de collaborators pre-rediseño (Fase 5)

Antes del rediseño de roles (fases 0–4), cualquier ``User`` con rol de empresa
``collaborator`` veía y editaba TODAS las obras de su tenant — comportamiento
implícito, sin ninguna fila en ``obra_user_roles`` porque la tabla no existía.

Con el enforcement de Fase 2 ya activo, un collaborator sin filas en la tabla
recibe 404 en cualquier endpoint scoped a una obra. Sin esta migración, todo
collaborator existente pierde acceso a todo el día del deploy.

Esta migración crea, para cada collaborator activo, una fila
``ObraUserRole(role='colaborador', origin='backfill_fase5')`` para cada obra
del mismo tenant. Con eso el comportamiento post-deploy es idéntico al
pre-deploy — ni más ni menos permisos.

Propiedades:

* **Idempotente.** ``ON CONFLICT (obra_id, user_id) DO NOTHING`` respeta
  cualquier fila que ya exista (por invite de Fase 3, asignación manual de
  Fase 4, o corrida previa del mismo backfill). No pisa roles distintos.
* **Rollback determinista.** ``downgrade()`` borra SOLO las filas con
  ``origin='backfill_fase5'``. No toca asignaciones manuales.
* **Cross-tenant safe.** El JOIN es por ``users.tenant_id = obras.tenant_id``;
  nunca cruza empresas. Filas con ``tenant_id IS NULL`` (usuarios "huérfanos"
  que a veces aparecen en dev) se saltean explícitamente.
* **Solo collaborators.** ``users.role = 'collaborator'``. Los admin de empresa
  ya son superset absoluto — no necesitan filas.

Revision ID: 0049
Revises: 0048
Create Date: 2026-08-23
"""
from alembic import op
import sqlalchemy as sa


revision = "0049"
down_revision = "0048"
branch_labels = None
depends_on = None


BACKFILL_SQL = """
INSERT INTO obra_user_roles (obra_id, user_id, tenant_id, role, created_at, origin)
SELECT
    o.id          AS obra_id,
    u.id          AS user_id,
    o.tenant_id   AS tenant_id,
    'colaborador' AS role,
    NOW()         AS created_at,
    'backfill_fase5' AS origin
FROM users u
JOIN obras o ON o.tenant_id = u.tenant_id
WHERE u.role = 'collaborator'
  AND u.tenant_id IS NOT NULL
ON CONFLICT (obra_id, user_id) DO NOTHING
"""

ROLLBACK_SQL = """
DELETE FROM obra_user_roles
WHERE origin = 'backfill_fase5'
"""


def upgrade() -> None:
    result = op.get_bind().execute(sa.text(BACKFILL_SQL))
    n = getattr(result, "rowcount", -1)
    # Log del conteo — visible en la salida de `alembic upgrade`.
    print(
        f"[fase-5-backfill] filas nuevas insertadas: {n} "
        f"(las que ya existían por invite/asignación manual quedaron intactas)"
    )


def downgrade() -> None:
    result = op.get_bind().execute(sa.text(ROLLBACK_SQL))
    n = getattr(result, "rowcount", -1)
    print(f"[fase-5-rollback] filas eliminadas (origin='backfill_fase5'): {n}")
