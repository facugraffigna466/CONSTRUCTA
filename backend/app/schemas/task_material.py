from datetime import datetime
from pydantic import BaseModel, Field

MATERIAL_STATUSES = {"pendiente", "pedido", "recibido"}


class TaskMaterialCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    quantity: float | None = Field(None, gt=0)
    unit: str | None = Field(None, max_length=50)
    unit_price: float | None = Field(None, ge=0)
    supplier_id: int | None = None
    responsible_id: int | None = None
    status: str = Field(default="pendiente")

    def model_post_init(self, _context):
        if self.status not in MATERIAL_STATUSES:
            raise ValueError(f"status debe ser uno de: {', '.join(MATERIAL_STATUSES)}")


class TaskMaterialUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=255)
    quantity: float | None = Field(None, gt=0)
    unit: str | None = Field(None, max_length=50)
    unit_price: float | None = Field(None, ge=0)
    supplier_id: int | None = None
    responsible_id: int | None = None
    status: str | None = None

    def model_post_init(self, _context):
        if self.status is not None and self.status not in MATERIAL_STATUSES:
            raise ValueError(f"status debe ser uno de: {', '.join(MATERIAL_STATUSES)}")


class TaskMaterialRead(BaseModel):
    id: int
    task_id: int
    name: str
    quantity: float | None
    unit: str | None
    unit_price: float | None
    supplier_id: int | None
    supplier_name: str | None = None
    responsible_id: int | None = None
    responsible_name: str | None = None
    created_by: int | None = None
    created_by_name: str | None = None
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}
