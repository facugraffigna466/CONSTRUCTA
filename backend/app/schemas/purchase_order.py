from datetime import datetime
from pydantic import BaseModel, Field

ORDER_STATUSES = {"borrador", "enviado", "recibido"}


class PurchaseOrderItemRead(BaseModel):
    id: int
    material_id: int | None
    name: str
    quantity: float | None
    unit: str | None
    unit_price: float | None

    model_config = {"from_attributes": True}


class PurchaseOrderCreate(BaseModel):
    supplier_id: int | None = None
    material_ids: list[int] = Field(..., min_length=1)
    notes: str | None = None


class PurchaseOrderRead(BaseModel):
    id: int
    obra_id: int
    supplier_id: int | None
    supplier_name: str | None = None
    supplier_phone: str | None = None
    supplier_email: str | None = None
    created_by: int | None
    status: str
    notes: str | None
    created_at: datetime
    sent_at: datetime | None
    received_at: datetime | None
    items: list[PurchaseOrderItemRead] = []
    total: float = 0

    model_config = {"from_attributes": True}


class PurchaseOrderSendRequest(BaseModel):
    channel: str = Field(default="whatsapp")  # whatsapp | email

    def model_post_init(self, _context):
        if self.channel not in {"whatsapp", "email"}:
            raise ValueError("channel debe ser 'whatsapp' o 'email'")


# ── Presupuesto por obra ──────────────────────────────────────────────────────

class PresupuestoRow(BaseModel):
    task_id: int
    task_title: str
    material_id: int
    name: str
    quantity: float | None
    unit: str | None
    unit_price: float | None
    subtotal: float
    status: str
    supplier_id: int | None
    supplier_name: str | None
    responsible_id: int | None = None
    responsible_name: str | None = None
    created_by: int | None = None
    created_by_name: str | None = None


class PresupuestoResponse(BaseModel):
    rows: list[PresupuestoRow]
    total_estimado: float      # todos los materiales con precio
    total_pedido: float        # status pedido
    total_recibido: float      # status recibido (gasto real)
