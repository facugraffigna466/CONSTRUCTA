"""Motor de estadísticas de obra (insights, etapa 2) — determinístico, sin IA.

Calcula 5 métricas verificables a mano sobre una obra y las persiste en
`obra_stats_snapshots`. Ninguna de estas métricas necesita un modelo de lenguaje:
todo sale de las tablas `tasks`, `historial_eventos`, `bitacora_entries` y
`alerts`. La etapa siguiente (redacción del informe) lee el JSON resultante —
el contrato está documentado en `docs/features/insights-etapa-2-estadisticas.md`.

Métricas:
  1. estimation_accuracy  — precisión de estimación por disciplina
  2. bitacora_themes      — temas recurrentes en bitácora y su correlación con retrasos
  3. top_deviations       — paquete de evidencia de los mayores desvíos (datos, no narración)
  4. risk_concentration   — concentración 80/20 de los días de retraso
  5. alert_reaction       — velocidad de reacción a alertas

Alcance temporal: cada snapshot cubre un mes (`period`, "YYYY-MM") pero las
métricas se calculan **acumuladas hasta el fin de ese mes**, no solo con los
datos del mes. Un desvío de cronograma o una concentración 80/20 no son
magnitudes mensuales; la etapa de IA puede derivar la variación mes a mes
comparando dos snapshots consecutivos.
"""
import calendar
import logging
import math
import re
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.alert import Alert, AlertType
from app.models.bitacora import BitacoraEntry
from app.models.historial import HistorialEvento
from app.models.obra import Obra, ObraStatus
from app.models.obra_stats_snapshot import ObraStatsSnapshot
from app.models.responsible import Responsible
from app.models.task import Task, TaskStatus, task_dependencies_table
from app.services.plano_service import _norm, match_discipline_in_text

logger = logging.getLogger(__name__)

SCHEMA_VERSION = 1

# ── Parámetros ajustables ─────────────────────────────────────────────────────
# Ventana para correlacionar una mención de bitácora con un retraso posterior.
# 5 días = una semana laboral: si el material que faltaba el lunes frena algo,
# se nota dentro de esa semana. Subirlo infla la correlación (más chances de
# encontrar CUALQUIER retraso); bajarlo la vuelve ciega a efectos diferidos.
CORRELATION_WINDOW_DAYS = 5

# "Top 20%" del clásico Pareto. El universo es el de tareas CON retraso (>0 días),
# no todas las tareas: incluir las que terminaron en fecha diluye el percentil y
# haría que "el top 20%" sea en realidad "casi todas las atrasadas".
CONCENTRATION_TOP_PERCENT = 20

# Cuántas tareas desviadas se documentan con paquete de evidencia completo.
TOP_DEVIATIONS_COUNT = 3

# Tope de eventos de historial que se adjuntan por tarea en el paquete de
# evidencia (los más recientes), para que el JSON no crezca sin control.
MAX_HISTORIAL_EVENTS_PER_TASK = 30

# Alertas que cuentan como "señal de retraso" para la correlación de la métrica 2.
DELAY_ALERT_TYPES = {
    AlertType.TASK_OVERDUE,
    AlertType.DELAY_RISK,
    AlertType.RESCHEDULE_REQUESTED,
}

# Obras que el job mensual NO procesa.
INACTIVE_OBRA_STATUSES = {ObraStatus.COMPLETADA, ObraStatus.CANCELADA}

# ── Categorías de bitácora ────────────────────────────────────────────────────
# Mismo patrón que DISCIPLINE_SYNONYMS de plano_service: matcheo por palabra
# completa sobre texto normalizado (minúsculas sin acentos). Es una aproximación
# por palabras clave — NO comprensión semántica. Un audio que dice "no vino el
# camión con el hierro" no matchea "falta_material" salvo que use una de estas
# palabras. La etapa de IA puede leer el transcript y matizarlo; acá se cuenta.
BITACORA_THEME_SYNONYMS: dict[str, list[str]] = {
    "falta_material": [
        "falta material", "falta de material", "faltan materiales", "faltaron materiales",
        "sin material", "sin materiales", "no llego el material", "falto material",
        "sin stock", "no hay stock", "falta hormigon", "falta hierro", "falta cemento",
        "falta arena", "falta ladrillo", "faltan ladrillos",
    ],
    "clima": [
        "lluvia", "lluvias", "llovio", "llovia", "lloviendo", "tormenta", "temporal",
        "granizo", "viento", "helada", "nevada", "barro", "anegado", "inundado",
    ],
    "ausencia_personal": [
        "falto personal", "falta de personal", "sin personal", "no vino", "no vinieron",
        "falto el", "faltaron", "ausente", "ausencia", "licencia", "enfermo",
        "de baja", "paro general", "huelga", "sin cuadrilla", "sin gente",
    ],
    "proveedor": [
        "proveedor", "proveedores", "corralon", "demora en la entrega", "no entrego",
        "no entregaron", "remito", "flete", "pedido pendiente", "no facturo",
    ],
    "problema_tecnico": [
        "rotura", "roto", "se rompio", "falla", "fallo", "defecto", "mal ejecutado",
        "hay que rehacer", "rehacer", "filtracion", "fisura", "grieta", "desnivel",
        "fuera de plomo", "no cierra la medida", "error de replanteo",
    ],
    "equipos_maquinaria": [
        "maquina", "maquinaria", "grua", "hormigonera", "retroexcavadora", "andamio",
        "andamios", "bomba", "compresor", "sin herramientas", "se corto la luz",
        "sin energia", "generador",
    ],
    "seguridad": [
        "accidente", "incidente", "lesion", "lesionado", "se lastimo", "casco",
        "arnes", "riesgo de caida", "art", "inseguro",
    ],
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _as_utc(dt: datetime | None) -> datetime | None:
    """Normaliza a UTC consciente de zona. SQLite (tests) devuelve naive; PG aware."""
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def _iso(value: date | datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def _parse_date(value: Any) -> date | None:
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, str):
        try:
            return date.fromisoformat(value[:10])
        except ValueError:
            return None
    return None


def period_bounds(period: str) -> tuple[date, date]:
    """('2026-08') → (2026-08-01, 2026-08-31)."""
    year, month = int(period[:4]), int(period[5:7])
    last_day = calendar.monthrange(year, month)[1]
    return date(year, month, 1), date(year, month, last_day)


def previous_period(today: date | None = None) -> str:
    """Mes cerrado anterior a `today` — lo que el job del día 1 tiene que reportar."""
    ref = today or datetime.now(timezone.utc).date()
    first_of_this_month = ref.replace(day=1)
    last_of_prev = first_of_this_month - timedelta(days=1)
    return f"{last_of_prev.year:04d}-{last_of_prev.month:02d}"


def match_themes(text: str) -> dict[str, list[str]]:
    """Categorías mencionadas en un texto → keywords que dispararon el match.

    Matcheo por palabra/frase completa (\\b) sobre texto normalizado, igual que
    `match_discipline_in_text`. Una entrada puede matchear varias categorías.
    """
    if not text:
        return {}
    normalized = _norm(text)
    hits: dict[str, list[str]] = {}
    for category, keywords in BITACORA_THEME_SYNONYMS.items():
        matched = [k for k in keywords if re.search(rf"\b{re.escape(k)}\b", normalized)]
        if matched:
            hits[category] = matched
    return hits


def _bitacora_text(entry: BitacoraEntry) -> str:
    parts: list[str] = [entry.transcript or "", entry.summary or ""]
    if isinstance(entry.key_points, list):
        parts.extend(str(p) for p in entry.key_points)
    return " ".join(p for p in parts if p)


def _completed_within(task: Task, period_end: date) -> bool:
    """¿La tarea ya estaba cerrada al final del período que cubre el snapshot?"""
    return (
        task.status == TaskStatus.COMPLETADA
        and task.completed_date is not None
        and task.completed_date <= period_end
    )


def _task_discipline(task: Task) -> str:
    """Disciplina de una tarea. El modelo Task NO tiene campo de disciplina: se
    infiere del título con los sinónimos de plano_service. Aproximación por
    palabras clave, no un dato explícito — así se reporta en el JSON."""
    return match_discipline_in_text(task.title or "") or "sin_disciplina"


def _percentile_cutoff(n_items: int, top_percent: int) -> int:
    """Cuántos ítems entran en el top X% (redondeo hacia arriba, mínimo 1)."""
    if n_items <= 0:
        return 0
    return max(1, math.ceil(n_items * top_percent / 100))


class ObraStatsService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # ── API pública ───────────────────────────────────────────────────────────

    async def compute(self, obra_id: int, period: str | None = None) -> dict[str, Any]:
        """Calcula las 5 métricas de una obra. No escribe nada en la DB."""
        period = period or previous_period()
        period_start, period_end = period_bounds(period)
        cutoff = datetime.combine(period_end, datetime.max.time(), tzinfo=timezone.utc)

        obra = await self.session.get(Obra, obra_id)
        if obra is None:
            raise ValueError(f"Obra {obra_id} no existe")

        tasks = list((await self.session.execute(
            select(Task).where(Task.obra_id == obra_id)
        )).scalars().all())
        events = [
            e for e in (await self.session.execute(
                select(HistorialEvento)
                .where(HistorialEvento.obra_id == obra_id)
                .order_by(HistorialEvento.created_at)
            )).scalars().all()
            if (_as_utc(e.created_at) or cutoff) <= cutoff
        ]
        bitacoras = [
            b for b in (await self.session.execute(
                select(BitacoraEntry)
                .where(BitacoraEntry.obra_id == obra_id)
                .order_by(BitacoraEntry.created_at)
            )).scalars().all()
            if (_as_utc(b.created_at) or cutoff) <= cutoff
        ]
        alerts = [
            a for a in (await self.session.execute(
                select(Alert).where(Alert.obra_id == obra_id).order_by(Alert.created_at)
            )).scalars().all()
            if (_as_utc(a.created_at) or cutoff) <= cutoff
        ]

        events_by_task: dict[int, list[HistorialEvento]] = defaultdict(list)
        for ev in events:
            if ev.task_id is not None:
                events_by_task[ev.task_id].append(ev)

        deviations, deviation_gaps = self._task_deviations(tasks, period_end)
        delay_signals = self._delay_signals(events, alerts)

        return {
            "schema_version": SCHEMA_VERSION,
            "obra": {
                "id": obra.id,
                "name": obra.name,
                "status": obra.status.value,
                "start_date": _iso(obra.start_date),
                "expected_end_date": _iso(obra.expected_end_date),
                "task_count": len(tasks),
                "completed_task_count": sum(1 for t in tasks if t.status == TaskStatus.COMPLETADA),
            },
            "period": period,
            "period_start": _iso(period_start),
            "period_end": _iso(period_end),
            "scope": "cumulative_to_period_end",
            "computed_at": datetime.now(timezone.utc).isoformat(),
            "params": {
                "correlation_window_days": CORRELATION_WINDOW_DAYS,
                "concentration_top_percent": CONCENTRATION_TOP_PERCENT,
                "top_deviations_count": TOP_DEVIATIONS_COUNT,
                "discipline_source": "keyword_proxy",
            },
            "data_quality": {
                "note": (
                    "Tareas que quedaron fuera del cálculo de desvíos (métricas 3 y 4) "
                    "por falta de datos, no por no tener retraso."
                ),
                "tasks_excluded_from_deviations": deviation_gaps,
            },
            "estimation_accuracy": self._estimation_accuracy(tasks, events_by_task, period_end),
            "bitacora_themes": self._bitacora_themes(bitacoras, delay_signals),
            "top_deviations": await self._top_deviations(
                tasks, deviations, events_by_task, bitacoras, alerts, period_end
            ),
            "risk_concentration": await self._risk_concentration(tasks, deviations),
            "alert_reaction": self._alert_reaction(alerts),
        }

    async def snapshot(self, obra_id: int, period: str | None = None) -> ObraStatsSnapshot:
        """Calcula y persiste el snapshot. Si ya existe uno para (obra, period), lo pisa."""
        period = period or previous_period()
        metrics = await self.compute(obra_id, period)
        obra = await self.session.get(Obra, obra_id)

        existing = (await self.session.execute(
            select(ObraStatsSnapshot).where(
                ObraStatsSnapshot.obra_id == obra_id,
                ObraStatsSnapshot.period == period,
            )
        )).scalar_one_or_none()

        if existing is not None:
            existing.metrics = metrics
            existing.computed_at = datetime.now(timezone.utc)
            existing.tenant_id = obra.tenant_id if obra else None
            snapshot = existing
        else:
            snapshot = ObraStatsSnapshot(
                obra_id=obra_id,
                tenant_id=obra.tenant_id if obra else None,
                period=period,
                metrics=metrics,
            )
            self.session.add(snapshot)

        await self.session.flush()
        return snapshot

    async def snapshot_all_active(self, period: str | None = None) -> list[ObraStatsSnapshot]:
        """Un snapshot por cada obra activa (todas menos completadas y canceladas)."""
        period = period or previous_period()
        obras = list((await self.session.execute(
            select(Obra).where(Obra.status.notin_(list(INACTIVE_OBRA_STATUSES)))
        )).scalars().all())

        snapshots: list[ObraStatsSnapshot] = []
        for obra in obras:
            try:
                snapshots.append(await self.snapshot(obra.id, period))
            except Exception:
                # Una obra con datos raros no puede tumbar el job entero.
                logger.exception("Insights: falló el snapshot de la obra %d (%s)", obra.id, period)
        return snapshots

    # ── Métrica 1 — precisión de estimación por disciplina ────────────────────

    def _real_start(
        self, task: Task, events_by_task: dict[int, list[HistorialEvento]]
    ) -> tuple[date | None, str]:
        """Fecha de inicio REAL de una tarea, con la fuente de donde salió.

        No hay columna `actual_start_date` en el modelo: se reconstruye del primer
        evento de historial que la puso EN_PROGRESO (por la app o por el chatbot).
        Si nunca hubo ese evento, cae a la fecha planificada y se declara.
        """
        for ev in events_by_task.get(task.id, []):
            payload = ev.payload or {}
            if ev.event_type == "task_status_changed" and payload.get("to") == TaskStatus.EN_PROGRESO.value:
                started = _as_utc(ev.created_at)
                if started:
                    return started.date(), "historial_status_changed"
            if ev.event_type == "task_updated":
                status_change = (payload.get("changes") or {}).get("status") or {}
                if status_change.get("to") == TaskStatus.EN_PROGRESO.value:
                    started = _as_utc(ev.created_at)
                    if started:
                        return started.date(), "historial_task_updated"
        return task.start_date, "planned_start_date_fallback"

    def _estimation_accuracy(
        self,
        tasks: list[Task],
        events_by_task: dict[int, list[HistorialEvento]],
        period_end: date,
    ) -> dict[str, Any]:
        by_discipline: dict[str, list[dict[str, Any]]] = defaultdict(list)
        excluded: dict[str, int] = defaultdict(int)

        for task in tasks:
            if task.status != TaskStatus.COMPLETADA:
                excluded["sin_completar"] += 1
                continue
            if task.completed_date is None:
                excluded["sin_fecha_de_completado"] += 1
                continue
            if not _completed_within(task, period_end):
                # Cerró después del período que cubre este snapshot.
                excluded["completada_despues_del_periodo"] += 1
                continue
            if task.start_date is None or task.due_date is None:
                excluded["sin_fechas_planificadas"] += 1
                continue

            planned_days = (task.due_date - task.start_date).days + 1
            if planned_days <= 0:
                excluded["fechas_planificadas_inconsistentes"] += 1
                continue

            actual_start, source = self._real_start(task, events_by_task)
            if actual_start is None:
                excluded["sin_inicio_real"] += 1
                continue

            actual_days = (task.completed_date - actual_start).days + 1
            if actual_days <= 0:
                # Completada antes de arrancar: dato inconsistente, no se inventa.
                excluded["fechas_reales_inconsistentes"] += 1
                continue

            by_discipline[_task_discipline(task)].append({
                "task_id": task.id,
                "title": task.title,
                "planned_days": planned_days,
                "actual_days": actual_days,
                "deviation_days": actual_days - planned_days,
                "deviation_percent": round((actual_days - planned_days) / planned_days * 100, 1),
                "actual_start": _iso(actual_start),
                "actual_start_source": source,
            })

        disciplines = []
        for discipline, rows in by_discipline.items():
            total_planned = sum(r["planned_days"] for r in rows)
            total_actual = sum(r["actual_days"] for r in rows)
            disciplines.append({
                "discipline": discipline,
                "task_count": len(rows),
                "avg_deviation_percent": round(
                    sum(r["deviation_percent"] for r in rows) / len(rows), 1
                ),
                "total_planned_days": total_planned,
                "total_actual_days": total_actual,
                "avg_planned_days": round(total_planned / len(rows), 1),
                "avg_actual_days": round(total_actual / len(rows), 1),
                "tasks": sorted(rows, key=lambda r: r["deviation_percent"], reverse=True),
            })
        disciplines.sort(key=lambda d: d["avg_deviation_percent"], reverse=True)

        return {
            "method": "keyword_proxy",
            "note": (
                "El modelo Task no tiene campo de disciplina: se infiere del título con "
                "DISCIPLINE_SYNONYMS de plano_service (match por palabra completa). Es una "
                "aproximación por palabras clave, no un dato explícito del modelo. Las tareas "
                "cuyo título no matchea ninguna disciplina quedan en 'sin_disciplina'."
            ),
            "tasks_considered": sum(len(r) for r in by_discipline.values()),
            "tasks_excluded": dict(excluded),
            "by_discipline": disciplines,
        }

    # ── Métrica 2 — temas de bitácora y correlación con retrasos ──────────────

    def _delay_signals(
        self, events: list[HistorialEvento], alerts: list[Alert]
    ) -> list[dict[str, Any]]:
        """Eventos objetivos que cuentan como 'acá hubo un retraso o un bloqueo'.

        Son cuatro señales, todas con timestamp propio: tarea bloqueada, fecha de
        fin empujada hacia adelante, reprogramación en cascada, y alerta de
        retraso/vencimiento/pedido de reprogramación.
        """
        signals: list[dict[str, Any]] = []

        for ev in events:
            payload = ev.payload or {}
            when = _as_utc(ev.created_at)
            if when is None:
                continue

            if ev.event_type == "task_status_changed" and payload.get("to") == TaskStatus.BLOQUEADA.value:
                signals.append({
                    "type": "task_blocked", "at": when, "task_id": ev.task_id,
                    "historial_id": ev.id, "detail": ev.description,
                })

            if ev.event_type == "task_updated":
                due_change = (payload.get("changes") or {}).get("due_date") or {}
                old_due, new_due = _parse_date(due_change.get("from")), _parse_date(due_change.get("to"))
                if old_due and new_due and new_due > old_due:
                    signals.append({
                        "type": "due_date_pushed", "at": when, "task_id": ev.task_id,
                        "historial_id": ev.id,
                        "detail": f"Fin {old_due.isoformat()} → {new_due.isoformat()} (+{(new_due - old_due).days} días)",
                    })

            if ev.event_type == "task_cascade_rescheduled":
                affected = payload.get("affected") or []
                signals.append({
                    "type": "cascade_reschedule", "at": when, "task_id": ev.task_id,
                    "historial_id": ev.id,
                    "detail": f"{len(affected)} tarea(s) reprogramadas en cascada",
                })

        for alert in alerts:
            when = _as_utc(alert.created_at)
            if when is None or alert.type not in DELAY_ALERT_TYPES:
                continue
            signals.append({
                "type": f"alert_{alert.type.value}", "at": when, "task_id": alert.task_id,
                "alert_id": alert.id, "detail": alert.message,
            })

        signals.sort(key=lambda s: s["at"])
        return signals

    def _bitacora_themes(
        self, bitacoras: list[BitacoraEntry], delay_signals: list[dict[str, Any]]
    ) -> dict[str, Any]:
        window = timedelta(days=CORRELATION_WINDOW_DAYS)
        per_category: dict[str, list[dict[str, Any]]] = defaultdict(list)
        entries_with_any = 0

        for entry in bitacoras:
            created = _as_utc(entry.created_at)
            if created is None:
                continue
            hits = match_themes(_bitacora_text(entry))
            if not hits:
                continue
            entries_with_any += 1

            # Señales dentro de (mención, mención + N días]. Se compara con el
            # timestamp completo, no solo la fecha: una nota a las 9 y un bloqueo
            # a las 15 del mismo día cuentan como correlacionados.
            following = [
                {**s, "at": s["at"].isoformat()}
                for s in delay_signals
                if created <= s["at"] <= created + window
            ]

            for category, keywords in hits.items():
                per_category[category].append({
                    "bitacora_id": entry.id,
                    "at": created.isoformat(),
                    "matched_keywords": keywords,
                    "summary": entry.summary,
                    "delay_signals": following,
                })

        categories = []
        for category, occurrences in per_category.items():
            with_delay = [o for o in occurrences if o["delay_signals"]]
            categories.append({
                "category": category,
                "mentions": len(occurrences),
                "mentions_followed_by_delay": len(with_delay),
                "correlation_rate": round(len(with_delay) / len(occurrences), 2),
                "occurrences": occurrences,
            })
        categories.sort(key=lambda c: (c["mentions_followed_by_delay"], c["mentions"]), reverse=True)

        return {
            "method": "keyword_proxy",
            "note": (
                "Correlación temporal, NO causalidad: dice que después de mencionar X hubo un "
                "retraso dentro de la ventana, no que X lo haya causado. El matcheo de categorías "
                "es por palabras clave sobre transcript/summary/key_points."
            ),
            "correlation_window_days": CORRELATION_WINDOW_DAYS,
            "delay_signal_types": [
                "task_blocked", "due_date_pushed", "cascade_reschedule",
                *[f"alert_{t.value}" for t in sorted(DELAY_ALERT_TYPES, key=lambda x: x.value)],
            ],
            "entries_analyzed": len(bitacoras),
            "entries_with_any_category": entries_with_any,
            "delay_signals_total": len(delay_signals),
            "categories": categories,
        }

    # ── Desvíos de cronograma (base de las métricas 3 y 4) ────────────────────

    def _task_deviations(
        self, tasks: list[Task], period_end: date
    ) -> tuple[dict[int, dict[str, Any]], dict[str, int]]:
        """Desvío en días entre el fin planificado y el fin real de cada tarea.

        Completada  → completed_date - due_date (puede ser negativo: terminó antes).
        Sin cerrar  → period_end - due_date si ya se pasó de fecha, si no 0.
        Canceladas y tareas sin due_date quedan fuera (no hay contra qué medir).

        Devuelve además un contador de datos que no se pudieron medir, para que
        la etapa de IA sepa sobre cuánto NO está hablando.
        """
        out: dict[int, dict[str, Any]] = {}
        skipped: dict[str, int] = defaultdict(int)
        for task in tasks:
            if task.status == TaskStatus.CANCELADA:
                skipped["canceladas"] += 1
                continue
            if task.due_date is None:
                skipped["sin_fecha_de_fin_planificada"] += 1
                continue
            # Completada pero sin completed_date: hoy solo el endpoint /status
            # setea esa fecha; un PATCH genérico puede dejar la tarea cerrada sin
            # ella. Medirla contra period_end inventaría un atraso enorme que no
            # existe, así que se excluye y se declara.
            if task.status == TaskStatus.COMPLETADA and task.completed_date is None:
                skipped["completadas_sin_fecha_de_completado"] += 1
                continue
            # Una tarea completada DESPUÉS del período se considera abierta a esa
            # fecha: el snapshot de junio no puede saber que cerró en julio. Esto
            # hace que recalcular un mes viejo devuelva siempre lo mismo.
            if _completed_within(task, period_end):
                deviation = (task.completed_date - task.due_date).days
                basis, reference = "completed_vs_due", task.completed_date
            else:
                deviation = max(0, (period_end - task.due_date).days)
                basis, reference = "open_vs_period_end", period_end
            out[task.id] = {
                "task_id": task.id,
                "title": task.title,
                "status": task.status.value,
                "discipline": _task_discipline(task),
                "responsible_id": task.responsible_id,
                "start_date": _iso(task.start_date),
                "due_date": _iso(task.due_date),
                "completed_date": _iso(task.completed_date),
                "deviation_days": deviation,
                "delay_days": max(0, deviation),
                "basis": basis,
                "reference_date": _iso(reference),
            }
        return out, dict(skipped)

    # ── Métrica 3 — evidencia de los mayores desvíos ──────────────────────────

    async def _top_deviations(
        self,
        tasks: list[Task],
        deviations: dict[int, dict[str, Any]],
        events_by_task: dict[int, list[HistorialEvento]],
        bitacoras: list[BitacoraEntry],
        alerts: list[Alert],
        period_end: date,
    ) -> dict[str, Any]:
        ranked = sorted(
            [d for d in deviations.values() if d["deviation_days"] != 0],
            key=lambda d: abs(d["deviation_days"]),
            reverse=True,
        )[:TOP_DEVIATIONS_COUNT]

        tasks_by_id = {t.id: t for t in tasks}
        items = []
        for dev in ranked:
            task = tasks_by_id[dev["task_id"]]
            predecessors = await self._predecessor_ids(task.id)
            reference = _parse_date(dev["reference_date"]) or period_end
            due = _parse_date(dev["due_date"])
            window_start = (due - timedelta(days=CORRELATION_WINDOW_DAYS)) if due else None

            # Bitácoras de los días previos al desvío que mencionan alguna categoría.
            mentions = []
            for entry in bitacoras:
                created = _as_utc(entry.created_at)
                if created is None:
                    continue
                entry_date = created.date()
                if window_start and not (window_start <= entry_date <= reference):
                    continue
                hits = match_themes(_bitacora_text(entry))
                if hits:
                    mentions.append({
                        "bitacora_id": entry.id,
                        "at": created.isoformat(),
                        "categories": sorted(hits.keys()),
                        "matched_keywords": sorted({k for ks in hits.values() for k in ks}),
                        "summary": entry.summary,
                    })

            related_alerts = [
                {
                    "alert_id": a.id, "type": a.type.value, "task_id": a.task_id,
                    "message": a.message,
                    "created_at": _iso(_as_utc(a.created_at)),
                    "resolved_at": _iso(_as_utc(a.resolved_at)),
                    "on_predecessor": a.task_id in predecessors,
                }
                for a in alerts
                if a.task_id == task.id or a.task_id in predecessors
            ]

            task_events = events_by_task.get(task.id, [])[-MAX_HISTORIAL_EVENTS_PER_TASK:]
            history = [
                {
                    "historial_id": e.id, "event_type": e.event_type,
                    "description": e.description, "payload": e.payload,
                    "triggered_by": e.triggered_by,
                    "created_at": _iso(_as_utc(e.created_at)),
                }
                for e in task_events
            ]

            items.append({
                "task": dev,
                "predecessor_task_ids": sorted(predecessors),
                "historial_events": history,
                "bitacora_mentions": mentions,
                "alerts": related_alerts,
                "cascade_impact": await self._cascade_impact(task.id, events_by_task),
            })

        return {
            "note": (
                "Paquete de evidencia con IDs y fechas para que la etapa de IA redacte el "
                "porqué. Acá no hay ninguna interpretación: son los datos crudos asociados "
                "a cada desvío."
            ),
            "ranked_by": "abs(deviation_days)",
            "count": len(items),
            "items": items,
        }

    async def _predecessor_ids(self, task_id: int) -> set[int]:
        """Tareas de las que depende esta (M2M nueva + depends_on_id heredado)."""
        rows = (await self.session.execute(
            select(task_dependencies_table.c.depends_on_id)
            .where(task_dependencies_table.c.task_id == task_id)
        )).scalars().all()
        predecessors = {r for r in rows if r is not None}

        legacy = (await self.session.execute(
            select(Task.depends_on_id).where(Task.id == task_id)
        )).scalar_one_or_none()
        if legacy is not None:
            predecessors.add(legacy)
        return predecessors

    async def _cascade_impact(
        self, task_id: int, events_by_task: dict[int, list[HistorialEvento]]
    ) -> dict[str, Any]:
        """Cuántas tareas dependientes se empujaron por causa de esta."""
        direct = (await self.session.execute(
            select(task_dependencies_table.c.task_id)
            .where(task_dependencies_table.c.depends_on_id == task_id)
        )).scalars().all()

        cascade_events: list[dict[str, Any]] = []
        pushed: set[int] = set()
        for ev in events_by_task.get(task_id, []):
            if ev.event_type != "task_cascade_rescheduled":
                continue
            payload = ev.payload or {}
            if payload.get("source_task_id") != task_id:
                continue
            affected = payload.get("affected") or []
            pushed.update(a.get("task_id") for a in affected if a.get("task_id") is not None)
            cascade_events.append({
                "historial_id": ev.id,
                "at": _iso(_as_utc(ev.created_at)),
                "affected_count": len(affected),
                "affected_task_ids": [a.get("task_id") for a in affected],
            })

        return {
            "direct_dependent_count": len({d for d in direct if d is not None}),
            "direct_dependent_task_ids": sorted({d for d in direct if d is not None}),
            "cascade_events": cascade_events,
            "tasks_pushed_by_cascade": sorted(pushed),
        }

    # ── Métrica 4 — concentración de riesgo (80/20) ───────────────────────────

    async def _risk_concentration(
        self, tasks: list[Task], deviations: dict[int, dict[str, Any]]
    ) -> dict[str, Any]:
        delayed = sorted(
            [d for d in deviations.values() if d["delay_days"] > 0],
            key=lambda d: d["delay_days"],
            reverse=True,
        )
        total_delay = sum(d["delay_days"] for d in delayed)

        cutoff = _percentile_cutoff(len(delayed), CONCENTRATION_TOP_PERCENT)
        top_tasks = delayed[:cutoff]
        top_delay = sum(d["delay_days"] for d in top_tasks)

        # Por responsable
        by_responsible: dict[int, int] = defaultdict(int)
        for dev in delayed:
            if dev["responsible_id"] is not None:
                by_responsible[dev["responsible_id"]] += dev["delay_days"]

        names: dict[int, str] = {}
        if by_responsible:
            rows = (await self.session.execute(
                select(Responsible.id, Responsible.full_name)
                .where(Responsible.id.in_(list(by_responsible.keys())))
            )).all()
            names = {rid: full_name for rid, full_name in rows}

        responsible_rank = sorted(
            [
                {
                    "responsible_id": rid,
                    "name": names.get(rid),
                    "delay_days": days,
                    "task_count": sum(
                        1 for d in delayed if d["responsible_id"] == rid
                    ),
                }
                for rid, days in by_responsible.items()
            ],
            key=lambda r: r["delay_days"],
            reverse=True,
        )
        resp_cutoff = _percentile_cutoff(len(responsible_rank), CONCENTRATION_TOP_PERCENT)
        top_responsibles = responsible_rank[:resp_cutoff]
        total_resp_delay = sum(r["delay_days"] for r in responsible_rank)
        top_resp_delay = sum(r["delay_days"] for r in top_responsibles)

        return {
            "note": (
                f"Universo = tareas con retraso > 0 (no todas las tareas): incluir las que "
                f"cerraron en fecha diluiría el percentil. Top {CONCENTRATION_TOP_PERCENT}% "
                f"con redondeo hacia arriba y mínimo 1."
            ),
            "top_percent": CONCENTRATION_TOP_PERCENT,
            "by_task": {
                "tasks_considered": len(deviations),
                "tasks_with_delay": len(delayed),
                "total_delay_days": total_delay,
                "top_task_count": cutoff,
                "top_delay_days": top_delay,
                "concentration_percent": (
                    round(top_delay / total_delay * 100, 1) if total_delay else 0.0
                ),
                "ranking": delayed,
            },
            "by_responsible": {
                "responsibles_with_delay": len(responsible_rank),
                "total_delay_days": total_resp_delay,
                "top_responsible_count": resp_cutoff,
                "top_delay_days": top_resp_delay,
                "concentration_percent": (
                    round(top_resp_delay / total_resp_delay * 100, 1) if total_resp_delay else 0.0
                ),
                "unassigned_delay_days": total_delay - total_resp_delay,
                "ranking": responsible_rank,
            },
        }

    # ── Métrica 5 — velocidad de reacción a alertas ───────────────────────────

    def _alert_reaction(self, alerts: list[Alert]) -> dict[str, Any]:
        per_type: dict[str, list[float]] = defaultdict(list)
        unresolved: dict[str, int] = defaultdict(int)
        missing_timestamp = 0

        for alert in alerts:
            created, resolved = _as_utc(alert.created_at), _as_utc(alert.resolved_at)
            type_name = alert.type.value
            if resolved is None:
                if alert.is_read:
                    # Resuelta antes de que existiera resolved_at (migración 0062).
                    missing_timestamp += 1
                else:
                    unresolved[type_name] += 1
                continue
            if created is None:
                missing_timestamp += 1
                continue
            per_type[type_name].append((resolved - created).total_seconds() / 3600)

        by_type = sorted(
            [
                {
                    "type": type_name,
                    "resolved_count": len(hours),
                    "avg_hours": round(sum(hours) / len(hours), 2),
                    "min_hours": round(min(hours), 2),
                    "max_hours": round(max(hours), 2),
                }
                for type_name, hours in per_type.items()
            ],
            key=lambda r: r["avg_hours"],
            reverse=True,
        )
        all_hours = [h for hours in per_type.values() for h in hours]

        return {
            "note": (
                "'Resuelta' = marcada como leída (manual o auto-resolve). Las alertas "
                "resueltas antes de la migración 0062 no tienen resolved_at y se excluyen: "
                "el conteo está en alerts_resolved_without_timestamp."
            ),
            "alerts_total": len(alerts),
            "alerts_measured": len(all_hours),
            "alerts_resolved_without_timestamp": missing_timestamp,
            "alerts_unresolved_by_type": dict(unresolved),
            "overall_avg_hours": round(sum(all_hours) / len(all_hours), 2) if all_hours else None,
            "by_type": by_type,
        }


# ── Disparo manual (consola / tests, sin endpoint HTTP) ───────────────────────

async def run_obra_snapshot(obra_id: int, period: str | None = None) -> dict[str, Any]:
    """Calcula y guarda el snapshot de UNA obra, abriendo su propia sesión.

    Pensado para invocar a mano sin esperar al cron:
        python -c "import asyncio; from app.services.obra_stats_service import run_obra_snapshot; \\
                   print(asyncio.run(run_obra_snapshot(5)))"
    """
    from sqlalchemy.ext.asyncio import AsyncSession as _Session

    from app.core.database import engine

    async with _Session(engine, expire_on_commit=False) as session:
        snapshot = await ObraStatsService(session).snapshot(obra_id, period)
        metrics = snapshot.metrics
        await session.commit()
        return metrics


async def run_all_active_snapshots(period: str | None = None) -> int:
    """Snapshot de todas las obras activas. Devuelve cuántas procesó."""
    from sqlalchemy.ext.asyncio import AsyncSession as _Session

    from app.core.database import engine

    async with _Session(engine, expire_on_commit=False) as session:
        snapshots = await ObraStatsService(session).snapshot_all_active(period)
        count = len(snapshots)
        await session.commit()
        return count
