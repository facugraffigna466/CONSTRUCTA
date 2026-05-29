from datetime import date, datetime, timedelta

from app.models.calendar import CalendarException, WorkingCalendar


def _day_bit(d: date) -> int:
    """Return the bitmask bit for the weekday of d (bit0=Mon, bit6=Sun)."""
    return 1 << d.weekday()  # weekday(): Mon=0, Sun=6


def is_working_day(calendar: WorkingCalendar, d: date) -> bool:
    """Return True if d is a working day according to the calendar and its exceptions."""
    exceptions: list[CalendarException] = getattr(calendar, "exceptions", []) or []

    # Check explicit exceptions first
    for exc in exceptions:
        if exc.date == d:
            return exc.is_working

    # Fall back to weekly bitmask
    return bool(calendar.working_days & _day_bit(d))


def is_within_working_hours(calendar: WorkingCalendar, dt: datetime) -> bool:
    """Return True if dt falls on a working day AND within [hour_from, hour_to)."""
    if not is_working_day(calendar, dt.date()):
        return False
    return calendar.hour_from <= dt.hour < calendar.hour_to


def next_working_day(calendar: WorkingCalendar, d: date) -> date:
    """Return d if it is a working day, otherwise the next working day."""
    candidate = d
    for _ in range(14):  # safety cap of 2 weeks
        if is_working_day(calendar, candidate):
            return candidate
        candidate += timedelta(days=1)
    return candidate


# ── Argentine national holidays ───────────────────────────────────────────────

_AR_HOLIDAYS_2025 = [
    (2025,  1,  1, "Año Nuevo"),
    (2025,  3,  3, "Carnaval"),
    (2025,  3,  4, "Carnaval"),
    (2025,  3, 24, "Día Nacional de la Memoria"),
    (2025,  4,  2, "Día del Veterano y los Caídos en Malvinas"),
    (2025,  4, 18, "Viernes Santo"),
    (2025,  5,  1, "Día del Trabajador"),
    (2025,  5, 25, "Día de la Revolución de Mayo"),
    (2025,  6, 16, "Paso a la Inmortalidad del Gral. Güemes"),
    (2025,  6, 20, "Paso a la Inmortalidad del Gral. Belgrano"),
    (2025,  7,  9, "Día de la Independencia"),
    (2025,  8, 17, "Paso a la Inmortalidad del Gral. San Martín"),
    (2025, 10, 13, "Día del Respeto a la Diversidad Cultural"),
    (2025, 11, 20, "Día de la Soberanía Nacional"),
    (2025, 12,  8, "Inmaculada Concepción de María"),
    (2025, 12, 25, "Navidad"),
]

_AR_HOLIDAYS_2026 = [
    (2026,  1,  1, "Año Nuevo"),
    (2026,  2, 16, "Carnaval"),
    (2026,  2, 17, "Carnaval"),
    (2026,  3, 24, "Día Nacional de la Memoria"),
    (2026,  4,  2, "Día del Veterano y los Caídos en Malvinas"),
    (2026,  4,  3, "Viernes Santo"),
    (2026,  5,  1, "Día del Trabajador"),
    (2026,  5, 25, "Día de la Revolución de Mayo"),
    (2026,  6, 17, "Paso a la Inmortalidad del Gral. Güemes"),
    (2026,  6, 20, "Paso a la Inmortalidad del Gral. Belgrano"),
    (2026,  7,  9, "Día de la Independencia"),
    (2026,  8, 17, "Paso a la Inmortalidad del Gral. San Martín"),
    (2026, 10, 12, "Día del Respeto a la Diversidad Cultural"),
    (2026, 11, 20, "Día de la Soberanía Nacional"),
    (2026, 12,  8, "Inmaculada Concepción de María"),
    (2026, 12, 25, "Navidad"),
]

_HOLIDAYS_BY_YEAR: dict[int, list[tuple[int, int, int, str]]] = {
    2025: _AR_HOLIDAYS_2025,
    2026: _AR_HOLIDAYS_2026,
}


def get_ar_holidays(year: int) -> list[dict]:
    """Return Argentine national holiday exceptions for the given year."""
    rows = _HOLIDAYS_BY_YEAR.get(year, [])
    return [
        {"date": date(y, m, d), "is_working": False, "label": label}
        for y, m, d, label in rows
    ]
