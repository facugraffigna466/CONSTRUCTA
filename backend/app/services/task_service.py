from datetime import date, timedelta
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ForbiddenError, NotFoundError, UnprocessableError
from app.core.socket_manager import emit_alerts_resolved, emit_task_created, emit_task_deleted, emit_task_updated
from app.core.tenant_denorm import tenant_for_obra
from app.models.alert import AlertType
from app.models.obra import Obra, ObraStatus
from app.models.task import Task, TaskStatus
from app.repositories.alert import AlertRepository
from app.repositories.calendar import CalendarRepository
from app.repositories.historial import HistorialRepository
from app.repositories.obra import ObraRepository
from app.repositories.responsible import ResponsibleRepository
from app.repositories.settings import SettingsRepository
from app.repositories.task import TaskRepository
from app.repositories.user import UserRepository
from app.schemas.task import DependencyLinkInput, TaskCreate, TaskDueSoonRead, TaskStatusUpdate, TaskUpdate
from app.services.calendar_service import is_working_day, next_working_day

_FIELD_LABELS: dict[str, str] = {
    "title":          "título",
    "description":    "descripción",
    "responsible_id": "responsable",
    "start_date":     "fecha de inicio",
    "due_date":       "fecha de vencimiento",
    "order_index":    "orden",
    "depends_on_id":  "dependencia",
}


def _to_json(v: object) -> object:
    from datetime import time as time_type
    return str(v) if isinstance(v, (date, time_type)) else v


_NULL_LABELS: dict[str, str] = {
    "start_date":         "Sin fecha",
    "due_date":           "Sin fecha",
    "description":        "Sin descripción",
    "estimated_progress": "Sin definir",
    "depends_on_id":      "Sin dependencia",
    "order_index":        "—",
}


def _format_field_value(field: str, value: object) -> str:
    if value is None:
        return _NULL_LABELS.get(field, "—")
    if field in ("start_date", "due_date"):
        s = str(value)
        if len(s) == 10 and s[4] == "-":
            y, m, d_part = s.split("-")
            return f"{d_part}/{m}/{y}"
        return s
    if field == "description":
        s = str(value)
        return s if s else "Sin descripción"
    if field == "estimated_progress":
        return f"{value}%"
    if field == "depends_on_id":
        return f"Tarea #{value}"
    return str(value)


# Task state is controlled by the system, not by users.
# These are the only allowed transitions.
VALID_TRANSITIONS: dict[TaskStatus, set[TaskStatus]] = {
    TaskStatus.PENDIENTE:   {TaskStatus.EN_PROGRESO, TaskStatus.CANCELADA},
    TaskStatus.EN_PROGRESO: {TaskStatus.BLOQUEADA, TaskStatus.COMPLETADA, TaskStatus.CANCELADA},
    TaskStatus.BLOQUEADA:   {TaskStatus.EN_PROGRESO, TaskStatus.CANCELADA},
    TaskStatus.COMPLETADA:  set(),
    TaskStatus.CANCELADA:   set(),
}


class TaskService:
    def __init__(self, session: AsyncSession) -> None:
        self.repo = TaskRepository(session)
        self.obra_repo = ObraRepository(session)
        self.resp_repo = ResponsibleRepository(session)
        self.historial = HistorialRepository(session)
        self.alert_repo = AlertRepository(session)
        self.calendar_repo = CalendarRepository(session)
        self.settings_repo = SettingsRepository(session)

    # ── guards ────────────────────────────────────────────────────────────────

    async def _get_obra_and_assert_access(self, obra_id: int, manager_id: int) -> None:
        obra = await self.obra_repo.get(obra_id)
        if not obra:
            raise NotFoundError("Obra", obra_id)
        # Aislamiento multi-tenant: la obra debe ser del mismo tenant que el usuario.
        # Si no, se reporta como inexistente (404, no 403 — no filtrar qué ids existen).
        if obra.tenant_id is not None:
            user = await UserRepository(self.obra_repo.session).get(manager_id)
            if user is not None and user.tenant_id is not None and obra.tenant_id != user.tenant_id:
                raise NotFoundError("Obra", obra_id)

    async def recompute_obra_status(self, obra_id: int, allow_complete: bool = True) -> None:
        """Estado AUTOMÁTICO de la obra según sus tareas.

        Regla clave: `pausada`, `cancelada` y `completada` son 'pegajosos' —
        decisiones manuales/terminales que el automático NUNCA pisa. El auto solo
        maneja el tramo planificada ↔ en_progreso (y promueve a completada cuando
        todas las tareas están terminadas). El commit lo hace get_db.

        `allow_complete=False` se usa al reactivar/reabrir a mano: recalcula
        planificada/en_progreso pero NO vuelve a completar en el mismo acto (para
        que "reabrir" no rebote a completada si las tareas siguen al 100%).
        """
        obra = (await self.repo.session.execute(
            select(Obra).where(Obra.id == obra_id)
        )).scalar_one_or_none()
        if obra is None or obra.status in (
            ObraStatus.PAUSADA, ObraStatus.CANCELADA, ObraStatus.COMPLETADA
        ):
            return
        tasks = await self.repo.list_by_obra(obra_id)
        active = [t for t in tasks if t.status != TaskStatus.CANCELADA]
        if allow_complete and active and all(t.status == TaskStatus.COMPLETADA for t in active):
            new = ObraStatus.COMPLETADA
        elif any(
            t.status in (TaskStatus.EN_PROGRESO, TaskStatus.BLOQUEADA, TaskStatus.COMPLETADA)
            or (t.estimated_progress or 0) > 0
            for t in active
        ):
            new = ObraStatus.EN_PROGRESO
        else:
            new = ObraStatus.PLANIFICADA
        if obra.status != new:
            obra.status = new

    async def _assert_responsible_active(
        self, responsible_id: int, obra_tenant_id: int | None = None
    ) -> None:
        """Block assignment of inactive responsibles + cross-tenant leaks.

        In Phase 2 the chatbot sends messages to the responsible's phone.
        An inactive responsible means they left the project — assigning them
        would cause silent failures when the webhook tries to contact them.

        Hallazgo 7.2 de docs/auditoria/03-tareas.md: si `obra_tenant_id` viene,
        validamos también que el responsable pertenezca al mismo tenant. Sin
        esta guarda, un admin del tenant A podía asignar responsables del
        tenant B a sus tareas (y por _ensure_team_member terminaban en el
        team de una obra ajena). Devolvemos 404 (misma semántica que otros
        cross-tenant leaks: no filtrar qué ids existen en otros tenants).
        """
        responsible = await self.resp_repo.get(responsible_id)
        if not responsible:
            raise NotFoundError("Responsible", responsible_id)
        if not responsible.is_active:
            raise UnprocessableError(
                "El responsable seleccionado está inactivo. Elegí uno activo o dejá la tarea sin asignar."
            )
        if (
            obra_tenant_id is not None
            and responsible.tenant_id is not None
            and responsible.tenant_id != obra_tenant_id
        ):
            raise NotFoundError("Responsible", responsible_id)

    async def _ensure_team_member(self, obra_id: int, responsible_id: int | None) -> None:
        """Valida que el responsable ya pertenezca al equipo de la obra
        (`ObraTeamMember`) antes de asignarle una tarea.

        **Cambio de comportamiento (rediseño identidad WhatsApp — parte A.4).**
        Antes este método CREABA silenciosamente la fila si no existía, con
        `member_type='equipo'` y `plan_disciplines=NULL` (acceso total a
        planos por default). Eso permitía que asignar una tarea a alguien
        desde el TaskFormModal le diera acceso irrestricto a los planos de
        la obra sin ninguna decisión explícita del admin, y además saltaba
        el flujo de confirmación por WhatsApp que ahora es obligatorio.

        Ahora falla con un error 422 claro: el flujo correcto es
        (1) agregar al responsable al equipo desde el tab Responsables de
        la obra (con su member_type + plan_disciplines explícitos), y
        recién (2) asignarle la tarea. El frontend puede recuperar el 422
        y mostrarle al usuario el paso que falta.
        """
        if responsible_id is None:
            return
        from sqlalchemy import select
        from app.models.obra_team_member import ObraTeamMember
        exists = (await self.repo.session.execute(
            select(ObraTeamMember).where(
                ObraTeamMember.obra_id == obra_id,
                ObraTeamMember.responsible_id == responsible_id,
            )
        )).scalar_one_or_none()
        if exists is None:
            raise UnprocessableError(
                "El responsable no está en el equipo de esta obra — "
                "agregalo desde el tab Responsables antes de asignarle tareas."
            )

    async def _assert_depends_on_valid(
        self, depends_on_id: int, obra_id: int, current_task_id: int | None = None
    ) -> None:
        """Ensure the referenced dependency task belongs to the same obra.

        Cross-obra dependencies are logically invalid and would corrupt
        Gantt chain resolution in Phase 3.
        Also blocks self-reference (a task depending on itself).
        """
        if current_task_id is not None and depends_on_id == current_task_id:
            raise UnprocessableError("Una tarea no puede depender de sí misma.")

        dep_task = await self.repo.get(depends_on_id)
        if not dep_task:
            raise NotFoundError("Task", depends_on_id)
        if dep_task.obra_id != obra_id:
            raise UnprocessableError(
                "La tarea seleccionada como dependencia pertenece a otra obra."
            )

    async def _check_no_cycle(self, task_id: int, proposed_dep_ids: list[int]) -> None:
        """DFS from each proposed dependency to ensure none of them lead back to task_id."""
        visited: set[int] = set()

        async def dfs(current_id: int) -> bool:
            if current_id == task_id:
                return True  # cycle found
            if current_id in visited:
                return False
            visited.add(current_id)
            deps = await self.repo.get_dependency_ids(current_id)
            for dep_id in deps:
                if await dfs(dep_id):
                    return True
            return False

        for dep_id in proposed_dep_ids:
            if await dfs(dep_id):
                raise UnprocessableError(
                    f"Agregar esta dependencia crearía un ciclo (la tarea {dep_id} ya depende de esta tarea)."
                )

    async def _sync_dependencies(self, task: Task, links: list[DependencyLinkInput]) -> None:
        """Replace the task's dependency set with links, validating each one."""
        dep_ids = [l.depends_on_id for l in links]
        for dep_id in dep_ids:
            if dep_id == task.id:
                raise UnprocessableError("Una tarea no puede depender de sí misma.")
            dep = await self.repo.get(dep_id)
            if not dep:
                raise NotFoundError("Task", dep_id)
            if dep.obra_id != task.obra_id:
                raise UnprocessableError(f"La tarea {dep_id} pertenece a otra obra.")
        await self._check_no_cycle(task.id, dep_ids)
        await self.repo.set_dependencies(task.id, [l.model_dump() for l in links])

    async def _assert_parent_valid(
        self, parent_task_id: int, obra_id: int, current_task_id: int | None = None
    ) -> None:
        if current_task_id is not None and parent_task_id == current_task_id:
            raise UnprocessableError("Una tarea no puede ser su propio padre.")
        parent = await self.repo.get(parent_task_id)
        if not parent:
            raise NotFoundError("Task", parent_task_id)
        if parent.obra_id != obra_id:
            raise UnprocessableError("La tarea padre debe pertenecer a la misma obra.")
        # Anti-cycle: parent must not be a descendant of current_task_id
        if current_task_id is not None:
            visited: set[int] = set()
            stack = [parent_task_id]
            while stack:
                node_id = stack.pop()
                if node_id == current_task_id:
                    raise UnprocessableError(
                        "No se puede establecer esta relación padre-hijo: crearía un ciclo jerárquico."
                    )
                if node_id in visited:
                    continue
                visited.add(node_id)
                node = await self.repo.get(node_id)
                if node and node.parent_task_id:
                    stack.append(node.parent_task_id)

    async def _snap_working_dates(
        self, obra_id: int, start_date: date | None, due_date: date | None
    ) -> tuple[date | None, date | None, list[str]]:
        """Corre inicio/fin al próximo día laboral si caen en feriado o fin de semana.
        No bloquea: devuelve las fechas ajustadas y notas legibles de lo que se movió."""
        if start_date is None and due_date is None:
            return start_date, due_date, []
        cal = await self.calendar_repo.get_for_obra(obra_id)
        result: dict[str, date | None] = {"inicio": start_date, "vencimiento": due_date}
        notes: list[str] = []
        for field_name, d in [("inicio", start_date), ("vencimiento", due_date)]:
            if d is not None and not is_working_day(cal, d):
                snapped = next_working_day(cal, d)
                result[field_name] = snapped
                label = next(
                    (e.label for e in (getattr(cal, "exceptions", []) or []) if e.date == d and not e.is_working),
                    None,
                )
                reason = label or "fin de semana"
                notes.append(
                    f"{field_name.capitalize()}: {d.strftime('%d/%m/%Y')} ({reason}) → "
                    f"{snapped.strftime('%d/%m/%Y')} (día laboral más cercano)"
                )
        # Hallazgo 7.5 de docs/auditoria/03-tareas.md: si las fechas caen fuera
        # del rango planificado de la obra, avisamos (sin bloquear — hay obras
        # que se atrasan legítimamente y las tareas se corren).
        obra = await self.obra_repo.get(obra_id)
        if obra is not None:
            s_final = result["inicio"]
            d_final = result["vencimiento"]
            if obra.start_date is not None and s_final is not None and s_final < obra.start_date:
                notes.append(
                    f"Advertencia: el inicio ({s_final.strftime('%d/%m/%Y')}) es anterior al "
                    f"inicio planificado de la obra ({obra.start_date.strftime('%d/%m/%Y')})."
                )
            if obra.expected_end_date is not None and d_final is not None and d_final > obra.expected_end_date:
                notes.append(
                    f"Advertencia: el vencimiento ({d_final.strftime('%d/%m/%Y')}) supera la fecha "
                    f"prevista de fin de la obra ({obra.expected_end_date.strftime('%d/%m/%Y')})."
                )
        return result["inicio"], result["vencimiento"], notes

    # ── bulk create (paste masivo desde Excel) ────────────────────────────────

    async def bulk_create(
        self, obra_id: int, rows: list, manager_id: int, actor: dict | None = None
    ) -> dict:
        """Crea un lote de tareas en una sola transacción con UN evento de historial.

        Las dependencias se resuelven por índice de fila (FS) en una segunda
        pasada, cuando todas las predecesoras ya tienen id. Una fila inválida
        no tumba el lote: se reporta y se sigue.
        """
        await self._get_obra_and_assert_access(obra_id, manager_id)
        base_order = len(await self.repo.list_by_obra(obra_id))
        bulk_tenant = await tenant_for_obra(self.repo.session, obra_id)

        task_ids: list[int | None] = []
        errors: list[str] = []

        for i, row in enumerate(rows):
            try:
                if row.responsible_id is not None:
                    await self._assert_responsible_active(row.responsible_id, bulk_tenant)
                s_date, d_date, _ = await self._snap_working_dates(obra_id, row.start_date, row.due_date)
                task = Task(
                    obra_id=obra_id,
                    tenant_id=bulk_tenant,
                    title=row.title.strip(),
                    start_date=s_date,
                    due_date=d_date,
                    responsible_id=row.responsible_id,
                    order_index=base_order + i,
                )
                self.repo.session.add(task)
                await self.repo.session.flush()
                await self._ensure_team_member(obra_id, row.responsible_id)
                task_ids.append(task.id)
            except Exception as exc:
                detail = getattr(exc, "detail", None) or str(exc)
                errors.append(f"Fila {i + 1} ({row.title[:40]}): {detail}")
                task_ids.append(None)

        # Segunda pasada: dependencias FS por índice de fila
        for i, row in enumerate(rows):
            tid = task_ids[i]
            dep_row = row.depends_on_row
            if tid is None or dep_row is None:
                continue
            if dep_row < 0 or dep_row >= len(task_ids):
                continue
            dep_id = task_ids[dep_row]
            if dep_id is None or dep_id == tid:
                continue
            await self.repo.set_dependencies(tid, [{"depends_on_id": dep_id}])

        created = len([t for t in task_ids if t is not None])
        if created:
            await self.historial.log(
                obra_id=obra_id,
                event_type="tasks_bulk_imported",
                description=f"Se importaron {created} tarea{'s' if created != 1 else ''} desde Excel",
                payload={
                    "count": created,
                    "failed": len(errors),
                    **({"actor": actor} if actor else {}),
                },
                triggered_by="user",
            )
            # Hallazgo 7.7: emitir task_created por cada tarea nueva para que
            # otras sesiones abiertas en la obra vean el import sin refrescar.
            for tid in task_ids:
                if tid is None:
                    continue
                fresh = await self.repo.get(tid)
                if fresh is not None:
                    await emit_task_created(fresh, actor)
            # Hallazgo 7.8: evaluamos riesgos una sola vez al final para que
            # las alertas de fechas vencidas del import aparezcan sin abrir la obra.
            await self._evaluate_risks_safe(obra_id)
        return {"created": created, "failed": len(errors), "errors": errors, "task_ids": task_ids}

    # ── cascade reschedule ────────────────────────────────────────────────────

    async def _compute_cascade(
        self,
        obra_id: int,
        source_task_id: int,
        new_start: date | None,
        new_due: date | None,
    ) -> list[dict]:
        """Compute downstream date shifts if source_task_id moves to the given dates.

        Push-only ("Respect Links" de MS Project con tareas manuales): una tarea
        sucesora solo se mueve hacia adelante cuando el cambio viola su dependencia.
        Nunca se adelanta — la holgura que el usuario dejó a propósito se preserva.
        Tareas completadas/canceladas no se mueven (y frenan la propagación).
        """
        tasks = await self.repo.list_by_obra(obra_id)
        links_map = await self.repo.get_all_dependency_links_by_obra(obra_id)
        task_map = {t.id: t for t in tasks}
        cal = await self.calendar_repo.get_for_obra(obra_id)

        successors: dict[int, list[int]] = {}
        in_degree: dict[int, int] = {t.id: 0 for t in tasks}
        for t in tasks:
            for link in links_map.get(t.id, []):
                dep_id = link["depends_on_id"]
                if dep_id in task_map:
                    successors.setdefault(dep_id, []).append(t.id)
                    in_degree[t.id] += 1

        # Orden topológico (Kahn) sobre toda la obra: una tarea con varios
        # predecesores se evalúa recién cuando todos ellos ya fueron procesados.
        from collections import deque
        queue: deque[int] = deque(tid for tid, deg in in_degree.items() if deg == 0)
        topo: list[int] = []
        deg = dict(in_degree)
        while queue:
            tid = queue.popleft()
            topo.append(tid)
            for sid in successors.get(tid, []):
                deg[sid] -= 1
                if deg[sid] == 0:
                    queue.append(sid)
        if len(topo) < len(tasks):  # ciclo — no debería pasar (_check_no_cycle)
            topo = [t.id for t in tasks]

        # Fechas propuestas por tarea; arranca con el override de la tarea origen.
        proposed: dict[int, tuple[date | None, date | None]] = {
            source_task_id: (new_start, new_due)
        }

        def dates_of(tid: int) -> tuple[date | None, date | None]:
            if tid in proposed:
                return proposed[tid]
            t = task_map[tid]
            return (t.start_date, t.due_date)

        affected: list[dict] = []
        for tid in topo:
            if tid == source_task_id:
                continue
            t = task_map[tid]
            if t.status in (TaskStatus.COMPLETADA, TaskStatus.CANCELADA):
                continue
            old_s, old_d = t.start_date, t.due_date
            if old_s is None and old_d is None:
                continue
            anchor_start: date = old_s or old_d  # type: ignore[assignment]
            anchor_finish: date = old_d or old_s  # type: ignore[assignment]

            # Máximo corrimiento (en días) que exigen sus dependencias.
            shift = 0
            for link in links_map.get(tid, []):
                pid = link["depends_on_id"]
                if pid not in task_map:
                    continue
                ps, pd = dates_of(pid)
                p_start = ps or pd
                p_finish = pd or ps
                if p_start is None or p_finish is None:
                    continue
                lag = link.get("lag_days") or 0
                dtype = link.get("dependency_type") or "FS"
                if dtype == "SS":
                    required = p_start + timedelta(days=lag)
                    shift = max(shift, (required - anchor_start).days)
                elif dtype == "FF":
                    required = p_finish + timedelta(days=lag)
                    shift = max(shift, (required - anchor_finish).days)
                elif dtype == "SF":
                    required = p_start + timedelta(days=lag)
                    shift = max(shift, (required - anchor_finish).days)
                else:  # FS — el sucesor arranca el día siguiente al fin del predecesor
                    required = p_finish + timedelta(days=lag + 1)
                    shift = max(shift, (required - anchor_start).days)

            if shift <= 0:
                continue

            ns = old_s + timedelta(days=shift) if old_s else None
            nd = old_d + timedelta(days=shift) if old_d else None
            if cal:
                duration = (old_d - old_s).days if old_s and old_d else None
                if ns:
                    ns = next_working_day(cal, ns)
                    if duration is not None:
                        nd = next_working_day(cal, ns + timedelta(days=duration))
                elif nd:
                    nd = next_working_day(cal, nd)

            proposed[tid] = (ns, nd)
            affected.append({
                "task_id": tid,
                "title": t.title,
                "old_start": old_s,
                "old_due": old_d,
                "new_start": ns,
                "new_due": nd,
            })
        return affected

    async def cascade_preview(
        self,
        task_id: int,
        new_start: date | None,
        new_due: date | None,
        manager_id: int,
    ) -> list[dict]:
        task = await self.get_or_raise(task_id)
        await self._get_obra_and_assert_access(task.obra_id, manager_id)
        return await self._compute_cascade(task.obra_id, task_id, new_start, new_due)

    # ── public methods ────────────────────────────────────────────────────────

    async def create(self, data: TaskCreate, manager_id: int, actor: dict | None = None) -> Task:
        await self._get_obra_and_assert_access(data.obra_id, manager_id)
        obra_tenant = await tenant_for_obra(self.repo.session, data.obra_id)

        if data.responsible_id is not None:
            await self._assert_responsible_active(data.responsible_id, obra_tenant)

        if data.parent_task_id is not None:
            await self._assert_parent_valid(data.parent_task_id, data.obra_id)

        if data.depends_on_id is not None:
            await self._assert_depends_on_valid(data.depends_on_id, data.obra_id)

        snap_start, snap_due, date_notes = await self._snap_working_dates(
            data.obra_id, data.start_date, data.due_date
        )

        task_data = data.model_dump(exclude={"dependency_links"})
        task_data["start_date"] = snap_start
        task_data["due_date"] = snap_due
        task_data["tenant_id"] = obra_tenant
        task = Task(**task_data)
        task = await self.repo.create(task)
        await self._ensure_team_member(task.obra_id, data.responsible_id)

        if data.dependency_links:
            await self._sync_dependencies(task, data.dependency_links)
            await self.repo.session.refresh(task)

        task._dep_links = await self.repo.get_dependency_links(task.id)

        await self.historial.log(
            obra_id=task.obra_id,
            task_id=task.id,
            event_type="task_created",
            description=f"Task '{task.title}' created",
            payload={"actor": actor} if actor else None,
            triggered_by="user",
        )
        task._date_adjustment = "; ".join(date_notes) if date_notes else None
        await emit_task_created(task, actor)
        await self.recompute_obra_status(task.obra_id)
        # Hallazgo 7.8: evaluar riesgos al crear para que las alertas y el
        # badge no dependan de que un humano abra la vista de tareas.
        await self._evaluate_risks_safe(task.obra_id)
        return task

    async def _evaluate_risks_safe(self, obra_id: int) -> None:
        """Wrapper defensivo — un fallo en el cálculo de riesgos no debe
        tumbar la operación de tarea que lo disparó."""
        try:
            from app.services.alert_service import AlertService
            await AlertService(self.repo.session).evaluate_task_risks_for_obra(obra_id)
        except Exception:
            import logging
            logging.getLogger(__name__).exception(
                "evaluate_task_risks_for_obra failed for obra_id=%d", obra_id
            )

    async def get_or_raise(self, task_id: int) -> Task:
        task = await self.repo.get(task_id)
        if not task:
            raise NotFoundError("Task", task_id)
        return task

    async def get_for_manager(self, task_id: int, manager_id: int) -> Task:
        task = await self.get_or_raise(task_id)
        await self._get_obra_and_assert_access(task.obra_id, manager_id)
        task._dep_links = await self.repo.get_dependency_links(task_id)
        return task

    async def list_by_obra(self, obra_id: int, manager_id: int) -> list[Task]:
        await self._get_obra_and_assert_access(obra_id, manager_id)
        tasks = await self.repo.list_by_obra(obra_id)
        links_by_task = await self.repo.get_all_dependency_links_by_obra(obra_id)
        materials_by_task = await self.repo.materials_summary_by_obra(obra_id)
        for task in tasks:
            task._dep_links = links_by_task.get(task.id, [])
            task._materials_summary = materials_by_task.get(task.id)
        return tasks

    async def reorder(self, obra_id: int, task_ids: list[int], manager_id: int) -> None:
        """Reasigna order_index según el orden de IDs dado. Permite insertar una
        tarea en cualquier posición sin dejar huecos (el commit lo hace get_db)."""
        await self._get_obra_and_assert_access(obra_id, manager_id)
        tasks = await self.repo.list_by_obra(obra_id)
        by_id = {t.id: t for t in tasks}
        for idx, tid in enumerate(task_ids):
            task = by_id.get(tid)
            if task is not None:
                task.order_index = idx

    async def _responsible_label(self, rid: object) -> str:
        if rid is None:
            return "Sin responsable"
        resp = await self.resp_repo.get(int(rid))  # type: ignore[arg-type]
        return resp.full_name if resp else f"Responsable #{rid}"

    async def _enrich_all_entries(
        self, real_changes: dict[str, dict[str, object]]
    ) -> None:
        for field, entry in real_changes.items():
            if field == "responsible_id":
                entry["from_label"] = await self._responsible_label(entry["from"])
                entry["to_label"]   = await self._responsible_label(entry["to"])
            else:
                entry["from_label"] = _format_field_value(field, entry["from"])
                entry["to_label"]   = _format_field_value(field, entry["to"])

    async def _resolve_update_alerts(
        self, task_id: int, changes: dict[str, object], obra_id: int
    ) -> None:
        resolved = False
        if changes.get("responsible_id") is not None:
            await self.alert_repo.mark_read_by_task_and_fragment(
                task_id, AlertType.DELAY_RISK, "responsable"
            )
            resolved = True
        if "due_date" in changes:
            new_due = changes["due_date"]
            if new_due is None or new_due >= date.today():  # type: ignore[operator]
                await self.alert_repo.mark_read_by_task_and_fragment(
                    task_id, AlertType.DELAY_RISK, "vencida"
                )
                resolved = True
        if resolved:
            await emit_alerts_resolved(task_id, obra_id)

    async def update(
        self,
        task_id: int,
        data: TaskUpdate,
        manager_id: int,
        actor: dict | None = None,
        cascade_dates: bool = False,
    ) -> Task:
        task = await self.get_or_raise(task_id)
        await self._get_obra_and_assert_access(task.obra_id, manager_id)

        # exclude_unset so that sending {"responsible_id": null} actually
        # removes the responsible instead of being silently ignored.
        raw_changes = data.model_dump(exclude_unset=True)
        dep_links_raw = raw_changes.pop("dependency_links", None)  # handle separately
        dep_links = [DependencyLinkInput(**l) for l in dep_links_raw] if dep_links_raw is not None else None
        changes = raw_changes
        if not changes and dep_links is None:
            return task

        # BS-03: capture old values BEFORE any await that could refresh `task`
        # via the session identity map.
        old_vals: dict[str, object] = {field: getattr(task, field) for field in changes}

        if changes.get("responsible_id") is not None:
            await self._assert_responsible_active(
                changes["responsible_id"],
                await tenant_for_obra(self.repo.session, task.obra_id),
            )
            await self._ensure_team_member(task.obra_id, changes["responsible_id"])

        if changes.get("parent_task_id") is not None:
            await self._assert_parent_valid(
                changes["parent_task_id"], task.obra_id, current_task_id=task_id
            )

        if changes.get("depends_on_id") is not None:
            await self._assert_depends_on_valid(
                changes["depends_on_id"], task.obra_id, current_task_id=task_id
            )

        # Snap (no bloquea): si una fecha que se está cambiando cae en día no laboral,
        # se corre al próximo día laboral en lugar de rechazar la operación.
        date_notes: list[str] = []
        if "start_date" in changes or "due_date" in changes:
            s2, d2, date_notes = await self._snap_working_dates(
                task.obra_id,
                changes.get("start_date") if "start_date" in changes else None,
                changes.get("due_date") if "due_date" in changes else None,
            )
            if "start_date" in changes:
                changes["start_date"] = s2
            if "due_date" in changes:
                changes["due_date"] = d2

        new_start = changes.get("start_date", task.start_date)
        new_due   = changes.get("due_date",   task.due_date)
        start_changed = "start_date" in changes and changes["start_date"] != task.start_date
        due_changed   = "due_date"   in changes and changes["due_date"]   != task.due_date

        if task.status == TaskStatus.COMPLETADA and "estimated_progress" in changes:
            raise UnprocessableError(
                "No se puede modificar el avance de una tarea completada."
            )

        if dep_links is not None:
            await self._sync_dependencies(task, dep_links)

        real_changes: dict[str, dict[str, object]] = {
            field: {"from": _to_json(old_vals[field]), "to": _to_json(new_val)}
            for field, new_val in changes.items()
            if old_vals[field] != new_val
        }

        await self._enrich_all_entries(real_changes)

        updated = await self.repo.update_fields(task_id, **changes) if changes else task

        if real_changes:
            changed_labels = [_FIELD_LABELS.get(f, f) for f in real_changes]
            await self.historial.log(
                obra_id=task.obra_id,
                task_id=task_id,
                event_type="task_updated",
                description=f"Tarea actualizada: {', '.join(changed_labels)}",
                payload={"changes": real_changes, **({"actor": actor} if actor else {})},
                triggered_by="user",
            )

        # Cascade: reprogramar dependientes si el usuario lo confirmó.
        if cascade_dates and (start_changed or due_changed):
            affected = await self._compute_cascade(
                task.obra_id, task_id,
                new_start if isinstance(new_start, date) else None,
                new_due if isinstance(new_due, date) else None,
            )
            for item in affected:
                shifted = await self.repo.update_fields(
                    item["task_id"],
                    start_date=item["new_start"],
                    due_date=item["new_due"],
                )
                if shifted is not None:
                    shifted._dep_links = await self.repo.get_dependency_links(item["task_id"])
                    await emit_task_updated(shifted, actor)
            if affected:
                source_title = updated.title if updated else task.title
                await self.historial.log(
                    obra_id=task.obra_id,
                    task_id=task_id,
                    event_type="task_cascade_rescheduled",
                    description=(
                        f"Se reprogramaron {len(affected)} "
                        f"tarea{'s' if len(affected) != 1 else ''} en cascada "
                        f"por cambio de fechas en '{source_title}'"
                    ),
                    payload={
                        "source_task_id": task_id,
                        "affected": [
                            {
                                "task_id": a["task_id"],
                                "title": a["title"],
                                "from_start": str(a["old_start"]) if a["old_start"] else None,
                                "to_start":   str(a["new_start"]) if a["new_start"] else None,
                                "from_due":   str(a["old_due"])   if a["old_due"]   else None,
                                "to_due":     str(a["new_due"])   if a["new_due"]   else None,
                            }
                            for a in affected
                        ],
                        **({"actor": actor} if actor else {}),
                    },
                    triggered_by="user",
                )

        await self._resolve_update_alerts(task_id, changes, task.obra_id)
        updated._dep_links = await self.repo.get_dependency_links(task_id)  # type: ignore[union-attr]
        updated._date_adjustment = "; ".join(date_notes) if date_notes else None  # type: ignore[union-attr]
        await emit_task_updated(updated, actor)
        await self.recompute_obra_status(task.obra_id)
        # Hallazgo 7.8: si cambió una fecha o el responsable, revisar riesgos
        # (evitamos disparar el cálculo si solo se editó el título/descripción).
        if any(f in changes for f in ("start_date", "due_date", "responsible_id", "status")):
            await self._evaluate_risks_safe(task.obra_id)
        return updated  # type: ignore[return-value]

    async def delete(self, task_id: int, manager_id: int, actor: dict | None = None) -> None:
        task = await self.get_or_raise(task_id)
        await self._get_obra_and_assert_access(task.obra_id, manager_id)

        # Capture all needed state BEFORE any session mutation (BS-03).
        obra_id        = task.obra_id
        title          = task.title
        responsible_id = task.responsible_id
        old_status     = task.status.value
        start_date     = str(task.start_date) if task.start_date else None
        due_date       = str(task.due_date)   if task.due_date   else None

        # Resolve active alerts for this task before deletion so they no longer
        # appear as unread in the UI. Alerts are not hard-deleted — they remain
        # in the DB as is_read=True for audit traceability.
        await self.alert_repo.mark_read_by_task(task_id)

        # Log the deletion event while the task_id FK is still valid.
        # After repo.delete() the DB ON DELETE SET NULL will null this FK on
        # the historial row, but the payload retains full traceability.
        payload: dict = {
            "task_id":        task_id,
            "title":          title,
            "responsible_id": responsible_id,
            "status":         old_status,
            "start_date":     start_date,
            "due_date":       due_date,
        }
        if actor is not None:
            payload["actor"] = actor
        await self.historial.log(
            obra_id=obra_id,
            task_id=task_id,
            event_type="task_deleted",
            description=f"La tarea '{title}' fue eliminada.",
            payload=payload,
            triggered_by="user",
        )

        await self.repo.delete(task_id)
        await emit_task_deleted(task_id, obra_id, title, actor)
        await self.recompute_obra_status(obra_id)

    async def apply_status_update(self, task_id: int, update: TaskStatusUpdate) -> Task:
        """
        Called by the AI pipeline after message interpretation.
        Status is never updated through any public HTTP endpoint.
        """
        task = await self.get_or_raise(task_id)

        # Capture before update_status() — session.refresh() inside update_fields()
        # mutates this same object via the identity map, so task.status would already
        # equal update.status by the time the post-update comparison runs.
        old_status = task.status

        allowed = VALID_TRANSITIONS.get(old_status, set())
        if update.triggered_by != "user" and update.status != old_status and update.status not in allowed:
            from app.models.task import TaskStatus as TS
            STATUS_LABELS = {
                TS.PENDIENTE: "Pendiente", TS.EN_PROGRESO: "En progreso",
                TS.BLOQUEADA: "Bloqueada", TS.COMPLETADA: "Completada", TS.CANCELADA: "Cancelada",
            }
            raise UnprocessableError(
                f"No se puede cambiar el estado de '{STATUS_LABELS.get(old_status, old_status.value)}' "
                f"a '{STATUS_LABELS.get(update.status, update.status.value)}'."
            )

        completed_date = None
        if update.status == TaskStatus.COMPLETADA:
            completed_date = update.completed_date or date.today()

        progress = 100 if update.status == TaskStatus.COMPLETADA else update.estimated_progress

        updated = await self.repo.update_status(
            task_id, update.status, progress, completed_date
        )

        if update.status != old_status:
            await self.historial.log(
                obra_id=task.obra_id,
                task_id=task_id,
                event_type="task_status_changed",
                description=f"Status: {old_status.value} → {update.status.value}",
                payload={
                    "from": old_status.value,
                    "to": update.status.value,
                    "progress": update.estimated_progress,
                    "reason": update.reason,
                },
                triggered_by=update.triggered_by,
            )

            if update.status == TaskStatus.BLOQUEADA:
                blocked_msg = f"La tarea '{task.title}' fue bloqueada."
                already_blocked = await self.alert_repo.exists_unread_for_task(
                    task_id, AlertType.TASK_BLOCKED, blocked_msg
                )
                # notify_task_blocked era decorativo — se guardaba pero ningún
                # servicio lo leía (docs/auditoria/11-panel-configuracion.md,
                # hallazgo 2).
                cfg = await self.settings_repo.get_for_obra(task.obra_id)
                if not already_blocked and cfg.notify_task_blocked:
                    await self.alert_repo.create_alert(
                        alert_type=AlertType.TASK_BLOCKED,
                        message=blocked_msg,
                        obra_id=task.obra_id,
                        task_id=task_id,
                    )
                    await self.historial.log(
                        obra_id=task.obra_id,
                        task_id=task_id,
                        event_type="alert_created",
                        description=blocked_msg,
                        payload={"alert_type": "task_blocked"},
                        triggered_by=update.triggered_by,
                    )

            # Auto-resolve: task unblocked → resolve all unread task_blocked alerts.
            if old_status == TaskStatus.BLOQUEADA and update.status != TaskStatus.BLOQUEADA:
                await self.alert_repo.mark_read_by_task_and_type(
                    task_id, AlertType.TASK_BLOCKED
                )

        await self.recompute_obra_status(updated.obra_id)
        # Hallazgo 7.8: al cambiar estado (bloqueada / vencida / etc.) recalculamos
        # las alertas del scope de la obra sin esperar al próximo GET.
        await self._evaluate_risks_safe(updated.obra_id)
        return updated  # type: ignore[return-value]

    async def apply_status_update_checked(
        self, task_id: int, update: TaskStatusUpdate, manager_id: int
    ) -> Task:
        """Public wrapper for apply_status_update that verifies obra ownership."""
        task = await self.get_or_raise(task_id)
        await self._get_obra_and_assert_access(task.obra_id, manager_id)
        return await self.apply_status_update(task_id, update)

    async def force_complete(self, task_id: int, triggered_by: str = "chatbot") -> Task:
        """Cascade through intermediate states to reach COMPLETADA (used by chatbot)."""
        task = await self.get_or_raise(task_id)
        chains: dict[TaskStatus, list[TaskStatus]] = {
            TaskStatus.PENDIENTE:   [TaskStatus.EN_PROGRESO, TaskStatus.COMPLETADA],
            TaskStatus.EN_PROGRESO: [TaskStatus.COMPLETADA],
            TaskStatus.BLOQUEADA:   [TaskStatus.EN_PROGRESO, TaskStatus.COMPLETADA],
            TaskStatus.COMPLETADA:  [],
            TaskStatus.CANCELADA:   [],
        }
        for target in chains.get(task.status, []):
            progress = 100 if target == TaskStatus.COMPLETADA else task.estimated_progress
            task = await self.apply_status_update(
                task.id,
                TaskStatusUpdate(
                    status=target,
                    estimated_progress=progress,
                    triggered_by=triggered_by,
                    reason="Finalizada vía WhatsApp",
                ),
            )
        return task

    async def force_block(self, task_id: int, triggered_by: str = "chatbot") -> Task:
        """Apply BLOQUEADA, transitioning through EN_PROGRESO if needed (used by chatbot)."""
        task = await self.get_or_raise(task_id)
        if task.status in (TaskStatus.COMPLETADA, TaskStatus.CANCELADA, TaskStatus.BLOQUEADA):
            return task
        if task.status == TaskStatus.PENDIENTE:
            task = await self.apply_status_update(
                task.id,
                TaskStatusUpdate(
                    status=TaskStatus.EN_PROGRESO,
                    estimated_progress=task.estimated_progress,
                    triggered_by=triggered_by,
                    reason="En progreso (auto) → demorada vía WhatsApp",
                ),
            )
        return await self.apply_status_update(
            task.id,
            TaskStatusUpdate(
                status=TaskStatus.BLOQUEADA,
                estimated_progress=task.estimated_progress,
                triggered_by=triggered_by,
                reason="Demorada vía WhatsApp",
            ),
        )

    async def compute_critical_path(
        self, obra_id: int, manager_id: int
    ) -> dict:
        """CPM: forward + backward pass sobre las tareas CON ambas fechas.
        Las tareas sin fecha no se pueden ubicar en el tiempo: se excluyen del
        cálculo (antes se colaban con duración=1 y ES=0, distorsionando la ruta
        en silencio) y se devuelven en `tasks_without_dates` para que el front
        avise. Devuelve critical_task_ids (float == 0) y float_by_task (días)."""
        await self._get_obra_and_assert_access(obra_id, manager_id)
        all_tasks = await self.repo.list_by_obra(obra_id)
        links_map = await self.repo.get_all_dependency_links_by_obra(obra_id)

        # Solo las tareas con ambas fechas participan del CPM; el resto se reporta.
        tasks = [t for t in all_tasks if t.start_date and t.due_date]
        tasks_without_dates = [t.id for t in all_tasks if not (t.start_date and t.due_date)]

        task_map = {t.id: t for t in tasks}

        def duration(t) -> int:
            return max(1, (t.due_date - t.start_date).days)

        # Build successor list for backward pass
        successors: dict[int, list[dict]] = {t.id: [] for t in tasks}
        in_degree: dict[int, int] = {t.id: 0 for t in tasks}
        for task in tasks:
            for link in links_map.get(task.id, []):
                dep_id = link["depends_on_id"]
                if dep_id in task_map:
                    in_degree[task.id] += 1
                    successors[dep_id].append({
                        "task_id": task.id,
                        "dep_type": link.get("dependency_type", "FS"),
                        "lag": link.get("lag_days", 0),
                    })

        # Kahn topological sort
        from collections import deque
        queue: deque[int] = deque(tid for tid, deg in in_degree.items() if deg == 0)
        topo: list[int] = []
        tmp_deg = dict(in_degree)
        while queue:
            tid = queue.popleft()
            topo.append(tid)
            for s in successors[tid]:
                sid = s["task_id"]
                tmp_deg[sid] -= 1
                if tmp_deg[sid] == 0:
                    queue.append(sid)
        # Fallback if cycle detected
        if len(topo) < len(tasks):
            topo = [t.id for t in tasks]

        # Forward pass
        ES: dict[int, float] = {}
        EF: dict[int, float] = {}
        for tid in topo:
            dur = duration(task_map[tid])
            constraints: list[float] = []
            for link in links_map.get(tid, []):
                dep_id = link["depends_on_id"]
                dep_type = link.get("dependency_type", "FS")
                lag = link.get("lag_days", 0)
                if dep_id not in EF:
                    continue
                if dep_type == "FS":
                    constraints.append(EF[dep_id] + lag)
                elif dep_type == "SS":
                    constraints.append(ES[dep_id] + lag)
                elif dep_type == "FF":
                    constraints.append(EF[dep_id] + lag - dur)
                elif dep_type == "SF":
                    constraints.append(ES[dep_id] + lag - dur)
            ES[tid] = max(constraints) if constraints else 0.0
            EF[tid] = ES[tid] + dur

        project_end = max(EF.values()) if EF else 0.0

        # Backward pass
        LS: dict[int, float] = {}
        LF: dict[int, float] = {}
        for tid in reversed(topo):
            dur = duration(task_map[tid])
            constraints = []
            for s in successors[tid]:
                sid = s["task_id"]
                dep_type = s["dep_type"]
                lag = s["lag"]
                if sid not in LF:
                    continue
                if dep_type == "FS":
                    constraints.append(LS[sid] - lag)
                elif dep_type == "SS":
                    constraints.append(LS[sid] - lag + dur)
                elif dep_type == "FF":
                    constraints.append(LF[sid] - lag)
                elif dep_type == "SF":
                    constraints.append(LF[sid] - lag + dur)
            LF[tid] = min(constraints) if constraints else project_end
            LS[tid] = LF[tid] - dur

        # Total float
        float_by_task: dict[int, int] = {}
        for tid in topo:
            if tid in LF and tid in EF:
                float_by_task[tid] = max(0, round(LF[tid] - EF[tid]))
            else:
                float_by_task[tid] = 9999  # no constraints

        critical_ids = [tid for tid, f in float_by_task.items() if f == 0]

        return {
            "critical_task_ids": critical_ids,
            "float_by_task": {str(k): v for k, v in float_by_task.items()},
            "tasks_without_dates": tasks_without_dates,
        }

    async def list_due_soon(
        self, manager_id: int, days: int
    ) -> list[TaskDueSoonRead]:
        today = date.today()
        deadline = today + timedelta(days=days)
        tasks = await self.repo.list_due_soon_for_manager(manager_id, today, deadline)

        responsible_ids = {t.responsible_id for t in tasks if t.responsible_id}
        responsibles = {}
        for rid in responsible_ids:
            r = await self.resp_repo.get(rid)
            if r:
                responsibles[r.id] = r

        return [
            TaskDueSoonRead(
                id=t.id,
                obra_id=t.obra_id,
                title=t.title,
                status=t.status,
                due_date=t.due_date,
                estimated_progress=t.estimated_progress,
                responsible_id=t.responsible_id,
                responsible_name=(
                    responsibles[t.responsible_id].full_name
                    if t.responsible_id and t.responsible_id in responsibles
                    else None
                ),
                responsible_whatsapp=(
                    responsibles[t.responsible_id].whatsapp_number
                    if t.responsible_id and t.responsible_id in responsibles
                    else None
                ),
            )
            for t in tasks
        ]
