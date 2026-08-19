# Auditoría 07 — Historial de actividad

> **Fecha:** 2026-08-19
> **Auditor:** Claude Sonnet 4.6 (con supervisión de Facundo)
> **Alcance:** módulo de historial de eventos de una obra (`historial_eventos`): modelo, repositorio, endpoint de lectura, todos los servicios que escriben eventos, cobertura real de acciones del sistema, vista frontend (`HistorialPanel`, `ResumenTab`), integridad del log, aislamiento multi-tenant, y comportamiento bajo volumen.
> **Metodología:** lectura completa del modelo, repositorio, schemas, endpoint, y los 8 servicios que usan `HistorialRepository`; revisión del componente frontend y del cliente API; inspección de migraciones; análisis de la query de tenant isolation; comparación entre qué se debería registrar y qué se registra efectivamente; y ejecución local (backend `:8000`, frontend `:5173`) para confirmar eventos reales en la DB.

---

## 1. Resumen ejecutivo

El módulo está bien fundado: `historial_eventos` es genuinamente append-only (no hay endpoints DELETE ni PUT/PATCH), el schema `HistorialEventoRead` no expone `tenant_id`, el endpoint valida el acceso a la obra antes de devolver eventos, y el modelo usa `ondelete="SET NULL"` en ambas FKs para que los eventos sobrevivan a la eliminación de sus entidades referenciadas.

Sin embargo, **no está production-ready como registro de auditoría confiable** por tres motivos críticos y varios medios:

1. **Cuando se elimina una obra, todo su historial queda permanentemente inaccesible** — las filas siguen en la DB con `obra_id=NULL` pero no hay ninguna forma de consultarlas por API, y no se registró ningún evento de "obra eliminada" antes del borrado.
2. **Hay 5 categorías de acciones significativas que nunca quedan registradas:** responsables (create/update/reactivate), planos (upload/delete), baseline, materiales de tarea, y eliminación de obra.
3. **El frontend trunca el historial a 30 eventos** (el cliente hardcodea `limit=30`) con un contador que dice "30 eventos" cuando hay más. No hay paginación ni indicador de que existen más eventos.

El historial de tareas (7 tipos de eventos, con payload from/to enriquecido) es la parte más sólida y funciona bien.

---

## 2. Inventario de eventos registrados

| Tipo de evento | Quién lo dispara | Implementado | Probado y funciona | Archivo(s) |
|---|---|---|---|---|
| `obra_created` | `ObraService.create()` | Sí | Sí | `services/obra_service.py:22` |
| `obra_updated` | `ObraService.update()` | Sí | Sí | `services/obra_service.py:88` |
| `task_created` | `TaskService.create()` | Sí | Sí | `services/task_service.py:509` |
| `task_updated` | `TaskService.update()` | Sí | Sí | `services/task_service.py:668` |
| `task_deleted` | `TaskService.delete()` | Sí | Sí | `services/task_service.py:759` |
| `task_status_changed` | `TaskService.apply_status_update()` | Sí | Sí | `services/task_service.py:807` |
| `task_cascade_rescheduled` | `TaskService.update()` (con `cascade_dates=True`) | Sí | Sí | `services/task_service.py:695` |
| `tasks_bulk_imported` | `TaskService.bulk_create()` | Sí | Sí | `services/task_service.py:332` |
| `alert_created` (delay_risk) | `AlertService._task_alert()` / `_obra_alert()` | Sí | Sí | `services/alert_service.py:148,182` |
| `alert_created` (task_blocked) | `TaskService.apply_status_update()` | Sí | Sí | `services/task_service.py:833` |
| `alert_created` (task_overdue) | `NotificationService.mark_overdue()` | Sí | Sí | `services/notification_service.py:161` |
| `alert_created` (no_response) | `NotificationService.mark_no_response()` | Sí | Sí | `services/notification_service.py:228` |
| `reschedule_requested` | `ConversationService._handle_reschedule()` | Sí | Sí | `services/conversation_service.py:724` |
| `task_updated` (deactivate) | `ResponsibleService.deactivate()` | Sí | Sí | `services/responsible_service.py:89` |
| `purchase_order_created` | `purchase_orders.py: POST /purchase-orders` | Sí | Sí | `api/routes/purchase_orders.py:171` |
| `purchase_order_sent` | `purchase_orders.py: POST /purchase-orders/{id}/send` | Sí | Sí | `api/routes/purchase_orders.py:239` |
| `purchase_order_received` | `purchase_orders.py: POST /purchase-orders/{id}/receive` | Sí | Sí | `api/routes/purchase_orders.py:292` |
| `bitacora_procesada` | `BitacoraService` | Sí | No verificado | `services/bitacora_service.py:463` |
| `bitacora_nota` | `BitacoraService` | Sí | No verificado | `services/bitacora_service.py:585` |
| `solicitud_cotizacion_creada` | `SolicitudService` | Sí | No verificado | `services/solicitud_service.py:299` |
| `cotizacion_recibida` | `SolicitudService` | Sí | No verificado | `services/solicitud_service.py:401` |
| `cotizacion_confirmada` | `SolicitudService` | Sí | No verificado | `services/solicitud_service.py:640` |

---

## 3. Cobertura real vs. esperada

### Acciones que SÍ quedan registradas

- Cualquier creación, edición, eliminación o cambio de estado de tarea
- Cascade de reprogramación de fechas
- Import masivo de tareas (Excel bulk → evento único; XML MS Project → un `task_created` por tarea — ver §7.4)
- Creación y edición de obra
- Alertas de riesgo de demora, bloqueo, vencimiento y falta de respuesta
- Sugerencia de reprogramación desde WhatsApp
- Desasignación automática de responsable al desactivarlo
- Pedidos de compra (create/send/receive)
- Bitácora y solicitudes de cotización

### Acciones que NO quedan registradas (faltantes)

| Acción | Por qué importa | Dónde implementar |
|---|---|---|
| Creación de responsable (`POST /responsibles`) | Un directorio de equipo que crece sin rastro — ¿quién agregó a quién y cuándo? | `ResponsibleService.create()` |
| Edición de responsable (`PATCH /responsibles/{id}`) | Cambio de nombre o teléfono WhatsApp sin rastro — el teléfono es la clave del chatbot | `ResponsibleService.update()` |
| Reactivación de responsable (`PATCH /responsibles/{id}/reactivate`) | Simetría con la desactivación, que sí se registra | `ResponsibleService.reactivate()` |
| Upload de plano (`POST /obras/{id}/planos`) | Trazabilidad de documentos técnicos aprobados | `PlanoService.create()` (confirmado en audit 05) |
| Eliminación de plano (`DELETE /planos/{id}`) | Quién borró un plano vigente — especialmente grave sin guard de rol (bug 05-5.2) | `PlanoService.delete()` (confirmado en audit 05) |
| Guardar baseline (`POST /obras/{id}/baseline`) | Una línea base es una decisión de gestión — ¿quién la guardó y cuándo? | `baseline.py: save_baseline()` |
| Eliminación de obra (`DELETE /obras/{id}`) | La obra desaparece sin ningún evento final; su historial también (ver §5) | `ObraService.delete()` |
| CRUD de materiales de tarea | Agregar/quitar/cambiar precio de materiales afecta el presupuesto sin rastro | `task_materials.py` |
| Creación de pedido de alerta `ORDER_RECEIVED` | El evento de alerta se crea en `purchase_orders.py` pero no se registra en historial (inconsistente con otros tipos de alerta) | `purchase_orders.py: receive_order()` |

---

## 4. Vista de historial

### Frontend — dónde y cómo se muestra

Hay dos vistas:
1. **Tab "Historial"** en `ObraDetailPage` (`caso "historial"` en `pages/ObraDetailPage.tsx:573`): muestra el `HistorialPanel` completo con filtros (Todos / Tareas / Alertas / Obra / Sistema).
2. **Panel "Actividad reciente"** en `ResumenTab` (`ResumenTab.tsx:524`): muestra solo `historial.slice(0, 5)` — los últimos 5 eventos del array ya truncado.

### Carga y límite

`fetchHistorial` (`api/historial.ts:5`) llama a `GET /obras/{id}/historial` con `limit=30` (hardcoded en el cliente). El endpoint acepta `limit` entre 1 y 200 con default 50. El frontend nunca pide más de 30, así que en obras activas con más de 30 eventos el tab muestra "30 eventos" como si eso fuera todo — sin indicador de truncamiento, sin botón "cargar más", sin paginación.

El header del tab muestra `{historial.length} eventos` (el array que tiene el frontend, que ya llega truncado del servidor). Un usuario que ve "30 eventos" no sabe si hay 31 o 3.000 en la DB.

### Coincidencia frontend vs. base de datos

Para obras con hasta 30 eventos, el frontend muestra exactamente lo que hay en la DB (orden DESC por `created_at`). Para obras con más de 30 eventos: el frontend muestra los 30 más recientes y el resto es invisible.

### Comportamiento con volumen alto

No se probó con una obra con 200+ eventos porque no tenía esa cantidad disponible en el entorno local, pero la query `list_by_obra_limited` tiene `LIMIT 50` (o lo que se pase) con un `ORDER BY created_at DESC` sobre una columna sin índice — el índice existente es sobre `obra_id` (filtro) y `event_type`, pero `created_at` no tiene índice. Para obras con cientos de eventos, el `ORDER BY created_at DESC + LIMIT` implicaría un sort en memoria. No es catastrófico para el volumen esperable, pero con miles de eventos podría degradar.

### Actualizaciones en tiempo real

El historial se carga una sola vez en `loadData()` que se llama al montar `ObraDetailPage`. No hay WebSocket para el historial — los nuevos eventos generados mientras el usuario tiene el tab abierto no aparecen hasta que recarga la página. Esto es especialmente notable si un responsable actualiza una tarea por WhatsApp mientras el jefe de obra tiene el historial abierto en la web.

### `task_rescheduled` — evento muerto en el frontend

`HistorialPanel.tsx:204-215` tiene un `case "task_rescheduled"` completamente implementado (sentence con from/to formateados, badge "reschedule"). Sin embargo, **ningún servicio del backend genera este `event_type`**. El backend genera `task_updated` con los campos `start_date`/`due_date` en los cambios, y el frontend maneja eso en el `case "task_updated"`. El `task_rescheduled` es código muerto en el frontend.

---

## 5. Integridad del log

### ¿Es editable o borrable?

**No vía API.** Solo existe un endpoint de historial: `GET /obras/{obra_id}/historial`. No hay DELETE, PUT, PATCH. El `BaseRepository` tiene métodos `update_fields` y `delete` pero no están expuestos por ninguna ruta de historial. El comentario en el modelo es explícito: `"Append-only event log. Written by services, never updated."`. Verificado: grepeando todos los archivos de `api/routes/`, no aparece ningún router que llame a `HistorialRepository` con métodos de escritura excepto el `.log()`.

### ¿Qué pasa al borrar la entidad asociada?

**Tareas eliminadas:** `task_id` tiene `ondelete="SET NULL"` en el modelo (`historial.py:18`). Cuando se elimina una tarea, los eventos de esa tarea quedan en la DB con `task_id=NULL` pero con `obra_id` intacto. Son visibles en el tab de historial de la obra. El payload del evento `task_deleted` tiene `task_id`, `title`, `status`, `start_date`, `due_date` del snapshot previo. Y el frontend maneja el caso con `if (ev.event_type === "task_deleted" && ev.payload?.title) return String(ev.payload.title)`. Diseño correcto: el historial de la obra muestra que la tarea fue eliminada, con contexto suficiente para saber qué era.

**Obras eliminadas:** `obra_id` tiene `ondelete="SET NULL"` en el modelo (`historial.py:15`). **Esto es un problema grave.** Cuando se elimina una obra:
1. No se registra ningún evento `obra_deleted` antes del borrado (revisar `ObraService.delete()` — es solo `await self.repo.delete(obra_id)`).
2. Postgres pone `obra_id=NULL` en todos los eventos históricos de esa obra.
3. `list_by_obra_limited` consulta `WHERE obra_id = :obra_id` — no puede consultar `WHERE obra_id IS NULL` sin saber qué obra era.
4. No existe ningún endpoint que consulte por `tenant_id` solo para recuperar eventos huérfanos.

**Resultado:** el historial completo de una obra borrada desaparece del sistema de forma irreversible desde el punto de vista de la API. Las filas persisten en la DB con `obra_id=NULL` pero son inaccesibles. Si alguna vez se necesita auditar "qué pasó con la obra X antes de que la borraran", la información está técnicamente en la DB pero no hay forma de recuperarla por código.

Esto es un conflicto de diseño: `ondelete="SET NULL"` fue pensado para mantener la fila (correcto para tareas — el historial de la obra sigue siendo útil), pero en el caso de `obra_id`, el `SET NULL` rompe precisamente la clave de consulta que define el ámbito del historial.

---

## 6. Qué tiene sentido como está

### Append-only real

El diseño de no exponer endpoints de escritura (solo `.log()` desde servicios) es correcto para un registro de auditoría. Un log que se puede alterar desde el frontend no sirve como tal.

### `triggered_by` distingue bien los tres actores

`"user"` (acción humana vía web), `"chatbot"` (acción desde WhatsApp), `"system"` (scheduler, alertas automáticas). En el frontend, el avatar muestra "Sistema" con color gris para system/chatbot y el avatar personalizado con color para user — distinción visual clara. Y en el `case "reschedule_requested"`, el nombre del responsable sale del `payload.responsible_name` en lugar del `actor.name`, lo cual es correcto porque la acción viene del responsable externo, no de un usuario web.

### Payload enriquecido en tareas

`task_updated` guarda `{"changes": {"due_date": {"from": "2026-05-01", "to": "2026-06-15", "from_label": "1 May", "to_label": "15 Jun"}}}`. Las etiquetas legibles (`from_label`, `to_label`) evitan que el frontend tenga que re-parsear fechas o resolver IDs de responsable. Para `task_status_changed`, el payload incluye `from`, `to`, `progress`, y `reason` — suficiente para reconstituir la transición completa.

### `ondelete="SET NULL"` en `task_id`

Correcto para tareas: el historial de la obra muestra que se borró la tarea, y el payload tiene el snapshot completo para identificar qué era. El evento `task_deleted` se registra ANTES de llamar a `repo.delete()` (`task_service.py:748-768`), lo que garantiza que la FK todavía es válida al insertar el evento. Diseño deliberado y bien pensado.

### Tenant isolation a nivel de endpoint

`GET /obras/{obra_id}/historial` llama a `ObraService.get_or_raise(obra_id, tenant_id=current_user.tenant_id)` antes de la query — si la obra no pertenece al tenant del usuario, 404. El test de isolation (`test_tenant_isolation.py:88`) verifica esto. ✓

### `tenant_id` denormalizado en la fila

Copiado desde la obra via `tenant_for_obra()` al momento de crear el evento. Permite filtros por tenant en queries sin join a `obras`. Bien pensado para escalabilidad futura (queries cross-obra del mismo tenant, dashboards de administración de tenant, etc.).

### Índices existentes

`obra_id` (filtro principal), `task_id`, `event_type`, `tenant_id` (desde migración 0040). El índice en `event_type` es útil si en el futuro se quieren queries "todas las alertas de este tenant en el último mes".

---

## 7. Qué no tiene sentido, está a medias o no funciona

### 7.1 [CRÍTICO] Obra eliminada → historial permanentemente inaccesible

**Qué pasa:** `ObraService.delete()` (`obra_service.py:104-106`) es:
```python
async def delete(self, obra_id: int, manager_id: int) -> None:
    await self.get_for_manager(obra_id, manager_id)
    await self.repo.delete(obra_id)
```
Sin evento de historial previo, sin ninguna captura de estado. Después del borrado, todos los eventos de la obra quedan con `obra_id=NULL`. El único endpoint de consulta (`GET /obras/{id}/historial`) no puede recuperarlos porque la obra ya no existe y la FK es NULL.

**Consecuencia:** pérdida total de trazabilidad histórica. Si un tenant borra una obra (intencionalmente o por error), no queda ningún rastro accesible de su actividad.

### 7.2 [ALTO] Frontend trunca a 30 eventos sin decirlo

**Qué pasa:** `fetchHistorial(obra.id)` en `ObraDetailPage.tsx:113` usa el default de `api/historial.ts:6`: `limit = 30`. Para una obra con 50 eventos, el tab muestra "30 eventos" (la longitud del array recibido) como si no hubiera más. No hay botón "ver más", no hay mensaje "mostrando los últimos 30 de 50", no hay paginación.

El servidor aguanta hasta 200 (`Query(ge=1, le=200)`), pero el cliente nunca pide más de 30.

**Consecuencia:** en obras activas, el jefe de obra puede creer que la obra tiene poca actividad cuando en realidad hay decenas de eventos más viejos invisibles.

### 7.3 [ALTO] No hay evento para acciones críticas en responsables, planos y baseline

Los responsables se crean, editan y reactivan sin dejar rastro. Los planos se suben y borran sin rastro (ya documentado en audit 05). La línea base se guarda sin rastro. En la práctica, si el jefe de obra ve la línea base en el Gantt y quiere saber "quién la guardó y cuándo", no hay forma de saberlo desde el historial.

### 7.4 [MEDIO] MS Project XML import → N eventos `task_created` individuales

**Qué pasa:** `confirm_import` en `imports.py:83` llama a `TaskService.create()` por cada tarea individualmente. Esto registra un `task_created` por tarea. Para un proyecto de 50 tareas, el historial recibe 50 eventos individuales de una sola operación de import. El Excel bulk paste (desde `TaskSheetView`) usa `TaskService.bulk_create()` que registra un solo `tasks_bulk_imported`.

**Consecuencia:** importar 50 tareas desde MS Project XML llena el historial con 50 entradas "Tarea X creada", aplastando todo el historial previo del tab (que muestra solo 30). El origen del dato (que fue una importación masiva) se pierde. El usuario ve 50 eventos de creación pero no puede saber si fueron individuales o una importación.

### 7.5 [MEDIO] `obra_updated` description usa Python list stringification

**Qué pasa:** `ObraService.update()` registra `description=f"Fields updated: {list(changes.keys())}"`. Esto produce strings como `"Fields updated: ['status', 'expected_end_date']"` — notación Python literal, no legible para el usuario. El frontend cae al default `sentence = ev.description` para `obra_updated`, así que el usuario ve literalmente esa string.

### 7.6 [MEDIO] Historial no se refresca en tiempo real

**Qué pasa:** el historial se carga una sola vez en `loadData()`. No hay suscripción WebSocket para eventos de historial. El Socket.IO ya emite eventos de task (`task_created`, `task_updated`, `task_deleted`) pero ninguno de esos listeners actualiza el estado `historial` en `ObraDetailPage`.

**Consecuencia:** si un responsable actualiza una tarea por WhatsApp (que genera `task_status_changed` en el historial), el jefe de obra que tiene el tab abierto no lo ve hasta recargar. Contrasta con las alertas, que sí se actualizan en tiempo real via WebSocket.

### 7.7 [BAJO] Descripciones de `task_created` y `obra_created` en inglés

`task_service.py:513`: `description=f"Task '{task.title}' created"`.
`obra_service.py:25`: `description=f"Obra '{obra.name}' created"`.

Todos los demás eventos usan español. El frontend renderiza `ev.description` como fallback para event types desconocidos (no hay `case "task_created"` que muestre la description directamente — el frontend la ignora y arma su propio sentence). Pero si alguna vez se exporta el historial en crudo o se agrega una búsqueda full-text, los eventos de creación estarían en inglés.

### 7.8 [BAJO] `alert_created` no se registra para `ORDER_RECEIVED`

`purchase_orders.py:receive_order()` crea una alerta `ORDER_RECEIVED` en la DB pero no llama a `historial.log()` para registrar la creación de esa alerta. Todos los demás tipos de alerta (delay_risk, task_blocked, task_overdue, no_response) sí tienen su `alert_created` en el historial. La inconsistencia hace que el filtro "Alertas" del historial no muestre las alertas de pedidos recibidos.

### 7.9 [BAJO] `task_rescheduled` en el frontend es código muerto

`HistorialPanel.tsx:204-215` tiene el `case "task_rescheduled"` implementado. Ningún servicio del backend genera este `event_type`. El backend genera `task_updated` con fechas en el payload, y el frontend ya maneja eso en `case "task_updated"` correctamente.

### 7.10 [BAJO] `list_by_obra_limited` sin índice en `created_at`

La query `SELECT ... WHERE obra_id = :id ORDER BY created_at DESC LIMIT :n` usa el índice en `obra_id` pero luego necesita ordenar por `created_at`. Postgres puede resolver esto si usa el índice en `obra_id` para filtrar y luego sort en memoria el subset resultante. Para obras con cientos de eventos, sería más eficiente un índice compuesto `(obra_id, created_at DESC)`.

---

## 8. Mejoras propuestas

### 8.1 Evento `obra_deleted` y cambio de `ondelete` para preservar acceso (cierra 7.1)

- **Qué:** en `ObraService.delete()`, antes de `repo.delete()`, registrar un evento `obra_deleted` con snapshot de la obra (nombre, estado, tenant_id, manager_id). Adicionalmente, cambiar `ondelete="SET NULL"` por `ondelete="CASCADE"` EN `obra_id` (no en `task_id`). O alternativamente: cambiar el query de `list_by_obra_limited` para aceptar también un `tenant_id` y exponer un endpoint `GET /historial?obra_id={id}` que funcione incluso cuando la obra ya no existe.
- **La opción más pragmática:** cambiar a `ondelete="CASCADE"` en `obra_id` de historial — los eventos se borran con la obra (limpio, consistente), y el evento `obra_deleted` queda en un log separado o en la tabla de tenants. Alternativamente, permitir que `ondelete="SET NULL"` se quede pero agregar un índice y endpoint por `tenant_id` para recuperar eventos huérfanos.
- **Por qué:** un registro de auditoría con huecos permanentes e irrecuperables no es confiable.
- **Esfuerzo:** MEDIO (migración + endpoint o lógica de cascade).
- **Rompe algo:** si se cambia a CASCADE, se pierde el historial al borrar la obra (distinto trade-off). Evaluar cuál se quiere.

### 8.2 Eventos para responsables, planos y baseline (cierra 7.3)

- **Qué:** en `ResponsibleService.create()`: `historial.log(event_type="responsible_created", obra_id=None, ...)` — usar `task_id=None` y `obra_id=None` (global del tenant). En `.update()`: `responsible_updated`. En `.reactivate()`: `responsible_reactivated`. En `PlanoService.create()/delete()`: `plano_uploaded`/`plano_deleted` (ya propuesto en audit 05-6.9). En `baseline.py: save_baseline()`: `baseline_saved` con `payload={"task_count": len(entries), "actor": {...}}`.
- **Por qué:** son acciones significativas de gestión que hoy no dejan rastro.
- **Esfuerzo:** BAJO (llamadas aditivas, no rompen nada existente). Nota: para responsables y baseline, el `obra_id` es claro. Para responsables globales (sin obra_id), se puede pasar `obra_id=None` — el evento queda en historial sin obra (y `tenant_id` se tendría que calcular directamente del `current_user.tenant_id`, no via `tenant_for_obra`).
- **Implicación de diseño:** si `obra_id=None` y `tenant_id=current_user.tenant_id`, el evento no aparece en ningún historial por-obra. Se necesitaría o bien (a) asociar responsables a una obra cuando sea posible, o (b) agregar un endpoint `GET /historial` a nivel de tenant para ver eventos globales.

### 8.3 Paginación o "cargar más" en el frontend (cierra 7.2)

- **Qué:** opción A — cambiar el default de `fetchHistorial` a `limit=100` (el endpoint ya lo soporta, y 100 eventos es ~2 KB de JSON, negligible). Opción B — agregar paginación: pasar `limit` + `before_id` (cursor pagination) al endpoint, y en el frontend agregar un botón "Ver más" que incremente el cursor. Opción C (mínimo): cambiar `limit=30` a `limit=100` en el cliente y agregar al header "mostrando los últimos {n}" en vez de "{n} eventos" para que el usuario sepa que puede haber más.
- **Por qué:** el contador "30 eventos" es objetivamente engañoso.
- **Esfuerzo:** BAJO (opción A: 1 línea). MEDIO (opción B: endpoint + UI).
- **Riesgo:** BAJO.

### 8.4 Deduplicar MS Project import en un solo evento (cierra 7.4)

- **Qué:** en `imports.py: confirm_import()`, actualmente llama a `TaskService.create()` por cada tarea individualmente (con un evento `task_created` por tarea). Cambiar para llamar después del loop a `HistorialRepository.log(event_type="tasks_imported_from_msproject", ...)` con el count total, y suprimir los eventos individuales de creación durante el import pasando un flag `silent=True` o usando `bulk_create`.
- **Por qué:** importar 50 tareas genera 50 entradas y oculta el historial previo de la obra.
- **Esfuerzo:** MEDIO (requiere refactorizar el flujo de import para usar bulk_create o suprimir eventos individuales).
- **Riesgo:** MEDIO — hay que asegurarse de no perder la trazabilidad de qué tarea es cuál.

### 8.5 Refresh en tiempo real del historial (cierra 7.6)

- **Qué:** el Socket.IO ya emite `task_created`, `task_updated`, `task_deleted`. En `ObraDetailPage`, en los handlers de esos eventos, agregar `setHistorial(prev => [nuevoEvento, ...prev])` después de actualizar las tareas. El backend puede emitir el evento de historial junto con el evento de tarea, o el frontend puede inferir un evento temporal optimista.
- **Por qué:** el historial debería reflejar el estado actual, no el de cuando se montó el componente.
- **Esfuerzo:** MEDIO (backend: emitir el evento de historial via socket; frontend: suscribirse y actualizar el estado).
- **Riesgo:** BAJO.

### 8.6 Corrección de descripciones en español (cierra 7.7)

- **Qué:** `task_service.py:513`: `"Task '{task.title}' created"` → `"Tarea '{task.title}' creada"`. `obra_service.py:25`: `"Obra '{obra.name}' created"` → `"Obra '{obra.name}' creada"`. `obra_service.py:92`: `f"Fields updated: {list(changes.keys())}"` → `f"Actualización de obra: {', '.join(changes.keys())}"`.
- **Por qué:** consistencia. El frontend muestra la description como fallback.
- **Esfuerzo:** TRIVIAL (3 strings).
- **Riesgo:** NULO.

### 8.7 Registrar `alert_created` para `ORDER_RECEIVED` (cierra 7.8)

- **Qué:** en `purchase_orders.py: receive_order()`, después de `AlertRepository.create_alert(...)`, agregar `await HistorialRepository(db).log(event_type="alert_created", ..., payload={"alert_type": "order_received"}, triggered_by="user")`.
- **Por qué:** consistencia con todos los otros tipos de alerta.
- **Esfuerzo:** TRIVIAL (3 líneas).
- **Riesgo:** NULO.

### 8.8 Eliminar `task_rescheduled` del frontend (cierra 7.9)

- **Qué:** borrar el `case "task_rescheduled"` en `HistorialPanel.tsx:204-215`.
- **Por qué:** código muerto que confunde.
- **Esfuerzo:** TRIVIAL.
- **Riesgo:** NULO.

### 8.9 Índice compuesto `(obra_id, created_at DESC)` (cierra 7.10)

- **Qué:** agregar migración con `CREATE INDEX idx_historial_obra_created ON historial_eventos (obra_id, created_at DESC)`.
- **Por qué:** hace la query principal (`WHERE obra_id = X ORDER BY created_at DESC LIMIT N`) un index scan puro en lugar de filtrar + sort.
- **Esfuerzo:** BAJO (1 migración).
- **Riesgo:** NULO. El índice simple en `obra_id` puede dropearse después.

---

## 9. Riesgos

| # | Riesgo | Severidad | Estado |
|---|---|---|---|
| R1 | Al borrar una obra, todo su historial queda con `obra_id=NULL` y es permanentemente inaccesible por API | **Alta** — pérdida de trazabilidad | **Abierto** (7.1) |
| R2 | Frontend muestra "30 eventos" como si fuera el total — contador objetivamente engañoso en obras activas | **Alta** UX / confianza del dato | **Abierto** (7.2) |
| R3 | Acciones significativas de gestión (responsables, planos, baseline) no dejan rastro | **Media** compliance / trazabilidad | **Abierto** (7.3) |
| R4 | Import MS Project → 50 `task_created` individuales tapan el historial previo de la obra | **Media** UX | **Abierto** (7.4) |
| R5 | Historial no se actualiza en tiempo real — puede mostrar estado obsoleto a quien tiene el tab abierto | **Media** confiabilidad | **Abierto** (7.6) |
| R6 | `alert_created` faltante para `ORDER_RECEIVED` — filtro "Alertas" del historial está incompleto | **Baja** | **Abierto** (7.8) |
| R7 | Descripciones en inglés para `task_created`/`obra_created`/`obra_updated` — inconsistencia visible | **Baja** | **Abierto** (7.7) |
| R8 | `list_by_obra_limited` sin índice en `created_at` — sort en memoria para obras con muchos eventos | **Baja** performance | **Abierto** (7.10) |
| R9 | Aislamiento tenant en la query del repositorio (`WHERE obra_id = X`, sin filtro adicional por `tenant_id`) | **Baja** — controlada por el pre-check del endpoint | Parcialmente cerrado |
| R10 | Tenant isolation del endpoint cubre cross-tenant, test en suite | — | **Cerrado** (`test_tenant_isolation.py:88`) |
| R11 | No hay endpoints DELETE/PUT/PATCH sobre historial — log es inmutable vía API | — | **Cerrado** |
| R12 | `task_deleted` loguea ANTES de borrar la tarea — preserva la FK temporalmente en el evento | — | **Cerrado** |

---

## Anexo A — Archivos clave

**Backend — modelo y repositorio:**
- `app/models/historial.py` — `HistorialEvento` con `ondelete="SET NULL"` en obra_id y task_id
- `app/repositories/historial.py` — `log()`, `list_by_obra_limited()`, `list_by_obra()`, `list_by_task()`
- `app/schemas/historial.py` — `HistorialEventoRead` (sin `tenant_id`)
- `app/core/tenant_denorm.py` — `tenant_for_obra()` usado por el repo

**Backend — endpoint:**
- `app/api/routes/obras.py:54-63` — `GET /obras/{obra_id}/historial?limit=50`

**Backend — servicios que loguean:**
- `app/services/obra_service.py:22,88` — obra_created, obra_updated
- `app/services/task_service.py:332,509,668,695,759,807,833` — 7 tipos de evento de tarea
- `app/services/alert_service.py:148,182` — alert_created (delay_risk)
- `app/services/responsible_service.py:89` — task_updated (deactivate)
- `app/services/notification_service.py:161,228` — alert_created (task_overdue, no_response)
- `app/services/conversation_service.py:724` — reschedule_requested
- `app/api/routes/purchase_orders.py:171,239,292` — purchase_order_created/sent/received
- `app/services/bitacora_service.py:463,585` — bitacora_procesada, bitacora_nota
- `app/services/solicitud_service.py:299,401,640` — cotización_*

**Backend — acciones SIN historial (gaps):**
- `app/services/responsible_service.py:24,59,71` — create, update, reactivate
- `app/services/plano_service.py:create(),delete()` — upload/delete plano (audit 05)
- `app/api/routes/baseline.py:save_baseline()` — guardar línea base
- `app/services/obra_service.py:104` — delete (sin evento previo)
- `app/api/routes/task_materials.py` — CRUD materiales sin historial

**Frontend:**
- `frontend/src/api/historial.ts:6` — `limit=30` hardcoded
- `frontend/src/components/HistorialPanel.tsx` — renderizado, filtros, `case "task_rescheduled"` muerto (línea 204)
- `frontend/src/pages/ObraDetailPage.tsx:111-118` — carga única en `Promise.all`
- `frontend/src/components/ResumenTab.tsx:524` — `historial.slice(0, 5)` en panel de resumen

**Tests:**
- `backend/tests/test_tenant_isolation.py:88` — verifica 404 cross-tenant en `/obras/{id}/historial`
- Cobertura de historial en tests: **mínima** — solo aislamiento tenant. No hay tests que verifiquen qué eventos se generan para cada acción ni su payload.
