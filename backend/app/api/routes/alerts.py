from typing import Annotated

from fastapi import APIRouter, Query

from app.core.deps import CurrentUserId, DbSession
from app.schemas.alert import AlertRead
from app.services.alert_service import AlertService

router = APIRouter(prefix="/alerts", tags=["alerts"])


@router.get("", response_model=list[AlertRead])
async def list_alerts(
    db: DbSession,
    _: CurrentUserId,
    unread_only: Annotated[bool, Query()] = False,
):
    return await AlertService(db).list_all(unread_only=unread_only)


@router.patch("/{alert_id}/read", response_model=AlertRead)
async def mark_alert_read(alert_id: int, db: DbSession, _: CurrentUserId):
    return await AlertService(db).mark_read(alert_id)
