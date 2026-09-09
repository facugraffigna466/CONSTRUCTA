from datetime import date, datetime

from pydantic import BaseModel, computed_field

from app.models.suggestion import SuggestionStatus, SuggestionType


class SuggestionRead(BaseModel):
    """Una acción propuesta por la IA, ahora con id propio.

    `applied` y `dismissed` se derivan de `status`: son los dos booleanos que
    consumía la interfaz cuando la sugerencia vivía dentro del blob JSON, y se
    mantienen para que ninguna pantalla tenga que razonar sobre el enum.
    """

    id: int
    obra_id: int | None
    source: str
    source_entry_id: int | None
    order_index: int
    type: SuggestionType
    task_id: int | None
    task_title: str | None
    new_start_date: date | None
    new_due_date: date | None
    new_status: str | None
    title: str | None
    description: str | None
    responsible_name: str | None
    reason: str
    status: SuggestionStatus
    result_task_id: int | None
    result_note: str | None
    resolved_by: int | None
    resolved_at: datetime | None
    created_at: datetime

    # Contexto para mostrarla fuera de la bitácora, donde no hay entrada a la vista.
    obra_name: str | None = None
    entry_summary: str | None = None
    reporter_name: str | None = None

    @computed_field  # type: ignore[prop-decorator]
    @property
    def applied(self) -> bool:
        return self.status == SuggestionStatus.APLICADA

    @computed_field  # type: ignore[prop-decorator]
    @property
    def dismissed(self) -> bool:
        return self.status == SuggestionStatus.DESCARTADA

    model_config = {"from_attributes": True}


class SuggestionEdit(BaseModel):
    """Ajustes opcionales del jefe a una sugerencia antes de aplicarla.

    La IA propone, la persona decide: cualquiera de estos campos pisa lo que
    propuso el modelo en el momento de aplicar, sin reescribir la fila original.
    """

    new_start_date: str | None = None
    new_due_date: str | None = None
    new_status: str | None = None
    title: str | None = None
    responsible_name: str | None = None
    description: str | None = None


class SuggestionCounts(BaseModel):
    pendientes: int
    aplicadas: int
    descartadas: int
