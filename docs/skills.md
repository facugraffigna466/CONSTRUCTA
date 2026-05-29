# CONSTRUCTA Skills

---

## Backend Skills

### BS-01 — Repository Pattern
Every domain entity has its own repository class that inherits `BaseRepository[ModelT]`.
Services receive an `AsyncSession` and instantiate repositories with that session.
**Rule:** Never query the database directly from a route handler or from another repository.
**Rule:** Never instantiate a repository outside a service (except in tests).

```python
class ResponsibleService:
    def __init__(self, session: AsyncSession) -> None:
        self.repo = ResponsibleRepository(session)
        self.task_repo = TaskRepository(session)
        self.historial = HistorialRepository(session)
```

### BS-02 — Transaction Safety via Shared Session
All repositories in a single service operation share the same `AsyncSession`.
The session is committed or rolled back in `get_db()` (the FastAPI dependency), not inside the service.
**Rule:** Never call `session.commit()` inside a service or repository.
**Rule:** If a service method touches multiple repositories (e.g. deactivate responsible + unassign tasks + log historial), they all run inside the same session — atomicity is guaranteed.

### BS-03 — Capture State Before Mutation
SQLAlchemy's identity map means `session.refresh()` mutates the in-memory object.
**Rule:** Always capture values you need to compare or log BEFORE calling any method that touches the session.

```python
# Correct
old_status = task.status
await self.repo.update_status(task_id, new_status)
if new_status != old_status:
    await self.historial.log(...)

# Wrong — old_status == new_status after refresh
await self.repo.update_status(task_id, new_status)
if new_status != task.status:  # always False
    ...
```

### BS-04 — Soft Delete Pattern
Entities are never hard-deleted. Use `is_active = False`.
`DELETE /responsibles/{id}` sets `is_active=False`, does not remove the row.
**Rule:** `whatsapp_number` on `Responsible` must never change — it is the chatbot identity key.
**Rule:** When deactivating a responsible, also unassign them from all non-completed/non-cancelled tasks in the same transaction.

### BS-05 — Historial is Append-Only
`HistorialEvento` is an immutable event log. Never update or delete events.
Every state change must produce a log entry via `HistorialRepository.log()`.
Standard `event_type` values: `task_created`, `task_updated`, `task_status_changed`.
`triggered_by` must be one of: `"user"`, `"chatbot"`, `"system"`.

```python
await self.historial.log(
    obra_id=task.obra_id,
    task_id=task.id,
    event_type="task_updated",
    description="Responsable desasignado porque fue desactivado",
    payload={"field": "responsible_id", "from": responsible_id, "to": None, "reason": "responsible_deactivated"},
    triggered_by="user",
)
```

### BS-06 — Pydantic Schemas Are the Contract
Request/response shapes are defined in `app/schemas/`.
`ResponsibleUpdate` intentionally excludes `whatsapp_number` — the backend enforces this, not just the frontend.
`TaskUpdatePayload` intentionally excludes `status` — task status is controlled by the chatbot pipeline, not the UI.
**Rule:** Never add a field to an Update schema unless there is a deliberate decision to allow it.

### BS-07 — Webhook Defensive Validation
WhatsApp webhook payloads have variable structure.
All fields in webhook Pydantic schemas must be `Optional` with sensible defaults.
Normalize message text before matching: `.lower().strip()` + strip accents via `unicodedata`.
If a responsible is not found by `whatsapp_number`, ignore silently — do not return 4xx.

---

## Frontend Skills

### FS-01 — State-Based Routing
There is no React Router. Navigation is controlled by state in `App.tsx`:
- `activePage: "panel" | "configuracion"`
- `selectedObra: Obra | null`

`selectedObra !== null` renders `ObraDetailPage`. Setting it to `null` returns to `PortfolioPage`.
**Rule:** Never introduce React Router without explicit decision. The current two-level hierarchy does not justify it.

### FS-02 — Single Data Load Per Obra
`ObraDetailPage` fetches all obra data once on mount via `Promise.all`:
```tsx
const [tasksData, allAlerts, historialData, responsiblesData] = await Promise.all([
  fetchTasksByObra(obra.id),
  fetchAlerts(),
  fetchHistorial(obra.id),
  fetchResponsibles(),
]);
```
Tabs receive data via props — they do not fetch independently.
Silent refresh (`loadData(true)`) is called after any mutation to keep all tabs in sync.
**Rule:** Never fetch inside a tab component. Always go through `loadData`.

### FS-03 — Import Type Enforcement
`tsconfig.json` has `verbatimModuleSyntax: true`.
**Rule:** All type-only imports must use `import type`:
```tsx
import { useState, type FormEvent, type ChangeEvent } from "react";
import type { Task, Responsible } from "../types";
```
The build will fail if this is violated.

### FS-04 — API Layer Separation
All HTTP calls live in `src/api/*.ts`. Components never call `axios` directly.
Each file exports typed async functions returning domain types.
**Rule:** API functions return domain types, not raw Axios responses.
**Rule:** Error handling in components catches the thrown error, not the HTTP status code.

### FS-05 — Fixed-Height Modal Pattern
Modals that contain dynamic content (lists, forms that grow) must use fixed height to prevent layout shift.
```tsx
// Correct
<div className="h-[90vh] flex flex-col overflow-hidden">
  <header className="flex-shrink-0">...</header>
  <main className="flex-1 overflow-y-auto min-h-0">...</main>
  <footer className="flex-shrink-0">...</footer>
</div>
```
Dynamic list areas use fixed-height containers: `min-h-[220px] max-h-[220px] overflow-y-auto`.
**Rule:** Never use `max-h` alone for modals — it allows shrinking on short content, causing height to change when items are added.

### FS-06 — Inactive Responsible Handling in Dropdowns
`TaskFormModal` only shows active responsibles in the dropdown:
```tsx
const activeResponsibles = responsibles.filter((r) => r.is_active);
```
When editing a task whose `responsible_id` points to an inactive responsible:
- Initialize `responsibleId` as `""` (unassigned)
- Show an amber warning: "El responsable anterior fue desactivado."
**Rule:** Never allow selecting an inactive responsible in any task form.

### FS-07 — Tailwind Design Tokens Only
Never use hardcoded hex colors in JSX or className strings.
Always use `constructa-*` tokens defined in `tailwind.config.js`.
| Token | Value | Use |
|---|---|---|
| `constructa-primary` | #FF6B35 | Primary actions, active states |
| `constructa-dark` | #37474F | Sidebar, modal headers |
| `constructa-warning` | #FFA726 | Warning badges, delay alerts |
| `constructa-danger` | #E53935 | Errors, destructive actions, blocked tasks |
| `constructa-success` | #43A047 | Completed states |
| `constructa-info` | #1E88E5 | Info badges |
| `constructa-bg` | #FAFAFA | Page background |
| `constructa-surface` | #ECEFF1 | Card/table header backgrounds |
| `constructa-border` | #B0BEC5 | Borders, dividers |
| `constructa-text` | #263238 | Primary text |
| `constructa-secondaryText` | #607D8B | Labels, subtitles, placeholders |

---

## Domain Rules

### DR-01 — Task Status Is Chatbot-Controlled
Task `status` is never editable from the web UI.
The chatbot pipeline (WhatsApp → webhook → `TaskService.apply_status_update`) is the only valid source of status changes.
**Rule:** Do not add a status field to `TaskFormModal` or `TaskUpdatePayload`.
Display note in the UI: "El estado de la tarea es gestionado por el sistema de chatbot."

### DR-02 — Task Status Machine
Valid statuses: `pendiente → en_progreso → bloqueada | en_revision → completada | cancelada`
When a task transitions to `bloqueada`, the system automatically creates a `task_blocked` alert.
**Rule:** Never skip the service layer to update status — always go through `TaskService.apply_status_update`.

### DR-03 — Responsible Identity
A responsible's `whatsapp_number` is immutable after creation.
It is the foreign key into the chatbot system — changing it would break the message lookup.
`ResponsibleUpdate` schema excludes `whatsapp_number`. The UI shows it as read-only.

### DR-04 — Deactivation Cascade
When a responsible is deactivated:
1. `is_active` set to `False`
2. All tasks with `status NOT IN (completada, cancelada)` have `responsible_id` set to `null`
3. A `task_updated` historial event is logged per affected task
4. Completed/cancelled tasks preserve the historical assignment
All steps run in the same DB transaction.

### DR-05 — No Automatic Rescheduling
When a task is blocked or a responsible is deactivated, the system alerts but does not move dates.
Rescheduling requires cronogram logic outside MVP scope.
**Rule:** Never auto-update `due_date` or `start_date` based on state changes.

### DR-06 — Obra-Centered Architecture
All data belongs to an obra. Alerts, tasks, historial, and responsible assignments are always queried in the context of a specific obra.
**Rule:** Always filter displayed data by the currently selected `obra.id`.
**Rule:** `fetchAlerts()` returns all alerts; filter client-side by `obra_id` — this is intentional (low volume, avoids extra query param).

---

## Alert System Rules

### AR-01 — Alert Types
| Type | Trigger | Visual |
|---|---|---|
| `task_blocked` | Task transitions to `bloqueada` | Red border, red badge |
| `delay_risk` | Reserved for future date-based logic | Amber border, amber badge |

### AR-02 — Alert Lifecycle
Alerts are created by the system, never by the user.
Users can only mark alerts as read: `PATCH /alerts/{id}/read`.
There is no delete, no bulk create, and no reopen.

### AR-03 — Mark All Read
No bulk-read endpoint exists. Frontend calls `PATCH /alerts/{id}/read` for each unread alert via `Promise.all`.
On partial failure, fall back to `loadData(true)` to re-sync state.

### AR-04 — Unread Count Badge
The "Alertas" tab always shows an unread badge when `alerts.filter(a => !a.is_read).length > 0`.
The Resumen tab shows a StatCard "Alertas activas" with this count.
Both must stay in sync — they read from the same `alerts` state in `ObraDetailPage`.

---

## UX / Design Rules

### UX-01 — Hierarchy: Portfolio → Obra → Tabs
Navigation has three levels:
1. Portfolio: all obras
2. ObraDetailPage: one obra
3. Tabs: Resumen / Tareas / Responsables / Alertas / Historial

The sidebar only holds top-level pages (Panel, Configuración).
Tabs are scoped to the obra. Never add tabs outside `ObraDetailPage`.

### UX-02 — Resumen Tab Shows Previews
The Resumen tab shows 5 most recent alerts and 5 most recent historial events (`.slice(0, 5)`).
For the full list, the user navigates to the respective tab.
Do not duplicate the full panels in Resumen.

### UX-03 — Empty States Are Required
Every list, table, and filtered view must have a specific empty state message.
Two variants are required where filters exist:
- "No hay [items] para esta obra." — when the dataset is empty
- "No hay [items] con este filtro." — when the filter has no matches

### UX-04 — Inactive Entities Are Visually Separated
Inactive responsibles are never mixed into the active table.
They appear in a collapsible section: "Ver responsables desactivados (N)", collapsed by default.
Row style: `opacity-50`, name with `line-through`, "Inactivo" gray badge.
No primary actions on inactive rows (no Desactivar). Edit remains available.

### UX-05 — Destructive Actions Require Confirmation
Any action that cannot be undone (deactivate responsible, delete task) must show a confirmation modal.
If the action has side effects (e.g. deactivating a responsible with active tasks), the confirmation must describe those side effects explicitly.

### UX-06 — SectionTitle Pattern
Every content section uses `<SectionTitle>` with the left orange bar.
The `aside` slot is used for section-level actions (e.g. "Nueva tarea" button) or counts.
Never put action buttons outside this pattern.

### UX-07 — Refresh After Mutation
After any create, update, or delete:
- Call `loadData(true)` (silent refresh) to keep all tabs in sync
- This refreshes tasks, alerts, historial, and responsibles in a single `Promise.all`
- Do not manually update individual state slices except for optimistic UI on simple toggles (e.g. mark-as-read)

---

## Data Consistency Rules

### DC-01 — Single Source of Truth Per Obra
`ObraDetailPage` owns the state: `tasks`, `alerts`, `historial`, `responsibles`.
All child components receive this state as props. They do not maintain their own copies.
**Rule:** If a child component needs to mutate data, it calls a callback prop that triggers `loadData(true)` in the parent.

### DC-02 — Optimistic Alert Updates
`handleMarkRead` updates alert state immediately in the client without waiting for a refetch:
```tsx
setAlerts((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
```
This avoids visual lag on a frequent action. Full `loadData` is not needed here.

### DC-03 — Task Count Is Always Derived
`tasks.filter(t => t.responsible_id === r.id).length` is computed at render time from props.
Never store task counts in separate state. They are derived from the canonical `tasks` array.

### DC-04 — Completed Tasks Preserve Assignment History
When a responsible is deactivated, only tasks with status `NOT IN (completada, cancelada)` are unassigned.
Completed and cancelled tasks keep their `responsible_id` for historical traceability.

---

## Execution Playbooks

---

### PB-01 — Add a New Backend Feature

Use this when adding a new endpoint, a new business rule, or a new service method.

**Implementation order (never skip steps):**

1. **Model** — only if the feature needs a new DB table.
   File: `backend/app/models/<entity>.py`
   Inherit from `Base`. Use `Mapped` columns. Add to `backend/app/models/__init__.py`.
   Create an Alembic migration: `alembic revision --autogenerate -m "add <entity>"`.

2. **Schema** — always required.
   File: `backend/app/schemas/<entity>.py`
   Define `<Entity>Create`, `<Entity>Update`, `<Entity>Read` as separate Pydantic models.
   `Read` must have `model_config = {"from_attributes": True}`.
   `Update` must only include fields that are actually updatable. Excluded fields cannot be changed (e.g. `whatsapp_number`, `status`). See BS-06.

3. **Repository** — always required.
   File: `backend/app/repositories/<entity>.py`
   Inherit `BaseRepository[Model]`. Only add methods the service actually needs.
   Use `select(Model).where(...)` for queries. Use `self.session.execute(...)`.
   Never call `session.commit()` here — the session is managed by `get_db()`. See BS-02.

4. **Service** — always required.
   File: `backend/app/services/<entity>_service.py`
   Constructor receives `AsyncSession`, instantiates all needed repositories with the same session.
   All business logic lives here: validation, guards, historial logging, alert creation.
   Raise `NotFoundError`, `ConflictError`, `ForbiddenError`, or `UnprocessableError` from `app.core.exceptions`.
   If a method touches multiple repositories, they all run in the same session — atomicity is free. See BS-02, BS-03.

5. **Route** — always required.
   File: `backend/app/api/routes/<entity>.py`
   Route functions must be thin: validate HTTP input, call the service, return the result.
   Use `DbSession` and `CurrentUserId` from `app.core.deps`.
   Register the router in `app/main.py` with the `API_PREFIX = "/api/v1"`.

6. **Register in main.py**
   ```python
   from app.api.routes import <entity>
   app.include_router(<entity>.router, prefix=API_PREFIX)
   ```

**Common mistakes specific to this project:**

- Forgetting `model_config = {"from_attributes": True}` on `Read` schemas → Pydantic validation error at runtime.
- Calling `await session.commit()` inside the service → double commit, or commit before rollback boundary is set.
- Capturing state after `session.refresh()` → value is already mutated. Always capture before any repo call. See BS-03.
- Putting business logic in the route handler instead of the service → untestable and breaks the layer contract.
- Adding a field to `TaskUpdate` or `ResponsibleUpdate` without deliberate decision → violates BS-06.

**How to verify:**
- Run `uvicorn app.main:app --reload` and hit `/docs`
- Test the endpoint directly via the Swagger UI (it injects Bearer token)
- Check the DB state with `psql` or pgAdmin
- Check historial via `GET /api/v1/obras/{id}/historial` if the feature logs events

---

### PB-02 — Add a New Frontend Module (Tab or Section)

Use this when adding a new tab to `ObraDetailPage`, a new panel to the Resumen tab, or a new full-page section.

**Adding a new tab to ObraDetailPage:**

1. **Define the tab ID** in `ObraDetailPage.tsx`:
   ```tsx
   type ObraTab = "resumen" | "tareas" | "responsables" | "alertas" | "historial" | "nueva_tab";
   const TABS = [..., { id: "nueva_tab", label: "Nueva Tab" }];
   ```

2. **Create the component** in `frontend/src/components/NuevaTab.tsx`.
   Props must include only what the parent already has in state — never fetch independently. See FS-02.
   ```tsx
   interface NuevaTabProps {
     tasks: Task[];         // already in ObraDetailPage state
     responsibles: Responsible[];
     onRefresh: () => void; // calls loadData(true) in parent
   }
   ```

3. **Never fetch inside the tab component.** All data comes from `ObraDetailPage` props.
   If the tab needs data not yet fetched in `loadData`, add the fetch call to `loadData` in `ObraDetailPage.tsx`, not in the tab.

4. **Wire the case** in `renderTab()`:
   ```tsx
   case "nueva_tab":
     return <NuevaTab tasks={tasks} responsibles={responsibles} onRefresh={() => loadData(true)} />;
   ```

5. **After any mutation in the tab**, call `onRefresh()` — never update state locally in the tab.

**Component structure rules:**

- Use `<SectionTitle>` with the orange left bar for every named section.
  ```tsx
  <SectionTitle aside={<Button variant="primary">Acción</Button>}>
    Título de sección
  </SectionTitle>
  ```
- Wrap content in `<Card padding="none">` (for tables) or `<Card padding="md">` (for lists/panels).
- Use only `constructa-*` Tailwind tokens. Never hardcode colors. See UX-07, FS-07.
- All type-only imports must use `import type`. See FS-03.
- Empty states are required — see UX-03.

**Adding to Resumen tab (preview panels):**

Add the new panel to the two-column grid in `renderTab() → case "resumen"`:
```tsx
<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
  {/* existing panels */}
  <section>
    <SectionTitle>Nueva sección</SectionTitle>
    <Card padding="md"><NuevoPanel data={data.slice(0, 5)} /></Card>
  </section>
</div>
```
Always slice to a preview length (`.slice(0, 5)`). Full list lives in its own tab. See UX-02.

---

### PB-03 — Add a New API Endpoint (Full Flow)

Concrete walkthrough using a real example shape. Adapt to your endpoint.

**Example: `PATCH /tasks/{id}/priority`**

**Step 1 — Schema** (`backend/app/schemas/task.py`):
```python
class TaskPriorityUpdate(BaseModel):
    priority: int = Field(..., ge=1, le=5)
```
Add `priority: int | None` to `TaskRead` and `TaskUpdate` if exposing in responses.

**Step 2 — Repository** (`backend/app/repositories/task.py`):
No new method needed if using `update_fields` from `BaseRepository`.
Add a dedicated method only if the query is non-trivial:
```python
async def list_by_priority(self, obra_id: int, min_priority: int) -> list[Task]:
    result = await self.session.execute(
        select(Task).where(Task.obra_id == obra_id, Task.priority >= min_priority)
    )
    return list(result.scalars().all())
```

**Step 3 — Service** (`backend/app/services/task_service.py`):
```python
async def update_priority(self, task_id: int, data: TaskPriorityUpdate, manager_id: int) -> Task:
    task = await self.get_or_raise(task_id)
    await self._get_obra_and_assert_access(task.obra_id, manager_id)
    old_priority = task.priority                        # capture BEFORE update (BS-03)
    updated = await self.repo.update_fields(task_id, priority=data.priority)
    await self.historial.log(
        obra_id=task.obra_id,
        task_id=task_id,
        event_type="task_updated",
        description=f"Priority: {old_priority} → {data.priority}",
        payload={"field": "priority", "from": old_priority, "to": data.priority},
        triggered_by="user",
    )
    return updated  # type: ignore[return-value]
```

**Step 4 — Route** (`backend/app/api/routes/tasks.py`):
```python
@router.patch("/{task_id}/priority", response_model=TaskRead)
async def update_task_priority(
    task_id: int, data: TaskPriorityUpdate, db: DbSession, user_id: CurrentUserId
):
    return await TaskService(db).update_priority(task_id, data, user_id)
```

**Step 5 — Frontend API function** (`frontend/src/api/tasks.ts`):
```typescript
export interface TaskPriorityUpdatePayload {
  priority: number;
}

export async function updateTaskPriority(
  id: number,
  payload: TaskPriorityUpdatePayload
): Promise<Task> {
  const { data } = await apiClient.patch<Task>(`/tasks/${id}/priority`, payload);
  return data;
}
```

**Step 6 — Frontend UI integration:**
- Call the API function inside the component handler.
- On success, call `onRefresh()` (which calls `loadData(true)` in `ObraDetailPage`). See DC-01.
- On error, set a local `apiError` state and display inline. Never use `alert()` or `console.error` as user feedback.

**Checklist before considering done:**
- [ ] Schema has `model_config = {"from_attributes": True}` on Read
- [ ] Service captures state before repo calls (BS-03)
- [ ] Historial event logged for every state change (BS-05)
- [ ] Route handler contains no business logic
- [ ] Frontend API function returns a typed domain type, not `AxiosResponse`
- [ ] `npm run build` passes with zero TypeScript errors

---

### PB-04 — Add a New Domain Rule (Side-Effect Logic)

Use this when a business event must trigger secondary effects: create an alert, log historial, update another entity.

**The rule: "if X happens → create alert + log historial"**

All side-effect logic belongs in the service layer, never in the repository or route. See BS-01.

**Implementation pattern** (modeled on `TaskService.apply_status_update`):

```python
# In the relevant service (e.g. task_service.py or obra_service.py)

async def some_action(self, ...) -> Entity:
    entity = await self.repo.get_or_raise(id)

    old_value = entity.relevant_field   # BS-03: capture before mutation

    updated = await self.repo.update_fields(id, relevant_field=new_value)

    # 1. Log historial — always
    await self.historial.log(
        obra_id=entity.obra_id,
        task_id=entity.id if hasattr(entity, 'id') else None,
        event_type="task_updated",     # use standard event_type strings
        description="Human-readable description of what changed",
        payload={"field": "relevant_field", "from": old_value, "to": new_value},
        triggered_by="user",           # "user" | "chatbot" | "system"
    )

    # 2. Create alert — only if operationally significant
    if condition_warrants_alert:
        await self.alert_repo.create_alert(
            alert_type=AlertType.TASK_BLOCKED,    # or DELAY_RISK
            message=f"Human-readable alert message for '{entity.title}'.",
            obra_id=entity.obra_id,
            task_id=entity.id,
        )

    return updated
```

**Transactional consistency:**
All repositories share the same session injected at service construction. No extra work needed — if the route handler raises an exception after the first `await`, the entire session is rolled back by `get_db()`. See BS-02.

**Adding a new alert type:**
1. Add the value to `AlertType` enum in `backend/app/models/alert.py`
2. Add the DB enum value via Alembic migration (enum changes require explicit migration)
3. Add `type_label` and `TYPE_STYLE` entries in `frontend/src/components/AlertasTab.tsx`
4. Add the same entry to `AlertsPanel.tsx` (used in the Resumen tab preview)
5. Add the type to `AlertType` in `frontend/src/types/index.ts`

**Reflecting in frontend:**
After any mutation that triggers this rule, the frontend calls `loadData(true)`, which re-fetches `fetchAlerts()`. The new alert appears automatically. No frontend code change needed unless you added a new `AlertType`.

---

### PB-05 — Modify Existing Logic Safely

Use this before changing any existing service method, model field, or component behavior.

**Step 1 — Trace the impact surface before touching anything.**

For a backend change:
- Which routes call this service method? Check `backend/app/api/routes/`.
- Does the chatbot pipeline call this? Check `backend/app/services/message_service.py` and `message_interpreter.py`.
- Does this method log historial? If yes, changing its behavior changes the audit log.
- Does this method create alerts? If yes, alert generation may change.

For a frontend change:
- Which tabs use this component? Search for import in `ObraDetailPage.tsx` and `App.tsx`.
- Does the component receive data from `ObraDetailPage.tasks/alerts/responsibles`? If yes, changing the prop shape breaks all callers.
- Does the component call `onRefresh`? If you remove that call, data goes stale.

**Step 2 — Check what must NOT break.**

| What you touch | Risk area | How to verify |
|---|---|---|
| `TaskService.apply_status_update` | Chatbot pipeline, historial, alerts | Test full WhatsApp → webhook → DB → alert flow |
| `ResponsibleService.deactivate` | Task unassignment cascade, historial | Verify tasks become `responsible_id = null`, events logged |
| `loadData` in `ObraDetailPage` | All 5 tabs, StatCards, unread badge | Open each tab and verify counts after mutation |
| `TaskFormModal` responsible dropdown | Inactive responsible guard (FS-06) | Deactivate responsible, reopen edit modal, verify warning |
| `AlertType` enum | DB migration required, frontend badge styles | Check `AlertasTab.tsx` and `AlertsPanel.tsx` TYPE_STYLE |
| `Task` or `Responsible` schema `Read` | All API responses, frontend `types/index.ts` | Align `TaskRead` fields with `Task` type in `types/index.ts` |

**Step 3 — The chatbot pipeline is the most fragile path.**

The message interpreter in `message_interpreter.py` identifies tasks by index or keyword.
`message_service.py` calls `TaskService.apply_status_update`, which is the only place status transitions happen.
Do not change `VALID_TRANSITIONS` in `task_service.py` without testing the webhook manually:
```bash
curl -X POST http://localhost:8000/api/v1/webhook \
  -H "Content-Type: application/json" \
  -d '{"from": "+5491112345678", "body": "tarea 1 completada"}'
```

**Step 4 — After any change, run in order:**
1. `cd backend && python3 -c "from app.main import app; print('imports OK')"` — catches circular imports
2. `cd frontend && npm run build` — catches TypeScript errors
3. Start both servers and verify the affected tab in the browser

---

### PB-06 — Debugging Guide

#### Backend Debugging

**Symptom: historial events are not being logged.**
Root cause: almost always BS-03 violation. The service is comparing `task.status` after `session.refresh()` has mutated it.
Fix: Move `old_status = task.status` to the first line of the method, before any `await` call that touches the session.
Verify by querying directly: `SELECT * FROM historial_eventos WHERE task_id = X ORDER BY created_at DESC;`

**Symptom: 500 error on a route that worked before.**
Check the FastAPI startup logs — import errors print here, not at request time.
Run: `python3 -c "from app.api.routes.<module> import router"` to isolate the broken import.
Check for Alembic migration drift: `alembic current` vs `alembic heads`. If they differ, run `alembic upgrade head`.

**Symptom: changes are not persisted to the DB.**
Check if `session.commit()` is being called somewhere that inadvertently shadows the one in `get_db()`.
Verify `get_db()` in `backend/app/core/database.py` — it commits after `yield` and rolls back on exception.
If you added a `try/except` inside a service and swallowed the exception, the rollback never fires and the commit at `yield` commits partial state.

**Symptom: SQLAlchemy `DetachedInstanceError`.**
Cause: accessing a relationship or lazy-loaded column after the session has closed.
Fix: Use `expire_on_commit=False` (already set in `AsyncSessionLocal`) or explicitly `await session.refresh(obj)` before the session closes.

**Symptom: enum value causes DB error on insert.**
Cause: added a new value to a Python `str, enum.Enum` but did not run an Alembic migration to update the PostgreSQL `ENUM` type.
Fix: create a migration manually that runs `ALTER TYPE alert_type ADD VALUE 'new_value';`

---

#### Frontend Debugging

**Symptom: TypeScript build error — "X is a type and must be imported using 'import type'".**
Cause: `verbatimModuleSyntax: true` in `tsconfig.json`. See FS-03.
Fix: change `import { SomeType }` to `import type { SomeType }` or `import { something, type SomeType }`.
Run `npm run build` — it lists every file with violations.

**Symptom: tab shows stale data after a mutation.**
Cause: the component called its own local state update instead of `onRefresh()`.
Fix: trace the callback chain. The tab must call `onRefresh()` → which is `() => loadData(true)` in `ObraDetailPage` → which re-fetches all four data sources via `Promise.all`.
Never update `tasks`, `alerts`, `responsibles`, or `historial` state locally inside a tab component.

**Symptom: a select dropdown does not show the currently assigned responsible.**
Cause: the responsible exists in `responsibles` but their `is_active` is `false`. The dropdown filters to `activeResponsibles` only. See FS-06.
Fix: this is intentional behavior. The component should detect it and show the amber warning (already implemented in `TaskFormModal`). If the warning is missing, verify `previousResponsibleInactive` logic.

**Symptom: modal changes height when adding items.**
Cause: using `max-h` instead of `h-[90vh]` on the modal wrapper. See FS-05.
Fix: change the modal root to `h-[90vh] flex flex-col overflow-hidden`. List containers must use `min-h-[220px] max-h-[220px] overflow-y-auto`.

**Symptom: component renders but data is empty.**
Check `ObraDetailPage.loadData` — if the `Promise.all` rejects, it sets `error` state but leaves all arrays empty. The tab renders empty state.
Open the browser Network tab and check which of the four requests failed. Look at the response body for FastAPI error detail.

---

#### API / Auth Debugging

**Symptom: all requests return 401.**
Check `localStorage.getItem("access_token")` in the browser console.
If null: the login flow did not save the token. Check `frontend/src/api/auth.ts` and `LoginPage.tsx`.
If present but expired: call `POST /api/v1/auth/login` directly to get a fresh token.
The `apiClient` interceptor in `frontend/src/api/client.ts` auto-redirects to `/` on 401 — if you're in a redirect loop, the token is expired or invalid.

**Symptom: request reaches the backend but returns 422.**
Pydantic validation failed. The FastAPI response body contains the exact field and reason:
```json
{"detail": [{"loc": ["body", "due_date"], "msg": "due_date must be after start_date"}]}
```
Check the corresponding schema in `backend/app/schemas/`.
Common cause: frontend sends a field that exists in the TypeScript type but not in the Pydantic schema, or sends `null` for a required field.

**Symptom: PATCH updates some fields but not others.**
Cause: `TaskUpdate` uses `exclude_unset=True` in the service. Fields not sent in the request body are not updated — this is intentional.
If a field is being ignored, verify it is included in the Pydantic `TaskUpdate` schema and that the frontend is actually sending it in the payload.

**Symptom: CORS error in the browser.**
The backend `main.py` has `allow_origins=["*"]` for development — CORS should never block in local dev.
If it does, check that the backend is running on `http://localhost:8000` and that `BASE_URL` in `frontend/src/api/client.ts` matches exactly.
If running on a different port, update `BASE_URL` in `client.ts`.

**Symptom: webhook receives the message but task status does not update.**
1. Check the Evolution API / Twilio logs — did the message actually reach the endpoint?
2. Check `POST /api/v1/webhook` in the FastAPI logs — is the responsible's `whatsapp_number` recognized?
3. Add a temporary `print()` in `message_interpreter.py` to see what the normalized message looks like.
4. The interpreter uses regex rules — test the normalized message string against each pattern manually.
5. Verify `VALID_TRANSITIONS` in `task_service.py` allows the attempted transition from the task's current status.
This is intentional — the historial must reflect who was responsible when the task was completed.

---

## Agent Skills

The `.agents/skills/` directory contains focused, self-contained skill files for AI agents working on this project. They are more specific and actionable than this file — they include file lists, step-by-step processes, validation commands, and the mandatory documentation rule.

### Relationship to this file

`docs/skills.md` (this file) defines the **rules** — what is allowed, what is forbidden, what patterns to follow.

`.agents/skills/*/SKILL.md` defines the **process** — step-by-step how to execute a specific category of task while respecting these rules.

Use both together. Do not treat them as alternatives.

### Available agent skills

| Skill | Path | Use for |
|---|---|---|
| `constructa-backend-feature` | `.agents/skills/constructa-backend-feature/SKILL.md` | New endpoints, services, schemas, migrations |
| `constructa-frontend-module` | `.agents/skills/constructa-frontend-module/SKILL.md` | New components, tabs, forms, API integration |
| `constructa-gantt-update` | `.agents/skills/constructa-gantt-update/SKILL.md` | GanttTimeline, drag/drop, date handling, modals |
| `constructa-alert-rules` | `.agents/skills/constructa-alert-rules/SKILL.md` | Alert generation, risk detection, alert display |
| `constructa-debugging` | `.agents/skills/constructa-debugging/SKILL.md` | Broken endpoints, build errors, DB issues, stale UI |
| `constructa-data-model-review` | `.agents/skills/constructa-data-model-review/SKILL.md` | Model proposals, schema audits, migrations |
| `constructa-documentation-update` | `.agents/skills/constructa-documentation-update/SKILL.md` | Updating documentacion.md |

### Mandatory documentation rule

**Every task must end with an update to `documentacion.md`.**

This applies regardless of whether code was changed. If the task was analysis-only, document what was analyzed and what decisions were made.

The template is defined in `.agents/skills/constructa-documentation-update/SKILL.md`.

Failing to document means future agents start without context, which leads to repeated work and contradictory changes.
