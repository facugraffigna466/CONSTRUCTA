"""Dashboard de indicadores de obra — P0 (docs/features/dashboard-indicadores-obra.md).

Compone en vivo, en una sola llamada, los indicadores P0 (I-01 avance real
ponderado, I-02 avance planificado, I-03 SPI, I-04 fin proyectado, I-09
alertas por severidad) más I-10 (cuello de botella). Todo sale de SQL/Python,
nada de IA — es verificable a mano (regla de oro del diseño).

Cada bloque trae `available`: el frontend nunca decide si un dato es válido,
lo dice el backend. Nunca se manda 0 en lugar de "no calculable".
"""
from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.alert import Alert, AlertSeverity
from app.models.obra import Obra, ObraStatus
from app.models.task import Task, TaskStatus
from app.repositories.calendar import CalendarRepository
from app.repositories.obra import ObraRepository
from app.repositories.task import TaskRepository
from app.services import dashboard_calc
from app.services.calendar_service import add_working_days, working_days_between
from app.services.staff_digest_service import StaffDigestService

# Bajo esta confianza planificada el SPI se calcula igual pero se marca de baja
# confianza (§I-03): 2% real vs. 1% planificado da SPI 2.0 y no significa nada.
_SPI_LOW_CONFIDENCE_THRESHOLD = 5.0
# Por debajo de este SPI la proyección de fecha fin daría un absurdo (el doble
# de la obra); se sigue calculando pero se marca `capped` para que el frontend
# muestre "más de X meses de desvío" en vez de una fecha falsamente precisa.
_FORECAST_CAPPED_SPI_THRESHOLD = 0.5


class ObraDashboardService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.task_repo = TaskRepository(session)
        self.calendar_repo = CalendarRepository(session)
        self.obra_repo = ObraRepository(session)

    async def get_dashboard(self, obra_id: int) -> dict[str, Any]:
        obra = await self.obra_repo.get(obra_id)
        tasks = await self.task_repo.list_by_obra(obra_id)
        calendar = await self.calendar_repo.get_for_obra(obra_id)
        links_by_task = await self.task_repo.get_all_dependency_links_by_obra(obra_id)
        as_of = self._as_of(obra)

        progress, span = self._build_progress(calendar, tasks, as_of)
        forecast = self._build_forecast(obra, calendar, span, progress, as_of)
        alerts = await self._build_alerts(obra_id, as_of)
        bottleneck = await self._build_bottleneck(tasks, as_of)
        data_quality = self._build_data_quality(tasks, links_by_task)

        return {
            "computed_at": datetime.now(timezone.utc).isoformat(),
            "as_of": as_of.isoformat(),
            "progress": progress,
            "forecast": forecast,
            "alerts": alerts,
            "bottleneck": bottleneck,
            "data_quality": data_quality,
        }

    def _as_of(self, obra: Obra | None) -> date:
        """§I-03: "obra completada → SPI se congela al valor del día de cierre"."""
        if obra is not None and obra.status == ObraStatus.COMPLETADA and obra.actual_end_date:
            return obra.actual_end_date
        return date.today()

    def _build_progress(
        self, calendar, tasks: list[Task], as_of: date
    ) -> tuple[dict[str, Any], tuple[date, date] | None]:
        real = dashboard_calc.weighted_real_progress(calendar, tasks)
        span = dashboard_calc.planned_span(calendar, tasks)
        planned = (
            dashboard_calc.weighted_planned_progress(calendar, tasks, as_of)
            if span is not None
            else None
        )

        spi: float | None = None
        spi_confidence: str | None = None
        days_behind: int | None = None
        if real is not None and planned:  # planned no es None ni 0
            spi = real / planned
            spi_confidence = "low" if planned < _SPI_LOW_CONFIDENCE_THRESHOLD else "high"
            total_planned_days = working_days_between(calendar, span[0], span[1])
            days_behind = round((planned - real) / 100 * total_planned_days)

        non_cancelled = [t for t in tasks if t.status != TaskStatus.CANCELADA]
        progress = {
            "real_percent": real,
            "planned_percent": planned,
            "spi": spi,
            "spi_confidence": spi_confidence,
            "days_behind": days_behind,
            "tasks_total": len(non_cancelled),
            "tasks_completed": sum(1 for t in non_cancelled if t.status == TaskStatus.COMPLETADA),
            "available": real is not None,
            "reason": None if real is not None else "no_tasks",
        }
        return progress, span

    def _build_forecast(
        self,
        obra: Obra | None,
        calendar,
        span: tuple[date, date] | None,
        progress: dict[str, Any],
        as_of: date,
    ) -> dict[str, Any]:
        base = {
            "projected_end_date": None,
            "expected_end_date": obra.expected_end_date.isoformat()
            if obra is not None and obra.expected_end_date
            else None,
            "deviation_working_days": None,
            "method": "spi",
            "available": False,
            "reason": None,
            "capped": False,
        }
        if span is None or progress["planned_percent"] is None:
            base["reason"] = "no_dates"
            return base
        spi = progress["spi"]
        if spi is None or progress["spi_confidence"] == "low":
            base["reason"] = "spi_unreliable"
            return base

        span_start, span_end = span
        total_planned_days = working_days_between(calendar, span_start, span_end)
        proyectada = total_planned_days / spi
        projected_end_date = add_working_days(calendar, span_start, round(proyectada))
        deviation = None
        if obra is not None and obra.expected_end_date:
            deviation = working_days_between(calendar, obra.expected_end_date, projected_end_date)

        base.update(
            {
                "projected_end_date": projected_end_date.isoformat(),
                "deviation_working_days": deviation,
                "available": True,
                "capped": spi < _FORECAST_CAPPED_SPI_THRESHOLD,
            }
        )
        return base

    async def _build_alerts(self, obra_id: int, as_of: date) -> dict[str, Any]:
        result = await self.session.execute(
            select(Alert.severity, func.count(Alert.id))
            .where(Alert.obra_id == obra_id, Alert.is_read.is_(False))
            .group_by(Alert.severity)
        )
        counts = {row[0]: row[1] for row in result.fetchall()}

        oldest = (
            await self.session.execute(
                select(func.min(Alert.created_at)).where(
                    Alert.obra_id == obra_id,
                    Alert.is_read.is_(False),
                    Alert.severity == AlertSeverity.CRITICA.value,
                )
            )
        ).scalar_one_or_none()
        oldest_age = (as_of - oldest.date()).days if oldest is not None else None

        return {
            "critica": counts.get(AlertSeverity.CRITICA.value, 0),
            "alta": counts.get(AlertSeverity.ALTA.value, 0),
            "media": counts.get(AlertSeverity.MEDIA.value, 0),
            "baja": counts.get(AlertSeverity.BAJA.value, 0),
            "oldest_critical_age_days": oldest_age,
        }

    async def _build_bottleneck(self, tasks: list[Task], as_of: date) -> dict[str, Any]:
        """Mismo criterio de candidatas que StaffDigestService._recolectar:
        bloqueadas + vencidas (sin duplicar las bloqueadas vencidas)."""
        bloqueadas = [t for t in tasks if t.status == TaskStatus.BLOQUEADA]
        vencidas = [
            t
            for t in tasks
            if t.due_date
            and t.due_date < as_of
            and t.status not in (TaskStatus.COMPLETADA, TaskStatus.CANCELADA, TaskStatus.BLOQUEADA)
        ]
        mejor = await StaffDigestService(self.session).cuello_de_botella(bloqueadas + vencidas)
        if mejor is None:
            return {
                "available": False,
                "task_id": None,
                "title": None,
                "blocked_task_count": None,
                "status": None,
                "overdue_since": None,
            }
        return {
            "available": True,
            "task_id": mejor["task_id"],
            "title": mejor["tarea"],
            "blocked_task_count": mejor["frena"],
            "status": mejor["estado"],
            "overdue_since": mejor["vencio"],
        }

    def _build_data_quality(
        self, tasks: list[Task], links_by_task: dict[int, list[dict]]
    ) -> dict[str, Any]:
        non_cancelled = [t for t in tasks if t.status != TaskStatus.CANCELADA]
        weighted_universe = [t for t in non_cancelled if dashboard_calc.in_progress_universe(t)]

        linked_ids: set[int] = set(links_by_task.keys())
        for links in links_by_task.values():
            linked_ids.update(link["depends_on_id"] for link in links)

        return {
            "tasks_without_dates": sum(
                1 for t in weighted_universe if not (t.start_date and t.due_date)
            ),
            "tasks_without_responsible": sum(
                1 for t in non_cancelled if t.responsible_id is None
            ),
            "tasks_without_dependencies": sum(
                1 for t in non_cancelled if t.id not in linked_ids
            ),
            "milestones_without_dates": sum(
                1 for t in non_cancelled if t.is_milestone and not t.due_date
            ),
        }
