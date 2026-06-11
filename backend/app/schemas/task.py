from datetime import date, datetime, time
from pydantic import BaseModel, Field, model_validator
from app.models.task import TaskStatus


class DependencyLinkInput(BaseModel):
    depends_on_id: int
    dependency_type: str = "FS"
    lag_days: int = Field(default=0, ge=-365, le=365)


class DependencyLink(BaseModel):
    depends_on_id: int
    dependency_type: str
    lag_days: int


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
    parent_task_id: int | None = None
    depends_on_id: int | None = None
    dependency_links: list[DependencyLinkInput] | None = None
    is_milestone: bool = False
    estimated_progress: int = Field(default=0, ge=0, le=100)

    @model_validator(mode="after")
    def validate_dates(self) -> "TaskCreate":
        if self.start_date and self.due_date and self.due_date < self.start_date:
            raise ValueError("La fecha de vencimiento debe ser posterior a la fecha de inicio.")
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
    parent_task_id: int | None = None
    depends_on_id: int | None = None
    dependency_links: list[DependencyLinkInput] | None = None
    is_milestone: bool | None = None
    estimated_progress: int | None = Field(None, ge=0, le=100)

    @model_validator(mode="after")
    def validate_dates(self) -> "TaskUpdate":
        if self.start_date and self.due_date and self.due_date < self.start_date:
            raise ValueError("La fecha de vencimiento debe ser posterior a la fecha de inicio.")
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
    parent_task_id: int | None = None
    depends_on_id: int | None
    dependency_ids: list[int] = []
    dependency_links: list[DependencyLink] = []
    is_milestone: bool = False
    estimated_progress: int = 0
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

    @classmethod
    def model_validate(cls, obj, **kwargs):  # type: ignore[override]
        instance = super().model_validate(obj, **kwargs)
        if hasattr(obj, "_dep_links"):
            links = obj._dep_links or []
            instance.dependency_ids = [l["depends_on_id"] for l in links]
            instance.dependency_links = [DependencyLink(**l) for l in links]
        elif hasattr(obj, "dependencies"):
            instance.dependency_ids = [d.id for d in (obj.dependencies or [])]
            instance.dependency_links = [
                DependencyLink(depends_on_id=d.id, dependency_type="FS", lag_days=0)
                for d in (obj.dependencies or [])
            ]
        return instance


class CascadePreviewRequest(BaseModel):
    """Proposed new dates for a task, to preview the downstream impact."""
    start_date: date | None = None
    due_date: date | None = None


class CascadeAffectedTask(BaseModel):
    task_id: int
    title: str
    old_start: date | None
    old_due: date | None
    new_start: date | None
    new_due: date | None


class CascadePreviewResponse(BaseModel):
    affected: list[CascadeAffectedTask]


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
