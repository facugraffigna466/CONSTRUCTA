from datetime import datetime

from pydantic import BaseModel


class PlanoRead(BaseModel):
    id: int
    obra_id: int
    discipline: str
    name: str | None = None
    version: int
    is_latest: bool
    file_url: str | None = None
    original_filename: str | None = None
    content_type: str | None = None
    file_size: int | None = None
    notes: str | None = None
    uploaded_by: int | None = None
    uploaded_by_name: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}
