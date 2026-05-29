from datetime import date, datetime
from pydantic import BaseModel, Field
from app.models.obra import ObraStatus


class ObraBase(BaseModel):
    name: str = Field(..., min_length=2, max_length=255)
    description: str | None = None
    location: str | None = None
    start_date: date | None = None
    expected_end_date: date | None = None


class ObraCreate(ObraBase):
    pass


class ObraUpdate(BaseModel):
    name: str | None = Field(None, min_length=2, max_length=255)
    description: str | None = None
    location: str | None = None
    status: ObraStatus | None = None
    start_date: date | None = None
    expected_end_date: date | None = None
    actual_end_date: date | None = None


class ObraRead(ObraBase):
    id: int
    status: ObraStatus
    manager_id: int
    actual_end_date: date | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ObraSummary(BaseModel):
    """Lightweight version for list endpoints and Gantt."""
    id: int
    name: str
    status: ObraStatus
    start_date: date | None
    expected_end_date: date | None
    manager_id: int

    model_config = {"from_attributes": True}
