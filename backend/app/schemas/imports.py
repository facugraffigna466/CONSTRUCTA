from datetime import date
from pydantic import BaseModel


class ImportDepLink(BaseModel):
    """Dependencia tipada hacia otra fila del preview (0-based)."""
    row: int
    dependency_type: str = "FS"   # FS / SS / FF / SF
    lag_days: int = 0


class ImportPreviewRow(BaseModel):
    row_index: int
    title: str
    start_date: date | None = None
    due_date: date | None = None
    responsible_name: str | None = None
    depends_on_row: int | None = None   # 0-based index in the preview rows (legado Excel/CSV)
    dependency_links: list[ImportDepLink] | None = None  # MS Project XML: deps tipadas
    parent_row: int | None = None       # WBS: fila padre (0-based)
    is_milestone: bool = False
    warning: str | None = None          # non-blocking notice
    error: str | None = None            # blocking: row won't be imported


class ImportPreview(BaseModel):
    rows: list[ImportPreviewRow]
    column_map: dict[str, str]          # field → column header detected
    headers: list[str] = []             # encabezados crudos del archivo (para remapeo manual)
    total_rows: int
    warnings: int
    errors: int
    source: str = "excel"               # "excel" | "csv" | "msproject"


class ImportConfirmPayload(BaseModel):
    obra_id: int
    rows: list[ImportPreviewRow]
    source: str = "excel"               # "excel" | "csv" | "msproject" — para el evento de historial
