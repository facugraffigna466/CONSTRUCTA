"""Dashboard de indicadores de obra (docs/features/dashboard-indicadores-obra.md).

Compone en vivo, en una sola llamada, los indicadores P0 (I-01 avance real
ponderado, I-02 avance planificado, I-03 SPI, I-04 fin proyectado, I-09
alertas por severidad, I-10 cuello de botella) y P1 (I-06 desvío vs. línea
base, I-07 salud de ruta crítica, I-08 hitos, I-11 ejecución de materiales).
Todo sale de SQL/Python, nada de IA — es verificable a mano (regla de oro
del diseño).

Cada bloque trae `available`: el frontend nunca decide si un dato es válido,
lo dice el backend. Nunca se manda 0 en lugar de "no calculable".
"""
import statistics
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.alert import Alert, AlertSeverity
from app.models.baseline import TaskBaseline
from app.models.obra import Obra, ObraStatus
from app.models.obra_progress_daily import ObraProgressDaily
from app.models.task import Task, TaskStatus
from app.models.task_material import TaskMaterial
from app.repositories.calendar import CalendarRepository
from app.repositories.obra import ObraRepository
from app.repositories.task import TaskRepository
from app.services import dashboard_calc
from app.services.calendar_service import add_working_days, working_days_between
from app.services.staff_digest_service import StaffDigestService
from app.services.task_service import TaskService

# Holgura por debajo de la cual una tarea no-crítica se considera "en riesgo"
# (§I-07): 3 días laborales ≈ media semana, el mismo umbral que usa el diseño.
_AT_RISK_FLOAT_DAYS = 3

# Bajo esta confianza planificada el SPI se calcula igual pero se marca de baja
# confianza (§I-03): 2% real vs. 1% planificado da SPI 2.0 y no significa nada.
_SPI_LOW_CONFIDENCE_THRESHOLD = 5.0
# Por debajo de este SPI la proyección de fecha fin daría un absurdo (el doble
# de la obra); se sigue calculando pero se marca `capped` para que el frontend
# muestre "más de X meses de desvío" en vez de una fecha falsamente precisa.
_FORECAST_CAPPED_SPI_THRESHOLD = 0.5

# I-05: cuántos días de margen se aceptan para emparejar un punto semanal de
# la curva con la fila de obra_progress_daily más cercana. El job corre todos
# los días desde que arrancó a trackear, pero ese día no tiene por qué caer en
# el mismo día de la semana que el inicio de la obra — exigir fecha exacta
# dejaría la serie real vacía para la mayoría de las obras.
_CURVA_S_MATCH_TOLERANCE_DAYS = 3


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
        baseline = await self._build_baseline(obra_id, calendar, tasks)
        critical_path, float_by_task = await self._build_critical_path(obra_id, tasks, links_by_task)
        milestones = self._build_milestones(tasks, as_of, float_by_task)
        materials = await self._build_materials(obra_id, progress["real_percent"])

        return {
            "computed_at": datetime.now(timezone.utc).isoformat(),
            "as_of": as_of.isoformat(),
            "progress": progress,
            "forecast": forecast,
            "alerts": alerts,
            "bottleneck": bottleneck,
            "data_quality": data_quality,
            "baseline": baseline,
            "critical_path": critical_path,
            "milestones": milestones,
            "materials": materials,
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
        # spi == 0.0 es un valor real (nada de avance con plan ya arrancado),
        # pero proyectar `duración/spi` con spi 0 es una división por cero: la
        # duración proyectada sería infinita, no "absurda pero finita" como el
        # caso 0 < spi < 0.5 que sí se cubre con `capped`. Se trata igual que
        # "no confiable" — no hay fecha que mostrar.
        if spi is None or spi <= 0 or progress["spi_confidence"] == "low":
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

    async def _build_baseline(
        self, obra_id: int, calendar, tasks: list[Task]
    ) -> dict[str, Any]:
        """I-06 — desvío contra la línea base guardada. `task_baselines` no
        tiene repositorio propio: se consulta inline, mismo patrón que
        RiskService.baselines()."""
        result = await self.session.execute(
            select(TaskBaseline).where(TaskBaseline.obra_id == obra_id)
        )
        baselines = {b.task_id: b for b in result.scalars().all()}
        if not baselines:
            return {
                "available": False,
                "reason": "no_baseline",
                "saved_at": None,
                "end_deviation_days": None,
                "tasks_deviated": 0,
                "tasks_total_in_baseline": 0,
                "tasks_added_after_baseline": 0,
                "avg_deviation_days": 0.0,
            }

        non_cancelled = [t for t in tasks if t.status != TaskStatus.CANCELADA]
        tasks_in_baseline = [t for t in non_cancelled if t.id in baselines]
        tasks_added_after = [t for t in non_cancelled if t.id not in baselines]

        deviations: list[int] = []
        for t in tasks_in_baseline:
            baseline_finish = baselines[t.id].baseline_finish
            if t.due_date and baseline_finish and t.due_date > baseline_finish:
                deviations.append(working_days_between(calendar, baseline_finish, t.due_date))

        # Fin de obra actual = el más tardío entre TODAS las no canceladas (una
        # tarea agregada después de la línea base que empuja la fecha también
        # es parte del desvío, no solo las que tienen fila de baseline).
        baseline_finishes = [b.baseline_finish for b in baselines.values() if b.baseline_finish]
        current_due_dates = [t.due_date for t in non_cancelled if t.due_date]
        end_deviation_days = (
            working_days_between(calendar, max(baseline_finishes), max(current_due_dates))
            if baseline_finishes and current_due_dates
            else None
        )

        return {
            "available": True,
            "reason": None,
            "saved_at": max(b.saved_at for b in baselines.values()).isoformat(),
            "end_deviation_days": end_deviation_days,
            "tasks_deviated": len(deviations),
            "tasks_total_in_baseline": len(tasks_in_baseline),
            "tasks_added_after_baseline": len(tasks_added_after),
            "avg_deviation_days": (sum(deviations) / len(deviations)) if deviations else 0.0,
        }

    async def _build_critical_path(
        self, obra_id: int, tasks: list[Task], links_by_task: dict[int, list[dict]]
    ) -> tuple[dict[str, Any], dict[str, int]]:
        """I-07 — salud de la ruta crítica y holgura. Devuelve también
        `float_by_task` (claves string, días) para que _build_milestones no
        tenga que recalcular el CPM."""
        has_dependencies = any(links_by_task.values())
        if not has_dependencies:
            empty = {
                "available": False,
                "reason": "no_dependencies",
                "critical_task_count": 0,
                "at_risk_task_count": 0,
                "slack_task_count": 0,
                "median_float_days": None,
                "coverage_percent": 0.0,
                "partial": False,
            }
            return empty, {}

        cpm = await TaskService(self.session).compute_critical_path_unchecked(obra_id)
        non_cancelled = [t for t in tasks if t.status != TaskStatus.CANCELADA]
        non_cancelled_ids = {t.id for t in non_cancelled}
        # compute_critical_path_unchecked corre sobre TODAS las tareas de la
        # obra (no filtra canceladas) — se restringe acá para que el numerador
        # de critical/at_risk/slack use el mismo universo que coverage_percent.
        float_by_task: dict[str, int] = {
            k: int(v) for k, v in cpm["float_by_task"].items() if int(k) in non_cancelled_ids
        }
        non_critical_floats = [f for f in float_by_task.values() if f > 0]

        con_fechas = sum(1 for t in non_cancelled if t.start_date and t.due_date)
        coverage_percent = (con_fechas / len(non_cancelled) * 100) if non_cancelled else 0.0

        critical_task_ids = [tid for tid in cpm["critical_task_ids"] if tid in non_cancelled_ids]
        critical_path = {
            "available": True,
            "reason": None,
            "critical_task_count": len(critical_task_ids),
            "at_risk_task_count": sum(1 for f in non_critical_floats if f <= _AT_RISK_FLOAT_DAYS),
            "slack_task_count": sum(1 for f in non_critical_floats if f > _AT_RISK_FLOAT_DAYS),
            "median_float_days": statistics.median(non_critical_floats) if non_critical_floats else None,
            "coverage_percent": coverage_percent,
            "partial": coverage_percent < 100,
        }
        return critical_path, float_by_task

    def _build_milestones(
        self, tasks: list[Task], as_of: date, float_by_task: dict[str, int]
    ) -> dict[str, Any]:
        """I-08 — estado de cada hito. Sin hitos no es un error (muchas obras
        chicas no los usan): el bloque queda `available=False` sin `reason`,
        el doc no le pide uno a esta ficha."""
        hitos = [t for t in tasks if t.is_milestone and t.status != TaskStatus.CANCELADA]
        if not hitos:
            return {"available": False, "items": []}

        items = []
        for t in hitos:
            float_days = float_by_task.get(str(t.id))
            if t.status == TaskStatus.COMPLETADA and t.completed_date and t.due_date:
                state = "cumplido" if t.completed_date <= t.due_date else "tarde"
            elif t.status != TaskStatus.COMPLETADA and (
                (t.due_date and t.due_date < as_of) or (float_days is not None and float_days <= _AT_RISK_FLOAT_DAYS)
            ):
                state = "en_riesgo"
            else:
                state = "pendiente"
            items.append({
                "task_id": t.id,
                "title": t.title,
                "due_date": t.due_date.isoformat() if t.due_date else None,
                "completed_date": t.completed_date.isoformat() if t.completed_date else None,
                "state": state,
                "float_days": float_days,
            })
        return {"available": True, "items": items}

    async def _build_materials(self, obra_id: int, real_percent: float | None) -> dict[str, Any]:
        """I-11 — ejecución de materiales vs. estimado. Query de agregación
        liviana propia (no reusa GET /presupuesto, que trae filas y nombres
        que acá no hacen falta), mismo estilo que
        TaskRepository.materials_summary_by_obra."""
        result = await self.session.execute(
            select(
                TaskMaterial.status,
                func.coalesce(func.sum(TaskMaterial.quantity * TaskMaterial.unit_price), 0),
            )
            .join(Task, Task.id == TaskMaterial.task_id)
            .where(Task.obra_id == obra_id)
            .group_by(TaskMaterial.status)
        )
        totals_by_status = {status: float(total) for status, total in result.fetchall()}
        if not totals_by_status:
            return {
                "available": False,
                "reason": "no_materials",
                "total_estimado": 0.0,
                "total_pedido": 0.0,
                "total_recibido": 0.0,
                "percent_committed": 0.0,
                "percent_received": 0.0,
                "alignment_delta": None,
            }

        total_estimado = sum(totals_by_status.values())
        total_pedido = totals_by_status.get("pedido", 0.0)
        total_recibido = totals_by_status.get("recibido", 0.0)
        percent_committed = (total_pedido / total_estimado * 100) if total_estimado else 0.0
        percent_received = (total_recibido / total_estimado * 100) if total_estimado else 0.0

        return {
            "available": True,
            "reason": None,
            "total_estimado": total_estimado,
            "total_pedido": total_pedido,
            "total_recibido": total_recibido,
            "percent_committed": percent_committed,
            "percent_received": percent_received,
            "alignment_delta": (percent_received - real_percent) if real_percent is not None else None,
        }

    async def record_daily_progress(self, obra: Obra) -> None:
        """I-05 — snapshot de hoy para la curva S. Se guarda el resultado ya
        calculado (mismo `get_dashboard` que ve el usuario), no los insumos:
        si la fórmula cambia, la historia vieja queda con la fórmula vieja.
        Upsert por (obra_id, hoy) — correr el job dos veces el mismo día pisa
        la fila, no la duplica. Llamado por el job diario (core/scheduler.py)."""
        dashboard = await self.get_dashboard(obra.id)
        progress = dashboard["progress"]
        critical_path = dashboard["critical_path"]
        today = date.today()

        existing = (
            await self.session.execute(
                select(ObraProgressDaily).where(
                    ObraProgressDaily.obra_id == obra.id, ObraProgressDaily.date == today
                )
            )
        ).scalar_one_or_none()

        values = {
            "progress_real": progress["real_percent"],
            "progress_planned": progress["planned_percent"],
            "spi": progress["spi"],
            "tasks_total": progress["tasks_total"],
            "tasks_completed": progress["tasks_completed"],
            "critical_task_count": critical_path["critical_task_count"] if critical_path["available"] else None,
            "median_float_days": critical_path["median_float_days"] if critical_path["available"] else None,
        }
        if existing is not None:
            for key, value in values.items():
                setattr(existing, key, value)
        else:
            self.session.add(
                ObraProgressDaily(obra_id=obra.id, tenant_id=obra.tenant_id, date=today, **values)
            )
        await self.session.flush()

    def _nearest_tracked_value(
        self, tracked_rows: list[tuple[date, float | None]], target: date
    ) -> float | None:
        """Fila de `tracked_rows` más cercana a `target` dentro de la
        tolerancia (§I-05). `None` si no hay ninguna — el punto queda sin
        dato real, no en 0."""
        best: float | None = None
        best_distance: int | None = None
        for d, value in tracked_rows:
            distance = abs((d - target).days)
            if distance > _CURVA_S_MATCH_TOLERANCE_DAYS:
                continue
            if best_distance is None or distance < best_distance:
                best_distance = distance
                best = value
        return best

    def _curva_s_range(
        self, obra: Obra | None, calendar, tasks: list[Task], from_date: date | None, to_date: date | None
    ) -> tuple[date | None, date | None]:
        span = dashboard_calc.planned_span(calendar, tasks)
        start = from_date or (obra.start_date if obra else None) or (span[0] if span else None)
        end = to_date or (obra.expected_end_date if obra else None) or (span[1] if span else None)
        return start, end

    async def get_curva_s(
        self, obra_id: int, from_date: date | None = None, to_date: date | None = None
    ) -> dict[str, Any]:
        """I-05 — curva S. `planned` se calcula al vuelo (determinístico, no
        necesita historia guardada); `real` sale de `obra_progress_daily` y es
        `None` antes de `tracking_since` — el gráfico corta la línea, no la
        manda a cero. Solo semanal por ahora (§10 del diseño no pide más)."""
        obra = await self.obra_repo.get(obra_id)
        tasks = await self.task_repo.list_by_obra(obra_id)
        calendar = await self.calendar_repo.get_for_obra(obra_id)
        span_start, span_end = self._curva_s_range(obra, calendar, tasks, from_date, to_date)

        tracking_since = (
            await self.session.execute(
                select(func.min(ObraProgressDaily.date)).where(ObraProgressDaily.obra_id == obra_id)
            )
        ).scalar_one_or_none()

        points: list[dict[str, Any]] = []
        if span_start is not None and span_end is not None:
            tracked_rows: list[tuple[date, float | None]] = []
            if tracking_since is not None:
                # Ventana con margen: el job corre todos los días desde
                # `tracking_since`, pero anclado al día en que arrancó a
                # trackear, no al día de la semana del inicio de la obra —
                # una fila casi nunca cae justo en un punto semanal del
                # gráfico. Se busca la más cercana dentro de una tolerancia,
                # no una coincidencia exacta.
                result = (
                    await self.session.execute(
                        select(ObraProgressDaily.date, ObraProgressDaily.progress_real).where(
                            ObraProgressDaily.obra_id == obra_id,
                            ObraProgressDaily.date >= span_start - timedelta(days=_CURVA_S_MATCH_TOLERANCE_DAYS),
                            ObraProgressDaily.date <= span_end + timedelta(days=_CURVA_S_MATCH_TOLERANCE_DAYS),
                        )
                    )
                ).all()
                tracked_rows = [(d, float(r) if r is not None else None) for d, r in result]

            d = span_start
            while d <= span_end:
                planned = dashboard_calc.weighted_planned_progress(calendar, tasks, d)
                points.append({
                    "date": d.isoformat(),
                    "planned": round(planned, 2) if planned is not None else 0.0,
                    "real": self._nearest_tracked_value(tracked_rows, d),
                })
                d += timedelta(days=7)

        return {
            "granularity": "week",
            "tracking_since": tracking_since.isoformat() if tracking_since else None,
            "points": points,
        }

    async def get_monthly_insights(self, obra_id: int, current_user_role: str) -> dict[str, Any]:
        """I-12/I-13 — última foto mensual (`ObraStatsSnapshot`). No se
        recalcula acá, se lee el snapshot que ya escribe el job mensual.
        D-01: el ranking por responsable (I-12) se filtra en el backend para
        quien no sea admin — la clave ni siquiera viaja en el JSON."""
        from app.models.obra_stats_snapshot import ObraStatsSnapshot

        snapshot = (
            await self.session.execute(
                select(ObraStatsSnapshot)
                .where(ObraStatsSnapshot.obra_id == obra_id)
                .order_by(ObraStatsSnapshot.period.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if snapshot is None:
            return {"available": False, "period": None, "computed_at": None,
                    "risk_concentration": None, "estimation_accuracy": None,
                    "top_deviations": None, "bitacora_themes": None, "alert_reaction": None}

        metrics = snapshot.metrics or {}
        risk_concentration = dict(metrics.get("risk_concentration") or {})
        if current_user_role != "admin":
            risk_concentration.pop("by_responsible", None)

        return {
            "available": True,
            "period": snapshot.period,
            "computed_at": snapshot.computed_at.isoformat(),
            "risk_concentration": risk_concentration,
            "estimation_accuracy": metrics.get("estimation_accuracy"),
            # I-14/I-15/I-16: sin filtro de rol — a diferencia de by_responsible
            # arriba, ninguna trae ranking por persona (D-04 lo resuelve el front
            # no renderizando responsible_id/triggered_by, el JSON viaja completo).
            # No es un criterio nuevo: risk_concentration["by_task"] ya viaja sin
            # filtrar con responsible_id en cada fila (D-01 solo exige admin para
            # by_responsible, el ranking por tarea "lo ve cualquiera").
            "top_deviations": metrics.get("top_deviations"),
            "bitacora_themes": metrics.get("bitacora_themes"),
            "alert_reaction": metrics.get("alert_reaction"),
        }
