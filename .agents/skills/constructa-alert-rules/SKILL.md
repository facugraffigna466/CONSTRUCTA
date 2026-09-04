---
name: constructa-alert-rules
description: Use when adding, modifying, or debugging the alert generation system, risk detection logic, alert deduplication, or alert display in the frontend.
---

## When to use this skill

- Adding a new alert type (new `AlertType` enum value)
- Adding a new risk detection condition to `AlertService.evaluate_task_risks_for_obra()`
- Modifying alert deduplication logic
- Changing when `task_blocked` alerts are created
- Modifying `AlertasTab.tsx` to display a new alert type
- Debugging why alerts are not being generated or are duplicated
- Adding alert-related historial events

Do NOT use this skill for general frontend or backend tasks. Use `constructa-backend-feature` or `constructa-frontend-module` instead.

---

## Files to read first

```
backend/app/models/alert.py                          — AlertType enum, Alert model
backend/app/repositories/alert.py                   — create_alert(), exists_unread_for_task(), exists_unread_for_obra()
backend/app/services/alert_service.py               — evaluate_task_risks_for_obra(), mark_read(), emit() (ÚNICO punto de emisión)
backend/app/services/risk_service.py                — motor de detección de riesgo: RULES + las 11 reglas
backend/app/models/settings.py                      — toggles y umbrales por regla (campos risk_*)
backend/app/services/task_service.py                — apply_status_update() — where TASK_BLOCKED is created
backend/app/api/routes/tasks.py                     — GET /tasks/obra/{obra_id} triggers risk evaluation
frontend/src/lib/alertMeta.ts                       — ÚNICA fuente de etiqueta, ícono y paleta por alerta
frontend/src/components/AlertasTab.tsx              — vista completa (lee de alertMeta, no define colores)
frontend/src/components/ResumenTab.tsx              — KPI "Alertas activas" (solo el conteo de no leídas; no renderiza por tipo)
frontend/src/types/index.ts                         — AlertType type
frontend/src/api/alerts.ts                          — fetchAlerts(), markAlertRead()
docs/referencia/skills.md                                      — AR-01 through AR-04
```

---

## Alert system architecture

### 17 tipos de alerta, en dos familias

| Familia | Tipos | Dónde se evalúan |
|---|---|---|
| Estado inmediato | `task_blocked`, `delay_risk`, `task_overdue`, `no_response`, `reschedule_requested`, `order_received` | `AlertService` + `NotificationService` |
| Detección de riesgo | 11 reglas: ruta crítica, holgura, línea base, materiales/compras, avance, calendario, historial, hitos | `RiskService` |

Cada alerta tiene además una **severidad** (`critica`/`alta`/`media`/`baja`). El valor por
defecto de cada tipo está en `DEFAULT_SEVERITY` (`models/alert.py`); solo las reglas que la
calculan dinámicamente la pasan explícita. Detalle completo en `docs/features/deteccion-riesgos.md`.

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

### Emisión: siempre por AlertService.emit()
`emit()` es el único punto de emisión. Centraliza la dedup contra alertas NO leídas por
`(task_id/obra_id, tipo, mensaje)` y el evento único de historial. No llames a
`create_alert()` directamente desde una regla:

```python
await self.alerts.emit(
    obra_id=ctx.obra.id, task_id=task.id,
    alert_type=AlertType.MILESTONE_AT_RISK,
    message=message, reason="milestone_at_risk",
    severity=AlertSeverity.CRITICA,
)
```

**Los mensajes no deben llevar contadores volátiles** ("vence en 3 días"): la dedup es por
mensaje exacto, así que un texto que cambia a diario crea una alerta nueva en cada corrida
en vez de deduplicar. Usá fechas absolutas.

### Alert scope
- Task-level alert: `obra_id` set, `task_id` set
- Obra-level alert: `obra_id` set, `task_id = NULL`

Frontend distinguishes these:
```tsx
// Obra-level alerts (no task_id) for the risk banner in ResumenTab
const obraAlerts = alerts.filter(a => !a.task_id && !a.is_read);
```

### Cadencias
`evaluate_task_risks_for_obra()` (delay_risk) corre de forma síncrona en cada fetch de tareas
**y** en un job cada 4 h. Las 11 reglas de `RiskService` corren solo por cron, en tres
cadencias declaradas en `RULES` (`FREQUENT` 4 h / `DAILY` / `WEEKLY`), registradas en
`core/scheduler.py`. Elegí la cadencia por la naturaleza de la regla: una que compara contra
un snapshot del día anterior no cambia de resultado dentro del mismo día.

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
1. Add value to `AlertType` enum in `backend/app/models/alert.py` y su severidad por defecto
   en `DEFAULT_SEVERITY`
2. Create Alembic migration (enum changes require explicit SQL):
   ```sql
   ALTER TYPE alert_type ADD VALUE IF NOT EXISTS 'new_type';
   ```
   Si la migración compara la columna contra literales, casteá: `WHERE type::text IN (...)`.
   Postgres no define `alert_type = varchar` y la migración falla (en SQLite pasa igual, así
   que los tests no lo detectan).
3. Emitila con `AlertService.emit()` — nunca con `create_alert()` directo

#### Frontend
1. Add the new type to `AlertType` in `frontend/src/types/index.ts`:
   ```ts
   export type AlertType = "task_blocked" | "delay_risk" | "new_type";
   ```
2. Agregá la etiqueta y el ícono en `frontend/src/lib/alertMeta.ts` (`ALERT_LABEL` y
   `ALERT_ICON`). Los dos son `Record<AlertType, …>` exhaustivos: si falta el tipo, `tsc` falla.
3. **No agregues colores.** La paleta la manda la severidad (`SEVERITY_PALETTE`), no el tipo.
   `AlertasTab`, `AlertBell` y `CriticalAlertToast` leen de `alertMeta`; no hay copias que sincronizar.
4. Run `npm run build`

### Agregar una regla de detección de riesgo

Va en `RiskService`, no en `AlertService`: `evaluate_task_risks_for_obra()` corre en cada
carga del dashboard y tiene que seguir siendo barata.

1. Escribí el método `_rule_<nombre>(self, ctx)` en `backend/app/services/risk_service.py`,
   emitiendo por `self.alerts.emit()`. Si necesita un insumo caro (CPM, línea base,
   materiales), tomalo de `RiskContext`, que los cachea y los carga bajo demanda.
2. Agregá su toggle y su umbral a `SystemSettings` (+ migración) y al `SystemSettings` del
   frontend, o la regla queda apagada para siempre.
3. Sumá una línea a `RiskService.RULES` con `RiskRule(setting, method, cadence)`.
4. Un test recorre `RULES` y falla si el toggle o la cadencia no existen.

### Agregar una sub-condición a evaluate_task_risks_for_obra()

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

1. Read `AlertasTab.tsx` — it has filter pills (todas/no_leidas/leidas) and per-alert card rendering (única vista por tipo)
2. `ResumenTab.tsx` solo muestra el KPI de conteo ("Alertas activas") — no renderiza tarjetas por tipo
3. El layout de las tarjetas de alerta vive solo en `AlertasTab.tsx`
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
| Buscar un segundo `TYPE_STYLE` para sincronizar | Ya no existe: `AlertsPanel` fue eliminado (código muerto); el estilo por tipo vive solo en `AlertasTab.tsx` | Actualizar solo `AlertasTab.tsx` |
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
