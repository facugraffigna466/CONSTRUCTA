import re
from datetime import date, datetime
from pydantic import BaseModel, Field, field_validator


_E164_RE = re.compile(r"^\+\d{7,15}$")


class ResponsibleCreate(BaseModel):
    full_name: str = Field(..., min_length=2, max_length=255)
    whatsapp_number: str = Field(..., description="E.164 format: +5491112345678")
    role: str | None = Field(None, max_length=100)

    @field_validator("whatsapp_number")
    @classmethod
    def validate_phone(cls, v: str) -> str:
        if not _E164_RE.match(v):
            raise ValueError("whatsapp_number must be in E.164 format: +5491112345678")
        return v


class ResponsibleUpdate(BaseModel):
    full_name: str | None = Field(None, min_length=2, max_length=255)
    role: str | None = Field(None, max_length=100)
    # whatsapp_number is NOT updatable — it is the chatbot identity


class ResponsibleRead(BaseModel):
    id: int
    full_name: str
    whatsapp_number: str
    role: str | None
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class ActiveTaskBrief(BaseModel):
    id: int
    obra_id: int
    title: str
    status: str
    due_date: date | None
    estimated_progress: int

    model_config = {"from_attributes": True}


class ResponsibleWithTasksRead(ResponsibleRead):
    active_tasks: list[ActiveTaskBrief]
