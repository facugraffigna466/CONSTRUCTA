from typing import Annotated

from fastapi import APIRouter, Query, status

from app.core.deps import CurrentUser, CurrentUserId, DbSession
from app.core.plan_limits import check_plan_limit
from app.schemas.task import (
    CascadePreviewRequest,
    CascadePreviewResponse,
    TaskCreate,
    TaskDueSoonRead,
    TaskRead,
    TaskStatusUpdate,
    TaskUpdate,
)
from app.services.alert_service import AlertService
from app.services.task_service import TaskService

router = APIRouter(prefix="/tasks", tags=["tasks"])


@router.post("", response_model=TaskRead, status_code=status.HTTP_201_CREATED)
async def create_task(data: TaskCreate, db: DbSession, current_user: CurrentUser):
    await check_plan_limit(db, current_user.tenant_id, "tasks", obra_id=data.obra_id)
    actor = {
        "id": current_user.id,
        "name": current_user.full_name or current_user.email,
        "role": current_user.role,
        "channel": "web",
    }
    return await TaskService(db).create(data, current_user.id, actor=actor)


@router.get("/obra/{obra_id}", response_model=list[TaskRead])
async def list_tasks_for_obra(obra_id: int, db: DbSession, user_id: CurrentUserId):
    tasks = await TaskService(db).list_by_obra(obra_id, user_id)
    await AlertService(db).evaluate_task_risks_for_obra(obra_id)
    return tasks


@router.get("/due-soon", response_model=list[TaskDueSoonRead])
async def list_tasks_due_soon(
    db: DbSession,
    user_id: CurrentUserId,
    days: Annotated[int, Query(ge=1, le=30, description="Look-ahead window in days")] = 2,
):
    """Tasks due within N days for the current manager, with responsible contact info. Used by n8n."""
    return await TaskService(db).list_due_soon(user_id, days)


@router.get("/{task_id}", response_model=TaskRead)
async def get_task(task_id: int, db: DbSession, user_id: CurrentUserId):
    return await TaskService(db).get_for_manager(task_id, user_id)


@router.post("/{task_id}/status", response_model=TaskRead)
async def update_task_status(
    task_id: int, data: TaskStatusUpdate, db: DbSession, user_id: CurrentUserId
):
    """Apply a task status transition. Validates allowed transitions. Used by n8n."""
    return await TaskService(db).apply_status_update_checked(task_id, data, user_id)


@router.post("/{task_id}/cascade-preview", response_model=CascadePreviewResponse)
async def cascade_preview(
    task_id: int, data: CascadePreviewRequest, db: DbSession, user_id: CurrentUserId
):
    """Preview qué tareas dependientes se reprogramarían si esta tarea
    se moviera a las fechas propuestas. No modifica nada."""
    affected = await TaskService(db).cascade_preview(
        task_id, data.start_date, data.due_date, user_id
    )
    return {"affected": affected}


@router.patch("/{task_id}", response_model=TaskRead)
async def update_task(
    task_id: int,
    data: TaskUpdate,
    db: DbSession,
    current_user: CurrentUser,
    cascade_dates: bool = False,
):
    actor = {
        "id": current_user.id,
        "name": current_user.full_name or current_user.email,
        "role": current_user.role,
        "channel": "web",
    }
    return await TaskService(db).update(
        task_id, data, current_user.id, actor=actor, cascade_dates=cascade_dates
    )


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(task_id: int, db: DbSession, current_user: CurrentUser):
    actor = {
        "id": current_user.id,
        "name": current_user.full_name or current_user.email,
        "role": current_user.role,
        "channel": "web",
    }
    await TaskService(db).delete(task_id, current_user.id, actor=actor)
