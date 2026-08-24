"""
Import endpoints for MS Project / Excel integration.

POST /api/v1/imports/project-excel        → parse file, return preview
POST /api/v1/imports/project-excel/confirm → create tasks from confirmed preview
"""
import logging

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from app.core.deps import CurrentUser, CurrentUserId, DbSession
from app.core.obra_permissions import assert_obra_access
from app.models.obra_user_role import ObraUserRoleType
from app.repositories.responsible import ResponsibleRepository
from app.repositories.task import TaskRepository
from app.schemas.imports import ImportConfirmPayload, ImportPreview
from app.schemas.task import DependencyLinkInput, TaskCreate
from app.services.import_service import MAX_IMPORT_ROWS, parse_excel, detect_column_mapping_ai
from app.services.task_service import TaskService

logger = logging.getLogger(__name__)

ALLOWED_MIME = {
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "text/csv",
    "application/csv",
    "text/xml",
    "application/xml",
}
MAX_BYTES = 10 * 1024 * 1024  # 10 MB

router = APIRouter(prefix="/imports", tags=["imports"])


@router.post("/project-excel", response_model=ImportPreview)
async def preview_import(
    _: CurrentUserId,
    file: UploadFile = File(...),
    column_map: str | None = Form(default=None),
) -> ImportPreview:
    mime = file.content_type or ""
    filename = file.filename or ""
    if mime not in ALLOWED_MIME and not filename.endswith((".xlsx", ".xls", ".csv", ".xml")):
        raise HTTPException(400, "Solo se aceptan archivos .xlsx, .csv o .xml (MS Project).")

    content = await file.read()
    if len(content) > MAX_BYTES:
        raise HTTPException(400, "El archivo no puede superar 10 MB.")
    if not content:
        raise HTTPException(400, "El archivo está vacío.")

    overrides = None
    if column_map:
        import json
        try:
            overrides = json.loads(column_map)
        except ValueError:
            raise HTTPException(400, "column_map inválido")

    try:
        return parse_excel(content, mime, column_overrides=overrides)
    except ValueError as exc:
        # Errores esperados de archivo malformado → mensaje claro para el usuario.
        raise HTTPException(422, str(exc)) from exc
    except Exception as exc:
        # Fallo inesperado del parser (archivo corrupto, etc.): log interno, mensaje genérico.
        logger.exception("Error inesperado al parsear import (mime=%s, name=%s)", mime, filename)
        raise HTTPException(
            422, "No se pudo procesar el archivo. Verificá que sea un .xlsx, .csv o .xml válido."
        ) from exc


@router.post("/project-excel/confirm")
async def confirm_import(
    payload: ImportConfirmPayload,
    db: DbSession,
    current_user: CurrentUser,
) -> dict:
    if len(payload.rows) > MAX_IMPORT_ROWS:
        raise HTTPException(
            413, f"Demasiadas filas ({len(payload.rows)}); el máximo por importación es {MAX_IMPORT_ROWS}."
        )

    # obra_id viene del body → validamos con el helper (rol JEFE_OBRA porque
    # es equivalente a un bulk_create masivo).
    await assert_obra_access(db, current_user, payload.obra_id, ObraUserRoleType.JEFE_OBRA)

    service = TaskService(db)
    manager_id = current_user.id

    resp_repo = ResponsibleRepository(db)
    task_repo = TaskRepository(db)

    # Build row_index → task_id map for resolving predecessor/parent references
    created_ids: dict[int, int] = {}
    created = 0
    skipped = 0
    errors: list[str] = []

    all_resp = await resp_repo.list_active()
    base_order = len(await task_repo.list_by_obra(payload.obra_id))

    for row in payload.rows:
        if row.error:
            skipped += 1
            continue

        try:
            # Dependencias tipadas (MS Project XML) o legado por fila (Excel/CSV)
            dep_links: list[DependencyLinkInput] = []
            if row.dependency_links:
                for dl in row.dependency_links:
                    if dl.row in created_ids:
                        dep_links.append(DependencyLinkInput(
                            depends_on_id=created_ids[dl.row],
                            dependency_type=dl.dependency_type,
                            lag_days=dl.lag_days,
                        ))
            elif row.depends_on_row is not None and row.depends_on_row in created_ids:
                dep_links.append(DependencyLinkInput(depends_on_id=created_ids[row.depends_on_row]))

            # WBS: tarea padre (las filas padre vienen antes en el archivo)
            parent_task_id: int | None = None
            if row.parent_row is not None and row.parent_row in created_ids:
                parent_task_id = created_ids[row.parent_row]

            # Try to match responsible by name (case-insensitive partial match)
            responsible_id: int | None = None
            if row.responsible_name:
                match = next(
                    (r for r in all_resp if row.responsible_name.lower() in r.full_name.lower()),
                    None,
                )
                if match:
                    responsible_id = match.id

            task_create = TaskCreate(
                obra_id=payload.obra_id,
                title=row.title,
                start_date=row.start_date,
                due_date=row.due_date,
                responsible_id=responsible_id,
                order_index=base_order + created,
                parent_task_id=parent_task_id,
                is_milestone=row.is_milestone,
                dependency_links=dep_links or None,
            )
            task = await service.create(task_create, manager_id)
            created_ids[row.row_index] = task.id
            created += 1

        except Exception as exc:
            errors.append(f"Fila {row.row_index + 1} ({row.title}): {exc}")
            skipped += 1

    return {"created": created, "skipped": skipped, "errors": errors}


@router.post("/detect-mapping")
async def detect_mapping(
    current_user_id: CurrentUserId,
    db: DbSession,
    file: UploadFile = File(...),
) -> dict:
    """Detecta el mapeo de columnas de un archivo Excel/CSV usando IA (con caché).
    Para XML de MS Project retorna 422 indicando que no es necesario."""
    mime = file.content_type or ""
    if mime not in ALLOWED_MIME and not (file.filename or "").endswith((".xlsx", ".xls", ".csv", ".xml")):
        raise HTTPException(400, "Solo se aceptan archivos .xlsx, .csv o .xml.")

    content = await file.read()
    if len(content) > MAX_BYTES:
        raise HTTPException(400, "El archivo no puede superar 10 MB.")

    # Obtener tenant_id del usuario actual
    from sqlalchemy import select
    from app.models.user import User
    user = (await db.execute(select(User).where(User.id == current_user_id))).scalar_one_or_none()
    tenant_id = user.tenant_id if user else None

    try:
        result = await detect_column_mapping_ai(content, mime, tenant_id, db)
        return result
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(500, f"Error al detectar columnas: {exc}") from exc
