"""
Excel / CSV import service for MS Project integration.

Parses an uploaded file and returns a preview of rows to be confirmed.
Supports .xlsx (openpyxl) and .csv (stdlib csv).
Column detection is automatic, case-insensitive, Spanish and English.
"""
import csv
import io
from datetime import date

import openpyxl

from app.schemas.imports import ImportPreview, ImportPreviewRow

# ── Column alias maps ─────────────────────────────────────────────────────────

_TITLE_ALIASES       = {"nombre", "name", "task name", "tarea", "título", "titulo", "actividad", "task"}
_START_ALIASES       = {"comienzo", "start", "inicio", "fecha inicio", "start date", "fecha de inicio"}
_END_ALIASES         = {"fin", "finish", "vencimiento", "fecha fin", "end", "end date", "due date", "fecha de vencimiento"}
_RESPONSIBLE_ALIASES = {"recursos", "resource names", "responsable", "asignado", "assigned to", "recurso", "resource"}
_PREDECESSOR_ALIASES = {"predecesoras", "predecessors", "dependencia", "depends on", "predecesora", "pred."}

_ALIAS_GROUPS: dict[str, set[str]] = {
    "title":        _TITLE_ALIASES,
    "start_date":   _START_ALIASES,
    "due_date":     _END_ALIASES,
    "responsible":  _RESPONSIBLE_ALIASES,
    "predecessors": _PREDECESSOR_ALIASES,
}


def _detect_column_map(headers: list[str]) -> dict[str, int | None]:
    normalized = [h.strip().lower() for h in headers]
    result: dict[str, int | None] = {}
    for field, aliases in _ALIAS_GROUPS.items():
        idx = next((i for i, h in enumerate(normalized) if h in aliases), None)
        result[field] = idx
    return result


def _parse_date_cell(raw: object) -> date | None:
    """Parse a cell value from openpyxl (may already be a date/datetime) or string."""
    if raw is None:
        return None
    if isinstance(raw, date):
        return raw if isinstance(raw, date) and not hasattr(raw, "hour") else raw.date()  # type: ignore[attr-defined]
    s = str(raw).strip()
    if not s:
        return None
    # ISO: YYYY-MM-DD
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y", "%d-%m-%Y"):
        try:
            from datetime import datetime as _dt
            return _dt.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _parse_predecessor(raw: object) -> int | None:
    if raw is None:
        return None
    s = str(raw).strip()
    import re
    m = re.search(r"\d+", s)
    if not m:
        return None
    row_num = int(m.group())
    return row_num - 1  # 1-based → 0-based


def _rows_from_sheet(sheet) -> tuple[list[str], list[list[object]]]:
    """Return (headers, data_rows) from an openpyxl sheet."""
    rows = list(sheet.iter_rows(values_only=True))
    if not rows:
        return [], []
    headers = [str(c or "") for c in rows[0]]
    data = [list(r) for r in rows[1:] if any(c is not None for c in r)]
    return headers, data


def _rows_from_csv(content: bytes) -> tuple[list[str], list[list[str]]]:
    text = content.decode("utf-8-sig", errors="replace")
    reader = csv.reader(io.StringIO(text))
    rows = list(reader)
    if not rows:
        return [], []
    return rows[0], rows[1:]


def parse_excel(file_bytes: bytes, mime: str) -> ImportPreview:
    if mime == "text/csv" or mime == "application/csv":
        headers, data_rows = _rows_from_csv(file_bytes)
    else:
        wb = openpyxl.load_workbook(io.BytesIO(file_bytes), read_only=True, data_only=True)
        ws = wb.active
        headers, data_rows = _rows_from_sheet(ws)

    col_map = _detect_column_map(headers)
    col_names: dict[str, str] = {
        field: headers[idx] for field, idx in col_map.items() if idx is not None
    }

    preview_rows: list[ImportPreviewRow] = []
    warnings = 0
    errors = 0

    for i, row in enumerate(data_rows):
        def cell(field: str) -> object:
            idx = col_map.get(field)
            if idx is None or idx >= len(row):
                return None
            return row[idx]

        title = str(cell("title") or "").strip()
        if not title:
            errors += 1
            preview_rows.append(ImportPreviewRow(
                row_index=i, title="(sin título)", error="Fila sin título — no se importará."
            ))
            continue

        start_date = _parse_date_cell(cell("start_date"))
        due_date   = _parse_date_cell(cell("due_date"))
        responsible_name = str(cell("responsible") or "").strip() or None
        depends_on_row   = _parse_predecessor(cell("predecessors"))

        row_warnings: list[str] = []
        if cell("start_date") and start_date is None:
            row_warnings.append("Fecha de inicio inválida")
        if cell("due_date") and due_date is None:
            row_warnings.append("Fecha de vencimiento inválida")
        if start_date and due_date and due_date < start_date:
            row_warnings.append("Vencimiento anterior al inicio")

        warning_str = "; ".join(row_warnings) if row_warnings else None
        if warning_str:
            warnings += 1

        preview_rows.append(ImportPreviewRow(
            row_index=i,
            title=title,
            start_date=start_date,
            due_date=due_date,
            responsible_name=responsible_name,
            depends_on_row=depends_on_row,
            warning=warning_str,
        ))

    return ImportPreview(
        rows=preview_rows,
        column_map=col_names,
        total_rows=len(preview_rows),
        warnings=warnings,
        errors=errors,
    )
