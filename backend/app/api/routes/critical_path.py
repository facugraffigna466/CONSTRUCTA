from typing import Annotated

from fastapi import APIRouter, Depends

from app.core.deps import DbSession
from app.core.obra_permissions import require_obra_role
from app.models.obra_user_role import ObraUserRoleType
from app.models.user import User
from app.services.task_service import TaskService

router = APIRouter(prefix="/obras", tags=["critical-path"])


@router.get("/{obra_id}/critical-path")
async def get_critical_path(
    obra_id: int,
    db: DbSession,
    current_user: Annotated[User, Depends(require_obra_role(ObraUserRoleType.SOLO_LECTURA))],
):
    """
    Returns the critical path for an obra using CPM.
    critical_task_ids: tasks with float == 0 (any delay delays the project).
    float_by_task: total float in days for every scheduled task.
    tasks_without_dates: task ids excluded from the CPM because they lack
      start/finish dates (so the UI can warn the result is partial).
    """
    return await TaskService(db).compute_critical_path(obra_id, current_user.id)
