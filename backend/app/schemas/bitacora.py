from datetime import datetime
from pydantic import AliasChoices, BaseModel, Field

from app.schemas.suggestion import SuggestionEdit, SuggestionRead

# La sugerencia dejó de ser un objeto anidado en la entrada: es entidad propia
# (migración 0072). Los alias mantienen el nombre viejo donde ya se importaba.
BitacoraSuggestion = SuggestionRead
BitacoraSuggestionEdit = SuggestionEdit


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
    # La entrada expone sus sugerencias bajo el nombre de siempre, pero el
    # dato ahora sale de la relación `suggestion_rows` (migración 0072).
    suggestions: list[SuggestionRead] | None = Field(
        default=None,
        validation_alias=AliasChoices("suggestion_rows", "suggestions"),
    )
    status: str
    error: str | None
    created_at: datetime
    processed_at: datetime | None

    model_config = {"from_attributes": True, "populate_by_name": True}


class BitacoraTextCreate(BaseModel):
    """Entrada manual: texto directo (sin audio) o transcripción pegada."""
    text: str


class BitacoraAssignObra(BaseModel):
    obra_id: int
