from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.core.deps import AdminUser, CurrentUser, CurrentUserId, DbSession
from app.core.obra_permissions import (
    assert_obra_access,
    require_obra_role,
    require_task_obra_role,
)
from app.core.plan_limits import check_plan_limit
from app.models.obra_user_role import ObraUserRoleType
from app.models.user import User
from app.schemas.task import (
    BulkTaskCreate,
    BulkTaskResult,
    CascadePreviewRequest,
    CascadePreviewResponse,
    TaskCreate,
    TaskDueSoonRead,
    TaskRead,
    TaskReorder,
    TaskStatusUpdate,
    TaskUpdate,
)
from app.services.alert_service import AlertService
from app.services.task_service import TaskService

router = APIRouter(prefix="/tasks", tags=["tasks"])


@router.post("", response_model=TaskRead, status_code=status.HTTP_201_CREATED)
async def create_task(data: TaskCreate, db: DbSession, current_user: CurrentUser):
    # obra_id viene del body → chequeo con helper, no con la factory (que espera path).
    await assert_obra_access(db, current_user, data.obra_id, ObraUserRoleType.COLABORADOR)
    await check_plan_limit(db, current_user.tenant_id, "tasks", obra_id=data.obra_id)
    actor = {
        "id": current_user.id,
        "name": current_user.full_name or current_user.email,
        "role": current_user.role,
        "channel": "web",
    }
    task = await TaskService(db).create(data, current_user.id, actor=actor)
    # Conversión explícita: FastAPI serializa con el validador core de Pydantic,
    # que NO pasa por el model_validate custom que inyecta _dep_links.
    return TaskRead.model_validate(task)


@router.post("/obra/{obra_id}/bulk", response_model=BulkTaskResult, status_code=status.HTTP_201_CREATED)
async def bulk_create_tasks(
    obra_id: int,
    data: BulkTaskCreate,
    db: DbSession,
    current_user: Annotated[User, Depends(require_obra_role(ObraUserRoleType.JEFE_OBRA))],
):
    """Carga masiva (paste desde Excel): una transacción, un evento de historial."""
    await check_plan_limit(
        db, current_user.tenant_id, "tasks", obra_id=obra_id, requested=len(data.rows)
    )
    actor = {
        "id": current_user.id,
        "name": current_user.full_name or current_user.email,
        "role": current_user.role,
        "channel": "web",
    }
    return await TaskService(db).bulk_create(obra_id, data.rows, current_user.id, actor=actor)


@router.get("/obra/{obra_id}", response_model=list[TaskRead])
async def list_tasks_for_obra(
    obra_id: int,
    db: DbSession,
    current_user: Annotated[User, Depends(require_obra_role(ObraUserRoleType.SOLO_LECTURA))],
):
    tasks = await TaskService(db).list_by_obra(obra_id, current_user.id)
    await AlertService(db).evaluate_task_risks_for_obra(obra_id)
    return [TaskRead.model_validate(t) for t in tasks]


@router.post("/obra/{obra_id}/reorder", status_code=status.HTTP_204_NO_CONTENT)
async def reorder_tasks(
    obra_id: int,
    data: TaskReorder,
    db: DbSession,
    current_user: Annotated[User, Depends(require_obra_role(ObraUserRoleType.COLABORADOR))],
):
    """Reordena las tareas de la obra (lista de IDs). Permite insertar en cualquier posición."""
    await TaskService(db).reorder(obra_id, data.task_ids, current_user.id)


@router.get("/due-soon", response_model=list[TaskDueSoonRead])
async def list_tasks_due_soon(
    db: DbSession,
    user_id: CurrentUserId,
    days: Annotated[int, Query(ge=1, le=30, description="Look-ahead window in days")] = 2,
):
    """Tasks due within N days for the current manager, with responsible contact info. Used by n8n."""
    return await TaskService(db).list_due_soon(user_id, days)


@router.get("/{task_id}", response_model=TaskRead)
async def get_task(
    task_id: int,
    db: DbSession,
    current_user: Annotated[User, Depends(require_task_obra_role(ObraUserRoleType.SOLO_LECTURA))],
):
    return TaskRead.model_validate(await TaskService(db).get_for_manager(task_id, current_user.id))


@router.post("/{task_id}/status", response_model=TaskRead)
async def update_task_status(
    task_id: int,
    data: TaskStatusUpdate,
    db: DbSession,
    current_user: Annotated[User, Depends(require_task_obra_role(ObraUserRoleType.COLABORADOR))],
):
    """Aplica una transición de estado. Valida transiciones permitidas.

    Fase 2: exige rol COLABORADOR o superior en la obra. La regla (c) del
    diseño ("es el responsible asignado a la tarea") queda diferida a la
    Fase 4 — el bot de WhatsApp entra por webhook con firma HMAC, no por
    este endpoint con JWT, así que hoy no hay caso que la requiera."""
    return await TaskService(db).apply_status_update_checked(task_id, data, current_user.id)


@router.post("/{task_id}/cascade-preview", response_model=CascadePreviewResponse)
async def cascade_preview(
    task_id: int,
    data: CascadePreviewRequest,
    db: DbSession,
    current_user: Annotated[User, Depends(require_task_obra_role(ObraUserRoleType.SOLO_LECTURA))],
):
    """Preview qué tareas dependientes se reprogramarían si esta tarea
    se moviera a las fechas propuestas. No modifica nada."""
    affected = await TaskService(db).cascade_preview(
        task_id, data.start_date, data.due_date, current_user.id
    )
    return {"affected": affected}


@router.patch("/{task_id}", response_model=TaskRead)
async def update_task(
    task_id: int,
    data: TaskUpdate,
    db: DbSession,
    current_user: Annotated[User, Depends(require_task_obra_role(ObraUserRoleType.COLABORADOR))],
    cascade_dates: bool = False,
):
    actor = {
        "id": current_user.id,
        "name": current_user.full_name or current_user.email,
        "role": current_user.role,
        "channel": "web",
    }
    task = await TaskService(db).update(
        task_id, data, current_user.id, actor=actor, cascade_dates=cascade_dates
    )
    return TaskRead.model_validate(task)


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(
    task_id: int,
    db: DbSession,
    current_user: Annotated[User, Depends(require_task_obra_role(ObraUserRoleType.JEFE_OBRA))],
):
    actor = {
        "id": current_user.id,
        "name": current_user.full_name or current_user.email,
        "role": current_user.role,
        "channel": "web",
    }
    await TaskService(db).delete(task_id, current_user.id, actor=actor)
