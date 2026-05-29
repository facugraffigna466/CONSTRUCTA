---
name: constructa-backend-feature
description: Use when adding a new endpoint, service method, repository method, Pydantic schema, or Alembic migration to the CONSTRUCTA backend.
---

## When to use this skill

- Adding a new API endpoint (any HTTP method)
- Adding business logic to an existing or new service
- Adding a repository method
- Adding or modifying a Pydantic schema
- Adding a new database model or changing an existing one
- Running an Alembic migration

Do NOT use this skill for frontend changes. Use `constructa-frontend-module` for those.

---

## Files to read first

Before writing any code, read:

```
backend/app/models/<entity>.py          — understand the data model
backend/app/schemas/<entity>.py         — understand input/output shapes
backend/app/repositories/<entity>.py    — understand current data access
backend/app/services/<entity>_service.py — understand existing business logic
backend/app/api/routes/<entity>.py      — understand current routes
backend/app/core/exceptions.py          — available exception types
backend/app/core/deps.py                — DbSession, CurrentUserId
backend/app/core/database.py            — how get_db() works (commit/rollback boundary)
```

Also read `docs/skills.md` sections BS-01 through BS-07 for project-specific rules.

---

## Rules to respect

### Layer enforcement
- **Models**: SQLAlchemy ORM definitions only. No business logic.
- **Repositories**: Database queries only. One class per entity. Never call `session.commit()`.
- **Services**: All business logic lives here. Constructor receives `AsyncSession`, instantiates repositories.
- **Routes**: Thin handlers only. Validate HTTP input → call service → return result. No business logic.

### Transaction safety (BS-02)
The session is committed in `get_db()` after `yield`, not inside services or repositories.
Never call `await session.commit()` in any service or repository method.
If a service method uses multiple repositories, they share the same session — atomicity is free.

### State capture before mutation (BS-03)
Always capture field values BEFORE any `await` that touches the session:
```python
# CORRECT
old_status = task.status
await self.repo.update_status(task_id, new_status)

# WRONG — old_status will equal new_status after refresh
await self.repo.update_status(task_id, new_status)
old_status = task.status  # already mutated
```

### Historial is mandatory (BS-05)
Every state change must produce a `HistorialEvento` via `HistorialRepository.log()`.
Standard event_type values: `task_created`, `task_updated`, `task_status_changed`, `obra_created`, `obra_updated`.
`triggered_by` must be one of: `"user"`, `"chatbot"`, `"system"`.

### JSON serialization for date fields
When building a `payload` dict for historial, always use:
```python
changes      = data.model_dump(exclude_unset=True)         # native types for SQLAlchemy
changes_json = data.model_dump(exclude_unset=True, mode="json")  # ISO strings for JSON column
# Use changes for repo call, changes_json for historial payload
```
Python `date` objects are not JSON-serializable. `mode="json"` converts them to ISO strings.

### Schema rules (BS-06)
- `Read` schemas must have `model_config = {"from_attributes": True}`
- `Update` schemas must only include fields that are explicitly allowed to change
- `TaskUpdate` must never include `status` — status is chatbot-controlled (DR-01)
- `ResponsibleUpdate` must never include `whatsapp_number` — it is the chatbot identity key (DR-03)

### Access control
- ObraService: always verify `obra.manager_id == manager_id` before mutations
- TaskService: use `get_for_manager()` which checks obra ownership via `_get_obra_and_assert_access()`

### Task status machine
Valid transitions (enforce in `apply_status_update`, never anywhere else):
```
PENDIENTE   → EN_PROGRESO, CANCELADA
EN_PROGRESO → BLOQUEADA, EN_REVISION, CANCELADA
BLOQUEADA   → EN_PROGRESO, CANCELADA
EN_REVISION → EN_PROGRESO, COMPLETADA, CANCELADA
COMPLETADA  → (terminal)
CANCELADA   → (terminal)
```
Creating a TASK_BLOCKED alert is mandatory when status → BLOQUEADA.

---

## Step-by-step process

### Step 1 — Model (only if new table needed)
File: `backend/app/models/<entity>.py`
- Inherit from `Base`
- Use `Mapped` + `mapped_column` syntax
- Add to `backend/app/models/__init__.py`
- Create migration: `cd backend && alembic revision --autogenerate -m "add <entity>"`

### Step 2 — Schema
File: `backend/app/schemas/<entity>.py`
- Define `<Entity>Create`, `<Entity>Update`, `<Entity>Read`
- `Read` schema: `model_config = {"from_attributes": True}`
- `Update` schema: all fields optional, only include updatable fields
- Add validators for cross-field constraints (e.g., end_date >= start_date)

### Step 3 — Repository
File: `backend/app/repositories/<entity>.py`
- Inherit `BaseRepository[<Model>]`
- Only add methods the service actually needs
- Use `select(Model).where(...)` + `await self.session.execute(...)`
- Never call `session.commit()`

### Step 4 — Service
File: `backend/app/services/<entity>_service.py`
- Constructor: `def __init__(self, session: AsyncSession) -> None`
- Instantiate all needed repos with the same session
- Capture old values BEFORE any repo call (BS-03)
- Log historial after every state change (BS-05)
- Create alerts only for operationally significant events
- Raise typed exceptions: `NotFoundError`, `ConflictError`, `ForbiddenError`, `UnprocessableError`

### Step 5 — Route
File: `backend/app/api/routes/<entity>.py`
- Use `DbSession` and `CurrentUserId` from `app.core.deps`
- Route function body: validate → call service → return result
- Register in `backend/app/main.py`:
  ```python
  from app.api.routes import <entity>
  app.include_router(<entity>.router, prefix=API_PREFIX)
  ```

### Step 6 — Migration (if model changed)
```bash
cd backend
alembic revision --autogenerate -m "describe change"
alembic upgrade head
```
Enum value additions require manual migration: `ALTER TYPE <enum> ADD VALUE 'new_value';`

---

## Validation commands

```bash
# 1. Check for import/syntax errors
cd backend && python3 -c "from app.main import app; print('imports OK')"

# 2. Verify migration state
cd backend && alembic current
cd backend && alembic heads

# 3. Apply pending migrations
cd backend && alembic upgrade head

# 4. Start server and test via Swagger
uvicorn app.main:app --reload
# then open http://localhost:8000/docs
```

---

## Common mistakes to avoid

| Mistake | Consequence | Fix |
|---|---|---|
| `await session.commit()` inside a service | Double-commit or partial-commit before rollback boundary | Remove — `get_db()` handles this |
| Capturing state after `session.refresh()` | Old value equals new value (identity map) | Capture BEFORE any repo await |
| Forgetting `mode="json"` on date payloads | `TypeError: date is not JSON serializable` in historial log → full rollback | Use two `model_dump()` calls |
| Missing `model_config = {"from_attributes": True}` | Pydantic validation error at runtime for `Read` schemas | Always add to every `Read` schema |
| Putting business logic in the route handler | Untestable, breaks layer contract | Move to service |
| Adding `status` to `TaskUpdate` | DR-01 violation — status is chatbot-controlled | Remove it |
| Not logging historial | Audit trail breaks | Add `historial.log()` call |
| Creating alert without dedup check | Duplicate alerts flood UI | Use `exists_unread_for_task()` before `create_alert()` |

---

## End-of-task documentation requirement

At the end of every backend feature task, update `documentacion.md` with a new entry following this template:

```markdown
## YYYY-MM-DD — <Short title>

### Objective
What was implemented and why.

### Changes made
- New/modified files (bullet list)
- Migration description (if any)

### Files modified
- `backend/app/models/<entity>.py`
- `backend/app/schemas/<entity>.py`
- etc.

### Problems found
Any bugs, unexpected behavior, or architecture issues encountered.

### Solutions applied
How the problems were resolved. Reference specific patterns (BS-03, etc.) if applicable.

### Validation
- `python3 -c "from app.main import app; print('imports OK')"` — result
- `alembic current` / `alembic upgrade head` — result
- Manual Swagger test: endpoint + result

### Pending / next steps
What remains to be done. If nothing, write "None — feature complete."
```

If no code was changed (analysis/review only), still document:
- What was analyzed
- What decisions were made
- Why no change was applied
