"""Motor de detección de riesgo — implementa docs/propuesta-reglas-riesgo.md.

Por qué vive separado de AlertService: `evaluate_task_risks_for_obra()` corre en
cada carga del dashboard y tiene que ser barato. Estas reglas no: recalculan el
CPM, leen la línea base, cruzan materiales y calendario. Son de corrida periódica
(cron) y agruparlas acá deja claro cuál es cuál.

Cada regla es un método `_rule_<nombre>` que devuelve cuántas alertas creó, y se
declara en RULES junto al campo de SystemSettings que la habilita. Agregar una
regla nueva es escribir el método y sumar una línea a esa tabla.

Toda alerta sale por AlertService.emit(), que centraliza dedup e historial.
"""
import logging
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.alert import AlertSeverity, AlertType
from app.models.baseline import TaskBaseline
from app.models.obra import Obra, ObraStatus
from app.models.settings import SystemSettings
from app.models.task import Task, TaskStatus
from app.repositories.calendar import CalendarRepository
from app.repositories.obra import ObraRepository
from app.repositories.settings import SettingsRepository
from app.repositories.task import TaskRepository
from app.services.alert_service import AlertService
from app.services.calendar_service import is_working_day

logger = logging.getLogger(__name__)

# Estados en los que una tarea ya no puede generar riesgo.
INACTIVE_TASK_STATUSES = {TaskStatus.COMPLETADA, TaskStatus.CANCELADA}
INACTIVE_OBRA_STATUSES = {ObraStatus.COMPLETADA, ObraStatus.CANCELADA}


def _fmt(d: date) -> str:
    return d.strftime("%d/%m/%Y")


class RiskContext:
    """Datos de una obra compartidos por todas las reglas de una corrida.

    Los insumos caros (CPM, línea base, calendario) se cargan bajo demanda y se
    cachean: si el tenant apagó las reglas que los usan, no se pagan.
    """

    def __init__(self, session: AsyncSession, obra: Obra, cfg: SystemSettings) -> None:
        self.session = session
        self.obra = obra
        self.cfg = cfg
        self.today = date.today()
        self.tasks: list[Task] = []
        self.active_tasks: list[Task] = []
        self._cpm: dict | None = None
        self._baselines: dict[int, TaskBaseline] | None = None
        self._calendar = None
        self._dependencies: dict[int, list[dict]] | None = None

    async def load(self) -> None:
        repo = TaskRepository(self.session)
        self.tasks = await repo.list_by_obra(self.obra.id)
        self.active_tasks = [
            t for t in self.tasks if t.status not in INACTIVE_TASK_STATUSES
        ]

    async def cpm(self) -> dict:
        if self._cpm is None:
            from app.services.task_service import TaskService

            self._cpm = await TaskService(self.session).compute_critical_path_unchecked(
                self.obra.id
            )
        return self._cpm

    async def baselines(self) -> dict[int, TaskBaseline]:
        """Línea base por task_id. Vacío si la obra nunca guardó una."""
        if self._baselines is None:
            result = await self.session.execute(
                select(TaskBaseline).where(TaskBaseline.obra_id == self.obra.id)
            )
            self._baselines = {b.task_id: b for b in result.scalars().all()}
        return self._baselines

    async def calendar(self):
        if self._calendar is None:
            self._calendar = await CalendarRepository(self.session).get_for_obra(
                self.obra.id
            )
        return self._calendar

    async def dependencies(self) -> dict[int, list[dict]]:
        """{task_id: [links]}. Incluye el `depends_on_id` legacy de la tarea, que
        vive en una columna aparte de la tabla M2M y de otro modo se perdería."""
        if self._dependencies is None:
            links = await TaskRepository(self.session).get_all_dependency_links_by_obra(
                self.obra.id
            )
            for task in self.tasks:
                if task.depends_on_id is None:
                    continue
                existing = links.setdefault(task.id, [])
                if not any(l["depends_on_id"] == task.depends_on_id for l in existing):
                    existing.append(
                        {
                            "depends_on_id": task.depends_on_id,
                            "dependency_type": "FS",
                            "lag_days": 0,
                        }
                    )
            self._dependencies = links
        return self._dependencies


class RiskService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.alerts = AlertService(session)
        self.obra_repo = ObraRepository(session)
        self.settings_repo = SettingsRepository(session)

    # ── Registro de reglas ────────────────────────────────────────────────────
    # (campo de SystemSettings que la habilita, nombre del método)
    RULES: list[tuple[str, str]] = [
        ("risk_critical_task_delayed", "_rule_critical_task_delayed"),
        ("risk_baseline_deviation", "_rule_baseline_deviation"),
        ("risk_milestone_at_risk", "_rule_milestone_at_risk"),
        ("risk_deadline_holiday", "_rule_deadline_conflicts_holiday"),
    ]

    # ── Orquestación ──────────────────────────────────────────────────────────

    async def evaluate_obra(self, obra_id: int) -> int:
        obra = await self.obra_repo.get(obra_id)
        if obra is None or obra.status in INACTIVE_OBRA_STATUSES:
            return 0

        cfg = await self.settings_repo.get_for_obra(obra_id)
        ctx = RiskContext(self.session, obra, cfg)
        await ctx.load()

        created = 0
        for flag, method_name in self.RULES:
            if not getattr(cfg, flag, False):
                continue
            # Una regla que explota no debe tumbar al resto de la corrida.
            try:
                created += await getattr(self, method_name)(ctx)
            except Exception:
                logger.exception(
                    "Regla de riesgo %s falló para obra_id=%d", method_name, obra_id
                )
        return created

    async def evaluate_all_obras(self) -> int:
        """Corrida completa del cron. Una obra que falla no frena a las demás."""
        created = 0
        for obra in await self.obra_repo.list_all():
            if obra.status in INACTIVE_OBRA_STATUSES:
                continue
            try:
                created += await self.evaluate_obra(obra.id)
            except Exception:
                logger.exception("evaluate_obra falló para obra_id=%d", obra.id)
        return created

    # ── Bloque 1 — ruta crítica (CPM) ─────────────────────────────────────────

    async def _rule_critical_task_delayed(self, ctx: RiskContext) -> int:
        """§1.1 — tarea en la ruta crítica vencida o por vencer.

        Se diferencia de task_overdue en la consecuencia, no en la condición: una
        tarea con holgura cero que se atrasa mueve la fecha de fin de la obra
        entera. Por eso también se avisa ANTES del vencimiento (lookahead
        configurable) y con severidad más alta.
        """
        cpm = await ctx.cpm()
        critical_ids = set(cpm["critical_task_ids"])
        if not critical_ids:
            return 0

        limit = ctx.today + timedelta(days=ctx.cfg.risk_critical_delay_lookahead_days)
        created = 0
        for task in ctx.active_tasks:
            if task.id not in critical_ids or task.due_date is None:
                continue
            if task.due_date > limit:
                continue

            overdue = task.due_date < ctx.today
            if overdue:
                message = (
                    f"La tarea «{task.title}» está en la ruta crítica y está vencida "
                    f"desde el {_fmt(task.due_date)}. La fecha de fin de la obra ya se corrió."
                )
                severity = AlertSeverity.CRITICA
            else:
                message = (
                    f"La tarea «{task.title}» está en la ruta crítica y vence el "
                    f"{_fmt(task.due_date)}. Si se atrasa, se atrasa toda la obra."
                )
                severity = AlertSeverity.ALTA

            created += await self.alerts.emit(
                obra_id=ctx.obra.id,
                task_id=task.id,
                alert_type=AlertType.CRITICAL_TASK_DELAYED,
                message=message,
                reason="critical_task_delayed",
                severity=severity,
                extra={"due_date": task.due_date.isoformat(), "overdue": overdue},
            )
        return created

    # ── Bloque 2 — línea base ─────────────────────────────────────────────────

    async def _rule_baseline_deviation(self, ctx: RiskContext) -> int:
        """§2.1 — el fin actual se corrió respecto del fin de la línea base.

        Solo se alerta el atraso: adelantarse respecto de la línea base no es un
        riesgo. La severidad escala —al doble del umbral pasa de alta a crítica—
        porque un desvío de 30 días no es el mismo problema que uno de 5.
        """
        baselines = await ctx.baselines()
        if not baselines:
            return 0

        threshold = ctx.cfg.risk_baseline_deviation_days
        created = 0
        for task in ctx.active_tasks:
            baseline = baselines.get(task.id)
            if baseline is None or baseline.baseline_finish is None or task.due_date is None:
                continue

            deviation = (task.due_date - baseline.baseline_finish).days
            if deviation < threshold:
                continue

            message = (
                f"La tarea «{task.title}» terminaba el {_fmt(baseline.baseline_finish)} "
                f"según la línea base y hoy está para el {_fmt(task.due_date)}: "
                f"{deviation} días de atraso."
            )
            created += await self.alerts.emit(
                obra_id=ctx.obra.id,
                task_id=task.id,
                alert_type=AlertType.BASELINE_DEVIATION,
                message=message,
                reason="baseline_deviation",
                severity=(
                    AlertSeverity.CRITICA
                    if deviation >= threshold * 2
                    else AlertSeverity.ALTA
                ),
                extra={
                    "deviation_days": deviation,
                    "baseline_finish": baseline.baseline_finish.isoformat(),
                    "current_finish": task.due_date.isoformat(),
                },
            )
        return created

    # ── Bloque 7 — hitos ──────────────────────────────────────────────────────

    async def _rule_milestone_at_risk(self, ctx: RiskContext) -> int:
        """§7.1 — hito próximo con predecesoras sin completar.

        Un hito suele ser un compromiso visible ante el comitente, así que llega
        como crítico. El mensaje nombra las predecesoras pendientes: si el conjunto
        cambia, es otra situación y corresponde una alerta nueva, no deduplicar.
        """
        limit = ctx.today + timedelta(days=ctx.cfg.risk_milestone_lookahead_days)
        milestones = [
            t
            for t in ctx.active_tasks
            if t.is_milestone and t.due_date is not None and t.due_date <= limit
        ]
        if not milestones:
            return 0

        links = await ctx.dependencies()
        by_id = {t.id: t for t in ctx.tasks}
        created = 0
        for milestone in milestones:
            pending = [
                by_id[link["depends_on_id"]]
                for link in links.get(milestone.id, [])
                if link["depends_on_id"] in by_id
                and by_id[link["depends_on_id"]].status not in INACTIVE_TASK_STATUSES
            ]
            if not pending:
                continue

            names = ", ".join(f"«{t.title}»" for t in pending[:3])
            resto = f" y {len(pending) - 3} más" if len(pending) > 3 else ""
            plural = "s" if len(pending) != 1 else ""
            message = (
                f"El hito «{milestone.title}» vence el {_fmt(milestone.due_date)} y "
                f"tiene {len(pending)} tarea{plural} previa{plural} sin terminar: "
                f"{names}{resto}."
            )
            created += await self.alerts.emit(
                obra_id=ctx.obra.id,
                task_id=milestone.id,
                alert_type=AlertType.MILESTONE_AT_RISK,
                message=message,
                reason="milestone_at_risk",
                severity=AlertSeverity.CRITICA,
                extra={
                    "due_date": milestone.due_date.isoformat(),
                    "pending_task_ids": [t.id for t in pending],
                },
            )
        return created

    # ── Bloque 5 — calendario laboral ─────────────────────────────────────────

    async def _rule_deadline_conflicts_holiday(self, ctx: RiskContext) -> int:
        """§5.1 — el vencimiento cae en un día no laborable de la obra.

        Mira hacia adelante nada más: avisar de un vencimiento que ya pasó y cayó
        feriado no le sirve a nadie, el valor está en reprogramar antes. Cubre las
        dos vías de "no laborable" —excepción cargada (feriado, parate) y día
        apagado en la máscara semanal—, porque para el responsable son lo mismo.
        """
        limit = ctx.today + timedelta(days=ctx.cfg.risk_holiday_lookahead_days)
        candidates = [
            t
            for t in ctx.active_tasks
            if t.due_date is not None and ctx.today <= t.due_date <= limit
        ]
        if not candidates:
            return 0

        calendar = await ctx.calendar()
        labels = {
            exc.date: exc.label
            for exc in (getattr(calendar, "exceptions", []) or [])
            if not exc.is_working
        }

        created = 0
        for task in candidates:
            if is_working_day(calendar, task.due_date):
                continue

            label = labels.get(task.due_date)
            motivo = f"es {label}" if label else "no es día laborable en esta obra"
            message = (
                f"La tarea «{task.title}» vence el {_fmt(task.due_date)}, que {motivo}. "
                "Conviene reprogramarla antes de que llegue la fecha."
            )
            created += await self.alerts.emit(
                obra_id=ctx.obra.id,
                task_id=task.id,
                alert_type=AlertType.DEADLINE_CONFLICTS_HOLIDAY,
                message=message,
                reason="deadline_conflicts_holiday",
                severity=AlertSeverity.BAJA,
                extra={"due_date": task.due_date.isoformat(), "label": label},
            )
        return created
