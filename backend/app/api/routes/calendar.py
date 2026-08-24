from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.deps import DbSession
from app.core.obra_permissions import require_obra_role
from app.models.obra_user_role import ObraUserRoleType
from app.models.user import User
from app.repositories.calendar import CalendarRepository
from app.schemas.calendar import (
    CalendarExceptionCreate,
    CalendarExceptionRead,
    WorkingCalendarRead,
    WorkingCalendarUpdate,
)
from app.services.calendar_service import get_ar_holidays

router = APIRouter(prefix="/obras/{obra_id}/calendar", tags=["calendar"])


@router.get("", response_model=WorkingCalendarRead)
async def get_calendar(
    obra_id: int,
    db: DbSession,
    current_user: Annotated[User, Depends(require_obra_role(ObraUserRoleType.SOLO_LECTURA))],
) -> WorkingCalendarRead:
    cal = await CalendarRepository(db).get_for_obra(obra_id)
    return WorkingCalendarRead.model_validate(cal)


@router.put("", response_model=WorkingCalendarRead)
async def update_calendar(
    obra_id: int,
    data: WorkingCalendarUpdate,
    db: DbSession,
    current_user: Annotated[User, Depends(require_obra_role(ObraUserRoleType.JEFE_OBRA))],
) -> WorkingCalendarRead:
    updates = data.model_dump(exclude_none=True)
    cal = await CalendarRepository(db).update(obra_id, updates)
    return WorkingCalendarRead.model_validate(cal)


@router.post("/exceptions", response_model=CalendarExceptionRead, status_code=201)
async def add_exception(
    obra_id: int,
    body: CalendarExceptionCreate,
    db: DbSession,
    current_user: Annotated[User, Depends(require_obra_role(ObraUserRoleType.JEFE_OBRA))],
) -> CalendarExceptionRead:
    exc = await CalendarRepository(db).add_exception(
        obra_id=obra_id,
        exc_date=body.date,
        is_working=body.is_working,
        label=body.label,
    )
    return CalendarExceptionRead.model_validate(exc)


@router.delete("/exceptions/{exception_id}", status_code=204)
async def delete_exception(
    obra_id: int,
    exception_id: int,
    db: DbSession,
    current_user: Annotated[User, Depends(require_obra_role(ObraUserRoleType.JEFE_OBRA))],
) -> None:
    deleted = await CalendarRepository(db).delete_exception(obra_id, exception_id)
    if not deleted:
        raise HTTPException(404, "Excepción no encontrada.")


@router.post("/load-holidays", response_model=dict)
async def load_holidays(
    obra_id: int,
    db: DbSession,
    current_user: Annotated[User, Depends(require_obra_role(ObraUserRoleType.JEFE_OBRA))],
    year: int = Query(2026),
) -> dict:
    holidays = get_ar_holidays(year)
    if not holidays:
        raise HTTPException(400, f"No hay feriados precargados para el año {year}.")
    added = await CalendarRepository(db).bulk_add_exceptions(obra_id, holidays)
    return {"loaded": len(holidays), "added": added, "skipped": len(holidays) - added}
