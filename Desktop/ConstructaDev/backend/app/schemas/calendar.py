from datetime import date, datetime
from pydantic import BaseModel, field_validator


class CalendarExceptionRead(BaseModel):
    id: int
    calendar_id: int
    date: date
    is_working: bool
    label: str | None

    model_config = {"from_attributes": True}


class CalendarExceptionCreate(BaseModel):
    date: date
    is_working: bool = False
    label: str | None = None


class WorkingCalendarRead(BaseModel):
    id: int
    obra_id: int
    working_days: int
    hour_from: int
    hour_to: int
    created_at: datetime
    updated_at: datetime
    exceptions: list[CalendarExceptionRead] = []

    model_config = {"from_attributes": True}


class WorkingCalendarUpdate(BaseModel):
    working_days: int | None = None
    hour_from: int | None = None
    hour_to: int | None = None

    @field_validator("working_days")
    @classmethod
    def _valid_bitmask(cls, v: int | None) -> int | None:
        if v is not None and not (0 <= v <= 127):
            raise ValueError("working_days must be a 7-bit bitmask (0–127)")
        return v

    @field_validator("hour_from", "hour_to")
    @classmethod
    def _valid_hour(cls, v: int | None) -> int | None:
        if v is not None and not (0 <= v <= 23):
            raise ValueError("Hour must be between 0 and 23")
        return v
