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
from collections import Counter
from datetime import date, datetime, timedelta, timezone

from typing import NamedTuple

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.alert import AlertSeverity, AlertType
from app.models.baseline import TaskBaseline
from app.models.alert import Alert
from app.models.historial import HistorialEvento
from app.models.obra import Obra, ObraStatus
from app.models.responsible import Responsible
from app.models.purchase_order import PurchaseOrder
from app.models.task_material import TaskMaterial
from app.models.task_risk_snapshot import TaskRiskSnapshot
from app.models.settings import SystemSettings
from app.models.task import Task, TaskStatus
from app.repositories.calendar import CalendarRepository
from app.repositories.obra import ObraRepository
from app.repositories.settings import SettingsRepository
from app.repositories.task import TaskRepository
from app.services.alert_service import AlertService
from app.core.socket_manager import emit_alerts_resolved
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

# Cada cuánto corre cada regla. No es una preferencia estética: una regla que
# compara contra el pasado (holgura de ayer, avance de la semana) no cambia de
# resultado entre las 8 y las 12 del mismo día, y correrla cada 4 h solo gasta
# CPU. Las de patrón (§6) miran meses de historial: semanal alcanza.
FREQUENT = "frequent"  # cada 4 h — condiciones que cambian con cada edición
DAILY = "daily"        # 1 vez por día — comparaciones contra un snapshot diario
WEEKLY = "weekly"      # 1 vez por semana — patrones acumulados en historial


class RiskRule(NamedTuple):
    setting: str            # campo de SystemSettings que la habilita
    method: str             # método de RiskService que la evalúa
    cadence: str
    alert_type: "AlertType"  # el tipo que emite — lo necesita la reconciliación


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
        # Claves (task_id, tipo, mensaje) de las condiciones vigentes en esta
        # corrida. Las llena _emit(); la reconciliación final las usa para saber
        # qué alertas viejas ya no corresponden a nada.
        self.active_keys: set[tuple[int | None, str, str]] = set()
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
    RULES: list[RiskRule] = [
        RiskRule("risk_critical_task_delayed", "_rule_critical_task_delayed", FREQUENT, AlertType.CRITICAL_TASK_DELAYED),
        RiskRule("risk_baseline_deviation", "_rule_baseline_deviation", FREQUENT, AlertType.BASELINE_DEVIATION),
        RiskRule("risk_milestone_at_risk", "_rule_milestone_at_risk", FREQUENT, AlertType.MILESTONE_AT_RISK),
        RiskRule("risk_deadline_holiday", "_rule_deadline_conflicts_holiday", FREQUENT, AlertType.DEADLINE_CONFLICTS_HOLIDAY),
        RiskRule("risk_material_pending", "_rule_material_pending_too_long", FREQUENT, AlertType.MATERIAL_PENDING_TOO_LONG),
        RiskRule("risk_order_no_confirmation", "_rule_order_sent_no_confirmation", FREQUENT, AlertType.ORDER_SENT_NO_CONFIRMATION),
        RiskRule("risk_material_blocking_task", "_rule_material_blocking_task", FREQUENT, AlertType.MATERIAL_BLOCKING_TASK),
        RiskRule("risk_progress_stalled", "_rule_progress_stalled", DAILY, AlertType.PROGRESS_STALLED),
        RiskRule("risk_float_shrinking", "_rule_float_shrinking", DAILY, AlertType.FLOAT_SHRINKING),
        RiskRule("risk_recurring_blocker", "_rule_recurring_blocker", WEEKLY, AlertType.RECURRING_BLOCKER),
        RiskRule("risk_chronic_no_response", "_rule_chronic_no_response", WEEKLY, AlertType.CHRONIC_NO_RESPONSE),
    ]

    # ── Orquestación ──────────────────────────────────────────────────────────

    async def evaluate_obra(self, obra_id: int, cadence: str | None = None) -> int:
        """Evalúa las reglas habilitadas de una obra. `cadence` acota a las de esa
        frecuencia; sin ella corre todas (lo que usan los tests y una corrida manual)."""
        obra = await self.obra_repo.get(obra_id)
        if obra is None or obra.status in INACTIVE_OBRA_STATUSES:
            return 0

        cfg = await self.settings_repo.get_for_obra(obra_id)
        ctx = RiskContext(self.session, obra, cfg)
        await ctx.load()

        created = 0
        evaluados: set[AlertType] = set()
        for rule in self.RULES:
            if cadence is not None and rule.cadence != cadence:
                continue
            if not getattr(cfg, rule.setting, False):
                continue
            # Una regla que explota no debe tumbar al resto de la corrida. Y su
            # tipo NO entra en `evaluados`: sin una corrida completa no sabemos
            # qué condiciones siguen vigentes, así que no se barre nada de ella.
            try:
                created += await getattr(self, rule.method)(ctx)
                evaluados.add(rule.alert_type)
            except Exception:
                logger.exception(
                    "Regla de riesgo %s falló para obra_id=%d", rule.method, obra_id
                )

        await self._resolve_stale(ctx, evaluados)
        return created

    async def evaluate_all_obras(self, cadence: str | None = None) -> int:
        """Corrida completa del cron. Una obra que falla no frena a las demás."""
        created = 0
        for obra in await self.obra_repo.list_all():
            if obra.status in INACTIVE_OBRA_STATUSES:
                continue
            try:
                created += await self.evaluate_obra(obra.id, cadence=cadence)
            except Exception:
                logger.exception("evaluate_obra falló para obra_id=%d", obra.id)
        return created

    # ── Emisión y reconciliación ──────────────────────────────────────────────

    async def _emit(
        self,
        ctx: RiskContext,
        *,
        alert_type: AlertType,
        message: str,
        reason: str,
        task_id: int | None = None,
        severity: AlertSeverity | None = None,
        extra: dict | None = None,
    ) -> int:
        """Registra la condición como vigente y delega en AlertService.emit().

        La clave se registra SIEMPRE, aunque emit() deduplique y no cree nada: lo
        que importa para la reconciliación es que la condición sigue dándose, no
        que se haya emitido una alerta nueva.
        """
        ctx.active_keys.add((task_id, alert_type.value, message))
        return await self.alerts.emit(
            obra_id=ctx.obra.id,
            task_id=task_id,
            alert_type=alert_type,
            message=message,
            reason=reason,
            severity=severity,
            extra=extra,
        )

    async def _resolve_stale(self, ctx: RiskContext, tipos: set[AlertType]) -> int:
        """Marca resueltas las alertas cuya condición ya no se detecta.

        Es la contracara de la deduplicación. La dedup es contra alertas NO leídas,
        así que sin esto el ciclo se rompe: la condición desaparece, la alerta queda
        pendiente para siempre y, cuando el problema vuelve, la dedup ve una alerta
        idéntica sin leer y se calla. El aviso se pierde.

        Solo se barren los tipos cuya regla efectivamente CORRIÓ en esta pasada
        —habilitada, de la cadencia en curso y sin excepción—. Si una regla no
        corrió no sabemos qué condiciones están vigentes para su tipo, y darlas por
        resueltas sería inventar: por eso el job semanal no toca las alertas de las
        reglas frecuentes, ni apagar una regla resuelve lo que ya había avisado.

        Un cambio de mensaje también resuelve: si el desvío pasó de 6 a 12 días, el
        texto viejo quedó obsoleto y el nuevo ya se emitió en esta misma corrida.
        """
        if not tipos:
            return 0

        pendientes = await self.alerts.repo.list_unread_for_obra_by_types(
            ctx.obra.id, tipos
        )
        obsoletas = [
            a for a in pendientes
            if (a.task_id, a.type.value, a.message) not in ctx.active_keys
        ]
        if not obsoletas:
            return 0

        await self.alerts.repo.mark_read_by_ids(
            [a.id for a in obsoletas], tenant_id=ctx.obra.tenant_id
        )
        # El frontend refresca por tarea (evento `alerts_resolved`). Las alertas a
        # nivel obra no tienen task_id, así que ésas se ven recién en la próxima
        # carga: no hay evento para ellas todavía.
        for task_id in {a.task_id for a in obsoletas if a.task_id is not None}:
            await emit_alerts_resolved(task_id, ctx.obra.id)
        return len(obsoletas)

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

            created += await self._emit(
                ctx,
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
            created += await self._emit(
                ctx,
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
            created += await self._emit(
                ctx,
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
            created += await self._emit(
                ctx,
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
            created += await self._emit(
                ctx,
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
            created += await self._emit(
                ctx,
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
            created += await self._emit(
                ctx,
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

    # ── Bloque 4 — progreso estancado ─────────────────────────────────────────

    async def _rule_progress_stalled(self, ctx: RiskContext) -> int:
        """§4.1 — tarea en progreso que hace N días no mueve el avance.

        Usa `tasks.last_progress_at` (migración 0064) en vez de escarbar
        historial_eventos por tarea, que era la alternativa que la propuesta
        descartaba por costo. Para tareas anteriores a esa columna el backfill puso
        `updated_at`; si aun así estuviera en NULL se cae a `created_at`, para no
        alertar a una tarea recién creada por no tener historia.
        """
        cutoff = datetime.now(timezone.utc) - timedelta(
            days=ctx.cfg.risk_progress_stalled_days
        )
        created = 0
        for task in ctx.active_tasks:
            if task.status != TaskStatus.EN_PROGRESO:
                continue
            ultimo = _as_utc(task.last_progress_at or task.created_at)
            if ultimo > cutoff:
                continue

            message = (
                f"La tarea «{task.title}» está en progreso al {task.estimated_progress}% "
                f"y no registra avance desde el {_fmt(ultimo.date())}."
            )
            created += await self._emit(
                ctx,
                task_id=task.id,
                alert_type=AlertType.PROGRESS_STALLED,
                message=message,
                reason="progress_stalled",
                extra={
                    "last_progress_at": ultimo.isoformat(),
                    "estimated_progress": task.estimated_progress,
                },
            )
        return created

    # ── Bloque 1 — holgura que se achica ──────────────────────────────────────

    async def _rule_float_shrinking(self, ctx: RiskContext) -> int:
        """§1.2 — la holgura de una tarea no crítica cayó por debajo del umbral.

        Es la única regla con estado propio: compara contra `task_risk_snapshots`,
        que se pisa en cada corrida. Por eso el snapshot se actualiza SIEMPRE, haya
        o no alerta — si solo se guardara al alertar, la corrida siguiente
        compararía contra un valor viejo y volvería a alertar lo mismo.

        En la primera corrida de una obra no hay contra qué comparar: se guarda el
        snapshot y no se alerta. Se excluye la holgura 0 (esa tarea ya es crítica y
        la cubre `critical_task_delayed`) y el centinela 9999 que devuelve el CPM
        para las tareas sin ninguna restricción.
        """
        cpm = await ctx.cpm()
        floats = {int(tid): value for tid, value in cpm["float_by_task"].items()}
        if not floats:
            return 0

        result = await self.session.execute(
            select(TaskRiskSnapshot).where(TaskRiskSnapshot.task_id.in_(floats.keys()))
        )
        previos = {s.task_id: s for s in result.scalars().all()}
        activas = {t.id: t for t in ctx.active_tasks}
        umbral = ctx.cfg.risk_float_threshold_days

        created = 0
        for task_id, actual in floats.items():
            previo = previos.get(task_id)

            # El snapshot se escribe para todas, incluso las que no alertan.
            if previo is None:
                self.session.add(
                    TaskRiskSnapshot(
                        task_id=task_id,
                        tenant_id=ctx.obra.tenant_id,
                        float_days=actual,
                    )
                )
            else:
                anterior = previo.float_days
                previo.float_days = actual

                task = activas.get(task_id)
                if (
                    task is not None
                    and 0 < actual < umbral
                    and actual < anterior
                    and anterior != 9999
                ):
                    message = (
                        f"La holgura de la tarea «{task.title}» bajó de {anterior} a "
                        f"{actual} días. Está por entrar en la ruta crítica."
                    )
                    created += await self._emit(
                        ctx,
                        task_id=task_id,
                        alert_type=AlertType.FLOAT_SHRINKING,
                        message=message,
                        reason="float_shrinking",
                        extra={"float_before": anterior, "float_now": actual},
                    )
        await self.session.flush()
        return created

    # ── Bloque 6 — patrones sobre el historial ────────────────────────────────

    async def _rule_recurring_blocker(self, ctx: RiskContext) -> int:
        """§6.1 — la misma tarea se bloqueó N veces o más.

        Un bloqueo es un evento; tres son un síntoma de algo estructural (una
        dependencia mal definida, un proveedor que nunca cumple, un permiso que no
        sale). Por eso la alerta apunta a revisar la definición de la tarea y no a
        destrabarla una vez más.

        El filtro por `to == bloqueada` se hace en Python: `payload` es una columna
        JSON y consultarla desde SQL obligaría a ramificar entre el operador de
        Postgres y el de SQLite. El universo ya viene acotado por (obra, tipo de
        evento), que están indexados.
        """
        result = await self.session.execute(
            select(HistorialEvento).where(
                HistorialEvento.obra_id == ctx.obra.id,
                HistorialEvento.event_type == "task_status_changed",
            )
        )
        bloqueos: Counter[int] = Counter(
            evento.task_id
            for evento in result.scalars().all()
            if evento.task_id is not None
            and (evento.payload or {}).get("to") == TaskStatus.BLOQUEADA.value
        )

        umbral = ctx.cfg.risk_recurring_blocker_count
        activas = {t.id: t for t in ctx.active_tasks}
        created = 0
        for task_id, veces in bloqueos.items():
            if veces < umbral or task_id not in activas:
                continue

            task = activas[task_id]
            message = (
                f"La tarea «{task.title}» se bloqueó {veces} veces. No es un bloqueo "
                "puntual: conviene revisar sus dependencias o su responsable."
            )
            created += await self._emit(
                ctx,
                task_id=task_id,
                alert_type=AlertType.RECURRING_BLOCKER,
                message=message,
                reason="recurring_blocker",
                extra={"block_count": veces},
            )
        return created

    async def _rule_chronic_no_response(self, ctx: RiskContext) -> int:
        """§6.2 — un responsable acumula N alertas de falta de respuesta.

        Apunta a la persona y no a la tarea, que es donde está el problema
        accionable: si alguien no contesta en cinco tareas distintas, el tema no se
        resuelve mirando ninguna de las cinco. Va a nivel obra porque el sujeto es
        el responsable, no una tarea puntual.

        El mensaje incluye la cuenta a propósito: cuando pasa de 3 a 5 la situación
        escaló y merece avisar de nuevo. La cadencia semanal acota el ruido.
        """
        ventana = datetime.now(timezone.utc) - timedelta(
            days=ctx.cfg.risk_chronic_no_response_window_days
        )
        result = await self.session.execute(
            select(Alert).where(
                Alert.obra_id == ctx.obra.id,
                Alert.type == AlertType.NO_RESPONSE,
                Alert.created_at >= ventana,
            )
        )
        por_tarea = {t.id: t for t in ctx.tasks}
        conteo: Counter[int] = Counter()
        for alerta in result.scalars().all():
            task = por_tarea.get(alerta.task_id) if alerta.task_id else None
            if task is not None and task.responsible_id is not None:
                conteo[task.responsible_id] += 1

        umbral = ctx.cfg.risk_chronic_no_response_count
        dias = ctx.cfg.risk_chronic_no_response_window_days
        created = 0
        for responsible_id, veces in conteo.items():
            if veces < umbral:
                continue

            responsible = await self.session.get(Responsible, responsible_id)
            nombre = responsible.full_name if responsible else f"El responsable #{responsible_id}"
            message = (
                f"{nombre} acumula {veces} alertas por falta de respuesta en los "
                f"últimos {dias} días. Conviene revisar el canal de contacto."
            )
            created += await self._emit(
                ctx,
                alert_type=AlertType.CHRONIC_NO_RESPONSE,
                message=message,
                reason="chronic_no_response",
                extra={"responsible_id": responsible_id, "alert_count": veces},
            )
        return created
