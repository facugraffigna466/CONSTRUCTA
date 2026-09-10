"""Contrato de GET /obras/{id}/dashboard — sección 6 de
docs/features/dashboard-indicadores-obra.md: bloques P0
(progress/forecast/alerts/bottleneck/data_quality) y P1
(baseline/critical_path/milestones/materials).

Cada bloque trae `available` (y `reason` cuando aplica): el frontend nunca
decide si un dato es válido, lo dice el backend.
"""
from typing import Any

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


class DashboardBaseline(BaseModel):
    available: bool
    reason: str | None
    saved_at: str | None
    end_deviation_days: int | None
    tasks_deviated: int
    tasks_total_in_baseline: int
    tasks_added_after_baseline: int
    avg_deviation_days: float


class DashboardCriticalPath(BaseModel):
    available: bool
    reason: str | None
    critical_task_count: int
    at_risk_task_count: int
    slack_task_count: int
    median_float_days: float | None
    coverage_percent: float
    partial: bool


class DashboardMilestoneItem(BaseModel):
    task_id: int
    title: str
    due_date: str | None
    completed_date: str | None
    state: str  # cumplido | tarde | en_riesgo | pendiente
    float_days: int | None


class DashboardMilestones(BaseModel):
    available: bool
    items: list[DashboardMilestoneItem]


class DashboardMaterials(BaseModel):
    available: bool
    reason: str | None
    total_estimado: float
    total_pedido: float
    total_recibido: float
    percent_committed: float
    percent_received: float
    alignment_delta: float | None


class CurvaSPoint(BaseModel):
    date: str
    planned: float
    real: float | None


class CurvaSRead(BaseModel):
    granularity: str
    tracking_since: str | None
    points: list[CurvaSPoint]


class MonthlyInsightsRead(BaseModel):
    available: bool
    period: str | None
    computed_at: str | None
    # Formas que ya define obra_stats_service.py (_risk_concentration /
    # _estimation_accuracy) — se leen tal cual del snapshot, sin re-tipar acá
    # cada campo interno; el contrato Pydantic de esas fórmulas vive donde se
    # calculan, no en este endpoint que solo las reexpone.
    risk_concentration: dict[str, Any] | None
    estimation_accuracy: dict[str, Any] | None


class ObraDashboardRead(BaseModel):
    computed_at: str
    as_of: str
    progress: DashboardProgress
    forecast: DashboardForecast
    alerts: DashboardAlerts
    bottleneck: DashboardBottleneck
    data_quality: DashboardDataQuality
    baseline: DashboardBaseline
    critical_path: DashboardCriticalPath
    milestones: DashboardMilestones
    materials: DashboardMaterials
