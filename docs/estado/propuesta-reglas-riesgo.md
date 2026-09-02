# Propuesta: nuevas reglas de riesgo/alertas

> Diseño de reglas de detección de riesgo adicionales a las 6 actualmente implementadas (`task_blocked`, `delay_risk`, `task_overdue`, `no_response`, `reschedule_requested`, `order_received`).
> Fecha: 2026-08-31 | Rama: `main` | Estado: propuesta, sin implementar

---

## TL;DR

El sistema ya calcula o almacena varios datos que **no se usan hoy para generar alertas**: ruta crítica (CPM) con float por tarea, baseline por tarea, estado de materiales y órdenes de compra, calendario laboral con feriados, e historial append-only de eventos. Las reglas propuestas explotan esos datos existentes sin requerir nuevas fuentes de información — la mayoría no necesita tablas nuevas, solo lógica de comparación y (en algunos casos) un campo de severidad en `Alert`.

Se agrupan en 7 bloques según la fuente de datos que explotan, con la condición de disparo, tipo de trigger (evento vs. cron) y prioridad sugerida.

---

## 0. Contexto — las 6 reglas actuales

| Tipo | Condición | Disparo |
|---|---|---|
| `task_overdue` | `due_date < hoy`, tarea activa | Cron cada 1h |
| `no_response` | Recordatorio WhatsApp sin respuesta tras `max_response_hours` | Cron cada 2h |
| `task_blocked` | Tarea transiciona a `BLOQUEADA` vía chatbot | Evento (pipeline WhatsApp) |
| `reschedule_requested` | Responsable propone nueva fecha por WhatsApp | Evento (chatbot) |
| `order_received` | Usuario marca orden de compra como recibida | Evento (UI) |
| `delay_risk` | 5 sub-condiciones (vencidas, sin responsable, obra con ≥3 bloqueadas, ≥30% vencidas) | Evento (dashboard) + cron cada 4h |

Ninguna de las 6 usa ruta crítica, baseline, materiales/compras o calendario laboral como insumo.

---

## 1. Ruta crítica (CPM) — dato calculado, cero explotación hoy

`TaskService.compute_critical_path()` ya devuelve `float_by_task` (slack) y `critical_task_ids` (float = 0), consumido hoy solo por el endpoint `GET /obras/{id}/critical-path` para el toggle visual del Gantt.

### 1.1 `critical_task_delayed`
Tarea con `float = 0` (ruta crítica) vencida o próxima a vencer. A diferencia de `task_overdue`, esta condición implica que **la fecha fin de la obra completa se mueve**, no solo la tarea — amerita severidad más alta.

- **Trigger:** cron, reutilizando la cadencia de `evaluate_delay_risk` (4h).
- **Esfuerzo:** bajo — cruzar `critical_task_ids` con tareas vencidas, sin tablas nuevas.

### 1.2 `float_shrinking`
El slack de una tarea no crítica cayó por debajo de un umbral (ej. <3 días laborales) — se está por volver crítica. Requiere guardar el float de la corrida anterior para comparar contra el actual.

- **Trigger:** cron diario (snapshot + comparación).
- **Esfuerzo:** medio — necesita persistir el último float calculado por tarea (columna o tabla chica).

---

## 2. Baseline — existe la tabla, no se compara nunca

`task_baselines` guarda `baseline_start`/`baseline_finish` por tarea como snapshot histórico, pero nada compara esas fechas contra el estado actual.

### 2.1 `baseline_deviation`
`finish` actual desviado de `baseline_finish` por más de N días (configurable por obra). Es la métrica clásica de gestión de proyectos (schedule variance) y el dato ya existe — solo falta el cron que compare.

- **Trigger:** cron, mismo ciclo que `evaluate_delay_risk`.
- **Esfuerzo:** bajo.

---

## 3. Compras / materiales — tablas completas, cero alertas propias

Fase 4 (materiales + compras) está mergeada pero no generó ninguna alerta específica; hoy solo existe `order_received`, disparada manualmente por el usuario.

### 3.1 `material_pending_too_long`
`task_materials.status = 'pendiente'` hace más de N días sin pasar a `pedido`.

### 3.2 `order_sent_no_confirmation`
`purchase_orders.status = 'enviado'` hace más de N días sin recepción (`sent_at` + umbral) — el proveedor no confirmó ni entregó.

### 3.3 `material_blocking_task`
Tarea con `start_date` en ≤X días que aún tiene materiales en `pendiente`/`pedido`. Cruza fechas de tarea con estado de material para anticipar el bloqueo **antes** de que la tarea llegue a estar `BLOQUEADA` en la práctica.

- **Trigger:** las tres, cron cada 4-6h (reutilizable con `evaluate_delay_risk` o un job propio).
- **Esfuerzo:** bajo-medio — todas las tablas y campos ya existen.

---

## 4. Progreso estancado — requiere derivar de historial

### 4.1 `progress_stalled`
Tarea `en_progreso` sin cambios de `estimated_progress` ni eventos relevantes en `historial_eventos` durante N días.

Hoy no existe una columna "última actualización de progreso"; dos caminos:
- **Sin migración:** consultar el último evento relevante en `historial_eventos` por `task_id` (más simple de implementar, más costoso en query).
- **Con migración:** agregar `last_progress_at` a `tasks`, actualizada en `TaskService` al cambiar `estimated_progress` (consulta directa, más rápida).

- **Trigger:** cron diario.
- **Esfuerzo:** medio.

---

## 5. Calendario laboral — se usa para horarios de envío, no para riesgo

`working_calendars`/`calendar_exceptions` (días laborales + feriados por obra) hoy solo evita enviar mensajes de WhatsApp fuera de horario.

### 5.1 `deadline_conflicts_holiday`
`due_date` de una tarea cae en feriado/excepción del calendario de esa obra — el responsable probablemente no trabaja ese día. Alertar con anticipación para reprogramar antes de que se cumpla la fecha.

- **Trigger:** cron, al crear/editar tareas o corrida periódica semanal.
- **Esfuerzo:** bajo.

---

## 6. Historial — ya registra todo, ideal para patrones recurrentes

`historial_eventos` es append-only y ya loguea `alert_created`, `task_status_changed`, `reschedule_requested`, `purchase_order_received` — buena fuente para reglas basadas en frecuencia, no en un único evento puntual.

### 6.1 `recurring_blocker`
Una misma tarea entró a `BLOQUEADA` ≥3 veces (contable vía `historial_eventos`). Señala un problema estructural (dependencia mal definida, proveedor recurrente) en vez de un bloqueo puntual.

### 6.2 `chronic_no_response`
Un mismo responsable acumula ≥N alertas `no_response` en un período determinado. Más accionable que alertar por tarea individual — apunta al problema de personas/proceso, no de una tarea aislada.

- **Trigger:** cron semanal.
- **Esfuerzo:** medio — requiere agregaciones sobre `historial_eventos`/`alerts` por `task_id` o `responsible_id`.

---

## 7. Hitos — `is_milestone` sin usar en ninguna regla de riesgo

### 7.1 `milestone_at_risk`
Hito con fecha próxima (≤X días) que tiene tareas predecesoras aún no completadas. Combina dependencias + `is_milestone`; severidad mayor que una tarea común porque un hito suele ser un compromiso visible ante el comitente.

- **Trigger:** cron, mismo ciclo que `evaluate_delay_risk`.
- **Esfuerzo:** bajo-medio.

---

## Consideraciones transversales de diseño

- **Falta severidad:** `Alert` no tiene campo `severity`/`priority` hoy. Para que reglas como `critical_task_delayed` o `milestone_at_risk` pesen más que un `task_overdue` genérico, conviene agregar `severity` (migración chica) antes o junto con la primera regla nueva que la necesite.
- **Trigger type:** las reglas que comparan snapshots en el tiempo (`float_shrinking`, `baseline_deviation`, `progress_stalled`) necesitan cron, no evento. Las que cruzan estado de otra entidad al vuelo (`material_blocking_task`, `deadline_conflicts_holiday`) pueden vivir como sub-condiciones dentro de `evaluate_task_risks_for_obra`, igual que hace `delay_risk` hoy.
- **Dedup:** seguir el patrón existente — clave `(task_id/obra_id, type, message)` contra alertas no leídas.
- **Historial:** cada alerta nueva debe seguir registrando un único evento en `historial_eventos` al crearse (regla ya vigente para las 6 actuales).

---

## Prioridad sugerida de implementación

1. **`critical_task_delayed`** y **`baseline_deviation`** — mayor valor, cero tablas nuevas, solo lógica de comparación sobre datos que ya existen.
2. **`material_pending_too_long`** / **`order_sent_no_confirmation`** / **`material_blocking_task`** — cierre natural de la Fase 4 (compras), que hoy no tiene ninguna alerta propia.
3. **`milestone_at_risk`** y **`deadline_conflicts_holiday`** — bajo esfuerzo, alto valor percibido por el usuario (comitente/PM).
4. **`progress_stalled`**, **`recurring_blocker`**, **`chronic_no_response`**, **`float_shrinking`** — segunda tanda; requieren derivar datos de historial o mantener snapshots temporales, mayor esfuerzo de implementación.
