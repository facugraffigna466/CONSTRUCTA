"""Contrato de GET /obras/{id}/dashboard — sección 6 de
docs/features/dashboard-indicadores-obra.md (bloques P0 de esta etapa:
progress/forecast/alerts/bottleneck/data_quality).

Cada bloque trae `available` (y `reason` cuando aplica): el frontend nunca
decide si un dato es válido, lo dice el backend.
"""
from pydantic import BaseModel


class DashboardProgress(BaseModel):
    real_percent: float | None
    planned_percent: float | None
    spi: float | None
    spi_confidence: str | None  # "high" | "low" | None
    days_behind: int | None  # negativo = adelantado
    tasks_total: int
    tasks_completed: int
    available: bool
    reason: str | None


class DashboardForecast(BaseModel):
    projected_end_date: str | None
    expected_end_date: str | None
    deviation_working_days: int | None
    method: str
    available: bool
    reason: str | None
    # No forma parte del contrato literal del doc: cuando 0 < SPI < 0.5 la
    # fecha proyectada sería absurda (§I-04); con `capped=true` el frontend
    # muestra "más de X meses de desvío" en vez de la fecha, sin que el
    # backend la invente más corta de lo que da la cuenta.
    capped: bool


class DashboardAlerts(BaseModel):
    critica: int
    alta: int
    media: int
    baja: int
    oldest_critical_age_days: int | None


class DashboardBottleneck(BaseModel):
    available: bool
    task_id: int | None
    title: str | None
    blocked_task_count: int | None
    status: str | None
    overdue_since: str | None


class DashboardDataQuality(BaseModel):
    tasks_without_dates: int
    tasks_without_responsible: int
    tasks_without_dependencies: int
    milestones_without_dates: int


class ObraDashboardRead(BaseModel):
    computed_at: str
    as_of: str
    progress: DashboardProgress
    forecast: DashboardForecast
    alerts: DashboardAlerts
    bottleneck: DashboardBottleneck
    data_quality: DashboardDataQuality
