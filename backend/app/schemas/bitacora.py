from datetime import datetime
from pydantic import BaseModel


class BitacoraSuggestion(BaseModel):
    """Sugerencia de acción extraída del audio por la IA."""
    type: str                          # reschedule_task | create_task | update_status | note
    task_id: int | None = None
    task_title: str | None = None
    new_start_date: str | None = None  # YYYY-MM-DD
    new_due_date: str | None = None
    new_status: str | None = None      # pendiente/en_progreso/bloqueada/completada/cancelada
    title: str | None = None           # para create_task
    description: str | None = None
    responsible_name: str | None = None
    reason: str = ""
    applied: bool = False
    dismissed: bool = False
    result_task_id: int | None = None
    result_note: str | None = None   # aviso si se ajustó una fecha al día laboral más cercano


class BitacoraEntryRead(BaseModel):
    id: int
    obra_id: int | None
    obra_name: str | None = None
    responsible_id: int | None
    responsible_name: str | None = None
    created_by: int | None
    source: str
    audio_path: str | None
    audio_url: str | None = None  # ruta relativa FIRMADA (/uploads/<name>?exp=..&sig=..)
    transcript: str | None
    summary: str | None
    key_points: list[str] | None
    suggestions: list[BitacoraSuggestion] | None
    status: str
    error: str | None
    created_at: datetime
    processed_at: datetime | None

    model_config = {"from_attributes": True}


class BitacoraTextCreate(BaseModel):
    """Entrada manual: texto directo (sin audio) o transcripción pegada."""
    text: str


class BitacoraSuggestionEdit(BaseModel):
    """Ajustes opcionales del jefe a una sugerencia antes de aplicarla."""
    new_start_date: str | None = None
    new_due_date: str | None = None
    new_status: str | None = None
    title: str | None = None
    responsible_name: str | None = None
    description: str | None = None


class BitacoraAssignObra(BaseModel):
    obra_id: int
