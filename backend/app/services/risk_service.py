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
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.alert import AlertSeverity, AlertType
from app.models.baseline import TaskBaseline
from app.models.obra import Obra, ObraStatus
from app.models.purchase_order import PurchaseOrder
from app.models.task_material import TaskMaterial
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


def _as_utc(dt: datetime) -> datetime:
    """Normaliza a UTC. Postgres devuelve datetimes con tz y SQLite (tests) sin
    ella; comparar los dos mundos sin normalizar tira TypeError."""
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


# Un material deja de ser riesgo recién cuando llegó a la obra.
MATERIAL_NOT_RECEIVED = ("pendiente", "pedido")


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
        self._materials: list[TaskMaterial] | None = None
        self._orders: list[PurchaseOrder] | None = None

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

    async def materials(self) -> list[TaskMaterial]:
        """Materiales de todas las tareas de la obra (task_materials cuelga de la
        tarea, no de la obra, así que hace falta el join)."""
        if self._materials is None:
            result = await self.session.execute(
                select(TaskMaterial)
                .join(Task, Task.id == TaskMaterial.task_id)
                .where(Task.obra_id == self.obra.id)
            )
            self._materials = list(result.scalars().all())
        return self._materials

    async def purchase_orders(self) -> list[PurchaseOrder]:
        if self._orders is None:
            result = await self.session.execute(
                select(PurchaseOrder)
                .where(PurchaseOrder.obra_id == self.obra.id)
                .options(selectinload(PurchaseOrder.supplier))
            )
            self._orders = list(result.scalars().all())
        return self._orders

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
        ("risk_material_pending", "_rule_material_pending_too_long"),
        ("risk_order_no_confirmation", "_rule_order_sent_no_confirmation"),
        ("risk_material_blocking_task", "_rule_material_blocking_task"),
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

    # ── Bloque 3 — materiales y compras ───────────────────────────────────────

    async def _rule_material_pending_too_long(self, ctx: RiskContext) -> int:
        """§3.1 — materiales que quedaron en 'pendiente' sin pasar a 'pedido'.

        Se agrupa por tarea en vez de emitir una alerta por material: una tarea con
        veinte materiales cargados el mismo día produciría veinte alertas idénticas
        en intención, y el destinatario tiene una sola acción para todas (armar el
        pedido). El mensaje lista los materiales, así que si la lista cambia es otra
        situación y corresponde una alerta nueva.
        """
        cutoff = datetime.now(timezone.utc) - timedelta(
            days=ctx.cfg.risk_material_pending_days
        )
        activas = {t.id: t for t in ctx.active_tasks}

        atrasados: dict[int, list[TaskMaterial]] = {}
        for material in await ctx.materials():
            if material.status != "pendiente" or material.task_id not in activas:
                continue
            if _as_utc(material.created_at) > cutoff:
                continue
            atrasados.setdefault(material.task_id, []).append(material)

        created = 0
        for task_id, materiales in atrasados.items():
            task = activas[task_id]
            nombres = ", ".join(f"«{m.name}»" for m in materiales[:3])
            resto = f" y {len(materiales) - 3} más" if len(materiales) > 3 else ""
            plural = "es" if len(materiales) != 1 else ""
            message = (
                f"La tarea «{task.title}» tiene {len(materiales)} material{plural} "
                f"sin pedir hace más de {ctx.cfg.risk_material_pending_days} días: "
                f"{nombres}{resto}."
            )
            created += await self.alerts.emit(
                obra_id=ctx.obra.id,
                task_id=task_id,
                alert_type=AlertType.MATERIAL_PENDING_TOO_LONG,
                message=message,
                reason="material_pending_too_long",
                extra={"material_ids": [m.id for m in materiales]},
            )
        return created

    async def _rule_order_sent_no_confirmation(self, ctx: RiskContext) -> int:
        """§3.2 — pedido enviado que el proveedor nunca confirmó.

        Es alerta a nivel obra (task_id NULL): un pedido agrupa materiales de varias
        tareas, así que colgarla de una sola sería arbitrario.
        """
        cutoff = datetime.now(timezone.utc) - timedelta(
            days=ctx.cfg.risk_order_confirmation_days
        )
        created = 0
        for order in await ctx.purchase_orders():
            if order.status != "enviado" or order.sent_at is None:
                continue
            if _as_utc(order.sent_at) > cutoff:
                continue

            proveedor = order.supplier.name if order.supplier else "el proveedor"
            message = (
                f"El pedido #{order.id} a {proveedor} se envió el "
                f"{_fmt(_as_utc(order.sent_at).date())} y todavía no se confirmó la recepción."
            )
            created += await self.alerts.emit(
                obra_id=ctx.obra.id,
                alert_type=AlertType.ORDER_SENT_NO_CONFIRMATION,
                message=message,
                reason="order_sent_no_confirmation",
                extra={
                    "order_id": order.id,
                    "sent_at": _as_utc(order.sent_at).isoformat(),
                },
            )
        return created

    async def _rule_material_blocking_task(self, ctx: RiskContext) -> int:
        """§3.3 — tarea por arrancar con materiales que todavía no llegaron.

        Es la regla más valiosa del bloque: anticipa el bloqueo ANTES de que la
        tarea figure como BLOQUEADA en la práctica. Incluye las tareas cuyo inicio
        ya pasó y siguen sin material —ahí el problema es peor, no menor— y por eso
        el mensaje distingue "arranca el" de "tenía que arrancar el".
        """
        limit = ctx.today + timedelta(days=ctx.cfg.risk_material_blocking_days)
        candidatas = {
            t.id: t
            for t in ctx.active_tasks
            if t.start_date is not None and t.start_date <= limit
        }
        if not candidatas:
            return 0

        faltantes: dict[int, list[TaskMaterial]] = {}
        for material in await ctx.materials():
            if material.task_id in candidatas and material.status in MATERIAL_NOT_RECEIVED:
                faltantes.setdefault(material.task_id, []).append(material)

        created = 0
        for task_id, materiales in faltantes.items():
            task = candidatas[task_id]
            cuando = (
                f"tenía que arrancar el {_fmt(task.start_date)}"
                if task.start_date < ctx.today
                else f"arranca el {_fmt(task.start_date)}"
            )
            nombres = ", ".join(f"«{m.name}»" for m in materiales[:3])
            resto = f" y {len(materiales) - 3} más" if len(materiales) > 3 else ""
            plural = "es" if len(materiales) != 1 else ""
            message = (
                f"La tarea «{task.title}» {cuando} y todavía tiene "
                f"{len(materiales)} material{plural} sin recibir: {nombres}{resto}."
            )
            created += await self.alerts.emit(
                obra_id=ctx.obra.id,
                task_id=task_id,
                alert_type=AlertType.MATERIAL_BLOCKING_TASK,
                message=message,
                reason="material_blocking_task",
                severity=AlertSeverity.ALTA,
                extra={
                    "start_date": task.start_date.isoformat(),
                    "material_ids": [m.id for m in materiales],
                },
            )
        return created
