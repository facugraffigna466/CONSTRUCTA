from datetime import date, datetime
from pydantic import BaseModel, Field, field_validator
from app.models.task import TaskStatus


class TaskBase(BaseModel):
    title: str = Field(..., min_length=2, max_length=255)
    description: str | None = None
    responsible_id: int | None = None
    start_date: date | None = None
    due_date: date | None = None
    order_index: int = 0
    depends_on_id: int | None = None


class TaskCreate(TaskBase):
    obra_id: int

    @field_validator("due_date")
    @classmethod
    def due_after_start(cls, v, info):
        start = info.data.get("start_date")
        if v and start and v < start:
            raise ValueError("due_date must be after start_date")
        return v


class TaskUpdate(BaseModel):
    title: str | None = Field(None, min_length=2, max_length=255)
    description: str | None = None
    responsible_id: int | None = None
    start_date: date | None = None
    due_date: date | None = None
    order_index: int | None = None
    depends_on_id: int | None = None


class TaskRead(TaskBase):
    id: int
    obra_id: int
    status: TaskStatus
    estimated_progress: int
    completed_date: date | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class TaskStatusUpdate(BaseModel):
    """Used internally by the AI pipeline — not exposed as a public endpoint."""
    status: TaskStatus
    estimated_progress: int = Field(ge=0, le=100)
    completed_date: date | None = None
    triggered_by: str = "system"
    reason: str | None = None
