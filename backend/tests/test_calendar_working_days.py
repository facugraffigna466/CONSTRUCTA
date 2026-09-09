"""Aritmética de días laborales del calendario de obra.

Vive acá y no en los tests de bitácora porque dejó de ser un detalle del
análisis con IA: cuando alguien dice "corrélo dos días" no habla de días de
almanaque, y esa cuenta la hace el backend contra el calendario real de la obra.
Antes la hacía el modelo de lenguaje dentro del análisis y la erraba —en una
prueba, "dos días" sobre un viernes dio tres días laborales—, lo que además
la volvía imposible de probar.
"""
from datetime import date

from app.models.calendar import CalendarException, WorkingCalendar
from app.services.calendar_service import add_working_days


def _cal(working_days: int = 0b0011111, exceptions=None) -> WorkingCalendar:
    """Calendario mínimo: por defecto lunes a viernes, sin feriados.

    Ojo: el default REAL de una obra es lunes a sábado (`working_days=63`).
    Acá se fija lunes a viernes a propósito, para que el resultado esperado no
    dependa de ese default.
    """
    cal = WorkingCalendar(obra_id=1, working_days=working_days, hour_from=7, hour_to=18)
    cal.exceptions = exceptions or []
    return cal


def test_salta_el_fin_de_semana():
    """El caso que el modelo erraba: dos días laborales desde un viernes es el
    martes siguiente, no el domingo."""
    viernes = date(2026, 5, 29)
    assert viernes.weekday() == 4
    assert add_working_days(_cal(), viernes, 2) == date(2026, 6, 2)


def test_hacia_atras():
    lunes = date(2026, 6, 1)
    assert add_working_days(_cal(), lunes, -1) == date(2026, 5, 29)


def test_saltea_feriados_de_la_obra():
    """Un feriado cargado en el calendario de la obra no cuenta como día laboral —
    y es justamente lo que el modelo no podía saber."""
    feriado = CalendarException(date=date(2026, 6, 2), is_working=False, label="Feriado")
    viernes = date(2026, 5, 29)
    # Sin el feriado daría el martes 2; con el feriado, el miércoles 3.
    assert add_working_days(_cal(exceptions=[feriado]), viernes, 2) == date(2026, 6, 3)


def test_una_semana_son_cinco_habiles():
    lunes = date(2026, 6, 1)
    assert add_working_days(_cal(), lunes, 5) == date(2026, 6, 8)


def test_cero_normaliza_al_dia_laboral_mas_cercano():
    domingo = date(2026, 5, 31)
    assert add_working_days(_cal(), domingo, 0) == date(2026, 6, 1)


def test_calendario_con_sabado_cuenta_el_sabado():
    """El default de obra incluye el sábado: dos días desde el viernes es el lunes.
    Deja escrito que el resultado depende del calendario, no del almanaque."""
    lun_a_sab = _cal(working_days=0b0111111)
    assert add_working_days(lun_a_sab, date(2026, 5, 29), 2) == date(2026, 6, 1)
