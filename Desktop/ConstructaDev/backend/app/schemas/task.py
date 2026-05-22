from datetime import date, datetime, time
from pydantic import BaseModel, Field, model_validator
from app.models.task import TaskStatus


class TaskCreate(BaseModel):
    obra_id: int
    title: str = Field(..., min_length=2, max_length=255)
    description: str | None = None
    responsible_id: int | None = None
    start_date: date | None = None
    start_time: time | None = None
    due_date: date | None = None
    due_time: time | None = None
    order_index: int = Field(default=0, ge=0)
    depends_on_id: int | None = None
    dependency_ids: list[int] | None = None

    @model_validator(mode="after")
    def validate_dates(self) -> "TaskCreate":
        if self.start_date and self.due_date and self.due_date < self.start_date:
            raise ValueError("due_date must be after start_date")
        return self


class TaskUpdate(BaseModel):
    title: str | None = Field(None, min_length=2, max_length=255)
    description: str | None = None
    responsible_id: int | None = None
    start_date: date | None = None
    start_time: time | None = None
    due_date: date | None = None
    due_time: time | None = None
    order_index: int | None = Field(None, ge=0)
    depends_on_id: int | None = None
    dependency_ids: list[int] | None = None

    @model_validator(mode="after")
    def validate_dates(self) -> "TaskUpdate":
        if self.start_date and self.due_date and self.due_date < self.start_date:
            raise ValueError("due_date must be after start_date")
        return self


class TaskRead(BaseModel):
    id: int
    obra_id: int
    title: str
    description: str | None
    status: TaskStatus
    responsible_id: int | None
    start_date: date | None
    start_time: time | None
    due_date: date | None
    due_time: time | None
    completed_date: date | None
    order_index: int
    depends_on_id: int | None
    dependency_ids: list[int] = []
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

    @classmethod
    def model_validate(cls, obj, **kwargs):  # type: ignore[override]
        instance = super().model_validate(obj, **kwargs)
        # Populate dependency_ids from the ORM relationship if available
        if hasattr(obj, "dependencies"):
            instance.dependency_ids = [d.id for d in (obj.dependencies or [])]
        return instance


class TaskDueSoonRead(BaseModel):
    """Used by the n8n integration endpoint GET /tasks/due-soon."""
    id: int
    obra_id: int
    title: str
    status: TaskStatus
    due_date: date | None
    responsible_id: int | None
    responsible_name: str | None
    responsible_whatsapp: str | None


class TaskStatusUpdate(BaseModel):
    """Used by the AI pipeline (Phase 2) — not a public HTTP endpoint."""
    status: TaskStatus
    estimated_progress: int = Field(0, ge=0, le=100)
    completed_date: date | None = None
    triggered_by: str = "system"
    reason: str | None = None
