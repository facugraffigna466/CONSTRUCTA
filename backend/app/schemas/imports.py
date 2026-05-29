from datetime import date
from pydantic import BaseModel


class ImportPreviewRow(BaseModel):
    row_index: int
    title: str
    start_date: date | None = None
    due_date: date | None = None
    responsible_name: str | None = None
    depends_on_row: int | None = None   # 0-based index in the preview rows
    warning: str | None = None          # non-blocking notice
    error: str | None = None            # blocking: row won't be imported


class ImportPreview(BaseModel):
    rows: list[ImportPreviewRow]
    column_map: dict[str, str]          # field → column header detected
    total_rows: int
    warnings: int
    errors: int


class ImportConfirmPayload(BaseModel):
    obra_id: int
    rows: list[ImportPreviewRow]
