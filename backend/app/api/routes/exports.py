"""
Export endpoint — generates an .xlsx file with all tasks for a given obra.

GET /api/v1/exports/obras/{obra_id}/excel
"""
import io
from datetime import date

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from app.core.deps import CurrentUserId, DbSession
from app.repositories.responsible import ResponsibleRepository
from app.repositories.task import TaskRepository

router = APIRouter(prefix="/exports", tags=["exports"])

# ─── Status labels ────────────────────────────────────────────────────────────

STATUS_LABEL = {
    "pendiente":   "Pendiente",
    "en_progreso": "En progreso",
    "bloqueada":   "Bloqueada",
    "completada":  "Completada",
    "cancelada":   "Cancelada",
}

STATUS_COLOR = {
    "pendiente":   "DBEAFE",   # blue-100
    "en_progreso": "FEF3C7",   # amber-100
    "bloqueada":   "FEE2E2",   # red-100
    "completada":  "D1FAE5",   # green-100
    "cancelada":   "F3F4F6",   # gray-100
}

HEADER_FILL  = PatternFill("solid", fgColor="1B1B1A")
HEADER_FONT  = Font(bold=True, color="FFFFFF", size=10)
SUBHEAD_FILL = PatternFill("solid", fgColor="F5F0E8")
SUBHEAD_FONT = Font(bold=True, color="5B6770", size=9)

COLUMNS = [
    ("N°",          6),
    ("Tarea",       42),
    ("Hito",        7),
    ("Responsable", 24),
    ("Inicio",      13),
    ("Vencimiento", 13),
    ("Duración (d)", 13),
    ("Estado",      14),
    ("% Avance",    11),
]


def _fmt_date(d: date | None) -> str:
    return d.strftime("%d/%m/%Y") if d else ""


def _duration(start: date | None, due: date | None) -> int | str:
    if start and due:
        return (due - start).days
    return ""


@router.get("/obras/{obra_id}/excel")
async def export_tasks_excel(
    obra_id: int,
    db: DbSession,
    _user_id: CurrentUserId,
):
    tasks = await TaskRepository(db).list_by_obra(obra_id)
    if not tasks:
        raise HTTPException(404, "No hay tareas para exportar.")

    # Build responsible lookup
    resp_repo  = ResponsibleRepository(db)
    resp_ids   = {t.responsible_id for t in tasks if t.responsible_id}
    resp_names: dict[int, str] = {}
    for rid in resp_ids:
        r = await resp_repo.get(rid)
        if r:
            resp_names[rid] = r.full_name

    wb = Workbook()
    ws = wb.active
    ws.title = "Tareas"

    # ── Header row ────────────────────────────────────────────────────────────
    for col_idx, (label, width) in enumerate(COLUMNS, start=1):
        cell = ws.cell(row=1, column=col_idx, value=label)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = Alignment(horizontal="center", vertical="center")
        ws.column_dimensions[get_column_letter(col_idx)].width = width

    ws.row_dimensions[1].height = 22
    ws.freeze_panes = "A2"

    # ── Task rows ─────────────────────────────────────────────────────────────
    for row_idx, task in enumerate(tasks, start=2):
        status_str = task.status.value if hasattr(task.status, "value") else str(task.status)
        fill_color = STATUS_COLOR.get(status_str, "FFFFFF")
        row_fill   = PatternFill("solid", fgColor=fill_color)

        values = [
            row_idx - 1,
            task.title,
            "◆" if task.is_milestone else "",
            resp_names.get(task.responsible_id, "") if task.responsible_id else "",
            _fmt_date(task.start_date),
            _fmt_date(task.due_date),
            _duration(task.start_date, task.due_date),
            STATUS_LABEL.get(status_str, status_str),
            task.estimated_progress,
        ]

        for col_idx, value in enumerate(values, start=1):
            cell = ws.cell(row=row_idx, column=col_idx, value=value)
            cell.fill = row_fill
            cell.alignment = Alignment(vertical="center")
            cell.font = Font(size=10)

        ws.row_dimensions[row_idx].height = 18

    # Right-align numeric columns (N°, Duración, % Avance)
    for row in ws.iter_rows(min_row=2, max_row=ws.max_row):
        for col in (1, 7, 9):
            row[col - 1].alignment = Alignment(horizontal="right", vertical="center")

    # ── Stream response ───────────────────────────────────────────────────────
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="obra_{obra_id}_tareas.xlsx"'},
    )
