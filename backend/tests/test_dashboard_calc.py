"""Fórmulas del dashboard de indicadores (docs/features/dashboard-indicadores-obra.md §3).

Funciones puras — sin DB. Cada caso arma los números a propósito para que el
resultado esperado se pueda calcular a mano, misma convención que
test_obra_stats.py.
"""
import pytest
from datetime import date

from app.models.calendar import WorkingCalendar
from app.models.task import Task, TaskStatus
from app.services.dashboard_calc import (
    planned_span,
    task_planned_progress,
    task_progress,
    task_weight,
    weighted_planned_progress,
    weighted_real_progress,
)


def _cal() -> WorkingCalendar:
    """Lunes a sábado, sin feriados — el default real de una obra."""
    cal = WorkingCalendar(obra_id=1, working_days=0b0111111, hour_from=7, hour_to=18)
    cal.exceptions = []
    return cal


def _task(status: TaskStatus, **kw) -> Task:
    defaults = dict(obra_id=1, tenant_id=1, title="t", is_milestone=False, estimated_progress=0)
    defaults.update(kw)
    return Task(status=status, **defaults)


LUNES = date(2026, 6, 1)
LUNES_SIGUIENTE = date(2026, 6, 8)  # working_days_between = 6, ver test_calendar_working_days.py


def test_avance_real_ponderado_mezcla_de_estados():
    """4 tareas, pesos y avances distintos — el número se verifica a mano:
    (6*100 + 6*40 + 1*0 + 6*70) / (6+6+1+6) = 1260/19."""
    cal = _cal()
    completada = _task(TaskStatus.COMPLETADA, start_date=LUNES, due_date=LUNES_SIGUIENTE)
    en_progreso = _task(
        TaskStatus.EN_PROGRESO, start_date=LUNES, due_date=LUNES_SIGUIENTE, estimated_progress=40
    )
    pendiente = _task(TaskStatus.PENDIENTE, start_date=LUNES, due_date=date(2026, 6, 2))
    bloqueada = _task(
        TaskStatus.BLOQUEADA, start_date=LUNES, due_date=LUNES_SIGUIENTE, estimated_progress=70
    )
    tasks = [completada, en_progreso, pendiente, bloqueada]

    assert task_weight(cal, completada) == 6
    assert task_weight(cal, pendiente) == 1
    assert weighted_real_progress(cal, tasks) == pytest.approx(1260 / 19)


def test_tarea_bloqueada_conserva_su_avance():
    """Bloqueada no cae a 0 — conserva estimated_progress (§3.3)."""
    bloqueada = _task(TaskStatus.BLOQUEADA, estimated_progress=65)
    assert task_progress(bloqueada) == 65


def test_tarea_sin_fechas_pesa_uno_y_participa():
    cal = _cal()
    sin_fechas = _task(TaskStatus.EN_PROGRESO, estimated_progress=50)
    con_fechas = _task(TaskStatus.COMPLETADA, start_date=LUNES, due_date=LUNES_SIGUIENTE)
    assert task_weight(cal, sin_fechas) == 1
    # (1*50 + 6*100) / 7
    assert weighted_real_progress(cal, [sin_fechas, con_fechas]) == pytest.approx((50 + 600) / 7)


def test_todas_sin_fechas_es_promedio_simple():
    cal = _cal()
    a = _task(TaskStatus.COMPLETADA)  # progreso 100, peso 1
    b = _task(TaskStatus.PENDIENTE)  # progreso 0, peso 1
    assert weighted_real_progress(cal, [a, b]) == pytest.approx(50.0)


def test_obra_sin_tareas_es_none_no_cero():
    cal = _cal()
    assert weighted_real_progress(cal, []) is None


def test_cancelada_y_milestone_quedan_afuera_del_universo():
    cal = _cal()
    base = _task(TaskStatus.COMPLETADA, start_date=LUNES, due_date=LUNES_SIGUIENTE)
    sin_extras = weighted_real_progress(cal, [base])

    cancelada = _task(TaskStatus.CANCELADA, estimated_progress=0)
    hito = _task(TaskStatus.PENDIENTE, is_milestone=True, start_date=LUNES, due_date=LUNES)

    con_extras = weighted_real_progress(cal, [base, cancelada, hito])
    assert con_extras == sin_extras == 100.0


def test_avance_planificado_antes_del_inicio_es_cero():
    cal = _cal()
    t = _task(TaskStatus.EN_PROGRESO, start_date=LUNES, due_date=LUNES_SIGUIENTE)
    assert task_planned_progress(cal, t, date(2026, 5, 30)) == 0.0


def test_avance_planificado_en_o_despues_del_vencimiento_es_cien():
    cal = _cal()
    t = _task(TaskStatus.EN_PROGRESO, start_date=LUNES, due_date=LUNES_SIGUIENTE)
    assert task_planned_progress(cal, t, LUNES_SIGUIENTE) == 100.0
    assert task_planned_progress(cal, t, date(2026, 6, 10)) == 100.0


def test_avance_planificado_lineal_en_el_medio():
    """Jueves 4/6: 3 días laborales desde el lunes de un total de 6 -> 50%."""
    cal = _cal()
    t = _task(TaskStatus.EN_PROGRESO, start_date=LUNES, due_date=LUNES_SIGUIENTE)
    assert task_planned_progress(cal, t, date(2026, 6, 4)) == pytest.approx(50.0)


def test_avance_planificado_ponderado_de_la_obra():
    cal = _cal()
    t1 = _task(TaskStatus.EN_PROGRESO, start_date=LUNES, due_date=LUNES_SIGUIENTE)  # peso 6, 50% a jue 4/6
    t2 = _task(TaskStatus.PENDIENTE, start_date=LUNES, due_date=date(2026, 6, 2))  # peso 1, ya venció -> 100%
    hoy = date(2026, 6, 4)
    # (6*50 + 1*100) / 7
    assert weighted_planned_progress(cal, [t1, t2], hoy) == pytest.approx((300 + 100) / 7)


def test_avance_planificado_ninguna_tarea_con_fechas_es_none():
    cal = _cal()
    sin_fechas = _task(TaskStatus.EN_PROGRESO, estimated_progress=50)
    assert weighted_planned_progress(cal, [sin_fechas], date.today()) is None


def test_planned_span_ignora_tareas_sin_fechas_canceladas_y_milestones():
    cal = _cal()
    con_fechas = _task(TaskStatus.EN_PROGRESO, start_date=LUNES, due_date=LUNES_SIGUIENTE)
    sin_fechas = _task(TaskStatus.EN_PROGRESO, estimated_progress=10)
    cancelada = _task(TaskStatus.CANCELADA, start_date=date(2020, 1, 1), due_date=date(2020, 1, 2))
    hito = _task(TaskStatus.PENDIENTE, is_milestone=True, start_date=date(2030, 1, 1), due_date=date(2030, 1, 1))

    assert planned_span(cal, [con_fechas, sin_fechas, cancelada, hito]) == (LUNES, LUNES_SIGUIENTE)


def test_planned_span_sin_ninguna_tarea_con_fechas_es_none():
    cal = _cal()
    sin_fechas = _task(TaskStatus.EN_PROGRESO)
    assert planned_span(cal, [sin_fechas]) is None
