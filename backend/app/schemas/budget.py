from datetime import datetime
from typing import Any

from pydantic import BaseModel


class BudgetTextCreate(BaseModel):
    text: str
    obra_id: int | None = None
    supplier_name: str | None = None


class BudgetRead(BaseModel):
    id: int
    obra_id: int | None = None
    obra_name: str | None = None
    supplier_id: int | None = None
    supplier_name: str | None = None
    rubro: str | None = None
    source_type: str
    source_filename: str | None = None
    total: float | None = None
    currency: str
    status: str
    error: str | None = None
    data: dict[str, Any] | None = None
    inconsistencies: list[Any] | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class BudgetCompareRequest(BaseModel):
    budget_ids: list[int]


class BudgetComparisonRow(BaseModel):
    budget_id: int
    supplier_name: str | None = None
    rubro: str | None = None
    total: float | None = None
    currency: str = "ARS"
    plazo_entrega: str | None = None
    condiciones_pago: str | None = None
    validez: str | None = None
    incluye_flete: bool | None = None
    pct_vs_promedio: float | None = None  # +18 = 18% por encima del promedio
    es_mas_barato: bool = False
    flags: list[str] = []


class BudgetComparison(BaseModel):
    rows: list[BudgetComparisonRow]
    promedio: float | None = None
    recomendacion: str | None = None
