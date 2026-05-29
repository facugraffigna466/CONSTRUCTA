from typing import Annotated

from fastapi import APIRouter, Query

from app.core.deps import DbSession, InternalAuth
from app.services.notification_service import NotificationService

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.post("/send-reminders")
async def send_reminders(
    db: DbSession,
    _: InternalAuth,
    hours_ahead: Annotated[int, Query(ge=1, le=168, description="Hours ahead to target (e.g. 24 or 72)")] = 24,
) -> dict:
    """Send proactive WhatsApp reminders for tasks due in ~hours_ahead hours. Called by scheduler."""
    count = await NotificationService(db).send_reminders(hours_ahead)
    return {"messages_sent": count}


@router.post("/mark-overdue")
async def mark_overdue(db: DbSession, _: InternalAuth) -> dict:
    """Generate TASK_OVERDUE alerts for tasks past their due_date. Called by n8n."""
    count = await NotificationService(db).mark_overdue_tasks()
    return {"alerts_created": count}


@router.post("/check-no-response")
async def check_no_response(
    db: DbSession,
    _: InternalAuth,
    timeout_hours: Annotated[int | None, Query(ge=1, le=72)] = None,
) -> dict:
    """Generate NO_RESPONSE alerts for unanswered reminders.
    Uses max_response_hours from SystemSettings when timeout_hours is omitted."""
    count = await NotificationService(db).mark_no_response(timeout_hours)
    return {"alerts_created": count}
