from datetime import datetime
from pydantic import BaseModel, Field


# ── Proveedor en la solicitud ─────────────────────────────────────────────────

class SolicitudSupplierRead(BaseModel):
    supplier_id: int
    supplier_name: str
    supplier_phone: str | None = None
    status: str
    sent_at: datetime | None = None

    model_config = {"from_attributes": True}


# ── Ítem de respuesta de proveedor ────────────────────────────────────────────

class RespuestaItemRead(BaseModel):
    nombre: str
    cantidad: float | None = None
    unidad: str | None = None
    precio_unitario: float | None = None
    subtotal: float | None = None


# ── Respuesta de proveedor (Budget vinculado) ─────────────────────────────────

class RespuestaCotizacionRead(BaseModel):
    id: int
    solicitud_id: int
    supplier_id: int | None
    supplier_name: str
    total: float | None
    currency: str
    plazo_entrega: str | None = None
    condiciones_pago: str | None = None
    validez: str | None = None
    rubro: str | None = None
    proveedor_nombre: str | None = None
    fecha: str | None = None
    iva_pct: float | None = None
    iva_monto: float | None = None
    incluye_flete: bool | None = None
    inconsistencias: list[dict] | None = None
    created_at: datetime
    items: list[RespuestaItemRead] = []


# ── Análisis comparativo de IA ────────────────────────────────────────────────

class PrecioItemRead(BaseModel):
    supplier_id: int
    supplier_name: str
    precio_unitario: float | None = None
    subtotal: float | None = None


class ComparacionItemRead(BaseModel):
    nombre: str
    precios: list[PrecioItemRead]
    mas_barato_id: int | None = None
    diferencia: float | None = None


class AnalisisComparativoRead(BaseModel):
    resumen: str
    comparacion_items: list[ComparacionItemRead]
    donde_ganas: list[str]
    donde_pierdes: list[str]
    condiciones_pago: str
    plazos: str
    riesgos: list[str]
    recomendacion: str
    supplier_recomendado_id: int | None = None


# ── Solicitud completa (read) ─────────────────────────────────────────────────

class SolicitudCotizacionRead(BaseModel):
    id: int
    obra_id: int
    ref_code: str
    status: str
    notes: str | None
    pdf_url: str | None
    contratista_phone: str | None = None
    created_at: datetime
    sent_at: datetime | None
    material_ids: list[int] = []
    suppliers: list[SolicitudSupplierRead] = []
    respuestas: list[RespuestaCotizacionRead] = []
    analisis_ia: AnalisisComparativoRead | None = None


# ── Payload para crear ────────────────────────────────────────────────────────

class SolicitudCotizacionCreate(BaseModel):
    material_ids: list[int] = Field(..., min_length=1)
    supplier_ids: list[int] = Field(default_factory=list)
    notes: str | None = None
    contratista_phones: list[str] = Field(default_factory=list)


# ── Confirmar proveedor ───────────────────────────────────────────────────────

class ConfirmarProveedorRequest(BaseModel):
    supplier_id: int


# ── Confirmar contratista (auto-crea Supplier) ────────────────────────────────

class ConfirmarContratistaRequest(BaseModel):
    supplier_name: str
    supplier_phone: str | None = None


# ── Análisis histórico de compras (on-demand, por obra) ───────────────────────

class EstadisticaProveedorRead(BaseModel):
    nombre: str
    cotizaciones_respondidas: int
    precio_promedio: float | None = None
    precio_min: float | None = None
    precio_max: float | None = None
    tendencia: str  # "competitivo" | "caro" | "variable" | "sin datos"
    fortaleza: str  # e.g. "mejor precio en cemento"


class MaterialCriticoRead(BaseModel):
    nombre: str
    proveedor_mas_barato: str | None = None
    diferencia_pct: float | None = None
    veces_cotizado: int


class AnalisisHistoricoComprasRead(BaseModel):
    proveedor_recomendado: str | None = None
    motivo: str
    por_proveedor: list[EstadisticaProveedorRead]
    materiales_criticos: list[MaterialCriticoRead]
    alertas: list[str]
    ahorro_potencial: float | None = None
