# Auditoría 06 — Módulo Alertas

**Fecha:** 2026-08-19
**Rama auditada:** `audit/05-planos` (código en `main`)
**Auditor:** Claude Sonnet 4.6

---

## 1. Resumen ejecutivo

El módulo de alertas es el más complejo de CONSTRUCTA y en términos generales está bien diseñado: combina evaluación reactiva + periódica, deduplicación con dos estrategias diferenciadas, entrega real-time vía Socket.IO, y un ciclo de vida marca-leído / auto-resolve. Sin embargo tiene **tres problemas estructurales** que merecen atención: (1) dos implementaciones paralelas e inconsistentes de ventana de envío, (2) cuatro campos de configuración `notify_*` que existen en el modelo pero que el código de notificación nunca lee, y (3) TASK_OVERDUE y DELAY_RISK no se auto-resuelven cuando la condición desaparece, acumulando alertas huérfanas. El frontend está completo y es correcto; la parte más débil es el backend de evaluación y la configurabilidad de notificaciones.

---

## 2. Inventario de tipos de alerta

| Tipo | Código | Color UI | Disparador | Canal |
|------|--------|----------|------------|-------|
| `task_blocked` | `AlertType.TASK_BLOCKED` | Rojo `#D03A3A` | Tarea puesta en estado BLOCKED (app o chatbot) | In-app + WhatsApp (configuración pendiente — ver §7) |
| `delay_risk` | `AlertType.DELAY_RISK` | Amarillo `#C97D0E` | 4 sub-condiciones evaluadas reactivamente | Solo in-app |
| `task_overdue` | `AlertType.TASK_OVERDUE` | Rojo `#D03A3A` | Job periódico cada hora (APScheduler) | In-app + WhatsApp |
| `no_response` | `AlertType.NO_RESPONSE` | Azul `#2A6FDB` | Job periódico cada 2 horas | In-app + WhatsApp |
| `reschedule_requested` | `AlertType.RESCHEDULE_REQUESTED` | Naranja `#E85A26` | Chatbot WhatsApp detecta pedido de reprogramación | In-app |
| `order_received` | `AlertType.ORDER_RECEIVED` | Verde `#1F8A5B` | Orden de compra confirmada (módulo Compras) | In-app |

El enum completo está en `backend/app/models/alert.py`. Todos los tipos tienen ícono y color correctamente mapeados en `AlertBell.tsx` y `AlertasTab.tsx`.

---

## 3. Motor de evaluación

### 3.1 Evaluación reactiva — DELAY_RISK

**Dónde:** `backend/app/api/routes/tasks.py:59`

```python
@router.get("/obra/{obra_id}", response_model=list[TaskRead])
async def list_tasks_for_obra(obra_id: int, db: DbSession, user_id: CurrentUserId):
    tasks = await TaskService(db).list_by_obra(obra_id, user_id)
    await AlertService(db).evaluate_task_risks_for_obra(obra_id)  # reactive
    return [TaskRead.model_validate(t) for t in tasks]
```

Cada vez que cualquier usuario abre el tab Tareas o el Gantt de una obra, se corre `evaluate_task_risks_for_obra()`. Ese método evalúa cuatro condiciones sobre todas las tareas activas de la obra y crea alertas `DELAY_RISK` si corresponde.

**Cuatro condiciones evaluadas** (en `backend/app/services/alert_service.py`):

| Condición | Umbral | Deduplicación |
|-----------|--------|---------------|
| Tarea sin responsable | — | `exists_unread_for_task()` — no duplica si ya hay una no leída |
| Tarea vencida | fecha_fin < hoy | `exists_unread_for_task()` |
| Muchas tareas bloqueadas | ≥ 3 en la obra | `exists_unread_for_obra()` |
| Alto porcentaje de vencidas | ≥ 30 % del total | `exists_unread_for_obra()` |

La deduplicación es *unread-only*: si el usuario marca la alerta como leída y la condición persiste en la próxima visita, se genera una nueva alerta. Esto es **correcto** — permite recurrencia sin spam constante.

**Problema crítico:** Si todos los usuarios de una obra dejan de visitarla, DELAY_RISK nunca se evalúa para esa obra. Las obras abandonadas o poco activas quedan sin cobertura reactiva.

### 3.2 Evaluación periódica — APScheduler

**Dónde:** `backend/app/core/scheduler.py`

| Job | Trigger | Función | Alerta generada |
|-----|---------|---------|----------------|
| `_job_send_reminders` | CronTrigger `minute=0` (cada hora) | `notification_service.send_reminders()` | WhatsApp reminder (no crea Alert en DB) |
| `_job_mark_overdue` | CronTrigger `minute=5` (cada hora) | `notification_service.mark_overdue_tasks()` | `TASK_OVERDUE` |
| `_job_check_no_response` | CronTrigger `hour="*/2"` (cada 2h) | `notification_service.mark_no_response()` | `NO_RESPONSE` |
| `_job_remind_bitacora_obra` | CronTrigger `minute="*/15"` (cada 15min) | bitácora reminders | — |
| `_job_cleanup_expired_sessions` | CronTrigger `hour=3, minute=0` | limpieza de sesiones | — |

Todos los jobs usan `misfire_grace_time=600` (10 minutos) y timezone `"America/Argentina/Buenos_Aires"`.

**Deduplicación en jobs:**
- `mark_overdue_tasks()` usa `exists_for_task()` — busca *cualquier* alerta TASK_OVERDUE para esa tarea (leída o no). Una tarea crónicamente vencida recibe exactamente **una** alerta total. No re-alerta aunque siga vencida.
- `mark_no_response()` usa lógica similar.

Esto es correcto para evitar spam en condiciones crónicas, pero tiene el efecto de que si el responsable finalmente responde y luego vuelve a no responder, no se genera una segunda alerta (porque `exists_for_task()` ya encontró la primera).

### 3.3 Evaluación por acción de usuario — TASK_BLOCKED

**Dónde:** `backend/app/services/task_service.py`
- `apply_status_update()` (línea ~807): al cambiar status a `BLOCKED` via chatbot
- `update()` (línea ~668): al cambiar status a `BLOCKED` via API

La alerta se crea en `alert_repository.create_alert()`, que también emite Socket.IO `emit_alert_created()`. No hay deduplicación explícita aquí — si el responsable bloquea → desbloquea → vuelve a bloquear, puede generar múltiples alertas.

---

## 4. Canal y entrega

### 4.1 In-app (Socket.IO + DB)

1. `alert_repository.create_alert()` persiste la alerta en DB
2. Llama `emit_alert_created()` → Socket.IO broadcast a la room de la obra
3. `useGlobalAlerts` en el frontend escucha `alert_created` y actualiza el estado global
4. Para `task_blocked` y `task_overdue` también dispara `CriticalAlertToast` (esquina inferior derecha, auto-dismiss 8s)

**Auto-resolve via Socket.IO:** cuando una condición se resuelve (ej: tarea desbloqueada), se llama `mark_read_by_task_and_fragment()` y luego `emit_alerts_resolved()` con `{taskId, obraId}`. `useGlobalAlerts` escucha `alerts_resolved` y marca como leídas en el estado local.

### 4.2 WhatsApp

`notification_service.py` envía mensajes WhatsApp para TASK_OVERDUE, NO_RESPONSE y reminders. La entrega respeta la ventana de envío de `SystemSettings`:

```python
# backend/app/services/calendar_service.py — usado por notification_service
def is_within_working_hours(calendar: WorkingCalendar, dt: datetime) -> bool:
    # Verifica día laboral + hora_from <= dt.hour < hora_to
    # Usa el calendario de la obra (WorkingCalendar)
```

### 4.3 Ventana de envío — problema de dos implementaciones paralelas

Existe **una segunda implementación** de ventana de envío en `message_service.py`:

```python
# backend/app/services/message_service.py — usado para respuestas del chatbot
def _within_send_window(hour_from: int, hour_to: int) -> bool:
    # Usa _current_ar_hour() = UTC + offset hardcodeado de Argentina
    # Tira de SystemSettings.send_hour_from / send_hour_to (por manager, no por obra)
```

**Diferencias entre las dos:**

| Característica | `is_within_working_hours` | `_within_send_window` |
|----------------|---------------------------|----------------------|
| Fuente del horario | `WorkingCalendar` de la obra | `SystemSettings` del manager |
| Timezone | Hereda de la obra | Offset fijo Argentina (UTC-3/UTC-2) |
| Días no laborales | Considera días de la semana | No considera |
| Usado por | `notification_service` (TASK_OVERDUE, NO_RESPONSE, reminders) | `message_service` (chatbot, mensajes WhatsApp salientes) |

Un mensaje de chatbot puede salir cuando el calendario de la obra dice que es día no laboral. Y la ventana del chatbot puede diferir de la configurada en el calendario de la obra. Esto puede causar comportamientos contradictorios difíciles de depurar.

---

## 5. Ciclo de vida

```
[Condición disparada]
       │
       ▼
create_alert() → is_read=False → DB + Socket.IO emit_alert_created()
       │
       ├──── Usuario marca leída manualmente
       │     PATCH /alerts/{id}/read
       │     PATCH /alerts/mark-all-read
       │
       └──── Auto-resolve (solo TASK_BLOCKED)
             mark_read_by_task_and_fragment() + emit_alerts_resolved()
             (cuando tarea deja de estar BLOCKED)
```

**Auto-resolve implementado:**
- TASK_BLOCKED: se auto-resuelve cuando la tarea cambia de estado (sale de BLOCKED)

**Sin auto-resolve:**
- TASK_OVERDUE: no se auto-resuelve si la tarea se completa o si la fecha se corrige
- DELAY_RISK: no se auto-resuelve si el responsable se asigna o la tarea se completa
- NO_RESPONSE: no se auto-resuelve si el responsable responde (fuera de la lógica `mark_no_response`)

Las alertas no leídas de TASK_OVERDUE/DELAY_RISK permanecen en el listado indefinidamente hasta que el usuario las marca manualmente.

---

## 6. Qué tiene sentido como está

**Motor híbrido (reactivo + periódico):** es la estrategia correcta para este sistema. El periódico cubre condiciones que emergen sin interacción del usuario (WhatsApp-only, tareas que se vencen de noche). El reactivo cubre condiciones que dependen del estado calculado al momento de la consulta.

**Deduplicación diferenciada:** usar `exists_unread_for_task()` para DELAY_RISK y `exists_for_task()` para TASK_OVERDUE/NO_RESPONSE refleja dos semánticas distintas y ambas son correctas. DELAY_RISK permite recurrencia cuando el usuario toma acción; TASK_OVERDUE/NO_RESPONSE evita spam en condiciones crónicas.

**Auto-resolve de TASK_BLOCKED:** es el caso más importante y está bien implementado. El patrón `mark_read_by_task_and_fragment()` con ILIKE es frágil en teoría pero pragmático dado el contexto.

**Socket.IO para create y resolve:** ambos eventos están propagados, lo que permite que el badge del header y el listado de alertas se actualicen en tiempo real sin polling.

**`useGlobalAlerts` centralizado:** un único hook en AppLayout mantiene el estado global de alertas de todo el tenant. `ObraDetailPage` usa adicionalmente `useAlertSocket` local para filtrar por obra. La doble suscripción no genera duplicados porque `ObraDetailPage` ya tiene `prev.some(a => a.id === alert.id)` antes de agregar.

**AlertBell con modo portfolio:** el parámetro `groupByObra` y el chip con nombre de obra en cada alerta es una UX feature bien pensada para cuando el usuario está en la vista de portfolio (sin obra seleccionada).

**CriticalAlertToast:** correctamente limitado a `task_blocked` y `task_overdue` (los dos tipos que requieren acción inmediata). El auto-dismiss de 8 segundos es suficiente para que el usuario lo lea.

---

## 7. Qué no tiene sentido, está a medias o no funciona

### 7.1 Cuatro campos `notify_*` en SystemSettings que el código ignora

`backend/app/models/settings.py` define:
```python
notify_task_overdue: Mapped[bool] = mapped_column(Boolean, default=True)
notify_task_blocked: Mapped[bool] = mapped_column(Boolean, default=True)
notify_no_response:  Mapped[bool] = mapped_column(Boolean, default=True)
notify_rescheduled:  Mapped[bool] = mapped_column(Boolean, default=True)
```

`notification_service.py` nunca lee ninguno de estos campos. `alert_service.py` tampoco. El usuario no puede desactivar notificaciones específicas aunque la UI de configuración presumiblemente muestre estos toggles. Son **dead configuration**.

### 7.2 DELAY_RISK solo se evalúa cuando alguien visita el tab Tareas

Si una obra lleva días sin que ningún usuario la abra, sus tareas pueden volverse vencidas, quedar sin responsable, o tener alta tasa de bloqueos, sin que se genere ninguna alerta. El motor reactivo solo funciona cuando hay tráfico. No hay job periódico que evalúe DELAY_RISK.

### 7.3 TASK_OVERDUE / DELAY_RISK no se auto-resuelven

Si una tarea vencida se completa (estado DONE), la alerta TASK_OVERDUE correspondiente queda `is_read=False` hasta que el usuario la marque manualmente. El badge del header permanece con el contador elevado. Lo mismo para DELAY_RISK: asignar un responsable a una tarea que generó alerta "sin responsable" no limpia esa alerta.

### 7.4 CriticalAlertToast pierde alertas si llegan rápido

`useGlobalAlerts` tiene un único estado `toastAlert: Alert | null`. Si llegan dos alertas críticas en rápida sucesión, la segunda sobreescribe a la primera. Solo se muestra la segunda.

```typescript
// useGlobalAlerts.ts:49-52
setAlerts(prev => [alert, ...prev]);
if (CRITICAL_TYPES.includes(alert.type)) {
    setToastAlert(alert);  // sobreescribe la anterior sin esperar dismiss
}
```

### 7.5 `mark_read_by_task_and_fragment()` sin tenant check

El auto-resolve en `alert_repository.py` filtra solo por `task_id` + `ILIKE` en el mensaje. No filtra por `tenant_id`. En la práctica es seguro porque solo se llama internamente desde `task_service` que ya validó permisos, pero es una inconsistencia frente al resto del módulo que sí filtra por tenant.

### 7.6 `list_all()` y `mark_all_read()` usan JOIN en lugar de la columna denormalizada

El modelo `Alert` tiene `tenant_id` denormalizado. Sin embargo:
- `list_all()` filtra con `JOIN a obras WHERE obras.tenant_id = ?`
- `mark_all_read()` idem

Mientras que `create_alert()` sí guarda `tenant_id` directamente en la alerta. La columna denormalizada existe pero no se usa para leer, solo para escribir. Inconsistencia que añade complejidad al JOIN sin beneficio claro.

### 7.7 Cualquier collaborator puede marcar alertas como leídas

Los tres endpoints de alertas usan `CurrentUser` (usuario autenticado del tenant), no `AdminUser`. Un colaborador puede marcar como leídas las alertas de alertas generadas para la obra aunque no sea quien debería actuar sobre ellas. No es necesariamente un bug, pero no está documentada la intención.

### 7.8 `useGlobalAlerts` carga todas las alertas del tenant sin paginación

Al montar la app, se llama `fetchAlerts()` sin filtro (ni por obra ni por unread). Con muchas obras y tiempo acumulado, esto puede retornar cientos de alertas. No hay límite ni paginación en la carga inicial global.

---

## 8. Mejoras propuestas

### P0 — Crítico

**8.1 Agregar auto-resolve para TASK_OVERDUE y DELAY_RISK**

En `task_service.update()` y `apply_status_update()`, cuando una tarea pasa a DONE o IN_PROGRESS:
```python
await alert_repo.mark_read_by_task_and_fragment(task.id, "vencida")
await alert_repo.mark_read_by_task_and_fragment(task.id, "responsable")
```
Y en `responsible_service` al asignar responsable a una tarea: resolver la alerta "sin responsable".

**8.2 Implementar `notify_*` fields o eliminarlos**

Elegir uno:
- A) Leer `settings.notify_task_overdue` en `mark_overdue_tasks()` antes de crear la alerta
- B) Eliminar los 4 campos del modelo + migración + UI (si la UI los muestra)

Dejar campos que el código ignora es deuda técnica que confunde.

### P1 — Importante

**8.3 Unificar las dos implementaciones de ventana de envío**

Crear una función central `is_within_send_window(db, manager_id, obra_id)` que use `SystemSettings.send_hour_from/to` con el timezone de la obra (desde `WorkingCalendar`). Reemplazar tanto `_within_send_window()` en `message_service` como `is_within_working_hours()` en el path de notificaciones.

**8.4 Evaluar DELAY_RISK periódicamente**

Agregar un job en `scheduler.py`:
```python
scheduler.add_job(
    _job_evaluate_delay_risk,
    CronTrigger(hour="*/4", minute=30, timezone=AR_TZ),
    ...
)
```
El job itera todas las obras activas y llama `AlertService(db).evaluate_task_risks_for_obra(obra_id)`.

**8.5 Cola de toasts en lugar de estado único**

En `useGlobalAlerts`:
```typescript
const [toastQueue, setToastQueue] = useState<Alert[]>([]);
// Al recibir alerta crítica: push a la queue
// CriticalAlertToast muestra el primero, al dismiss hace shift
```

### P2 — Menor

**8.6 Paginación en carga inicial de `useGlobalAlerts`**

Pasar `unread_only=true` en la carga inicial del hook global, o agregar un parámetro `limit` en `GET /alerts`. La campana del header solo muestra no-leídas de todos modos.

**8.7 Agregar tenant check en `mark_read_by_task_and_fragment()`**

```python
async def mark_read_by_task_and_fragment(self, task_id: int, fragment: str, tenant_id: int):
    stmt = (update(Alert)
        .where(Alert.task_id == task_id, Alert.tenant_id == tenant_id,
               Alert.message.ilike(f"%{fragment}%"))
        .values(is_read=True))
```

**8.8 Consistencia en filtrado de tenant**

Usar la columna `alert.tenant_id` en `list_all()` y `mark_all_read()` en lugar del JOIN, ya que el dato ya está denormalizado al crear la alerta.

---

## 9. Riesgos

| # | Riesgo | Probabilidad | Impacto | Archivo |
|---|--------|--------------|---------|---------|
| R1 | Los cuatro `notify_*` de Settings nunca se leen — el manager cree que desactivó notificaciones pero siguen llegando | Alta | Alto | `backend/app/models/settings.py`, `notification_service.py` |
| R2 | Obra sin visitas activas: DELAY_RISK nunca se evalúa aunque haya condiciones de riesgo reales | Media | Medio | `backend/app/api/routes/tasks.py:59` |
| R3 | Inconsistencia de ventana de envío entre chatbot y notificaciones: pueden salir mensajes fuera de horario en obras con calendario personalizado | Media | Medio | `message_service.py:_within_send_window` vs `calendar_service.py:is_within_working_hours` |
| R4 | TASK_OVERDUE acumuladas no leídas aunque la tarea esté completa: badge del header siempre elevado, usuario pierde confianza en el módulo | Alta | Medio | `task_service.py` (falta auto-resolve) |
| R5 | Dos alertas críticas simultáneas: la primera toast se pierde sin ser vista por el usuario | Baja | Bajo | `useGlobalAlerts.ts:50-52` |
| R6 | `mark_read_by_task_and_fragment()` sin tenant_id: vector teórico de cross-tenant si se expone en endpoint futuro | Baja | Alto | `backend/app/repositories/alert.py` |

---

## Apéndice — Mapa de archivos auditados

| Archivo | Rol |
|---------|-----|
| `backend/app/models/alert.py` | Modelo + enum AlertType |
| `backend/app/models/settings.py` | SystemSettings (incl. notify_* orphaned) |
| `backend/app/repositories/alert.py` | CRUD + deduplicación + auto-resolve + tenant filtering |
| `backend/app/services/alert_service.py` | evaluate_task_risks_for_obra() (reactivo) |
| `backend/app/services/notification_service.py` | Jobs periódicos (TASK_OVERDUE, NO_RESPONSE) |
| `backend/app/services/message_service.py` | _within_send_window() (chatbot) |
| `backend/app/services/calendar_service.py` | is_within_working_hours() (notificaciones) |
| `backend/app/services/task_service.py` | Disparo de TASK_BLOCKED, auto-resolve parcial |
| `backend/app/api/routes/alerts.py` | 3 endpoints (CurrentUser, no AdminUser) |
| `backend/app/api/routes/tasks.py:59` | Hook reactivo evaluate_task_risks_for_obra |
| `backend/app/core/scheduler.py` | APScheduler jobs (4 jobs relevantes) |
| `frontend/src/hooks/useGlobalAlerts.ts` | Estado global de alertas del tenant |
| `frontend/src/hooks/useAlertSocket.ts` | Suscripción socket.io por obra |
| `frontend/src/components/AlertBell.tsx` | Campanita header con badge y dropdown |
| `frontend/src/components/AlertasTab.tsx` | Vista tab por obra con filtros |
| `frontend/src/components/CriticalAlertToast.tsx` | Toast 8s para task_blocked/task_overdue |
| `frontend/src/api/alerts.ts` | fetchAlerts, markAlertRead, markAllAlertsRead |
