"""
Centralized WhatsApp message templates for the Constructa chatbot.

All user-facing text lives here. To change wording or layout,
edit this file — no business logic needs to be touched.
"""
from datetime import date

# ── Status labels & emojis ─────────────────────────────────────────────────────

STATUS_LABELS: dict[str, str] = {
    "pendiente":   "Pendiente",
    "en_progreso": "En progreso",
    "bloqueada":   "Bloqueada",
    "completada":  "Completada",
    "cancelada":   "Cancelada",
}

STATUS_EMOJI: dict[str, str] = {
    "pendiente":   "🔵",
    "en_progreso": "🟡",
    "bloqueada":   "🔴",
    "completada":  "🟢",
    "cancelada":   "⚫",
}

def _status_line(status: str) -> str:
    emoji = STATUS_EMOJI.get(status, "⚪")
    label = STATUS_LABELS.get(status, status)
    return f"{emoji} {label}"

# ── Number emoji keycaps ───────────────────────────────────────────────────────

_NUM = {
    0: "0️⃣",
    1: "1️⃣",
    2: "2️⃣",
    3: "3️⃣",
    4: "4️⃣",
    5: "5️⃣",
    6: "6️⃣",
    7: "7️⃣",
    8: "8️⃣",
    9: "9️⃣",
}

def _n(i: int) -> str:
    return _NUM.get(i, f"{i}.")

# ── Date helpers ───────────────────────────────────────────────────────────────

def fmt_date(d: "date | str | None") -> str:
    if d is None:
        return "sin fecha"
    s = str(d)
    if len(s) == 10 and s[4] == "-":
        _, m, day = s.split("-")
        return f"{day}/{m}"
    return s


def fmt_date_full(d: "date | str | None") -> str:
    if d is None:
        return "sin fecha"
    s = str(d)
    if len(s) == 10 and s[4] == "-":
        y, m, day = s.split("-")
        return f"{day}/{m}/{y}"
    return s


# ── Message builders ───────────────────────────────────────────────────────────

def build_no_tasks_message(name: str) -> str:
    return f"Hola {name}. No tenés tareas activas asignadas en este momento."


def build_obra_list_message(name: str, obras: list[dict]) -> str:
    lines = [f"CONSTRUCTA 🏗️\n", f"Hola {name}. ¿En qué obra querés reportar?\n"]
    for i, obra in enumerate(obras, 1):
        urgent = obra.get("urgent_count", 0)
        total  = obra.get("task_count", 0)
        urgent_txt = f", {urgent} urgente{'s' if urgent != 1 else ''}" if urgent else ""
        lines.append(f"{_n(i)} {obra['obra_name']} ({total} tarea{'s' if total != 1 else ''}{urgent_txt})")
    lines.append(f"\nEscribí el número de la obra.\nPara cancelar escribí X.")
    return "\n".join(lines)


def build_task_list_message(
    name: str,
    page_tasks: list[dict],
    *,
    has_more: bool = False,
    remaining: int = 0,
    is_first_page: bool = True,
    obra_filter: str | None = None,
) -> str:
    lines = []

    if is_first_page:
        if obra_filter:
            lines.append(f"CONSTRUCTA 🏗️\n\nHola {name}. Tareas en {obra_filter}:\n")
        else:
            lines.append(f"CONSTRUCTA 🏗️\n\nHola {name}. Tus tareas:\n")
    else:
        lines.append("Más tareas:\n")

    for i, task in enumerate(page_tasks, 1):
        urgency = task.get("urgency_label")
        if not obra_filter:
            lines.append(f"{_n(i)} {task['title']} 📍 {task['obra_name']}")
        else:
            lines.append(f"{_n(i)} {task['title']}")
        icon = " ⚠️" if urgency else ""
        lines.append(f"   📅 {task['due_date']}{icon}")

    if has_more:
        ver_mas_idx = len(page_tasks) + 1
        lines.append(f"\n{_n(ver_mas_idx)} Ver más ({remaining} restante{'s' if remaining != 1 else ''})")

    if not is_first_page:
        footer = "Para volver escribí 0️⃣.\nPara cancelar escribí X."
    else:
        footer = "Para cancelar escribí X."
    lines.append(f"\nEscribí el número de la tarea.\n{footer}")
    return "\n".join(lines)


def build_status_menu_message(
    name: str,
    task_name: str,
    obra_name: str,
    due_date: str,
    *,
    current_status: str = "pendiente",
    can_go_back: bool = False,
) -> str:
    if can_go_back:
        footer = "Para volver escribí 0️⃣.\nPara cancelar escribí X."
    else:
        footer = "Para cancelar escribí X."
    return (
        f"CONSTRUCTA 🏗️\n\n"
        f"Tarea: {task_name}\n"
        f"📍 {obra_name}\n"
        f"📅 {due_date}\n"
        f"Estado actual: {_status_line(current_status)}\n\n"
        f"¿Cuál es el estado?\n\n"
        f"1️⃣ En progreso\n"
        f"2️⃣ Completada\n"
        f"3️⃣ Bloqueada\n"
        f"4️⃣ Demorada\n\n"
        f"Escribí el número.\n{footer}"
    )


def build_reminder_message(
    name: str,
    task_name: str,
    obra_name: str,
    due_date: str,
    *,
    current_status: str = "pendiente",
) -> str:
    return (
        f"CONSTRUCTA 🏗️\n\n"
        f"Hola {name}, recordatorio de tarea próxima a vencer.\n\n"
        f"Tarea: {task_name}\n"
        f"📍 {obra_name}\n"
        f"📅 {due_date}\n"
        f"Estado actual: {_status_line(current_status)}\n\n"
        f"¿Cuál es el estado?\n\n"
        f"1️⃣ En progreso\n"
        f"2️⃣ Completada\n"
        f"3️⃣ Bloqueada\n"
        f"4️⃣ Demorada\n\n"
        f"Escribí el número.\nPara cancelar escribí X."
    )


def build_reschedule_request_message(
    task_name: str,
    current_due_date: str,
    *,
    can_go_back: bool = True,
) -> str:
    if can_go_back:
        footer = "Para volver escribí 0️⃣.\nPara cancelar escribí X."
    else:
        footer = "Para cancelar escribí X."
    return (
        f"Tarea: {task_name}\n"
        f"📅 Fecha estimada actual: {current_due_date}\n\n"
        f"¿Para cuándo estimás que va a estar lista?\n"
        f"Formato: DD/MM o DD/MM/AAAA\n\n"
        f"{footer}"
    )


def build_confirmation_message(name: str, task_name: str, status: str) -> str:
    label = STATUS_LABELS.get(status, status)
    return (
        f"✅ Listo, gracias {name}.\n\n"
        f"Tarea: {task_name}\n"
        f"Estado: {label}\n\n"
        f"Quedó registrado en Constructa."
    )


def build_reschedule_confirmation_message(
    name: str, task_name: str, new_date: str
) -> str:
    return (
        f"✅ Listo, gracias {name}.\n\n"
        f"Tarea: {task_name}\n"
        f"📅 Nueva fecha: {new_date}\n\n"
        f"Quedó registrado en Constructa."
    )


def build_already_in_status_message(name: str, task_name: str, status: str) -> str:
    label = STATUS_LABELS.get(status, status)
    return (
        f"Hola {name}. La tarea \"{task_name}\" ya está en estado {label}.\n"
        f"No se realizaron cambios."
    )


def build_reschedule_received_message(name: str, task_name: str, suggested_date: str) -> str:
    return (
        f"✅ Gracias {name}.\n\n"
        f"Tarea: {task_name}\n"
        f"📅 Fecha sugerida: {suggested_date}\n\n"
        f"El encargado de obra fue notificado y revisará los cambios."
    )


def build_cancelled_message() -> str:
    return "Conversación cancelada.\nSi querés reportar algo, escribinos de nuevo."


def build_non_text_message(name: str) -> str:
    return f"Hola {name}. Por favor respondé con el número de la opción."
