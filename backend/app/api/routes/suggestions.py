"""
Sugerencias de IA sobre el plan de obra — acceso por id, desde cualquier pantalla.

GET  /suggestions?obra_id=&status=        → sugerencias de una obra
GET  /suggestions/pending-count?obra_id=  → contador para badges
GET  /tasks/{task_id}/suggestions         → las que afectan a esa tarea
POST /suggestions/{id}/apply              → aplicar (con ajustes opcionales)
POST /suggestions/{id}/dismiss            → descartar

Las rutas equivalentes bajo `/bitacora/{id}/suggestions/{idx}` siguen existiendo
y resuelven contra las mismas filas: direccionan por posición dentro de la nota
en vez de por id. Estas son las que puede usar cualquier pantalla que no tenga
la entrada de bitácora a mano — que es el punto de que la sugerencia sea una
entidad y no un objeto anidado.
"""
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.core.deps import CurrentUser, DbSession
from app.core.obra_permissions import (
    assert_obra_access,
    require_suggestion_obra_role,
    require_task_obra_role,
)
from app.models.obra_user_role import ObraUserRoleType
from app.models.suggestion import SuggestionStatus
from app.models.user import User
from app.schemas.suggestion import SuggestionEdit, SuggestionRead
from app.services.suggestion_service import SuggestionService

router = APIRouter(tags=["suggestions"])


async def _to_read(service: SuggestionService, rows: list) -> list[SuggestionRead]:
    """Serializa agregando el contexto de origen (obra, resumen, quién reportó)."""
    out: list[SuggestionRead] = []
    for item in await service.decorate(rows):
        data = SuggestionRead.model_validate(item["row"])
        data.obra_name = item["obra_name"]
        data.entry_summary = item["entry_summary"]
        data.reporter_name = item["reporter_name"]
        out.append(data)
    return out


@router.get("/suggestions", response_model=list[SuggestionRead])
async def list_suggestions(
    db: DbSession,
    current_user: CurrentUser,
    obra_id: int = Query(..., description="Obra de la que se piden las sugerencias"),
    status: SuggestionStatus | None = None,
    limit: int = 200,
):
    await assert_obra_access(db, current_user, obra_id, ObraUserRoleType.SOLO_LECTURA)
    service = SuggestionService(db)
    rows = await service.list_for_obra(obra_id, status=status, limit=limit)
    return await _to_read(service, rows)


@router.get("/suggestions/pending-count")
async def pending_count(
    db: DbSession, current_user: CurrentUser, obra_id: int | None = None
) -> dict[str, int]:
    if obra_id is not None:
        await assert_obra_access(db, current_user, obra_id, ObraUserRoleType.SOLO_LECTURA)
    count = await SuggestionService(db).pending_count(
        tenant_id=current_user.tenant_id, obra_id=obra_id
    )
    return {"count": count}


@router.get("/tasks/{task_id}/suggestions", response_model=list[SuggestionRead])
async def list_for_task(
    task_id: int,
    db: DbSession,
    current_user: Annotated[User, Depends(require_task_obra_role(ObraUserRoleType.SOLO_LECTURA))],
    status: SuggestionStatus | None = None,
):
    """Lo que la IA propuso sobre esta tarea. Por defecto devuelve todo; la
    tarjeta dentro de la tarea pide `status=pendiente`."""
    service = SuggestionService(db)
    rows = await service.list_for_task(task_id, status=status)
    return await _to_read(service, rows)


@router.post("/suggestions/{suggestion_id}/apply", response_model=SuggestionRead)
async def apply_suggestion(
    suggestion_id: int,
    db: DbSession,
    current_user: Annotated[
        User, Depends(require_suggestion_obra_role(ObraUserRoleType.COLABORADOR))
    ],
    edits: SuggestionEdit | None = None,
):
    actor = {
        "id": current_user.id,
        "name": current_user.full_name or current_user.email,
        "role": current_user.role,
        "channel": "sugerencia",
    }
    service = SuggestionService(db)
    row = await service.get_or_raise(suggestion_id)
    await service.apply(
        row,
        current_user.id,
        actor=actor,
        edits=edits.model_dump(exclude_unset=True) if edits else None,
    )
    return (await _to_read(service, [row]))[0]


@router.post("/suggestions/{suggestion_id}/dismiss", response_model=SuggestionRead)
async def dismiss_suggestion(
    suggestion_id: int,
    db: DbSession,
    current_user: Annotated[
        User, Depends(require_suggestion_obra_role(ObraUserRoleType.COLABORADOR))
    ],
):
    service = SuggestionService(db)
    row = await service.get_or_raise(suggestion_id)
    await service.dismiss(row, current_user.id)
    return (await _to_read(service, [row]))[0]
