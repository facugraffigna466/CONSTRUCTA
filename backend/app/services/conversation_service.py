"""
Structured menu-based conversation state machine for WhatsApp chatbot.

Flow:
  idle        → 0 tasks: "sin tareas"
              → 1 task:  show status menu directly
              → N tasks: show paginated task list (5 per page)
  task_select → "1"–"5": select task → status_menu
              → "6":     next page (if more tasks)
              → "0":     previous page / cancel if on first page
              → "X":     cancel → idle
  status_menu → "1" en curso / "2" finalizada / "3" demorada / "4" reprogramar
              → "0":     back to task_select (or idle if single-task flow)
              → "X":     cancel → idle
  await_date  → DD/MM or DD/MM/AAAA → update due_date
              → "0":     back to status_menu
              → "X":     cancel → idle

Session expires after 30 minutes of inactivity.
Navigation keywords "MENU" / "INICIO" / "HOLA" always restart the flow.
"""
import re
from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.socket_manager import emit_task_updated
from app.models.alert import AlertType
from app.models.conversation_session import ConversationSession, ConversationStep
from app.models.responsible import Responsible
from app.models.task import Task, TaskStatus
from app.repositories.alert import AlertRepository
from app.repositories.conversation_session import ConversationSessionRepository
from app.repositories.historial import HistorialRepository
from app.repositories.obra import ObraRepository
from app.repositories.task import TaskRepository
from app.schemas.task import TaskStatusUpdate
from app.services.message_templates import (
    build_already_in_status_message,
    build_cancelled_message,
    build_confirmation_message,
    build_no_tasks_message,
    build_obra_list_message,
    build_reminder_message,
    build_reschedule_received_message,
    build_reschedule_request_message,
    build_status_menu_message,
    build_task_list_message,
    fmt_date,
    fmt_date_full,
)
from app.services.task_service import TaskService

# ── Constants ──────────────────────────────────────────────────────────────────

_DATE_RE = re.compile(r"^(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?$")
_TASKS_PER_PAGE = 5
_URGENT_DAYS = 3  # tasks due within this window are shown as "needs attention"

# ── task_options pagination helpers ───────────────────────────────────────────
#
# task_options layout when total tasks > _TASKS_PER_PAGE:
#   [{"_meta": True, "page": N, "total": T}, task1, task2, ...]
#
# When total tasks <= _TASKS_PER_PAGE: plain list [task1, task2, ...]
# Meta dict has no "id" key so all existing lookups skip it safely.

def _has_meta(options: list[dict]) -> bool:
    return bool(options) and options[0].get("_meta") is True


def _page_of(options: list[dict]) -> int:
    return options[0]["page"] if _has_meta(options) else 0


def _all_tasks(options: list[dict]) -> list[dict]:
    return options[1:] if _has_meta(options) else options


def _page_tasks(options: list[dict]) -> list[dict]:
    """Tasks visible on the current page."""
    page = _page_of(options)
    tasks = _all_tasks(options)
    start = page * _TASKS_PER_PAGE
    return tasks[start : start + _TASKS_PER_PAGE]


def _has_more(options: list[dict]) -> bool:
    page = _page_of(options)
    return (page + 1) * _TASKS_PER_PAGE < len(_all_tasks(options))


def _remaining(options: list[dict]) -> int:
    page = _page_of(options)
    shown = (page + 1) * _TASKS_PER_PAGE
    return max(0, len(_all_tasks(options)) - shown)


def _with_meta(tasks: list[dict], page: int) -> list[dict]:
    return [{"_meta": True, "page": page, "total": len(tasks)}, *tasks]


def _next_page(options: list[dict]) -> list[dict]:
    return _with_meta(_all_tasks(options), _page_of(options) + 1)


def _prev_page(options: list[dict]) -> list[dict]:
    return _with_meta(_all_tasks(options), max(0, _page_of(options) - 1))


def _make_task_options(tasks: list[dict]) -> list[dict]:
    """Wrap task list with meta if pagination is needed."""
    if len(tasks) > _TASKS_PER_PAGE:
        return _with_meta(tasks, 0)
    return tasks


# ── Navigation command detection ──────────────────────────────────────────────

def _is_cancel(body: str | None) -> bool:
    return bool(body) and body.strip().lower() in ("x", "cancelar", "salir")


def _is_back(body: str | None) -> bool:
    return bool(body) and body.strip() == "0"


def _is_menu(body: str | None) -> bool:
    return bool(body) and body.strip().lower() in ("menu", "menú", "inicio", "hola", "start")


# ── Misc helpers ───────────────────────────────────────────────────────────────

def _task_dict(task: Task, obra_name: str) -> dict:
    return {
        "id":           task.id,
        "title":        task.title,
        "obra_name":    obra_name,
        "obra_id":      task.obra_id,
        "due_date":     fmt_date(task.due_date),
        "due_date_raw": str(task.due_date) if task.due_date else None,
        "status":       task.status.value,
        "urgency_label": _urgency_label_for(task),
    }


def _urgency_sort_key(td: dict) -> int:
    from datetime import timedelta
    status = td.get("status", "")
    if status in ("completada", "cancelada"):
        return 99
    due_raw = td.get("due_date_raw")
    if status == "bloqueada" and not due_raw:
        return 5
    if not due_raw:
        return 50
    due = date.fromisoformat(due_raw)
    today = date.today()
    if due < today:
        return 0
    delta = (due - today).days
    if delta == 0:
        return 1
    if delta == 1:
        return 2
    if delta <= _URGENT_DAYS:
        return 3
    if status == "bloqueada":
        return 4
    return 10 + delta


def _urgency_label_for(task: Task) -> str | None:
    today = date.today()
    if task.due_date and task.due_date < today:
        return "Vencida"
    if task.status == TaskStatus.BLOQUEADA:
        return "Demorada"
    if not task.due_date:
        return None
    delta = (task.due_date - today).days
    if delta == 0:
        return "Vence hoy"
    if delta == 1:
        return "Vence mañana"
    if delta <= _URGENT_DAYS:
        return f"Vence en {delta} días"
    return None


def _needs_attention(td: dict) -> bool:
    status = td.get("status", "")
    if status in ("completada", "cancelada"):
        return False
    if status == "bloqueada":
        return True
    due_raw = td.get("due_date_raw")
    if not due_raw:
        return False
    due = date.fromisoformat(due_raw)
    return (due - date.today()).days <= _URGENT_DAYS


def _parse_option(body: str | None, max_val: int) -> int | None:
    if not body:
        return None
    s = body.strip()
    if s.isdigit():
        n = int(s)
        if 1 <= n <= max_val:
            return n
    return None


def _parse_date(body: str | None) -> date | None:
    if not body:
        return None
    m = _DATE_RE.match(body.strip())
    if not m:
        return None
    day, month = int(m.group(1)), int(m.group(2))
    year_raw = m.group(3)

    if year_raw:
        year = int(year_raw)
        if year < 100:
            year += 2000
    else:
        from datetime import timedelta
        today = date.today()
        year = today.year
        try:
            candidate = date(year, month, day)
        except ValueError:
            return None
        if candidate < today - timedelta(days=7):
            year += 1

    try:
        return date(year, month, day)
    except ValueError:
        return None


# ── Service ────────────────────────────────────────────────────────────────────

class ConversationService:
    def __init__(self, session: AsyncSession) -> None:
        self.db = session
        self.task_repo = TaskRepository(session)
        self.obra_repo = ObraRepository(session)
        self.historial = HistorialRepository(session)
        self.alert_repo = AlertRepository(session)
        self.session_repo = ConversationSessionRepository(session)
        self.task_service = TaskService(session)

    # ── public entry point ─────────────────────────────────────────────────────

    async def handle_inbound(
        self, responsible: Responsible, body: str | None
    ) -> tuple[str, int | None]:
        """
        Process one inbound text message.
        Returns (reply_text, task_id_or_None).
        """
        # Global restart commands override any current state
        if _is_menu(body):
            await self.session_repo.upsert(responsible.id, ConversationStep.IDLE)
            return await self._start_fresh(responsible)

        conv = await self.session_repo.get_by_responsible(responsible.id)
        now = datetime.now(timezone.utc)
        is_expired = conv is None or conv.expires_at.replace(tzinfo=timezone.utc) < now

        if is_expired or conv.step == ConversationStep.IDLE:
            return await self._start_fresh(responsible)

        # Global cancel — reset to idle from any step
        if _is_cancel(body):
            await self.session_repo.upsert(responsible.id, ConversationStep.IDLE)
            return build_cancelled_message(), None

        if conv.step == ConversationStep.OBRA_SELECT:
            return await self._handle_obra_select(responsible, conv, body)

        if conv.step == ConversationStep.TASK_SELECT:
            return await self._handle_task_select(responsible, conv, body)

        if conv.step == ConversationStep.STATUS_MENU:
            return await self._handle_status_menu(responsible, conv, body)

        if conv.step == ConversationStep.AWAIT_DATE:
            return await self._handle_await_date(responsible, conv, body)

        return await self._start_fresh(responsible)

    async def seed_for_task(
        self, responsible: Responsible, task: Task, obra_name: str
    ) -> str:
        """
        Called by NotificationService before sending a proactive reminder.
        Seeds a STATUS_MENU session so the user's reply is immediately routed.
        Returns the reminder message text to send.
        """
        td = _task_dict(task, obra_name)
        await self.session_repo.upsert(
            responsible.id,
            ConversationStep.STATUS_MENU,
            selected_task_id=task.id,
            task_options=[td],
        )
        return build_reminder_message(
            responsible.full_name,
            task_name=td["title"],
            obra_name=td["obra_name"],
            due_date=td["due_date"],
            current_status=td["status"],
        )

    # ── step handlers ──────────────────────────────────────────────────────────

    async def _start_fresh(self, responsible: Responsible) -> tuple[str, int | None]:
        tasks = await self.task_repo.list_by_responsible(responsible.id)

        # Only show active tasks
        active = [
            t for t in tasks
            if t.status not in (TaskStatus.COMPLETADA, TaskStatus.CANCELADA)
        ]

        if not active:
            await self.session_repo.upsert(responsible.id, ConversationStep.IDLE)
            return build_no_tasks_message(responsible.full_name), None

        # Build task dicts and sort by urgency
        all_task_dicts: list[dict[str, Any]] = []
        for task in active:
            obra = await self.obra_repo.get(task.obra_id)
            obra_name = obra.name if obra else f"Obra #{task.obra_id}"
            all_task_dicts.append(_task_dict(task, obra_name))
        all_task_dicts.sort(key=_urgency_sort_key)

        # Single task → go directly to status menu
        if len(all_task_dicts) == 1:
            td = all_task_dicts[0]
            await self.session_repo.upsert(
                responsible.id,
                ConversationStep.STATUS_MENU,
                selected_task_id=td["id"],
                task_options=[td],
            )
            return (
                build_status_menu_message(
                    responsible.full_name,
                    task_name=td["title"],
                    obra_name=td["obra_name"],
                    due_date=td["due_date"],
                    current_status=td["status"],
                    can_go_back=False,
                ),
                td["id"],
            )

        # Multiple obras → obra selection first
        obra_ids = {td["obra_id"] for td in all_task_dicts}
        if len(obra_ids) > 1:
            obra_map: dict[int, dict] = {}
            for td in all_task_dicts:
                oid = td["obra_id"]
                if oid not in obra_map:
                    obra_map[oid] = {
                        "obra_id":     oid,
                        "obra_name":   td["obra_name"],
                        "task_count":  0,
                        "urgent_count": 0,
                    }
                obra_map[oid]["task_count"] += 1
                if _needs_attention(td):
                    obra_map[oid]["urgent_count"] += 1

            obra_list = list(obra_map.values())
            obra_options = [{"_meta": True, "type": "obra_select"}, *obra_list]
            await self.session_repo.upsert(
                responsible.id,
                ConversationStep.OBRA_SELECT,
                task_options=obra_options,
            )
            return build_obra_list_message(responsible.full_name, obra_list), None

        # Single obra → show urgency-sorted task list
        obra_name = all_task_dicts[0]["obra_name"]
        options = _make_task_options(all_task_dicts)
        await self.session_repo.upsert(
            responsible.id, ConversationStep.TASK_SELECT, task_options=options
        )
        pg = _page_tasks(options)
        return (
            build_task_list_message(
                responsible.full_name,
                pg,
                has_more=_has_more(options),
                remaining=_remaining(options),
                is_first_page=True,
                obra_filter=obra_name,
            ),
            None,
        )

    async def _handle_obra_select(
        self,
        responsible: Responsible,
        conv: ConversationSession,
        body: str | None,
    ) -> tuple[str, int | None]:
        options = conv.task_options or []
        # options[0] is the meta dict; the rest are obra dicts
        obra_list = [o for o in options if not o.get("_meta")]

        n = _parse_option(body, max_val=len(obra_list))
        if n is None:
            prefix = "Opción inválida.\n\n" if body and body.strip() else ""
            return prefix + build_obra_list_message(responsible.full_name, obra_list), None

        chosen_obra = obra_list[n - 1]
        obra_id = chosen_obra["obra_id"]

        # Re-query tasks for this responsible, filter to selected obra
        all_tasks = await self.task_repo.list_by_responsible(responsible.id)
        obra_tasks = [
            t for t in all_tasks
            if t.obra_id == obra_id
            and t.status not in (TaskStatus.COMPLETADA, TaskStatus.CANCELADA)
        ]

        if not obra_tasks:
            await self.session_repo.upsert(responsible.id, ConversationStep.IDLE)
            return build_no_tasks_message(responsible.full_name), None

        obra_name = chosen_obra["obra_name"]
        task_dicts = [_task_dict(t, obra_name) for t in obra_tasks]
        task_dicts.sort(key=_urgency_sort_key)

        if len(task_dicts) == 1:
            td = task_dicts[0]
            await self.session_repo.upsert(
                responsible.id,
                ConversationStep.STATUS_MENU,
                selected_task_id=td["id"],
                task_options=[td],
            )
            return (
                build_status_menu_message(
                    responsible.full_name,
                    task_name=td["title"],
                    obra_name=td["obra_name"],
                    due_date=td["due_date"],
                    current_status=td["status"],
                    can_go_back=True,
                ),
                td["id"],
            )

        paged = _make_task_options(task_dicts)
        await self.session_repo.upsert(
            responsible.id, ConversationStep.TASK_SELECT, task_options=paged
        )
        pg = _page_tasks(paged)
        return (
            build_task_list_message(
                responsible.full_name,
                pg,
                has_more=_has_more(paged),
                remaining=_remaining(paged),
                is_first_page=True,
                obra_filter=obra_name,
            ),
            None,
        )

    async def _handle_task_select(
        self,
        responsible: Responsible,
        conv: ConversationSession,
        body: str | None,
    ) -> tuple[str, int | None]:
        options = conv.task_options or []
        pg = _page_tasks(options)
        is_first_page = _page_of(options) == 0
        has_more = _has_more(options)
        ver_mas_idx = len(pg) + 1

        all_tasks = _all_tasks(options)
        obra_names = {td.get("obra_name") for td in all_tasks if td.get("obra_name")}
        obra_filter = next(iter(obra_names)) if len(obra_names) == 1 else None

        # "0" on first page → cancel (no previous step)
        if _is_back(body):
            if is_first_page:
                await self.session_repo.upsert(responsible.id, ConversationStep.IDLE)
                return build_cancelled_message(), None
            # Go to previous page
            prev = _prev_page(options)
            await self.session_repo.upsert(
                responsible.id, ConversationStep.TASK_SELECT, task_options=prev
            )
            prev_pg = _page_tasks(prev)
            return (
                build_task_list_message(
                    responsible.full_name,
                    prev_pg,
                    has_more=True,
                    remaining=_remaining(prev),
                    is_first_page=_page_of(prev) == 0,
                    obra_filter=obra_filter,
                ),
                None,
            )

        # "Ver más" option
        if has_more and body and body.strip() == str(ver_mas_idx):
            nxt = _next_page(options)
            await self.session_repo.upsert(
                responsible.id, ConversationStep.TASK_SELECT, task_options=nxt
            )
            nxt_pg = _page_tasks(nxt)
            return (
                build_task_list_message(
                    responsible.full_name,
                    nxt_pg,
                    has_more=_has_more(nxt),
                    remaining=_remaining(nxt),
                    is_first_page=False,
                    obra_filter=obra_filter,
                ),
                None,
            )

        # Normal task selection
        n = _parse_option(body, max_val=len(pg))
        if n is None:
            await self.session_repo.upsert(
                responsible.id, ConversationStep.TASK_SELECT, task_options=options
            )
            prefix = "Opción inválida.\n\n" if body and body.strip() else ""
            return (
                prefix + build_task_list_message(
                    responsible.full_name,
                    pg,
                    has_more=has_more,
                    remaining=_remaining(options),
                    is_first_page=is_first_page,
                    obra_filter=obra_filter,
                ),
                None,
            )

        chosen = pg[n - 1]
        all_options = _all_tasks(options)
        await self.session_repo.upsert(
            responsible.id,
            ConversationStep.STATUS_MENU,
            selected_task_id=chosen["id"],
            task_options=all_options,  # store all tasks (no pagination meta needed in status_menu)
        )
        return (
            build_status_menu_message(
                responsible.full_name,
                task_name=chosen["title"],
                obra_name=chosen["obra_name"],
                due_date=chosen["due_date"],
                current_status=chosen["status"],
                can_go_back=True,
            ),
            chosen["id"],
        )

    async def _handle_status_menu(
        self,
        responsible: Responsible,
        conv: ConversationSession,
        body: str | None,
    ) -> tuple[str, int | None]:
        task_id = conv.selected_task_id
        options = conv.task_options or []

        # "0" → back to task_select (if there were multiple tasks) or idle
        if _is_back(body):
            all_tasks = _all_tasks(options)
            if len(all_tasks) > 1:
                # Rebuild options with pagination and go back to task_select
                paged = _make_task_options(all_tasks)
                await self.session_repo.upsert(
                    responsible.id, ConversationStep.TASK_SELECT, task_options=paged
                )
                pg = _page_tasks(paged)
                return (
                    build_task_list_message(
                        responsible.full_name,
                        pg,
                        has_more=_has_more(paged),
                        remaining=_remaining(paged),
                        is_first_page=True,
                    ),
                    None,
                )
            # Single-task flow — no previous step
            await self.session_repo.upsert(responsible.id, ConversationStep.IDLE)
            return build_cancelled_message(), None

        opt = next((o for o in _all_tasks(options) if o.get("id") == task_id), None)
        n = _parse_option(body, max_val=4)

        if n is None:
            await self.session_repo.upsert(
                responsible.id,
                ConversationStep.STATUS_MENU,
                selected_task_id=task_id,
                task_options=options,
            )
            menu = (
                build_status_menu_message(
                    responsible.full_name,
                    task_name=opt["title"],
                    obra_name=opt["obra_name"],
                    due_date=opt["due_date"],
                    current_status=opt["status"],
                    can_go_back=len(_all_tasks(options)) > 1,
                )
                if opt else "Error interno. Intentá de nuevo."
            )
            prefix = "Opción inválida.\n\n" if body and body.strip() else ""
            return prefix + menu, task_id

        try:
            if n == 1:
                reply = await self._apply_en_curso(responsible, task_id, opt)
            elif n == 2:
                reply = await self._apply_finalizada(responsible, task_id, opt)
            elif n == 3:
                reply = await self._apply_demorada(responsible, task_id, opt)
            else:
                # Option 4: reschedule date
                await self.session_repo.upsert(
                    responsible.id,
                    ConversationStep.AWAIT_DATE,
                    selected_task_id=task_id,
                    task_options=options,
                )
                title = opt["title"] if opt else f"Tarea #{task_id}"
                due = opt["due_date"] if opt else "sin fecha"
                return build_reschedule_request_message(title, due, can_go_back=True), task_id
        except Exception:
            await self.session_repo.upsert(responsible.id, ConversationStep.IDLE)
            return "Ocurrió un error al actualizar la tarea. Por favor intentá de nuevo.", task_id

        await self.session_repo.upsert(responsible.id, ConversationStep.IDLE)
        if task_id:
            task = await self.task_repo.get(task_id)
            if task:
                await emit_task_updated(task)
        return reply, task_id

    async def _handle_await_date(
        self,
        responsible: Responsible,
        conv: ConversationSession,
        body: str | None,
    ) -> tuple[str, int | None]:
        task_id = conv.selected_task_id
        options = conv.task_options or []
        opt = next((o for o in _all_tasks(options) if o.get("id") == task_id), None)
        title = opt["title"] if opt else f"Tarea #{task_id}"
        current_due = opt["due_date"] if opt else "sin fecha"

        # "0" → back to status_menu
        if _is_back(body):
            await self.session_repo.upsert(
                responsible.id,
                ConversationStep.STATUS_MENU,
                selected_task_id=task_id,
                task_options=options,
            )
            return (
                build_status_menu_message(
                    responsible.full_name,
                    task_name=title,
                    obra_name=opt["obra_name"] if opt else "",
                    due_date=current_due,
                    current_status=opt["status"] if opt else "pendiente",
                    can_go_back=len(_all_tasks(options)) > 1,
                ),
                task_id,
            )

        new_date = _parse_date(body)
        if new_date is None:
            await self.session_repo.upsert(
                responsible.id,
                ConversationStep.AWAIT_DATE,
                selected_task_id=task_id,
                task_options=options,
            )
            return (
                "Formato inválido.\n\n"
                + build_reschedule_request_message(title, current_due, can_go_back=True),
                task_id,
            )

        if task_id:
            task = await self.task_repo.get(task_id)
            if task:
                suggested = fmt_date_full(new_date)
                alert_msg = (
                    f"{responsible.full_name} informó demora en '{task.title}'. "
                    f"Fecha sugerida: {suggested}."
                )
                await self.alert_repo.create_alert(
                    alert_type=AlertType.RESCHEDULE_REQUESTED,
                    message=alert_msg,
                    obra_id=task.obra_id,
                    task_id=task_id,
                )
                await self.historial.log(
                    obra_id=task.obra_id,
                    task_id=task_id,
                    event_type="reschedule_requested",
                    description=f"{responsible.full_name} sugirió nueva fecha: {suggested}",
                    payload={
                        "suggested_date": str(new_date),
                        "current_due_date": str(task.due_date) if task.due_date else None,
                        "responsible_id": responsible.id,
                        "responsible_name": responsible.full_name,
                    },
                    triggered_by="chatbot",
                )

        await self.session_repo.upsert(responsible.id, ConversationStep.IDLE)
        return (
            build_reschedule_received_message(
                responsible.full_name, title, fmt_date_full(new_date)
            ),
            task_id,
        )

    # ── action helpers ─────────────────────────────────────────────────────────

    async def _apply_en_curso(
        self, responsible: Responsible, task_id: int | None, opt: dict | None
    ) -> str:
        if not task_id:
            return "No se encontró la tarea."
        task = await self.task_repo.get(task_id)
        if not task:
            return "La tarea no fue encontrada."
        title = opt["title"] if opt else task.title

        if task.status == TaskStatus.EN_PROGRESO:
            return build_already_in_status_message(responsible.full_name, title, "en_progreso")

        await self.task_service.apply_status_update(
            task_id,
            TaskStatusUpdate(
                status=TaskStatus.EN_PROGRESO,
                estimated_progress=task.estimated_progress,
                triggered_by="chatbot",
                reason="En curso vía WhatsApp",
            ),
        )
        return build_confirmation_message(responsible.full_name, title, "en_progreso")

    async def _apply_finalizada(
        self, responsible: Responsible, task_id: int | None, opt: dict | None
    ) -> str:
        if not task_id:
            return "No se encontró la tarea."
        task = await self.task_repo.get(task_id)
        if not task:
            return "La tarea no fue encontrada."
        title = opt["title"] if opt else task.title

        if task.status == TaskStatus.COMPLETADA:
            return build_already_in_status_message(responsible.full_name, title, "completada")

        await self.task_service.force_complete(task_id, triggered_by="chatbot")
        return build_confirmation_message(responsible.full_name, title, "completada")

    async def _apply_demorada(
        self, responsible: Responsible, task_id: int | None, opt: dict | None
    ) -> str:
        if not task_id:
            return "No se encontró la tarea."
        task = await self.task_repo.get(task_id)
        if not task:
            return "La tarea no fue encontrada."
        title = opt["title"] if opt else task.title

        if task.status == TaskStatus.BLOQUEADA:
            return build_already_in_status_message(responsible.full_name, title, "bloqueada")

        await self.task_service.force_block(task_id, triggered_by="chatbot")
        return build_confirmation_message(responsible.full_name, title, "bloqueada")
