---
name: constructa-gantt-update
description: Use when modifying GanttTimeline, SchedulingModal, ReschedulingModal, task date handling, drag-and-drop planning behavior, or any visual timeline feature.
---

## When to use this skill

- Modifying `GanttTimeline.tsx`
- Modifying `ReschedulingModal.tsx` or `SchedulingModal.tsx`
- Changing how task dates are displayed, dragged, or calculated in the timeline
- Adding new visual indicators to the Gantt (status, overdue, today line, etc.)
- Changing the drag-to-reschedule or drag-to-schedule behavior
- Fixing drop zone issues (HTML5 DnD from "Tareas sin fechas")
- Modifying tick/scale generation or date label rendering

---

## Files to read first

Before writing any code, read ALL of these:

```
frontend/src/components/GanttTimeline.tsx        — full implementation
frontend/src/components/ReschedulingModal.tsx    — reschedule confirmation (dated task drag)
frontend/src/components/SchedulingModal.tsx      — schedule confirmation (unplanned task drop)
frontend/src/components/ResumenTab.tsx           — how GanttTimeline is called, unplanned task list
frontend/src/pages/ObraDetailPage.tsx            — how ResumenTab is called, loadData() flow
frontend/src/types/index.ts                      — Task, Responsible, TaskStatus types
frontend/src/api/tasks.ts                        — TaskUpdatePayload, updateTask()
docs/skills.md                                   — DR-05, FS-02, FS-03, FS-07
```

---

## Architecture overview

### Two separate drag systems coexist

**System 1 — Mouse drag for rescheduling (dated tasks within Gantt)**
- `mousedown` on a bar → `startDrag()` → `dragRef.current` set
- Global `mousemove`/`mouseup` listeners registered only while dragging
- Stale-closure prevention: `dragRef` mirrors drag state, `onEditTaskRef` mirrors `onEditTask`
- On `mouseup`: if `|deltaPx| < CLICK_THRESHOLD_PX` → edit click; else → `setPending()` → `ReschedulingModal`
- `stateRef` keeps `{ rangeMs, minMs, visible }` always current for use inside stable `useCallback`

**System 2 — HTML5 DnD for scheduling (unplanned tasks from ResumenTab list)**
- MIME type: `application/x-constructa-task` (checked in `dragover` to filter non-Gantt drags)
- `onDragStart` in ResumenTab's `<li>` → `setData(DND_TYPE, taskId.toString())`
- `onDragOver` in Gantt outer container → `setIsDragOver(true)` if correct type
- `onDragLeave` with `relatedTarget` check to avoid flicker on child hover
- `onDrop` → calculate drop date from `clientX` relative to `timelineRef` → `setPendingSchedule()` → `SchedulingModal`

### Date position calculation

Converting pixel position to date:
```
xFraction = (clientX - timelineRef.getBoundingClientRect().left) / timelineRef.width
dropDate  = msToDateStr(round((minMs + xFraction × rangeMs) / DAY_MS) × DAY_MS)
```

Converting date to bar position:
```
pct = ((dateMs - minMs) / rangeMs) × 100   // clamped 0–100
```

### Date range computation

When tasks have dates: `minMs`/`maxMs` from all task dates + today, with 5% padding.
When no tasks have dates (fallback): `obraStartDate → obraExpectedEndDate`, or `today → today+30d`.

### Tick spacing auto-selection

| Range | Interval |
|---|---|
| ≤ 14 days | 2 days |
| ≤ 30 days | 5 days |
| ≤ 90 days | 7 days |
| ≤ 180 days | 14 days |
| > 180 days | 30 days |

Strong grid line every 7 days (or every tick if interval ≥ 7 days).

---

## Rules to respect

### No task dependencies (DR-05)
Never implement automatic rescheduling of other tasks.
The Gantt shows the impact visually (nearbyCount warning) but never moves tasks without user confirmation.

### Every date change goes through PATCH /tasks/{id}
The only API call is `updateTask(taskId, { start_date, due_date, [responsible_id] })`.
No bulk update endpoints. No cascade.

### Confirmation before any change
- Dated task drag → `ReschedulingModal` must show before PATCH
- Unplanned task drop → `SchedulingModal` must show before PATCH
- Never apply date changes directly without user confirmation

### Highlight after save
After modal confirms, call `setHighlightedId(task.id)` then clear after 1500ms.
This gives visual feedback that the task was successfully updated.

### Fallback empty state is a drop zone
When `visible.length === 0`, the Gantt must still render and accept drops.
Show "Arrastrá tareas desde abajo para programarlas."
When `isDragOver`, show "Soltá acá para programar la tarea."

### Prop threading
- `GanttTimeline` needs: `tasks`, `responsibles`, `obraStartDate`, `obraExpectedEndDate`, `onSaved`, `onEditTask`
- `ResumenTab` passes all of these
- `ObraDetailPage` passes `obra.start_date` and `obra.expected_end_date` to `ResumenTab`

### SchedulingModal requires active responsible
When dropping an unplanned task:
- If active responsibles exist → responsible_id is required (validation blocks confirm)
- If no active responsibles → show amber warning, allow confirm without it
- Preselect existing responsible_id if still active

---

## Step-by-step process for Gantt changes

### Visual-only changes (colors, labels, layout)
1. Read `GanttTimeline.tsx` fully
2. Identify the exact render section to change (bar render, header, legend, empty state)
3. Make targeted edit — do not touch drag logic or date computation
4. Run `npm run build`

### New visual indicator (e.g., new badge, icon on bar)
1. Add constant/helper outside component if needed
2. Compute derived boolean inside the task row loop (e.g., `const isUrgent = ...`)
3. Render conditionally inside the timeline cell
4. Update legend if the new indicator needs a legend entry

### Changing drag-to-reschedule behavior
1. Understand current flow: `startDrag` → `handleMouseMove` → `handleMouseUp` → `setPending`
2. `handleMouseUp` and `handleMouseMove` use `useCallback` with `[]` deps — they read from refs only
3. To add data needed inside these callbacks: add it to `stateRef.current` assignment (after hooks)
4. Never add state dependencies to `handleMouseMove`/`handleMouseUp` — use refs instead
5. Test: drag task bar left/right, verify modal shows correct delta days

### Changing drop-to-schedule behavior
1. `handleDrop` is a regular function (not useCallback) — it can read render-scope variables
2. Date calculation uses `minMs`/`rangeMs` from render scope — always current
3. Task lookup uses `tasks` prop (all tasks) — not `visible` (only dated tasks)
4. After `setPendingSchedule()`, `SchedulingModal` opens with `dropDate` as default start

### Changing SchedulingModal fields
1. Read `SchedulingModal.tsx` — note props: `task`, `dropDate`, `responsibles`, `onClose`, `onSaved`
2. `dropDate` is the pre-filled start date calculated from drop position
3. If adding/removing fields, update both the local state and the `TaskUpdatePayload`
4. Ensure `responsible_id` stays required when active responsibles exist (current behavior)

---

## Validation commands

```bash
# TypeScript build
cd frontend && npm run build
```

### Manual test checklist

**Test 1 — Drag dated task to reschedule**
1. Open Resumen tab with tasks that have dates
2. Click-hold a task bar, drag left or right
3. Release → ReschedulingModal should open with correct new dates
4. Confirm → task bar moves, green highlight for 1.5s

**Test 2 — Click to edit**
1. Click a task bar without dragging (< 5px movement)
2. TaskFormModal should open (NOT ReschedulingModal)

**Test 3 — Drop unplanned task**
1. Drag a task from "Tareas sin fechas" section
2. Drag over Gantt — border turns orange, drop zone message appears
3. Drop on a date position → SchedulingModal opens with calculated start date
4. Set end date and responsible, confirm → task appears in Gantt, disappears from unplanned list

**Test 4 — Empty Gantt drop zone**
1. With all tasks lacking dates, Gantt shows empty state
2. Drag an unplanned task → Gantt highlights, empty state message changes to "Soltá acá"
3. Drop → SchedulingModal opens, confirm → task appears in Gantt

**Test 5 — No accidental rescheduling**
1. Confirm that clicking a bar opens edit modal, not reschedule modal
2. Confirm that very small drags (< 5px) open edit modal

---

## Common mistakes to avoid

| Mistake | Consequence | Fix |
|---|---|---|
| Adding state deps to `handleMouseMove`/`handleMouseUp` `useCallback` | Stale closures or infinite re-subscriptions | Use refs (`dragRef`, `stateRef`, `onEditTaskRef`) inside these callbacks |
| Using `setDrag(prev => ...)` to compute new values inside the updater | React docs: side effects in state updaters are wrong | Compute new value first, then `setDrag(newValue)` |
| Reading `drag` state inside `handleMouseUp` | Stale closure — `drag` is captured at `useCallback([])` creation | Read `dragRef.current` instead |
| Forgetting `e.preventDefault()` in `handleDragOver` | Drop event never fires | Always call `preventDefault()` in `dragover` |
| Using wrong MIME type for DnD (`"taskId"` vs the full `DND_TYPE`) | Drop silently fails | Use `DND_TYPE = "application/x-constructa-task"` consistently |
| Auto-rescheduling other tasks | Violates DR-05 | Only show nearbyCount warning in modal — never move other tasks |
| Direct PATCH without confirmation modal | Bad UX, no undo | Always open confirmation modal first |
| Changing `visible` to include undated tasks | Breaks date rendering (no start/due → no % position) | Keep `visible = tasks.filter(t => t.start_date || t.due_date)` |

---

## End-of-task documentation requirement

At the end of every Gantt task, update `documentacion.md`:

```markdown
## YYYY-MM-DD — <Short title>

### Objective
What was implemented (visual improvement, new drag behavior, date calculation fix, etc.).

### Changes made
- GanttTimeline changes (list specific sections: bar render, tick generation, drop handlers, etc.)
- Modal changes if any

### Files modified
- `frontend/src/components/GanttTimeline.tsx`
- `frontend/src/components/SchedulingModal.tsx` (if changed)
- `frontend/src/components/ReschedulingModal.tsx` (if changed)
- `frontend/src/components/ResumenTab.tsx` (if prop threading changed)

### Problems found
Any drag/drop issues, date calculation edge cases, stale closure bugs encountered.

### Solutions applied
How problems were resolved. Reference ref pattern if used.

### Validation
- `npm run build` — passed
- Manual test: describe each test from the checklist run and result

### Pending / next steps
Remaining visual improvements or known edge cases.
```
