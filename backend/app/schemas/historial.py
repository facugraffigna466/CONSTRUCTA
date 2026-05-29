from datetime import datetime
from typing import Any
from pydantic import BaseModel


class HistorialEventoRead(BaseModel):
    id: int
    obra_id: int | None
    task_id: int | None
    event_type: str
    description: str
    payload: dict[str, Any] | None
    triggered_by: str
    created_at: datetime

    model_config = {"from_attributes": True}
