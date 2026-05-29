from datetime import date, datetime
from pydantic import BaseModel, Field, model_validator
from app.models.obra import ObraStatus


class ObraCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=255)
    description: str | None = None
    location: str | None = None
    image_url: str | None = None
    start_date: date | None = None
    expected_end_date: date | None = None

    @model_validator(mode="after")
    def end_after_start(self) -> "ObraCreate":
        if self.start_date and self.expected_end_date:
            if self.expected_end_date < self.start_date:
                raise ValueError("expected_end_date must be after start_date")
        return self


class ObraUpdate(BaseModel):
    name: str | None = Field(None, min_length=2, max_length=255)
    description: str | None = None
    location: str | None = None
    image_url: str | None = None
    status: ObraStatus | None = None
    start_date: date | None = None
    expected_end_date: date | None = None
    actual_end_date: date | None = None

    @model_validator(mode="after")
    def validate_dates(self) -> "ObraUpdate":
        s, e, a = self.start_date, self.expected_end_date, self.actual_end_date
        if s and e and e < s:
            raise ValueError("expected_end_date must be after start_date")
        if s and a and a < s:
            raise ValueError("actual_end_date must be after start_date")
        return self


class ObraRead(BaseModel):
    id: int
    name: str
    description: str | None
    location: str | None
    image_url: str | None
    status: ObraStatus
    manager_id: int
    start_date: date | None
    expected_end_date: date | None
    actual_end_date: date | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ObraSummary(BaseModel):
    """Lightweight — for list endpoints."""
    id: int
    name: str
    status: ObraStatus
    location: str | None
    image_url: str | None
    start_date: date | None
    expected_end_date: date | None
    actual_end_date: date | None
    manager_id: int
    completed_tasks: int = 0
    total_tasks: int = 0

    model_config = {"from_attributes": True}
