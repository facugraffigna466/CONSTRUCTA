from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.calendar import CalendarException, WorkingCalendar


def _default_calendar(obra_id: int) -> WorkingCalendar:
    return WorkingCalendar(obra_id=obra_id, working_days=63, hour_from=7, hour_to=18)


class CalendarRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_for_obra(self, obra_id: int) -> WorkingCalendar:
        result = await self.session.execute(
            select(WorkingCalendar)
            .where(WorkingCalendar.obra_id == obra_id)
            .options(selectinload(WorkingCalendar.exceptions))
        )
        cal = result.scalar_one_or_none()
        if cal is None:
            cal = _default_calendar(obra_id)
            cal.exceptions = []
        return cal

    async def get_or_create(self, obra_id: int) -> WorkingCalendar:
        result = await self.session.execute(
            select(WorkingCalendar)
            .where(WorkingCalendar.obra_id == obra_id)
            .options(selectinload(WorkingCalendar.exceptions))
        )
        cal = result.scalar_one_or_none()
        if cal is None:
            cal = WorkingCalendar(obra_id=obra_id)
            self.session.add(cal)
            await self.session.commit()
            await self.session.refresh(cal)
            cal.exceptions = []
        return cal

    async def update(self, obra_id: int, data: dict) -> WorkingCalendar:
        cal = await self.get_or_create(obra_id)
        for field, value in data.items():
            setattr(cal, field, value)
        await self.session.commit()
        await self.session.refresh(cal)
        return await self.get_for_obra(obra_id)

    async def add_exception(self, obra_id: int, exc_date: date, is_working: bool, label: str | None) -> CalendarException:
        cal = await self.get_or_create(obra_id)
        # Upsert: if same date exists, update it
        result = await self.session.execute(
            select(CalendarException)
            .where(CalendarException.calendar_id == cal.id, CalendarException.date == exc_date)
        )
        exc = result.scalar_one_or_none()
        if exc:
            exc.is_working = is_working
            exc.label = label
        else:
            exc = CalendarException(calendar_id=cal.id, date=exc_date, is_working=is_working, label=label)
            self.session.add(exc)
        await self.session.commit()
        await self.session.refresh(exc)
        return exc

    async def delete_exception(self, obra_id: int, exception_id: int) -> bool:
        cal = await self.get_or_create(obra_id)
        result = await self.session.execute(
            select(CalendarException)
            .where(CalendarException.id == exception_id, CalendarException.calendar_id == cal.id)
        )
        exc = result.scalar_one_or_none()
        if not exc:
            return False
        await self.session.delete(exc)
        await self.session.commit()
        return True

    async def bulk_add_exceptions(self, obra_id: int, exceptions: list[dict]) -> int:
        """Add multiple exceptions, skipping duplicates."""
        cal = await self.get_or_create(obra_id)
        added = 0
        for item in exceptions:
            result = await self.session.execute(
                select(CalendarException)
                .where(CalendarException.calendar_id == cal.id, CalendarException.date == item["date"])
            )
            if result.scalar_one_or_none() is None:
                self.session.add(CalendarException(
                    calendar_id=cal.id,
                    date=item["date"],
                    is_working=item.get("is_working", False),
                    label=item.get("label"),
                ))
                added += 1
        await self.session.commit()
        return added
