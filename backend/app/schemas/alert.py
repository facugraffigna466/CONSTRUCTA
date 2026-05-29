from datetime import datetime
from pydantic import BaseModel
from app.models.alert import AlertType


class AlertRead(BaseModel):
    id: int
    obra_id: int | None
    task_id: int | None
    type: AlertType
    message: str
    is_read: bool
    created_at: datetime

    model_config = {"from_attributes": True}
