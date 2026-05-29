---
name: constructa-alert-rules
description: Use when adding, modifying, or debugging the alert generation system, risk detection logic, alert deduplication, or alert display in the frontend.
---

## When to use this skill

- Adding a new alert type (new `AlertType` enum value)
- Adding a new risk detection condition to `AlertService.evaluate_task_risks_for_obra()`
- Modifying alert deduplication logic
- Changing when `task_blocked` alerts are created
- Modifying `AlertsPanel.tsx` or `AlertasTab.tsx` to display a new alert type
- Debugging why alerts are not being generated or are duplicated
- Adding alert-related historial events

Do NOT use this skill for general frontend or backend tasks. Use `constructa-backend-feature` or `constructa-frontend-module` instead.

---

## Files to read first

```
backend/app/models/alert.py                          — AlertType enum, Alert model
backend/app/repositories/alert.py                   — create_alert(), exists_unread_for_task(), exists_unread_for_obra()
backend/app/services/alert_service.py               — evaluate_task_risks_for_obra(), mark_read()
backend/app/services/task_service.py                — apply_status_update() — where TASK_BLOCKED is created
backend/app/api/routes/tasks.py                     — GET /tasks/obra/{obra_id} triggers risk evaluation
frontend/src/components/AlertasTab.tsx              — full alert view with filter/type badges
frontend/src/components/AlertsPanel.tsx             — alert preview (max 5) in ResumenTab
frontend/src/types/index.ts                         — AlertType type
frontend/src/api/alerts.ts                          — fetchAlerts(), markAlertRead()
docs/skills.md                                      — AR-01 through AR-04
```

---

## Alert system architecture

### Two alert types currently

| Type | Trigger | Level |
|---|---|---|
| `task_blocked` | Task transitions to BLOQUEADA status | Task-level |
| `delay_risk` | Risk conditions detected at obra level (5 conditions) | Task-level or Obra-level |

### When alerts are generated

**`task_blocked`**: Created in `TaskService.apply_status_update()` when `new_status == BLOQUEADA`.
Called only by `MessageService.process_inbound()` — never by direct user action.

**`delay_risk`**: Created by `AlertService.evaluate_task_risks_for_obra(obra_id)`.
This method is called on every `GET /tasks/obra/{obra_id}` request.
The 5 current risk conditions:
1. Task overdue: `due_date < today` AND active status
2. Task missing responsible: active task with no `responsible_id`
3. Inconsistent progress: `status=PENDIENTE` but `estimated_progress > 0`
4. Many blocked tasks: `>= 3` tasks with `status=BLOQUEADA`
5. High overdue rate: `>= 30%` of active tasks are overdue

### Deduplication rule
Before creating any alert, check if an unread alert with the same `(task_id/obra_id, type, message)` already exists:
```python
if await self.alert_repo.exists_unread_for_task(task_id, AlertType.DELAY_RISK, message):
    return  # skip — already exists
await self.alert_repo.create_alert(AlertType.DELAY_RISK, message, obra_id, task_id)
```
This prevents alert spam on repeated page loads.

### Alert scope
- Task-level alert: `obra_id` set, `task_id` set
- Obra-level alert: `obra_id` set, `task_id = NULL`

Frontend distinguishes these:
```tsx
// Obra-level alerts (no task_id) for the risk banner in ResumenTab
const obraAlerts = alerts.filter(a => !a.task_id && !a.is_read);
```

### No scheduler/cron
Risk evaluation is triggered synchronously on each task-list fetch.
There is no background job or cron. Do NOT add one without explicit decision.

---

## Rules to respect

### Alerts are generated in the service layer only (AR-02)
Never create alerts in routes, repositories, or the model itself.
`AlertRepository.create_alert()` is called from `AlertService` and `TaskService` only.

### No automatic task changes (DR-05)
Alerts report risk. They do not reschedule, reassign, or modify tasks.
Any action on the alerted task must come from user interaction.

### Historial for alert-creating events
When an alert-creating action is logged in historial, the event type should match:
- `task_status_changed` when `task_blocked` alert is created (status change is the event)
- `alert_created` (optional, for audit) — only add if explicitly required

### Deduplication is mandatory (AR-01)
Always check `exists_unread_for_task()` or `exists_unread_for_obra()` before calling `create_alert()`.
Without this, every page load regenerates the same alert.

### Mark-as-read is optimistic (DC-02)
`markAlertRead()` updates the alert in the frontend immediately without waiting for a full `loadData` refetch.
`handleMarkAllRead()` falls back to `loadData(true)` on partial failure (since there is no bulk-read endpoint).

---

## Step-by-step process

### Adding a new alert type

#### Backend
1. Add value to `AlertType` enum in `backend/app/models/alert.py`
2. Create Alembic migration (enum changes require explicit SQL):
   ```sql
   ALTER TYPE alerttype ADD VALUE 'new_type';
   ```
3. Add `create_alert()` call (with dedup check) in the appropriate service

#### Frontend
1. Add the new type to `AlertType` in `frontend/src/types/index.ts`:
   ```ts
   export type AlertType = "task_blocked" | "delay_risk" | "new_type";
   ```
2. Add display entries to `AlertasTab.tsx` — find `TYPE_STYLE` and `type_label` maps:
   ```tsx
   const TYPE_STYLE: Record<AlertType, string> = {
     task_blocked: "border-constructa-danger ...",
     delay_risk:   "border-constructa-warning ...",
     new_type:     "border-constructa-info ...",  // ← add
   };
   ```
3. Add same entry to `AlertsPanel.tsx` which also has a `TYPE_STYLE` map
4. Run `npm run build`

### Adding a new risk condition to evaluate_task_risks_for_obra()

1. Open `backend/app/services/alert_service.py`
2. Inside `evaluate_task_risks_for_obra()`, add a new condition block:
   ```python
   # Condition: <description>
   for task in tasks:
       if <condition(task)>:
           message = f"<Human-readable message about task.title>"
           if not await self.alert_repo.exists_unread_for_task(
               task.id, AlertType.DELAY_RISK, message
           ):
               await self._task_alert(task, AlertType.DELAY_RISK, message)
               created += 1
   ```
3. For obra-level conditions (not per-task):
   ```python
   if <obra-level condition>:
       message = "<Obra-level message>"
       if not await self.alert_repo.exists_unread_for_obra(
           obra_id, AlertType.DELAY_RISK, message
       ):
           await self._obra_alert(obra_id, AlertType.DELAY_RISK, message)
           created += 1
   ```
4. Increment the return counter

### Modifying alert display in the frontend

1. Read `AlertasTab.tsx` — it has filter pills (todas/no_leidas/leidas) and per-alert card rendering
2. Read `AlertsPanel.tsx` — it's the preview in ResumenTab (max 5 alerts)
3. Changes to the alert card layout must be made in BOTH files to stay consistent
4. Badge type labels use the `type_label` map — update it
5. Color/border uses `TYPE_STYLE` — update both files

---

## Validation commands

```bash
# Backend: check imports
cd backend && python3 -c "from app.main import app; print('imports OK')"

# Backend: verify migration was applied
cd backend && alembic current

# Frontend: TypeScript check
cd frontend && npm run build
```

### Manual test for new risk condition
1. Create task matching the new condition
2. Navigate to Resumen tab (triggers `GET /tasks/obra/{id}` → `evaluate_task_risks_for_obra`)
3. Alert should appear in the Alertas tab
4. Reload page — alert should NOT duplicate (dedup check working)
5. Mark as read — alert disappears from unread count

---

## Common mistakes to avoid

| Mistake | Consequence | Fix |
|---|---|---|
| Missing dedup check before `create_alert()` | Alert duplicates on every page load | Always call `exists_unread_for_task()` or `exists_unread_for_obra()` first |
| Adding enum value without Alembic migration | DB error on insert | Run `ALTER TYPE alerttype ADD VALUE '...'` in a new migration |
| Updating `AlertType` in only one file (models or types) | Type mismatch between DB and frontend | Update both `alert.py` model and `types/index.ts` |
| Updating badge style in `AlertasTab` but not `AlertsPanel` | Inconsistent look between full view and preview | Both files have `TYPE_STYLE` — update both |
| Creating alerts in a route handler | Breaks service-layer separation | Move to `AlertService` or the appropriate service |
| Auto-modifying tasks when alert is generated | DR-05 violation | Alerts are passive — no side effects on tasks |

---

## End-of-task documentation requirement

At the end of every alert task, update `documentacion.md`:

```markdown
## YYYY-MM-DD — <Short title>

### Objective
What alert behavior was added or changed.

### Changes made
- New AlertType enum value (if added)
- New risk condition in evaluate_task_risks_for_obra (if added)
- Frontend badge/style changes

### Files modified
- `backend/app/models/alert.py`
- `backend/app/repositories/alert.py`
- `backend/app/services/alert_service.py`
- `frontend/src/types/index.ts`
- `frontend/src/components/AlertasTab.tsx`
- `frontend/src/components/AlertsPanel.tsx`
- (list others)

### Problems found
Deduplication issues, enum migration errors, type mismatches.

### Solutions applied
How problems were resolved.

### Validation
- `python3 -c "from app.main import app; print('imports OK')"` — result
- `alembic current` — result
- `npm run build` — result
- Manual test: alert generated, deduplicated, displayed, marked as read

### Pending / next steps
Any remaining risk conditions or display improvements.
```
