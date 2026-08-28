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
    # True si el archivo excede el tope de adjuntos de WhatsApp: se puede
    # descargar bien desde la web, pero el bot no lo va a poder entregar.
    # Se calcula en el backend para no duplicar el umbral en el frontend.
    too_big_for_whatsapp: bool = False

    model_config = {"from_attributes": True}
