---
name: constructa-debugging
description: Use when diagnosing and fixing broken endpoints, frontend build errors, database issues, API mismatches, stale UI, authentication failures, or any unexpected runtime behavior in CONSTRUCTA.
---

## When to use this skill

- A PATCH/POST/DELETE endpoint returns 4xx or 5xx
- `npm run build` fails with TypeScript errors
- A page shows stale data after mutation
- Alerts/historial are not being generated
- Drag-and-drop in the Gantt stops working
- Authentication returns 401 unexpectedly
- A database migration fails
- The WhatsApp webhook doesn't update task status

---

## Files to read first

Read the files relevant to the broken flow:

```
backend/app/main.py                           — imports, router registration, exception handlers
backend/app/core/database.py                  — get_db(), session lifecycle, commit/rollback boundary
backend/app/core/exceptions.py               — exception types and HTTP mappings
backend/app/api/routes/<relevant>.py          — route definition
backend/app/services/<relevant>_service.py   — business logic
backend/app/repositories/<relevant>.py       — data access
backend/app/schemas/<relevant>.py            — Pydantic validation
frontend/src/api/client.ts                   — axios instance, auth interceptor, 401 redirect
frontend/src/api/<relevant>.ts               — API function that's failing
frontend/src/pages/ObraDetailPage.tsx         — data flow, loadData(), error state
```

---

## Debugging protocol

### Step 1 — Reproduce exactly
Identify the exact user action that triggers the bug.
Note: HTTP method, URL, request payload, response status code, response body.
Do not guess. Read the error message first.

### Step 2 — Locate the failure layer

| Symptom | Where to look first |
|---|---|
| 422 Unprocessable Entity | Pydantic schema in `backend/app/schemas/<entity>.py` |
| 500 Internal Server Error | FastAPI logs in terminal; Python traceback |
| 401 Unauthorized | `localStorage.getItem("access_token")` in browser; JWT expiry |
| 404 Not Found | Route registration in `main.py`; service `get_or_raise()` |
| 403 Forbidden | Service access control (manager_id check) |
| Data not updating in UI | `loadData(true)` not called after mutation; stale state |
| TypeScript build error | Import type errors; prop type mismatches |
| Empty list / missing data | `loadData()` Promise.all rejected; check Network tab |

### Step 3 — Inspect backend logs
In the terminal running `uvicorn app.main:app --reload`:
- Look for the Python traceback
- The last line of the traceback is the root cause
- Lines above it are the call stack

### Step 4 — Check the browser Network tab
- Open DevTools → Network
- Find the failing request
- Check: Request Headers (Authorization present?), Request Payload (matches schema?), Response (exact error detail from FastAPI)

FastAPI returns validation errors as:
```json
{
  "detail": [
    {"loc": ["body", "due_date"], "msg": "due_date must be >= start_date", "type": "value_error"}
  ]
}
```

### Step 5 — Check the database directly
```bash
# Connect to PostgreSQL
psql -U constructa -d constructa_db

# Inspect table state
SELECT * FROM tasks WHERE id = <id>;
SELECT * FROM historial_eventos WHERE task_id = <id> ORDER BY created_at DESC;
SELECT * FROM alerts WHERE obra_id = <id> ORDER BY created_at DESC;

# Check migration status
cd backend && alembic current
cd backend && alembic heads
```

---

## Known CONSTRUCTA-specific bugs

### Bug 1 — Date JSON serialization (500 on PATCH with date fields)
**Symptom**: PATCH /tasks/{id} or PATCH /obras/{id} returns 500. Traceback mentions `TypeError: date is not JSON serializable`.

**Root cause**: `data.model_dump(exclude_unset=True)` returns Python `date` objects. Passing these directly to `historial.log(payload=changes)` fails because SQLAlchemy's JSON column can't serialize `date`.

**Fix**:
```python
changes      = data.model_dump(exclude_unset=True)           # native types for SQLAlchemy
changes_json = data.model_dump(exclude_unset=True, mode="json")  # ISO strings for JSON
updated = await self.repo.update_fields(task_id, **changes)
await self.historial.log(..., payload=changes_json)  # ← use json version
```

Affected files: `task_service.py`, `obra_service.py`.

---

### Bug 2 — SQLAlchemy identity map / stale state capture (historial not logged or wrong values)
**Symptom**: Historial shows `"from": "en_progreso", "to": "en_progreso"` — same value for both.

**Root cause**: `old_status = task.status` was captured AFTER `await self.repo.update_status(...)` which calls `session.refresh()` internally, mutating the in-memory object.

**Fix** (BS-03):
```python
old_status = task.status               # capture BEFORE any await
await self.repo.update_status(task_id, new_status)
await self.historial.log(..., payload={"from": old_status, "to": new_status})
```

---

### Bug 3 — TypeScript `verbatimModuleSyntax` import error (build fails)
**Symptom**: `npm run build` fails with `error TS1484: 'X' is a type and must be imported using a type-only import`

**Root cause**: A type is imported as a value import instead of a type import.

**Fix** (FS-03):
```tsx
// WRONG
import { Task, useState } from "react";
import { Responsible } from "../types";

// CORRECT
import { useState, type FormEvent } from "react";
import type { Responsible } from "../types";
// or
import { useState } from "react";
import type { Task, Responsible } from "../types";
```

Run `npm run build` to see all violations at once.

---

### Bug 4 — Stale data after mutation
**Symptom**: User creates/edits a task but the list doesn't update. Other tabs show old data.

**Root cause**: Component called a local `setState` after mutation instead of `onRefresh()`.

**Fix** (DC-01):
```tsx
// WRONG — only updates local state
setTasks(prev => [...prev, newTask]);

// CORRECT — re-fetches all obra data (tasks, alerts, historial, responsibles)
onRefresh();  // which calls loadData(true) in ObraDetailPage
```

---

### Bug 5 — PATCH payload mismatch (422 from schema)
**Symptom**: PATCH /tasks/{id} returns 422 with `extra fields not permitted` or `field required`.

**Possible causes**:
- Frontend sends a field not in `TaskUpdate` schema (e.g., `status`)
- Frontend sends `null` for a field that's `int` not `int | None`
- Frontend sends `""` for a date field instead of `null`

**Fix**: Compare `TaskUpdatePayload` in `frontend/src/api/tasks.ts` with `TaskUpdate` in `backend/app/schemas/task.py`. They must match exactly.

---

### Bug 6 — Duplicate alerts on every page load
**Symptom**: Alert count keeps increasing on Resumen tab refresh.

**Root cause**: Missing dedup check in `evaluate_task_risks_for_obra()`.

**Fix**: Before `create_alert()`, always call:
```python
if await self.alert_repo.exists_unread_for_task(task_id, AlertType.DELAY_RISK, message):
    continue
```

---

### Bug 7 — Webhook not updating task status
**Symptom**: WhatsApp message received, but task status unchanged. No historial event.

**Debugging steps**:
1. Check FastAPI logs — did `POST /api/v1/webhook` fire?
2. Is the responsible's `whatsapp_number` in the database? `SELECT * FROM responsibles WHERE whatsapp_number = '+...'`
3. Is the responsible active? `is_active = true`?
4. Does the responsible have an active task? Check `TaskRepository.list_by_responsible()`
5. Add `print()` to `message_interpreter.py` to see what the interpreter receives
6. Check `VALID_TRANSITIONS` in `task_service.py` — is the attempted transition allowed from the task's current status?
7. Check `messages` table: `SELECT processing_status, ai_interpretation FROM messages ORDER BY created_at DESC LIMIT 5`

---

### Bug 8 — Auth 401 redirect loop
**Symptom**: All API requests return 401; browser keeps redirecting to login.

**Debugging**:
```javascript
// In browser console
localStorage.getItem("access_token")  // should not be null
```
If token is present but still 401: token may be expired. Call `POST /api/v1/auth/login` with credentials to get a fresh token.

If token is null: the login flow didn't store it. Check `frontend/src/api/auth.ts` and `LoginPage.tsx`.

---

### Bug 9 — Alembic migration drift
**Symptom**: `alembic upgrade head` fails; DB is out of sync.

**Debugging**:
```bash
cd backend
alembic current      # what revision is the DB at
alembic heads        # what the latest migration is
alembic history      # full migration chain
```

If drift: run `alembic upgrade head` to apply pending migrations.
If a model field was added without a migration: run `alembic revision --autogenerate -m "add field"`.

---

## Validation after fix

```bash
# 1. Backend imports OK
cd backend && python3 -c "from app.main import app; print('imports OK')"

# 2. Migrations applied
cd backend && alembic current && alembic heads

# 3. Frontend build
cd frontend && npm run build

# 4. Reproduce the original failing flow and confirm it works
```

---

## Common debugging mistakes to avoid

| Mistake | Better approach |
|---|---|
| Guessing the root cause without reading logs | Read the full traceback first |
| Fixing symptoms without understanding the root cause | Trace the call chain: route → service → repo |
| Deleting and recreating migration files | Use `alembic upgrade head` first; only create new revisions |
| Using `--no-verify` to skip hooks | Fix the underlying hook issue instead |
| Assuming a 500 is always a backend bug | 500 can also be caused by DB connection loss or env var missing |
| Using `alert()` or `console.log` as user feedback | Set `apiError` state and render it in the component |

---

## End-of-task documentation requirement

At the end of every debugging session, update `documentacion.md`:

```markdown
## YYYY-MM-DD — Bug fix: <description>

### Objective
What was broken and what the expected behavior should be.

### Root cause
Exact cause identified (e.g., "BS-03 violation — state captured after refresh").

### Files modified
- List every file changed

### Problems found
What was the error message / symptom observed.

### Solutions applied
Exact code change made. Reference the relevant known bug number if applicable.

### Validation
- `python3 -c "from app.main import app; print('imports OK')"` — result (if backend)
- `npm run build` — result (if frontend)
- Manual test: exact flow tested and result

### Pending / next steps
Are there similar bugs elsewhere that need the same fix?
```
