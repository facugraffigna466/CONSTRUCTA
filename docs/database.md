# Base de datos — CONSTRUCTA

Última actualización: 2026-04-27  
Motor: PostgreSQL (async via SQLAlchemy + asyncpg)  
Migraciones: Alembic (`0001_initial` → `0002_messages` → `0003_alerts`)

---

## Índice

1. [Diagrama de entidades](#diagrama-de-entidades)
2. [Entidades](#entidades)
   - [users](#users)
   - [responsibles](#responsibles)
   - [obras](#obras)
   - [tasks](#tasks)
   - [messages](#messages)
   - [alerts](#alerts)
   - [historial_eventos](#historial_eventos)
3. [Relaciones](#relaciones)
4. [ENUMs](#enums)
5. [Reglas de negocio críticas](#reglas-de-negocio-críticas)

---

## Diagrama de entidades

```
users ──< obras ──< tasks >── responsibles
                     │              │
                     ├──< messages <┘
                     ├──< alerts
                     └──< historial_eventos
obras ──< alerts
obras ──< historial_eventos
tasks ──< tasks (depends_on_id, self-referencia)
```

---

## Entidades

---

### users

Tabla de autenticación. Un user es el manager de sus obras.  
No se expone al frontend más allá del token JWT.

| Columna | Tipo | Nullable | Restricciones | Descripción |
|---|---|---|---|---|
| `id` | INTEGER | NO | PK | Auto-incremental |
| `email` | VARCHAR(255) | NO | UNIQUE, INDEX | Email de login |
| `hashed_password` | VARCHAR(255) | NO | — | bcrypt hash |
| `full_name` | VARCHAR(255) | NO | — | Nombre visible |
| `is_active` | BOOLEAN | NO | default: true | Soft-disable de cuenta |
| `created_at` | TIMESTAMPTZ | NO | — | UTC |

**Índices:**
- `ix_users_email` UNIQUE

**Relaciones salientes:**
- `obras` → un user puede tener muchas obras (`manager_id`)

---

### responsibles

Responsables de tareas. Su `whatsapp_number` es la identidad para el chatbot (Fase 2).  
Soft delete: nunca se borran, se desactivan con `is_active = false`.

| Columna | Tipo | Nullable | Restricciones | Descripción |
|---|---|---|---|---|
| `id` | INTEGER | NO | PK | Auto-incremental |
| `full_name` | VARCHAR(255) | NO | — | Nombre completo |
| `whatsapp_number` | VARCHAR(20) | NO | UNIQUE, INDEX | Formato E.164: `+5491112345678` |
| `role` | VARCHAR(100) | SÍ | — | Ej: "Capataz", "Electricista" |
| `is_active` | BOOLEAN | NO | default: true | Soft delete |
| `created_at` | TIMESTAMPTZ | NO | — | UTC |
| `updated_at` | TIMESTAMPTZ | NO | — | Auto-actualiza en cada UPDATE |

**Índices:**
- `ix_responsibles_whatsapp_number` UNIQUE

**Relaciones salientes:**
- `tasks` → puede estar asignado a muchas tareas
- `messages` → recibe/envía mensajes de WhatsApp

**Reglas:**
- `whatsapp_number` NO es editable después de la creación (es la clave del chatbot)
- Al desactivar un responsible, todas sus tareas activas quedan `responsible_id = NULL` en la misma transacción
- Solo responsibles activos pueden asignarse a tareas nuevas o editadas

---

### obras

Proyecto de construcción. Unidad principal de trabajo.

| Columna | Tipo | Nullable | Restricciones | Descripción |
|---|---|---|---|---|
| `id` | INTEGER | NO | PK | Auto-incremental |
| `name` | VARCHAR(255) | NO | — | Nombre de la obra |
| `description` | TEXT | SÍ | — | Descripción larga |
| `location` | VARCHAR(500) | SÍ | — | Dirección o referencia |
| `status` | ENUM `obra_status` | NO | default: `planificada` | Ver ENUMs |
| `start_date` | DATE | SÍ | — | Fecha de inicio planificada |
| `expected_end_date` | DATE | SÍ | — | Fecha de fin esperada |
| `actual_end_date` | DATE | SÍ | — | Fecha real de finalización |
| `manager_id` | INTEGER | NO | FK → users.id RESTRICT | Dueño de la obra |
| `created_at` | TIMESTAMPTZ | NO | — | UTC |
| `updated_at` | TIMESTAMPTZ | NO | — | Auto-actualiza |

**Índices:**
- `ix_obras_manager_id`

**Restricción FK:**
- `manager_id` → `users.id` ON DELETE **RESTRICT** (no se puede borrar un user con obras)

**Relaciones salientes:**
- `tasks` → cascade delete (si se borra la obra, se borran sus tareas)
- `historial_eventos` → ON DELETE SET NULL (el historial queda huérfano pero no se borra)
- `alerts` → ON DELETE SET NULL

**Validaciones de negocio:**
- `expected_end_date >= start_date`
- `actual_end_date >= start_date`
- Un manager solo puede ver/editar sus propias obras

---

### tasks

Tarea dentro de una obra. Estado controlado por el chatbot, no por el usuario.

| Columna | Tipo | Nullable | Restricciones | Descripción |
|---|---|---|---|---|
| `id` | INTEGER | NO | PK | Auto-incremental |
| `obra_id` | INTEGER | NO | FK → obras.id CASCADE | Obra propietaria |
| `responsible_id` | INTEGER | SÍ | FK → responsibles.id SET NULL | Responsable asignado |
| `title` | VARCHAR(255) | NO | — | Título (mín 2 chars) |
| `description` | TEXT | SÍ | — | Detalle opcional |
| `status` | ENUM `task_status` | NO | default: `pendiente` | Ver ENUMs (solo chatbot puede cambiar) |
| `estimated_progress` | INTEGER | NO | default: 0, 0–100 | % de avance (solo chatbot actualiza) |
| `start_date` | DATE | SÍ | — | Inicio planificado |
| `due_date` | DATE | SÍ | — | Fecha de vencimiento |
| `completed_date` | DATE | SÍ | — | Fecha real de completado (solo chatbot) |
| `order_index` | INTEGER | NO | default: 0, ≥ 0 | Orden de visualización en Gantt |
| `depends_on_id` | INTEGER | SÍ | FK → tasks.id SET NULL | Dependencia (misma obra) |
| `created_at` | TIMESTAMPTZ | NO | — | UTC |
| `updated_at` | TIMESTAMPTZ | NO | — | Auto-actualiza |

**Índices:**
- `ix_tasks_obra_id`
- `ix_tasks_responsible_id`
- `ix_tasks_depends_on_id`

**Restricciones FK:**
- `obra_id` → ON DELETE **CASCADE**
- `responsible_id` → ON DELETE **SET NULL**
- `depends_on_id` → ON DELETE **SET NULL** (auto-referencial, misma tabla)

**Transiciones de estado válidas** (solo chatbot/sistema):
```
pendiente   → en_progreso | cancelada
en_progreso → bloqueada | en_revision | cancelada
bloqueada   → en_progreso | cancelada
en_revision → en_progreso | completada | cancelada
completada  → (terminal)
cancelada   → (terminal)
```

**Campos editables por el usuario** (vía PATCH /tasks/{id}):
- `title`, `description`, `responsible_id`, `start_date`, `due_date`, `order_index`, `depends_on_id`

**Campos NO editables por usuario:**
- `status`, `estimated_progress`, `completed_date` (solo chatbot vía `TaskStatusUpdate`)

**Validaciones:**
- `due_date >= start_date` (si ambos presentes en el payload)
- `responsible_id` debe apuntar a un responsible activo
- `depends_on_id` debe ser de la misma obra y no puede auto-referenciar

---

### messages

Mensajes de WhatsApp entre el sistema y los responsibles. Solo para Fase 2 (chatbot).  
No existe endpoint público de escritura — se populan desde el webhook de Twilio.

| Columna | Tipo | Nullable | Restricciones | Descripción |
|---|---|---|---|---|
| `id` | INTEGER | NO | PK | Auto-incremental |
| `responsible_id` | INTEGER | SÍ | FK → responsibles.id SET NULL | Quién envía/recibe |
| `task_id` | INTEGER | SÍ | FK → tasks.id SET NULL | Tarea relacionada |
| `direction` | ENUM `message_direction` | NO | — | `inbound` / `outbound` |
| `channel` | ENUM `message_channel` | NO | default: `whatsapp` | Siempre `whatsapp` por ahora |
| `message_type` | ENUM `message_type` | NO | default: `text` | `text` / `audio` / `image` / `unknown` |
| `processing_status` | ENUM `message_processing_status` | NO | default: `pending` | `pending` / `processed` / `failed` |
| `from_number` | VARCHAR(30) | NO | — | Número E.164 origen |
| `to_number` | VARCHAR(30) | NO | — | Número E.164 destino |
| `body` | TEXT | SÍ | — | Texto del mensaje |
| `media_url` | VARCHAR(500) | SÍ | — | URL de audio/imagen (Twilio) |
| `transcription` | TEXT | SÍ | — | Transcripción de audio (Whisper, Fase 3) |
| `ai_interpretation` | JSON | SÍ | — | Resultado del modelo Claude (Fase 3) |
| `external_message_id` | VARCHAR(64) | SÍ | UNIQUE | Twilio `MessageSid` — idempotencia |
| `raw_payload` | JSON | SÍ | — | Payload completo de Twilio (debug) |
| `created_at` | TIMESTAMPTZ | NO | — | UTC |

**Índices:**
- `ix_messages_responsible_id`
- `ix_messages_task_id`
- `ix_messages_external_message_id` UNIQUE
- `ix_messages_direction_status` (direction, processing_status) — hot path de la IA

**Sin `updated_at`** — los mensajes son inmutables una vez creados.

---

### alerts

Alertas automáticas generadas por el sistema al evaluar riesgos.  
Se generan en cada `GET /tasks/obra/{id}` (no en background).

| Columna | Tipo | Nullable | Restricciones | Descripción |
|---|---|---|---|---|
| `id` | INTEGER | NO | PK | Auto-incremental |
| `obra_id` | INTEGER | SÍ | FK → obras.id SET NULL | Obra afectada |
| `task_id` | INTEGER | SÍ | FK → tasks.id SET NULL | Tarea afectada (NULL = alerta de obra) |
| `type` | ENUM `alert_type` | NO | INDEX | `task_blocked` / `delay_risk` |
| `message` | TEXT | NO | — | Texto descriptivo |
| `is_read` | BOOLEAN | NO | default: false, INDEX | Estado de lectura |
| `created_at` | TIMESTAMPTZ | NO | — | UTC |

**Índices:**
- `ix_alerts_obra_id`
- `ix_alerts_task_id`
- `ix_alerts_type`
- `ix_alerts_is_read`

**Deduplicación:** antes de insertar, se verifica que no exista una alerta sin leer con el mismo `(task_id, type, message)` o `(obra_id, NULL task_id, type, message)`.

**Alertas nivel tarea** (`task_id NOT NULL`):
- `delay_risk` — tarea vencida (`due_date < hoy` y status activo)
- `delay_risk` — tarea sin responsable (activa)
- `task_blocked` — tarea bloqueada (generado también en cambio de status)
- `delay_risk` — progreso inconsistente (status activo pero `estimated_progress = 100`)

**Alertas nivel obra** (`task_id NULL`):
- `task_blocked` — ≥ 3 tareas bloqueadas simultáneamente
- `delay_risk` — ≥ 30% de las tareas activas vencidas

---

### historial_eventos

Log append-only de toda actividad del sistema. Nunca se modifica ni se borra.

| Columna | Tipo | Nullable | Restricciones | Descripción |
|---|---|---|---|---|
| `id` | INTEGER | NO | PK | Auto-incremental |
| `obra_id` | INTEGER | SÍ | FK → obras.id SET NULL | Obra afectada |
| `task_id` | INTEGER | SÍ | FK → tasks.id SET NULL | Tarea afectada (si aplica) |
| `event_type` | VARCHAR(100) | NO | INDEX | Ver valores abajo |
| `description` | TEXT | NO | — | Texto legible del evento |
| `payload` | JSON | SÍ | — | Campos cambiados (ISO strings, nunca date objects) |
| `triggered_by` | VARCHAR(50) | NO | default: `system` | `user` / `chatbot` / `system` |
| `created_at` | TIMESTAMPTZ | NO | — | UTC |

**Índices:**
- `ix_historial_eventos_obra_id`
- `ix_historial_eventos_task_id`
- `ix_historial_eventos_event_type`

**Valores de `event_type`:**

| Valor | Quién | Cuándo |
|---|---|---|
| `obra_created` | user | Al crear una obra |
| `obra_updated` | user | Al editar campos de la obra |
| `task_created` | user | Al crear una tarea |
| `task_updated` | user | Al editar campos de la tarea (incluye reprogramación Gantt) |
| `task_status_changed` | chatbot / system | Al cambiar el status vía pipeline |
| `task_updated` (responsible) | user | Al desactivar un responsible (unassign masivo) |

**Formato del `payload`:**
```json
// task_updated (fechas)
{ "start_date": "2025-03-01", "due_date": "2025-06-30" }

// task_status_changed
{ "from": "pendiente", "to": "en_progreso", "progress": 20, "reason": "..." }

// task_updated (responsible desactivado)
{ "field": "responsible_id", "from": 5, "to": null, "reason": "responsible_deactivated" }
```

> **Nota:** el `payload` siempre usa valores JSON-serializables (fechas como ISO strings, enums como strings). Nunca se almacenan objetos Python `date` directamente.

---

## Relaciones

```
users (1) ──── (N) obras
               manager_id → users.id  [RESTRICT]

obras (1) ──── (N) tasks
               obra_id → obras.id  [CASCADE DELETE]

responsibles (1) ──── (N) tasks
                       responsible_id → responsibles.id  [SET NULL]

tasks (1) ──── (N) tasks   ← auto-referencia (dependencias)
               depends_on_id → tasks.id  [SET NULL]

tasks (1) ──── (N) messages
               task_id → messages.id  [SET NULL]

responsibles (1) ──── (N) messages
                       responsible_id → messages.id  [SET NULL]

obras (1) ──── (N) alerts
               obra_id → alerts.id  [SET NULL]

tasks (1) ──── (N) alerts
               task_id → alerts.id  [SET NULL]

obras (1) ──── (N) historial_eventos
               obra_id → historial_eventos.id  [SET NULL]

tasks (1) ──── (N) historial_eventos
               task_id → historial_eventos.id  [SET NULL]
```

---

## ENUMs

### `obra_status`

| Valor | Descripción |
|---|---|
| `planificada` | Obra creada, no iniciada |
| `en_progreso` | En ejecución |
| `pausada` | Suspendida temporalmente |
| `completada` | Finalizada exitosamente |
| `cancelada` | Cancelada |

### `task_status`

| Valor | Descripción | Terminal |
|---|---|---|
| `pendiente` | Esperando inicio | No |
| `en_progreso` | En ejecución activa | No |
| `bloqueada` | Impedida por algún obstáculo | No |
| `en_revision` | Terminada, esperando aprobación | No |
| `completada` | Aprobada y cerrada | **Sí** |
| `cancelada` | Descartada | **Sí** |

> Estados activos (no terminales): `pendiente`, `en_progreso`, `bloqueada`, `en_revision`  
> Estados terminales: `completada`, `cancelada`

### `alert_type`

| Valor | Descripción |
|---|---|
| `task_blocked` | Tarea bloqueada o múltiples tareas bloqueadas (nivel obra) |
| `delay_risk` | Riesgo de demora (vencida, sin responsable, progreso inconsistente, alto % vencidas) |

### `message_direction`

| Valor | Descripción |
|---|---|
| `inbound` | Mensaje recibido del responsible |
| `outbound` | Mensaje enviado al responsible |

### `message_channel`

| Valor | Descripción |
|---|---|
| `whatsapp` | Canal WhatsApp (único canal soportado) |

### `message_type`

| Valor | Descripción |
|---|---|
| `text` | Texto plano |
| `audio` | Audio (transcripto por Whisper en Fase 3) |
| `image` | Imagen |
| `unknown` | Tipo no reconocido |

### `message_processing_status`

| Valor | Descripción |
|---|---|
| `pending` | Guardado, esperando procesamiento IA |
| `processed` | Procesado exitosamente por Claude |
| `failed` | Error en el procesamiento |

---

## Reglas de negocio críticas

1. **Status de tarea — solo sistema/chatbot**  
   Ningún endpoint HTTP público permite cambiar `status`, `estimated_progress` o `completed_date`. Solo `TaskService.apply_status_update()` lo hace, llamado desde el pipeline de IA.

2. **Soft delete en responsibles**  
   `is_active = false` en lugar de DELETE. Al desactivar, todas las tareas activas del responsible quedan `responsible_id = NULL` en la misma transacción. El historial registra cada reasignación.

3. **Alertas — deduplicación por mensaje**  
   Antes de crear una alerta se verifica si ya existe una sin leer con el mismo `(task_id/obra_id, type, message)`. Esto evita spam de alertas repetidas en cada request.

4. **Alertas — generación lazy**  
   No hay job de background. Las alertas se evalúan y crean al hacer `GET /tasks/obra/{id}`. El frontend carga tasks primero (secuencial), luego alerts.

5. **Historial — append-only**  
   Ningún evento se modifica ni se borra. `triggered_by` distingue el origen: `user` (frontend), `chatbot` (pipeline IA), `system` (lógica interna).

6. **Dependencias de tarea**  
   `depends_on_id` debe apuntar a una tarea de la **misma obra**. Auto-referencia (`depends_on_id = id`) prohibida. No hay cascade automático de fechas ni de status al resolver dependencias (visualización solamente, Fase 3).

7. **whatsapp_number — inmutable**  
   Una vez creado el responsible, su número no puede cambiarse. Es la clave con la que el chatbot lo identifica en los webhooks de Twilio.

8. **Serialización JSON en historial**  
   El campo `payload` de `historial_eventos` almacena JSON. Todos los valores se serializan con `model_dump(mode="json")` antes de persistir. Los objetos Python `date` se convierten a strings ISO `"YYYY-MM-DD"`.
