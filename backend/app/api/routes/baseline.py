from datetime import date, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel
from sqlalchemy import delete, select

from app.core.deps import DbSession
from app.core.obra_permissions import require_obra_role
from app.core.tenant_denorm import tenant_for_obra
from app.models.baseline import TaskBaseline
from app.models.obra_user_role import ObraUserRoleType
from app.models.user import User
from app.services.task_service import TaskService

router = APIRouter(prefix="/obras", tags=["baseline"])


class BaselineEntry(BaseModel):
    task_id: int
    baseline_start: date | None
    baseline_finish: date | None


class BaselineResponse(BaseModel):
    obra_id: int
    saved_at: datetime | None
    entries: list[BaselineEntry]


@router.post("/{obra_id}/baseline", response_model=BaselineResponse, status_code=status.HTTP_201_CREATED)
async def save_baseline(
    obra_id: int,
    db: DbSession,
    current_user: Annotated[User, Depends(require_obra_role(ObraUserRoleType.JEFE_OBRA))],
):
    """Snapshot current task dates as the baseline for this obra. Replaces any existing baseline."""
    tasks = await TaskService(db).list_by_obra(obra_id, current_user.id)

    await db.execute(delete(TaskBaseline).where(TaskBaseline.obra_id == obra_id))

    now = None
    bl_tenant = await tenant_for_obra(db, obra_id)
    entries: list[BaselineEntry] = []
    for task in tasks:
        entry = TaskBaseline(
            obra_id=obra_id,
            tenant_id=bl_tenant,
            task_id=task.id,
            baseline_start=task.start_date,
            baseline_finish=task.due_date,
        )
        db.add(entry)
        entries.append(BaselineEntry(task_id=task.id, baseline_start=task.start_date, baseline_finish=task.due_date))

    await db.commit()

    # Get saved_at from first inserted row
    result = await db.execute(
        select(TaskBaseline.saved_at).where(TaskBaseline.obra_id == obra_id).limit(1)
    )
    row = result.first()
    now = row[0] if row else None

    return BaselineResponse(obra_id=obra_id, saved_at=now, entries=entries)


@router.get("/{obra_id}/baseline", response_model=BaselineResponse)
async def get_baseline(
    obra_id: int,
    db: DbSession,
    current_user: Annotated[User, Depends(require_obra_role(ObraUserRoleType.SOLO_LECTURA))],
):
    """Return the latest saved baseline for this obra."""
    result = await db.execute(
        select(TaskBaseline).where(TaskBaseline.obra_id == obra_id).order_by(TaskBaseline.saved_at.desc())
    )
    rows = result.scalars().all()

    saved_at = rows[0].saved_at if rows else None
    entries = [BaselineEntry(task_id=r.task_id, baseline_start=r.baseline_start, baseline_finish=r.baseline_finish) for r in rows]

    return BaselineResponse(obra_id=obra_id, saved_at=saved_at, entries=entries)
