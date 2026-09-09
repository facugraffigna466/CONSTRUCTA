"""Las sugerencias de IA pasan de blob JSON a entidad propia

Hasta acá, cada acción propuesta por la IA vivía como un objeto dentro de
`bitacora_entries.suggestions` (columna JSON) y se resolvía **por índice**:
`POST /bitacora/{id}/suggestions/{idx}/apply`. Eso las dejaba atadas a la
pantalla de bitácora — sin id estable no se pueden consultar por tarea, contar
en SQL ni resolver desde otra pantalla, que es exactamente lo que hace falta
para mostrarlas en la tarea que afectan.

Esta migración crea `suggestions`, migra el contenido del blob preservando el
orden en `order_index` (los endpoints legacy por índice siguen funcionando) y
elimina la columna JSON. No hay período de doble escritura: el backfill es
total y la lectura pasa a la tabla en el mismo deploy.

Dos decisiones que quedan grabadas en el esquema:

- `task_id` y `result_task_id` usan `ON DELETE SET NULL`, no CASCADE: si la
  tarea se borra, la propuesta sigue siendo el registro de lo que se pidió.
  `task_title` guarda el título tal como lo vio la IA para que la fila siga
  siendo legible sin la tarea.
- `source` + `source_entry_id` describen de dónde salió la sugerencia sin que
  la tabla dependa de la bitácora. Un origen nuevo (mensaje de texto, análisis
  de riesgo) se agrega sin tocar a quien las consume.

Revision ID: 0072
Revises: 0071
Create Date: 2026-09-07
"""
import json
from datetime import date

import sqlalchemy as sa
from alembic import op

revision = "0072"
down_revision = "0071"
branch_labels = None
depends_on = None


SUGGESTION_TYPES = ("reschedule_task", "create_task", "update_status", "note")
SUGGESTION_STATUSES = ("pendiente", "aplicada", "descartada")


def _parse(raw) -> list:
    """El blob llega parseado desde Postgres (JSON) y como texto desde SQLite."""
    if not raw:
        return []
    if isinstance(raw, str):
        try:
            return json.loads(raw) or []
        except ValueError:
            return []
    return raw if isinstance(raw, list) else []


def _date_or_none(value):
    """Las fechas venían como texto libre de la IA — descartamos lo que no parsea."""
    if not value or not isinstance(value, str):
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def upgrade() -> None:
    op.create_table(
        "suggestions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id"), nullable=True),
        sa.Column(
            "obra_id",
            sa.Integer(),
            sa.ForeignKey("obras.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("source", sa.String(20), nullable=False, server_default="bitacora"),
        sa.Column(
            "source_entry_id",
            sa.Integer(),
            sa.ForeignKey("bitacora_entries.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("order_index", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "type",
            sa.Enum(*SUGGESTION_TYPES, name="suggestion_type"),
            nullable=False,
        ),
        sa.Column(
            "task_id",
            sa.Integer(),
            sa.ForeignKey("tasks.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("task_title", sa.String(255), nullable=True),
        sa.Column("new_start_date", sa.Date(), nullable=True),
        sa.Column("new_due_date", sa.Date(), nullable=True),
        sa.Column("new_status", sa.String(30), nullable=True),
        sa.Column("title", sa.String(255), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("responsible_name", sa.String(255), nullable=True),
        sa.Column("reason", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "status",
            sa.Enum(*SUGGESTION_STATUSES, name="suggestion_status"),
            nullable=False,
            server_default="pendiente",
        ),
        sa.Column(
            "result_task_id",
            sa.Integer(),
            sa.ForeignKey("tasks.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("result_note", sa.Text(), nullable=True),
        sa.Column(
            "resolved_by",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_suggestions_tenant_id", "suggestions", ["tenant_id"])
    op.create_index("ix_suggestions_obra_id", "suggestions", ["obra_id"])
    op.create_index("ix_suggestions_source_entry_id", "suggestions", ["source_entry_id"])
    op.create_index("ix_suggestions_task_id", "suggestions", ["task_id"])
    op.create_index("ix_suggestions_result_task_id", "suggestions", ["result_task_id"])
    op.create_index("ix_suggestions_status", "suggestions", ["status"])
    # El acceso caliente es "sugerencias pendientes de esta tarea" (la tarjeta
    # dentro de la tarea) y "pendientes de esta obra" (el badge del menú).
    op.create_index("ix_suggestions_task_status", "suggestions", ["task_id", "status"])
    op.create_index("ix_suggestions_obra_status", "suggestions", ["obra_id", "status"])

    _backfill_from_blob()

    op.drop_column("bitacora_entries", "suggestions")


def _backfill_from_blob() -> None:
    conn = op.get_bind()
    entries = conn.execute(
        sa.text(
            "SELECT id, tenant_id, obra_id, suggestions, created_at "
            "FROM bitacora_entries WHERE suggestions IS NOT NULL"
        )
    ).mappings().all()

    rows = []
    for entry in entries:
        for idx, s in enumerate(_parse(entry["suggestions"])):
            if not isinstance(s, dict):
                continue
            stype = s.get("type")
            if stype not in SUGGESTION_TYPES:
                # Tipo desconocido (modelo viejo o dato corrupto): se registra
                # como nota para no perder el texto del acuerdo.
                stype = "note"
            if s.get("applied"):
                status = "aplicada"
            elif s.get("dismissed"):
                status = "descartada"
            else:
                status = "pendiente"
            rows.append(
                {
                    "tenant_id": entry["tenant_id"],
                    "obra_id": entry["obra_id"],
                    "source": "bitacora",
                    "source_entry_id": entry["id"],
                    "order_index": idx,
                    "type": stype,
                    "task_id": s.get("task_id"),
                    "task_title": (s.get("task_title") or None),
                    "new_start_date": _date_or_none(s.get("new_start_date")),
                    "new_due_date": _date_or_none(s.get("new_due_date")),
                    "new_status": s.get("new_status"),
                    "title": s.get("title"),
                    "description": s.get("description"),
                    "responsible_name": s.get("responsible_name"),
                    "reason": s.get("reason") or "",
                    "status": status,
                    "result_task_id": s.get("result_task_id"),
                    "result_note": s.get("result_note"),
                    # No hay registro histórico de quién resolvió cada sugerencia
                    # (el blob no lo guardaba); queda en NULL a propósito.
                    "resolved_by": None,
                    "resolved_at": entry["created_at"] if status != "pendiente" else None,
                    "created_at": entry["created_at"],
                }
            )

    if not rows:
        return

    conn.execute(
        sa.text(
            "INSERT INTO suggestions ("
            "tenant_id, obra_id, source, source_entry_id, order_index, type, "
            "task_id, task_title, new_start_date, new_due_date, new_status, "
            "title, description, responsible_name, reason, status, "
            "result_task_id, result_note, resolved_by, resolved_at, created_at"
            ") VALUES ("
            ":tenant_id, :obra_id, :source, :source_entry_id, :order_index, :type, "
            ":task_id, :task_title, :new_start_date, :new_due_date, :new_status, "
            ":title, :description, :responsible_name, :reason, :status, "
            ":result_task_id, :result_note, :resolved_by, :resolved_at, :created_at)"
        ),
        rows,
    )


def downgrade() -> None:
    op.add_column("bitacora_entries", sa.Column("suggestions", sa.JSON(), nullable=True))

    conn = op.get_bind()
    rows = conn.execute(
        sa.text(
            "SELECT source_entry_id, order_index, type, task_id, task_title, "
            "new_start_date, new_due_date, new_status, title, description, "
            "responsible_name, reason, status, result_task_id, result_note "
            "FROM suggestions WHERE source_entry_id IS NOT NULL "
            "ORDER BY source_entry_id, order_index"
        )
    ).mappings().all()

    by_entry: dict[int, list] = {}
    for r in rows:
        by_entry.setdefault(r["source_entry_id"], []).append(
            {
                "type": r["type"],
                "task_id": r["task_id"],
                "task_title": r["task_title"],
                "new_start_date": r["new_start_date"].isoformat() if r["new_start_date"] else None,
                "new_due_date": r["new_due_date"].isoformat() if r["new_due_date"] else None,
                "new_status": r["new_status"],
                "title": r["title"],
                "description": r["description"],
                "responsible_name": r["responsible_name"],
                "reason": r["reason"] or "",
                "applied": r["status"] == "aplicada",
                "dismissed": r["status"] == "descartada",
                "result_task_id": r["result_task_id"],
                "result_note": r["result_note"],
            }
        )

    # Tabla mínima tipada para que el JSON se serialice según el dialecto
    # (un str crudo no castea solo a la columna json de Postgres).
    entries_tbl = sa.table(
        "bitacora_entries",
        sa.column("id", sa.Integer),
        sa.column("suggestions", sa.JSON),
    )
    for entry_id, suggestions in by_entry.items():
        conn.execute(
            entries_tbl.update()
            .where(entries_tbl.c.id == entry_id)
            .values(suggestions=suggestions)
        )

    op.drop_table("suggestions")
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        sa.Enum(name="suggestion_type").drop(bind, checkfirst=True)
        sa.Enum(name="suggestion_status").drop(bind, checkfirst=True)
