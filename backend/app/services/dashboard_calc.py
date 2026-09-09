"""Fórmulas comunes del dashboard de indicadores de obra.

Implementa literalmente las secciones 3.1-3.4 de
`docs/features/dashboard-indicadores-obra.md`: universo de tareas, peso,
avance real y avance planificado. Son funciones puras (sin acceso a DB) para
que se puedan testear con un fixture de tareas armado a mano y para que
`ObraDashboardService` (avance en vivo del detalle de obra) y
`ObraService.list_all` (avance del portfolio) usen exactamente el mismo
cálculo — es el punto de la decisión D-02 del diseño: que el mismo número no
se calcule de dos formas distintas en dos pantallas.
"""
from datetime import date

from app.models.calendar import WorkingCalendar
from app.models.task import Task, TaskStatus
from app.services.calendar_service import working_days_between


def in_progress_universe(task: Task) -> bool:
    """§3.1 — universo de todo cálculo ponderado: no canceladas, sin hitos.

    Los hitos tienen duración cero y se miden aparte (ficha I-08, fuera de
    esta etapa): incluirlos acá los haría contar como una tarea de un día que
    no son.
    """
    return task.status != TaskStatus.CANCELADA and not task.is_milestone


def task_weight(calendar: WorkingCalendar, task: Task) -> int:
    """peso(t) — §3.2. Si falta alguna fecha, pesa 1 y NO se excluye del
    cálculo: excluirla escondería trabajo real del avance."""
    if task.start_date is None or task.due_date is None:
        return 1
    return max(1, working_days_between(calendar, task.start_date, task.due_date))


def task_progress(task: Task) -> int:
    """avance(t) — §3.3. Una tarea bloqueada conserva el avance que tenía
    (`estimated_progress`): ponerla en 0 castigaría dos veces el mismo
    problema, que ya se ve en alertas y en holgura."""
    if task.status == TaskStatus.COMPLETADA:
        return 100
    if task.status == TaskStatus.PENDIENTE:
        return 0
    return task.estimated_progress  # en_progreso | bloqueada


def task_planned_progress(calendar: WorkingCalendar, task: Task, as_of: date) -> float:
    """planificado(t, D) — §3.4. Asume avance lineal dentro de la tarea.
    Requiere `start_date`/`due_date`; el llamador filtra antes de invocarla."""
    if as_of < task.start_date:
        return 0.0
    if as_of >= task.due_date:
        return 100.0
    return 100.0 * working_days_between(calendar, task.start_date, as_of) / task_weight(calendar, task)


def weighted_real_progress(calendar: WorkingCalendar, tasks: list[Task]) -> float | None:
    """avance_real — I-01. `None` si el universo (§3.1) está vacío, nunca 0."""
    universe = [t for t in tasks if in_progress_universe(t)]
    if not universe:
        return None
    weights = [task_weight(calendar, t) for t in universe]
    total_weight = sum(weights)
    return sum(w * task_progress(t) for w, t in zip(weights, universe)) / total_weight


def weighted_planned_progress(
    calendar: WorkingCalendar, tasks: list[Task], as_of: date
) -> float | None:
    """avance_planificado — I-02. Solo tareas del universo con AMBAS fechas
    (sin fechas no hay plan contra el cual comparar). `None` si ninguna
    tarea del universo tiene fechas."""
    universe = [t for t in tasks if in_progress_universe(t) and t.start_date and t.due_date]
    if not universe:
        return None
    weights = [task_weight(calendar, t) for t in universe]
    total_weight = sum(weights)
    planned = [task_planned_progress(calendar, t, as_of) for t in universe]
    return sum(w * p for w, p in zip(weights, planned)) / total_weight


def planned_span(calendar: WorkingCalendar, tasks: list[Task]) -> tuple[date, date] | None:
    """(min start_date, max due_date) sobre el universo con fechas — insumo de
    la fecha de fin proyectada (I-04) y del texto humano de desvío (I-03).
    `None` si ninguna tarea del universo tiene ambas fechas."""
    universe = [t for t in tasks if in_progress_universe(t) and t.start_date and t.due_date]
    if not universe:
        return None
    return min(t.start_date for t in universe), max(t.due_date for t in universe)
