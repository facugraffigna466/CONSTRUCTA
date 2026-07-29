from fastapi import APIRouter
from app.core.deps import CurrentUserId, DbSession
from app.services.task_service import TaskService

router = APIRouter(prefix="/obras", tags=["critical-path"])


@router.get("/{obra_id}/critical-path")
async def get_critical_path(obra_id: int, db: DbSession, user_id: CurrentUserId):
    """
    Returns the critical path for an obra using CPM.
    critical_task_ids: tasks with float == 0 (any delay delays the project).
    float_by_task: total float in days for every scheduled task.
    tasks_without_dates: task ids excluded from the CPM because they lack
      start/finish dates (so the UI can warn the result is partial).
    """
    return await TaskService(db).compute_critical_path(obra_id, user_id)
