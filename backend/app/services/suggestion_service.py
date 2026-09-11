"""
Sugerencias de IA sobre el plan de obra — ciclo de vida propio.

Una sugerencia es una acción concreta que la IA propone sobre el plan
(reprogramar, crear tarea, cambiar estado, o dejar registro) a partir de lo que
se dijo en el campo. Hasta la migración 0072 vivían dentro del blob JSON de la
entrada de bitácora y solo se podían resolver desde esa pantalla; ahora son
filas propias y este servicio es el único dueño de aplicarlas y descartarlas,
venga la orden de donde venga (bitácora, tarea, o lo que se agregue después).

`BitacoraService` sigue generándolas — es el origen — pero ya no las resuelve.
"""
import logging
from datetime import date, datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError, UnprocessableError
from app.models.bitacora import BitacoraEntry
from app.models.obra import Obra
from app.models.responsible import Responsible
from app.models.suggestion import Suggestion, SuggestionStatus, SuggestionType
from app.models.task import Task, TaskStatus
from app.repositories.historial import HistorialRepository
from app.schemas.task import TaskCreate, TaskStatusUpdate, TaskUpdate
from app.services.task_service import TaskService

logger = logging.getLogger(__name__)

# Campos que el jefe puede pisar antes de aplicar (la IA propone, él decide).
_EDITABLE_FIELDS = (
    "new_start_date",
    "new_due_date",
    "new_status",
    "new_progress",
    "title",
    "responsible_name",
    "description",
)


class SuggestionService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.historial = HistorialRepository(session)

    # ── Lectura ───────────────────────────────────────────────────────────────

    async def get_or_raise(self, suggestion_id: int) -> Suggestion:
        row = (await self.session.execute(
            select(Suggestion).where(Suggestion.id == suggestion_id)
        )).scalar_one_or_none()
        if not row:
            raise NotFoundError("Suggestion", suggestion_id)
        return row

    async def get_by_entry_index(self, entry_id: int, index: int) -> Suggestion:
        """Resuelve una sugerencia por su posición dentro de la entrada de origen.

        Es lo que mantiene vivos los endpoints legacy `/bitacora/{id}/suggestions/{idx}`:
        el índice ya no direcciona nada en la base, pero sigue siendo cómo la
        entrada las enumera.
        """
        row = (await self.session.execute(
            select(Suggestion).where(
                Suggestion.source_entry_id == entry_id,
                Suggestion.order_index == index,
            )
        )).scalar_one_or_none()
        if not row:
            raise NotFoundError("Sugerencia", index)
        return row

    async def list_for_obra(
        self,
        obra_id: int,
        *,
        status: SuggestionStatus | None = None,
        limit: int = 200,
    ) -> list[Suggestion]:
        q = select(Suggestion).where(Suggestion.obra_id == obra_id)
        if status is not None:
            q = q.where(Suggestion.status == status)
        q = q.order_by(Suggestion.created_at.desc(), Suggestion.order_index).limit(limit)
        return list((await self.session.execute(q)).scalars().all())

    async def list_for_task(
        self, task_id: int, *, status: SuggestionStatus | None = None
    ) -> list[Suggestion]:
        """Sugerencias que apuntan a esta tarea.

        Incluye tanto las que la quieren modificar (`task_id`) como las que la
        crearon al aplicarse (`result_task_id`): desde la tarea, las dos cosas
        son "lo que la IA propuso sobre esto".
        """
        q = select(Suggestion).where(
            (Suggestion.task_id == task_id) | (Suggestion.result_task_id == task_id)
        )
        if status is not None:
            q = q.where(Suggestion.status == status)
        q = q.order_by(Suggestion.created_at.desc(), Suggestion.order_index)
        return list((await self.session.execute(q)).scalars().all())

    async def pending_count(
        self, *, tenant_id: int | None = None, obra_id: int | None = None
    ) -> int:
        """Conteo real en SQL. Antes había que traer todas las entradas y sumar
        los objetos del blob en Python."""
        # Solo cuentan las accionables: una sugerencia sin obra no se puede
        # aplicar (hay que asignar la nota primero), así que no es un pendiente
        # que el jefe pueda resolver desde el badge.
        q = select(func.count(Suggestion.id)).where(
            Suggestion.status == SuggestionStatus.PENDIENTE,
            Suggestion.obra_id.is_not(None),
        )
        if obra_id is not None:
            q = q.where(Suggestion.obra_id == obra_id)
        if tenant_id is not None:
            q = q.where(Suggestion.tenant_id == tenant_id)
        return int((await self.session.execute(q)).scalar_one() or 0)

    # ── Contexto para mostrarlas fuera de la bitácora ─────────────────────────

    async def decorate(self, rows: list[Suggestion]) -> list[dict]:
        """Agrega obra, resumen de la nota y quién la reportó.

        Dentro de la bitácora ese contexto está en pantalla; en la tarea no hay
        nada alrededor que diga de dónde salió la propuesta, y sin eso el jefe
        no puede decidir. Se resuelve en dos queries para toda la lista.
        """
        entry_ids = {r.source_entry_id for r in rows if r.source_entry_id}
        obra_ids = {r.obra_id for r in rows if r.obra_id}

        entries: dict[int, tuple[str | None, str | None]] = {}
        if entry_ids:
            for eid, summary, reporter in (await self.session.execute(
                select(BitacoraEntry.id, BitacoraEntry.summary, Responsible.full_name)
                .outerjoin(Responsible, BitacoraEntry.responsible_id == Responsible.id)
                .where(BitacoraEntry.id.in_(entry_ids))
            )).all():
                entries[eid] = (summary, reporter)

        obra_names: dict[int, str] = {}
        if obra_ids:
            obra_names = dict((await self.session.execute(
                select(Obra.id, Obra.name).where(Obra.id.in_(obra_ids))
            )).all())

        decorated = []
        for r in rows:
            summary, reporter = entries.get(r.source_entry_id or -1, (None, None))
            decorated.append({
                "row": r,
                "obra_name": obra_names.get(r.obra_id) if r.obra_id else None,
                "entry_summary": summary,
                "reporter_name": reporter,
            })
        return decorated

    # ── Validaciones de aplicación ────────────────────────────────────────────

    async def _assert_task_in_obra(self, task_id: int, obra_id: int | None) -> None:
        """El guard de la ruta valida el rol sobre la obra de la SUGERENCIA, y
        `TaskService` solo valida tenant. Si la sugerencia quedó apuntando a una
        tarea de otra obra (p. ej. la entrada se reasignó), alguien con acceso
        solo a esta obra podría mutar una tarea de una obra donde no tiene rol.
        Ver audit 08-bitácora, hallazgo N2."""
        task_obra_id = (await self.session.execute(
            select(Task.obra_id).where(Task.id == task_id)
        )).scalar_one_or_none()
        if task_obra_id is not None and task_obra_id != obra_id:
            raise UnprocessableError(
                "Esta sugerencia quedó desactualizada — la tarea que referencia ya no "
                "pertenece a la obra de esta nota. Reprocesá la entrada para generar "
                "sugerencias al día."
            )

    def _parse_date(self, value, label: str) -> date | None:
        """El valor puede venir de la fila (ya `date`) o de una edición del jefe
        (texto). Un ISO mal escrito dejaba un ValueError sin manejar — 500 opaco.
        Ver audit 08-bitácora, hallazgo N5."""
        if not value:
            return None
        if isinstance(value, date):
            return value
        try:
            return date.fromisoformat(str(value))
        except ValueError:
            raise UnprocessableError(
                f"'{value}' no es una fecha válida para {label} (formato AAAA-MM-DD)."
            )

    def _parse_status(self, value: str) -> TaskStatus:
        try:
            return TaskStatus(value)
        except ValueError:
            valid = ", ".join(t.value for t in TaskStatus)
            raise UnprocessableError(
                f"'{value}' no es un estado válido de tarea (opciones: {valid})."
            )

    # ── Aplicar / descartar ───────────────────────────────────────────────────

    async def apply(
        self,
        suggestion: Suggestion,
        manager_id: int,
        *,
        actor: dict | None = None,
        edits: dict | None = None,
    ) -> Suggestion:
        if suggestion.status == SuggestionStatus.APLICADA:
            return suggestion
        if not suggestion.obra_id:
            raise UnprocessableError("Asigná la entrada a una obra antes de aplicar sugerencias.")

        # Los ajustes del jefe pisan lo propuesto solo para esta ejecución.
        values = {
            "new_start_date": suggestion.new_start_date,
            "new_due_date": suggestion.new_due_date,
            "new_status": suggestion.new_status,
            "new_progress": suggestion.new_progress,
            "title": suggestion.title,
            "responsible_name": suggestion.responsible_name,
            "description": suggestion.description,
        }
        for k in _EDITABLE_FIELDS:
            if edits and k in edits:
                values[k] = edits[k]

        task_service = TaskService(self.session)

        if suggestion.type == SuggestionType.RESCHEDULE_TASK:
            if not suggestion.task_id:
                raise UnprocessableError("La sugerencia no referencia una tarea válida.")
            await self._assert_task_in_obra(suggestion.task_id, suggestion.obra_id)
            # Solo se toca la fecha que la sugerencia trae. `TaskService.update`
            # usa `exclude_unset`, así que pasar `start_date=None` NO es "dejala
            # como está" sino "borrala": aplicar un cambio de fin le vaciaba el
            # inicio a la tarea. Si el audio habló de una sola fecha, la otra
            # queda intacta — que es lo que la persona espera al aceptar.
            campos: dict[str, date] = {}
            inicio = self._parse_date(values["new_start_date"], "la fecha de inicio")
            fin = self._parse_date(values["new_due_date"], "la fecha de fin")
            if inicio is not None:
                campos["start_date"] = inicio
            if fin is not None:
                campos["due_date"] = fin
            if not campos:
                raise UnprocessableError(
                    "Esta sugerencia no propone ninguna fecha. Editala para indicar "
                    "el inicio o el vencimiento antes de aplicarla."
                )
            # cascade_dates=True: si la tarea tiene dependientes, se corren en cadena
            updated = await task_service.update(
                suggestion.task_id, TaskUpdate(**campos), manager_id, actor=actor, cascade_dates=True
            )
            suggestion.result_task_id = suggestion.task_id
            if getattr(updated, "_date_adjustment", None):
                suggestion.result_note = updated._date_adjustment

        elif suggestion.type == SuggestionType.CREATE_TASK:
            responsible_id = await self._match_responsible(
                values["responsible_name"], suggestion.obra_id
            )
            created = await task_service.create(
                TaskCreate(
                    obra_id=suggestion.obra_id,
                    title=values["title"] or "Tarea desde bitácora",
                    description=(values["description"] or "")
                    + (f"\n\n[Origen: bitácora #{suggestion.source_entry_id}]"
                       if suggestion.source_entry_id else ""),
                    start_date=self._parse_date(values["new_start_date"], "la fecha de inicio"),
                    due_date=self._parse_date(values["new_due_date"], "la fecha de fin"),
                    responsible_id=responsible_id,
                ),
                manager_id,
                actor=actor,
            )
            suggestion.result_task_id = created.id
            if getattr(created, "_date_adjustment", None):
                suggestion.result_note = created._date_adjustment

        elif suggestion.type == SuggestionType.UPDATE_STATUS:
            if not suggestion.task_id or not values["new_status"]:
                raise UnprocessableError("La sugerencia no tiene tarea o estado válido.")
            await self._assert_task_in_obra(suggestion.task_id, suggestion.obra_id)
            origen = (
                f"Bitácora #{suggestion.source_entry_id}"
                if suggestion.source_entry_id else "Sugerencia de IA"
            )
            # `TaskStatusUpdate.estimated_progress` tiene default 0 y el repo lo
            # escribe SIEMPRE: sin esto, aplicar "bloqueada" a una tarea al 60%
            # le reseteaba el avance a cero. Si la sugerencia no trae un avance
            # propuesto, se conserva el actual de la tarea.
            task_actual = await task_service.get_or_raise(suggestion.task_id)
            avance = values["new_progress"]
            if avance is None:
                avance = task_actual.estimated_progress or 0
            await task_service.apply_status_update_checked(
                suggestion.task_id,
                TaskStatusUpdate(
                    status=self._parse_status(values["new_status"]),
                    estimated_progress=avance,
                    triggered_by="user",
                    reason=f"{origen}: {(suggestion.reason or '')[:200]}",
                ),
                manager_id,
            )
            suggestion.result_task_id = suggestion.task_id

        elif suggestion.type == SuggestionType.NOTE:
            await self.historial.log(
                event_type="bitacora_nota",
                description=suggestion.reason or values["description"] or "Nota de bitácora",
                obra_id=suggestion.obra_id,
                payload={"entry_id": suggestion.source_entry_id, "suggestion_id": suggestion.id},
                triggered_by="user",
            )

        suggestion.status = SuggestionStatus.APLICADA
        suggestion.resolved_by = manager_id
        suggestion.resolved_at = datetime.now(timezone.utc)
        await self.session.flush()

        # Cierra el loop: avisa por WhatsApp al que mandó la nota que su reporte se aplicó.
        await self._notify_reporter(
            suggestion, self._confirmation_text(suggestion, values, (actor or {}).get("name")),
            manager_id,
        )
        return suggestion

    async def dismiss(self, suggestion: Suggestion, user_id: int | None = None) -> Suggestion:
        if suggestion.status == SuggestionStatus.APLICADA:
            raise UnprocessableError(
                "Esta sugerencia ya se aplicó — descartarla no desharía el cambio en la obra."
            )
        suggestion.status = SuggestionStatus.DESCARTADA
        suggestion.resolved_by = user_id
        suggestion.resolved_at = datetime.now(timezone.utc)
        await self.session.flush()
        return suggestion

    async def _match_responsible(self, name: str | None, obra_id: int | None) -> int | None:
        """Responsible es global por tenant (ya no tiene obra_id): matchea por nombre
        dentro del tenant de la obra. Sin match, la tarea se crea sin responsable —
        no es un error."""
        if not name:
            return None
        obra_tenant = (await self.session.execute(
            select(Obra.tenant_id).where(Obra.id == obra_id)
        )).scalar_one_or_none()
        q = select(Responsible).where(
            Responsible.is_active == True,  # noqa: E712
            Responsible.full_name.ilike(f"%{name}%"),
        )
        if obra_tenant is not None:
            q = q.where(Responsible.tenant_id == obra_tenant)
        resp = (await self.session.execute(q)).scalars().first()
        return resp.id if resp else None

    # ── Aviso de vuelta al que reportó ────────────────────────────────────────

    def _fmt_date(self, value) -> str:
        if not value:
            return ""
        if isinstance(value, date):
            return value.strftime("%d/%m/%Y")
        try:
            return date.fromisoformat(str(value)).strftime("%d/%m/%Y")
        except ValueError:
            return str(value)

    def _confirmation_text(
        self, s: Suggestion, values: dict, actor_name: str | None
    ) -> str:
        who = f"{actor_name} " if actor_name else ""
        if s.type == SuggestionType.RESCHEDULE_TASK:
            ref = s.task_title or f"tarea #{s.task_id}"
            partes = []
            if values.get("new_start_date"):
                partes.append(f"inicio {self._fmt_date(values['new_start_date'])}")
            if values.get("new_due_date"):
                partes.append(f"fin {self._fmt_date(values['new_due_date'])}")
            extra = f": {' · '.join(partes)}" if partes else ""
            return f"✅ {who}reprogramó «{ref}»{extra} a partir de tu nota de voz."
        if s.type == SuggestionType.CREATE_TASK:
            return f"✅ {who}creó la tarea «{values.get('title') or 'nueva tarea'}» a partir de tu nota de voz."
        if s.type == SuggestionType.UPDATE_STATUS:
            ref = s.task_title or f"tarea #{s.task_id}"
            estado = (values.get("new_status") or "").replace("_", " ")
            avance = values.get("new_progress")
            extra = f" ({avance}% de avance)" if avance is not None else ""
            return f"✅ {who}marcó «{ref}» como {estado}{extra} a partir de tu nota de voz."
        return f"✅ {who}registró tu nota en la bitácora de la obra. ¡Gracias!"

    async def _notify_reporter(
        self, suggestion: Suggestion, text: str, manager_id: int | None
    ) -> None:
        """Avisa por WhatsApp a quien mandó la nota (salvo que sea quien está aplicando).
        Nunca rompe el flujo si el envío falla."""
        if not suggestion.source_entry_id:
            return
        entry = (await self.session.execute(
            select(BitacoraEntry).where(BitacoraEntry.id == suggestion.source_entry_id)
        )).scalar_one_or_none()
        if entry is None:
            return

        from app.integrations.twilio.client import send_whatsapp_message
        from app.models.tenant_membership import TenantMembership

        number = None
        if entry.responsible_id is not None:
            number = (await self.session.execute(
                select(Responsible.whatsapp_number).where(Responsible.id == entry.responsible_id)
            )).scalar_one_or_none()
        elif entry.created_by is not None and entry.created_by != manager_id:
            # whatsapp_number vive en TenantMembership (Fase 3) — resolvemos la
            # membership de la obra de la entrada si la tiene; si no, cualquiera
            # de sus membership sirve para este best-effort.
            stmt = select(TenantMembership.whatsapp_number).where(
                TenantMembership.user_id == entry.created_by
            )
            if entry.obra_id is not None:
                obra_tenant_id = (await self.session.execute(
                    select(Obra.tenant_id).where(Obra.id == entry.obra_id)
                )).scalar_one_or_none()
                if obra_tenant_id is not None:
                    stmt = stmt.where(TenantMembership.tenant_id == obra_tenant_id)
            number = (await self.session.execute(stmt)).scalars().first()
        if not number:
            return
        try:
            await send_whatsapp_message(number, text)
        except Exception:
            logger.exception("No se pudo notificar al emisor de la bitácora %s", entry.id)
