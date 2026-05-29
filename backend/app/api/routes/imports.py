"""
Import endpoints for MS Project / Excel integration.

POST /api/v1/imports/project-excel        → parse file, return preview
POST /api/v1/imports/project-excel/confirm → create tasks from confirmed preview
"""
from fastapi import APIRouter, File, HTTPException, UploadFile

from app.core.deps import CurrentUserId, DbSession
from app.repositories.responsible import ResponsibleRepository
from app.repositories.task import TaskRepository
from app.schemas.imports import ImportConfirmPayload, ImportPreview
from app.schemas.task import TaskCreate
from app.services.import_service import parse_excel
from app.services.task_service import TaskService

ALLOWED_MIME = {
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "text/csv",
    "application/csv",
}
MAX_BYTES = 10 * 1024 * 1024  # 10 MB

router = APIRouter(prefix="/imports", tags=["imports"])


@router.post("/project-excel", response_model=ImportPreview)
async def preview_import(
    _: CurrentUserId,
    file: UploadFile = File(...),
) -> ImportPreview:
    mime = file.content_type or ""
    if mime not in ALLOWED_MIME and not file.filename.endswith((".xlsx", ".xls", ".csv")):  # type: ignore[union-attr]
        raise HTTPException(400, "Solo se aceptan archivos .xlsx o .csv.")

    content = await file.read()
    if len(content) > MAX_BYTES:
        raise HTTPException(400, "El archivo no puede superar 10 MB.")

    try:
        return parse_excel(content, mime)
    except Exception as exc:
        raise HTTPException(422, f"No se pudo procesar el archivo: {exc}") from exc


@router.post("/project-excel/confirm")
async def confirm_import(
    payload: ImportConfirmPayload,
    db: DbSession,
    manager_id: CurrentUserId,
) -> dict:
    service = TaskService(db)
    resp_repo = ResponsibleRepository(db)
    task_repo = TaskRepository(db)

    # Build row_index → task_id map for resolving predecessor references
    created_ids: dict[int, int] = {}
    created = 0
    skipped = 0
    errors: list[str] = []

    for row in payload.rows:
        if row.error:
            skipped += 1
            continue

        try:
            # Resolve dependency from row-index reference
            dep_ids: list[int] = []
            if row.depends_on_row is not None and row.depends_on_row in created_ids:
                dep_ids = [created_ids[row.depends_on_row]]

            # Try to match responsible by name (case-insensitive partial match)
            responsible_id: int | None = None
            if row.responsible_name:
                all_resp = await resp_repo.list_active()
                match = next(
                    (r for r in all_resp if row.responsible_name.lower() in r.full_name.lower()),
                    None,
                )
                if match:
                    responsible_id = match.id

            # Count current tasks for order_index
            current_tasks = await task_repo.list_by_obra(payload.obra_id)
            order_index = len(current_tasks) + created

            task_create = TaskCreate(
                obra_id=payload.obra_id,
                title=row.title,
                start_date=row.start_date,
                due_date=row.due_date,
                responsible_id=responsible_id,
                order_index=order_index,
                dependency_ids=dep_ids if dep_ids else None,
            )
            task = await service.create(task_create, manager_id)
            created_ids[row.row_index] = task.id
            created += 1

        except Exception as exc:
            errors.append(f"Fila {row.row_index + 1} ({row.title}): {exc}")
            skipped += 1

    return {"created": created, "skipped": skipped, "errors": errors}
