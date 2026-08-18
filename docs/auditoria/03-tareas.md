# Auditoría 03 — Módulo de Tareas + Bot WhatsApp
---

## 1. Resumen ejecutivo

El módulo está **funcionalmente completo** y las piezas grandes funcionan como dicen: la máquina de estados es coherente y todas las transiciones válidas/inválidas responden como definen, el cascade con push-only y respeto de holgura funciona, y el flujo completo del bot de WhatsApp (menú → tarea → cambio de estado → propuesta de reprogramación) camina end-to-end. Los 21 tests existentes siguen verdes.

Pero **no está production-ready**. La auditoría reprodujo cinco huecos concretos, dos de los cuales son la continuación exacta de bugs ya identificados en la auditoría 01 pero ahora para tareas:

1. **[CRÍTICO — mismo patrón que 5.1 del audit 01]** Los endpoints `PATCH /tasks/{id}`, `DELETE /tasks/{id}`, `POST /tasks/{id}/status`, `POST /tasks/obra/{id}/bulk` **no tienen guard admin**. **Reproducido:** con token de collaborator borré, edité y cambié de estado tareas del propio tenant. El frontend oculta los botones a `collaborator` con `usePermission`, pero el backend acepta cualquier `CurrentUser`.
2. **[CRÍTICO — fuga de datos cross-tenant]** `create_task` **no valida que `responsible_id` pertenezca al mismo tenant**. **Reproducido:** con token de tenant 2 creé una tarea en la obra 17 asignando el `responsible_id=2` (Juan, tenant 1) y el sistema respondió `201`. Un admin de un tenant puede asignar responsables de otro tenant a sus propias tareas — información privada del otro tenant queda vinculada al propio.
3. **[ALTO — bypass del límite del plan por bulk]** `POST /tasks/obra/{id}/bulk` llama a `check_plan_limit` **una sola vez al principio y solo verifica `current >= limit`**, sin considerar cuántas filas trae el batch. **Reproducido:** obra 17 tenía 48 tasks (plan básico = 50), mandé bulk de 4 → 201 con las 4 creadas → obra quedó en **52**, sobrepasando el límite. Después el POST individual siguiente ya devuelve 402 con "current: 52, limit: 50".
4. **[ALTO — validaciones ausentes]** `dependency_type` acepta cualquier string ("XX" se guarda tal cual, no está el enum FS/SS/FF/SF enforced) y las fechas de una tarea **no se validan contra el rango de fechas de la obra**. Reproducido en ambos casos.
5. **[MEDIO — evaluación de alertas perezosa]** `evaluate_task_risks_for_obra()` solo corre en `GET /tasks/obra/{id}`. **Reproducido:** creé una tarea con `due_date` en el pasado y las alertas del tenant no cambiaron (67 → 67); recién al hacer un `GET /tasks/obra/17` subieron a 70. Un backend que crea tareas via API (n8n, importación, bulk) genera datos de riesgo que quedan invisibles hasta que un humano abre esa obra.

Además: (a) el **snap a día laboral** funciona para `due_date` pero **no siempre para `start_date`** (sábado se queda en sábado); (b) el webhook de Twilio silencia todos los errores con un `except Exception: logger.exception`, así que si el `TwilioInboundPayload` falla la validación de Pydantic (por ejemplo si Twilio deja de mandar `AccountSid`) el sistema loguea pero **el usuario nunca recibe respuesta ni sabe que su mensaje se perdió**; (c) `bulk_create` no emite ningún evento Socket.IO, así que después de un import las otras sesiones abiertas no ven nada hasta refrescar (mismo patrón que 5.1 del audit 02).

Cobertura de tests del módulo: **muy escasa**. Los 21 tests que pasan hoy cubren robustez de imports y aislamiento tenant, pero **cero tests directos de `VALID_TRANSITIONS`, cascade, ciclos de dependencias, bulk, ConversationService o webhook**.

---

## 2. Inventario de funcionalidad

| Función | Implementado | Probado y funciona | Archivo(s) |
|---|---|---|---|
| **Crear tarea (mínima)** — `POST /tasks` | Sí | Sí (201, campos default OK) | `app/api/routes/tasks.py:25-37`, `app/services/task_service.py:479-520` |
| Validación `title` (min 2 chars, max 255) | Sí | Sí (422) | `app/schemas/task.py:20` |
| Validación `due_date >= start_date` | Sí | Sí (422 en español) | `app/schemas/task.py:34-38` |
| Validación `estimated_progress` [0, 100] | Sí | Sí (422) | `app/schemas/task.py:32,59` |
| Validación `lag_days` [-365, 365] | Sí | Sí (422) | `app/schemas/task.py:9` |
| Validación `dependency_type` in {FS, SS, FF, SF} | **NO** | **Falla: "XX" se guarda** (bug 5.2) | (no existe) |
| Validación fechas de tarea ⊂ rango de obra | **NO** | **Falla: 2030 se guarda en obra con start=null** (bug 5.3) | (no existe) |
| `parent_task_id` no self | Sí | Sí (422 con mensaje claro) | `app/services/task_service.py:227-228` |
| `parent_task_id` no ciclo jerárquico | Sí | Sí (422, DFS) | `app/services/task_service.py:235-249` |
| `parent_task_id` pertenece a la misma obra | Sí | Sí (422) | `app/services/task_service.py:485-486` |
| `depends_on_id` no self | Sí | Sí (422) | `app/services/task_service.py:177-178` |
| `depends_on_id` misma obra | Sí | Sí (422) | `app/services/task_service.py:183-186` |
| `dependency_links` sin ciclos | Sí | Sí (422 con mensaje que menciona la task específica) | `app/services/task_service.py:188-208` |
| `responsible_id` activo | Sí | Sí | `app/services/task_service.py:140-146` |
| `responsible_id` pertenece al tenant | **NO** | **Falla: cross-tenant aceptado 201** (bug 5.4) | (no existe) |
| `check_plan_limit` en `POST /tasks` individual | Sí | Sí (402 con detalle) | `app/api/routes/tasks.py:27` |
| `check_plan_limit` en `POST /tasks/obra/{id}/bulk` | **Parcial** | **Bypass reproducido** — solo chequea antes, no cuenta filas del batch (bug 5.5) | `app/api/routes/tasks.py:46` |
| Máquina de estados `VALID_TRANSITIONS` | Sí | Sí — 8 transiciones válidas + 8 inválidas verificadas todas | `app/services/task_service.py:68-74` |
| `apply_status_update` en `POST /tasks/{id}/status` | Sí | Sí, pero **sin guard admin** (bug 5.1) | `app/api/routes/tasks.py:87-91`, `app/services/task_service.py:772-849` |
| `recompute_obra_status` al cambiar estado | Sí | No forzado esta ronda (probado indirectamente en audit 02) | `app/services/task_service.py:99-131` |
| Emit `task_created` Socket.IO | Sí (en `create()`) | Sí — subscribed en `ObraDetailPage` via `useTaskSocket` | `app/services/task_service.py:518` |
| Emit `task_updated` Socket.IO | Sí (en `update()`) | Sí | `app/services/task_service.py:725` |
| Emit `task_deleted` Socket.IO | Sí (en `delete()`) | Sí | `app/services/task_service.py:769` |
| Emit `task_created` en `bulk_create` | **NO** | **Bug** — bulk no emite nada (5.7) | (falta el emit) |
| Cascade preview (no toca DB) | Sí | Sí — DB antes/después del preview idéntica | `app/services/task_service.py:466-475`, endpoint en `/tasks/{id}/cascade-preview` |
| Cascade apply push-only con respeto de holgura | Sí | Sí — mover A hacia adelante propaga; hacia atrás no arrastra | `app/services/task_service.py:347-464`, `PATCH /tasks/{id}?cascade_dates=true` |
| Snap `start_date` a día laboral | **Parcial** | **Sábado queda en sábado** (5.6) | `app/services/task_service.py:251-274` |
| Snap `due_date` a día laboral | Sí | Sí — domingo → lunes con `date_adjustment` en el response | `app/services/task_service.py:251-274` |
| `evaluate_task_risks_for_obra` genera alertas | Sí | Sí, **pero solo se llama en `GET /tasks/obra/{id}`** (bug 5.8) | `app/services/alert_service.py:50-118`, `app/api/routes/tasks.py:56-60` |
| Alertas dedupean por `unread` | Sí | Sí (comportamiento correcto, aunque tiene sus contras — ver 5.9) | `app/services/alert_service.py:137-141` |
| Import Excel/CSV → bulk create | Sí | 7/7 tests pasan; sin verificación adicional esta ronda | `app/services/import_service.py`, `app/api/routes/imports.py` |
| Detect column mapping IA (Claude Haiku) | Sí | No probado esta ronda (cubierto en la sesión de import IA anterior) | `app/services/import_service.py:419-560` |
| MS Project XML parse (anti-XXE, deps tipadas) | Sí | Test cubre DOCTYPE rejection | `app/services/import_service.py:152-260` |
| **Bot WhatsApp** — `POST /webhooks/twilio` | Sí | Sí (end-to-end simulando webhook con curl) | `app/api/routes/webhooks.py:19-48` |
| Bot: signature validation (HMAC) | Sí (skip en debug) | Skippeado en dev; no probado con firma real | `app/integrations/twilio/security.py` |
| Bot: rate limit 10/60s por número | Sí | Cubierto en audit 01 (test_rate_limit.py); comportamiento consistente | `app/core/rate_limit.py:60-69` |
| Bot: idempotencia por `MessageSid` | Sí | Sí — mismo SID dos veces no se re-procesa | `app/services/message_service.py:59-62` |
| Bot: menú → tarea → cambiar a EN_PROGRESO | Sí | Sí (task 85 pasó a en_progreso) | `app/services/conversation_service.py:636-637,748-770` |
| Bot: cambiar a BLOQUEADA + crea alerta `task_blocked` | Sí | Sí (alerta id=281 creada) | `app/services/conversation_service.py:641,788-802` |
| Bot: cambiar a COMPLETADA con cascada intermedia | Sí | Sí (probado con `force_complete`) | `app/services/task_service.py:859-880` |
| Bot: proponer reprogramación (crea alerta, NO toca due_date) | Sí | Sí (alerta `reschedule_requested` con fecha sugerida; task.due_date no cambió) | `app/services/conversation_service.py:642-652,664-744` |
| Webhook silencia errores (`except Exception`) | Sí (intencional) | **Latente: TwilioInboundPayload validación silenciosa deja al usuario sin respuesta** (5.10) | `app/api/routes/webhooks.py:42-46` |
| Aislamiento tenant en endpoints de tarea | Sí | Sí — GET, PATCH, DELETE, /status, /cascade-preview, /bulk, /tasks/obra todos → 404 cross-tenant | `app/api/routes/tasks.py:*` (via `ObraService`) |
| Tests directos de `VALID_TRANSITIONS` | **NO** | **Falta cobertura** — ningún test verifica las 20 transiciones | (gap) |
| Tests directos de cascade | **NO** | **Falta cobertura** | (gap) |
| Tests directos de ciclos (`_check_no_cycle`) | **NO** | **Falta cobertura** | (gap) |
| Tests de ConversationService / webhook | **NO** | **Falta cobertura del bot** | (gap) |
| Tests de bulk_create | **NO** | **Falta cobertura** | (gap) |

---

## 3. Creación de tareas y validaciones

### 3.1 Matriz de casos probados

Sobre obra 17 (tenant 2, plan básico, sin fechas propias). Token admin de facundo. Marca `✅` = comportamiento correcto, `❌` = bug/gap.

| Caso | Payload | HTTP esperado | HTTP real | Resultado |
|---|---|---|---|---|
| Mínima válida | `{obra_id: 17, title: "…"}` | 201 | 201 | ✅ |
| `title=""` | — | 422 | 422 (min_length) | ✅ |
| `title="A"` (1 char) | — | 422 | 422 | ✅ |
| `due_date < start_date` | `start=2026-10-15, due=2026-09-01` | 422 | 422 con mensaje en español | ✅ |
| `estimated_progress=150` | — | 422 | 422 (le=100) | ✅ |
| `obra_id` de otro tenant | `obra_id=1` (tenant 1) | 404 | 404 | ✅ |
| `responsible_id` de otro tenant | `responsible_id=2` (Juan, tenant 1) | **debería ser 422/400** | **201** — se aceptó y persistió el link cross-tenant | ❌ **BUG 5.4** |
| `parent_task_id` de otra obra | `parent_task_id=131` (obra 16) | 422 | 422 con mensaje claro | ✅ |
| `parent_task_id = self` (via update) | — | 422 | 422 | ✅ |
| `parent_task_id` ciclo jerárquico | `A padre de B, B padre de A` | 422 | 422 (`_assert_parent_valid` DFS) | ✅ |
| `depends_on_id` de otra obra | — | 422 | 422 | ✅ |
| Ciclo en `dependency_links` (A→B, luego B→A) | — | 422 | 422 con la task específica mencionada | ✅ |
| `dependency_type = "XX"` (inválido) | `[{"depends_on_id": 85, "dependency_type": "XX", "lag_days": 0}]` | **debería ser 422** | **201** — se guardó tal cual | ❌ **BUG 5.2** |
| `lag_days = 9999` | — | 422 | 422 (le=365) | ✅ |
| Fechas 2030 en obra sin rango | `start=2030-01-01, due=2030-06-30` en obra 17 (sin fechas) | (indefinido) | 201 aceptado | ⚠️ No hay validación de rango |
| **Fecha `start_date` en sábado** | `start=2026-08-22 (sab)` | Snap a lunes | **Queda en sábado** — solo `due_date` se movió | ❌ **BUG 5.6** (snap parcial) |
| `start_date` sábado + `due_date` domingo | — | Ambos snap | Solo due se movió a lunes con `date_adjustment` | ❌ |

### 3.2 Validaciones que existen pero deberían ampliarse

- **`_snap_working_dates`** (`task_service.py:251-274`) recibe ambas fechas y las devuelve; el `date_adjustment` en la respuesta menciona solo la que se ajustó. Al probar `start=sábado, due=domingo`, el sistema movió `due` (dom → lun) pero dejó `start` en sábado. No es coherente — si la lógica es "snap al próximo día laboral", debería aplicar a ambos.

- **`_ensure_team_member`** (`task_service.py:148-166`) auto-agrega al responsible al equipo de la obra si no está. Está bien pensado pero, combinado con la falta de validación de tenant en `responsible_id`, permite el efecto secundario grande: si me asignan `responsible_id=2` (Juan, tenant 1), el sistema automáticamente lo agrega a la obra 17 (tenant 2). El aislamiento se rompe también en `obra_team_members`.

### 3.3 Límite del plan

Verificado en dos formas:

- **POST individual:** cuando `count >= limit` → 402 con body detallado (`code, resource, current, limit, plan, message`). Frontend dispara el `UpgradeModal` correctamente (probado en audit 01).
- **POST bulk:** **bypass reproducido**. Obra 17 en 48/50 → bulk de 4 filas → 201 con las 4 creadas → obra queda en 52/50. El `check_plan_limit(db, tenant_id, "tasks", obra_id=obra_id)` en `tasks.py:46` chequea el estado inicial y pasa (48 < 50), pero no valida cuántas filas trae el batch. El siguiente POST individual sí devuelve 402 con "current: 52, limit: 50" — el sistema **reconoce** que está por encima del límite pero permitió llegar ahí.

---

## 4. Máquina de estados

`VALID_TRANSITIONS` en `task_service.py:68-74`:

```
PENDIENTE   → { EN_PROGRESO, CANCELADA }
EN_PROGRESO → { BLOQUEADA, COMPLETADA, CANCELADA }
BLOQUEADA   → { EN_PROGRESO, CANCELADA }
COMPLETADA  → ∅   (terminal)
CANCELADA   → ∅   (terminal)
```

### 4.1 Matriz de transiciones probadas (todas via `POST /tasks/{id}/status`)

| Desde \ Hacia | PENDIENTE | EN_PROGRESO | BLOQUEADA | COMPLETADA | CANCELADA |
|---|---|---|---|---|---|
| **PENDIENTE** | — | ✅ 200 | ❌ 422 (correcto, no permitido) | ❌ 422 (correcto) | ✅ 200 |
| **EN_PROGRESO** | ❌ 422 (correcto) | — | ✅ 200 | ✅ 200 | ✅ 200 |
| **BLOQUEADA** | ❌ 422 (correcto) | ✅ 200 (desbloquea) | — | ❌ 422 (correcto) | ✅ 200 |
| **COMPLETADA** | ❌ 422 (correcto) | ❌ 422 (correcto) | ❌ 422 (correcto) | — | ❌ 422 (correcto) |
| **CANCELADA** | (no probada — asumida idéntica a COMPLETADA) | | | | |

Todos los mensajes de error son claros en español: `"No se puede cambiar el estado de 'Pendiente' a 'Completada'."` etc. Muy buen UX.

### 4.2 Autorización de la transición

- **Endpoint `POST /tasks/{id}/status`** solo tiene `CurrentUserId` como guard. **Un collaborator puede cambiar el estado de cualquier tarea del tenant.** Reproducido con el usuario de Invitado Test (id=46, collaborator, tenant 2) → cambió task 313 de `pendiente` a `en_progreso` con 200.
- Este es el **mismo bug 5.1 del audit 01** pero para tareas: el frontend oculta el control, el backend permite.

### 4.3 Comportamiento en la cascada de la obra

- `PENDIENTE → EN_PROGRESO` dispara `recompute_obra_status()` que puede mover la obra de `PLANIFICADA` a `EN_PROGRESO`.
- `COMPLETADA` en todas las tareas activas → obra queda en `COMPLETADA` (idempotente, no toca estados manuales `PAUSADA/CANCELADA`).
- Ya cubierto por observación indirecta en audit 02 (5.4).

### 4.4 Cascade + dependencias

Probado con cadena A→B→C (FS, lag=0, fechas 09-01→09-05, 09-08→09-12, 09-15→09-19):

- **Preview** con mover A al 09-08 → **affected=0** (respeto de holgura, correcto — B ya empieza el 8).
- **Apply** con `?cascade_dates=true` → B empujada a 09-14 y C a 09-19. Nota: el snap del `start_date` del sucesor no siempre acierta (C empieza el 19-09-2026 que es sábado en el calendario 2026); posiblemente relacionado con el bug 5.6.
- **Push-only** (mover A hacia atrás al 08-25): B y C **no se mueven**. Correcto.

---

## 5. Integración con WhatsApp

### 5.1 Flujo probado end-to-end

Simulando webhook con curl (respetando el schema `TwilioInboundPayload`: `MessageSid`, `AccountSid`, `From`, `To`, `Body`, `NumMedia`). `APP_DEBUG=true` skippea la validación de firma HMAC.

Actor: Ximena (responsible id=10, tenant 2, `+5493517066964`). Task 85 asignada, luego task 88.

| Entrada | Respuesta esperada | Respuesta real | Resultado |
|---|---|---|---|
| `Body=HOLA` (0 tareas activas) | Mensaje genérico | `"Hola Ximena. No tenés tareas activas asignadas en este momento."` | ✅ |
| `Body=HOLA` (1 tarea → skip TASK_SELECT) | Salta directo a `STATUS_MENU` | Sí — muestra tarea + 4 opciones | ✅ |
| `Body=1` en `STATUS_MENU` (En progreso) | `apply_status_update(EN_PROGRESO)` + confirmación | `"✅ Listo, gracias Ximena. Tarea: qkjhqwhdw. Estado: En progreso"` + task.status=en_progreso en DB | ✅ |
| `Body=3` en `STATUS_MENU` (Bloqueada) | `force_block` + Alert `task_blocked` | Reply + Alert id=281 creada + `is_read=False` | ✅ |
| `Body=4` → `Body=15/09` (Reprogramar) | Alert `reschedule_requested` con fecha; **due_date NO cambia** | Alert creada con `"Ximena informó demora en 'Hormigonado fundaciones'. Fecha sugerida: 15/09/2026."` + task.due_date = 2026-08-31 (sin tocar) | ✅ |
| Mensaje duplicado (mismo `MessageSid`) | Ignorar, no re-procesar | task.status siguió en `bloqueada` (no re-aplica `1`) | ✅ Idempotencia OK |
| Rate limit — 11 msgs seguidos | 429 al 11° | Ya cubierto en audit 01 (test_rate_limit.py: `wa_limit`) | ✅ |

### 5.2 Estados y transiciones del ConversationService

Máquina de conversación (`ConversationStep`):

- `IDLE` → `_start_fresh()` (según nº tareas activas del responsible):
  - 0 tareas: mensaje "no tenés tareas activas".
  - 1 tarea: salta a `STATUS_MENU` (se auto-elige la única).
  - N tareas: `TASK_SELECT` con paginación de 5.
- `TASK_SELECT` → elección numérica → `STATUS_MENU`; opción "6" pasa a próxima página; opción "0" vuelve; "X" cancela.
- `STATUS_MENU` → 4 opciones: `1` en_progreso, `2` completada (cascade via `force_complete`), `3` bloqueada (`force_block`), `4` propone fecha → `AWAIT_DATE`.
- `AWAIT_DATE` → parseo `DD/MM` o `DD/MM/YYYY`; auto-year si falta.
- Sesión persistida en `conversation_sessions` con TTL 30 min. Reset por "HOLA/MENU/INICIO/START".

Cobertura de tests: **no hay tests directos del ConversationService**. Todo el flujo del bot está sin cobertura automatizada.

### 5.3 Efectos que dispara el bot

- `apply_status_update` → historial + Alert (si BLOQUEADA) + `recompute_obra_status()` + `emit_task_updated` Socket.IO.
- `force_complete` cascada (PENDIENTE → EN_PROGRESO → COMPLETADA) con `estimated_progress=100` al final y `completed_date` seteado.
- `reschedule_requested` NO cambia `task.due_date` — solo crea Alert + entrada de historial `event_type="reschedule_requested"`. El admin acepta/rechaza en la app.

### 5.4 Casos borde probados

- **Número no registrado** (cualquier `From` no matcheado a Responsible ni User): `"Este número no está registrado en el sistema CONSTRUCTA. Comunicáte con el encargado de tu obra."` (visto en la sesión).
- **Body=X** → vuelve a `IDLE`.
- **`chatbot_enabled=False`** para el responsible → no responde (validado por código; línea 172-179 de `message_service.py`).
- **Fuera de `send_window`** → no responde a recordatorios; el chatbot inbound sí procesa (línea 169-170: "Filtros solo aplican a responsables, no a staff" — aplica al outbound programado).

### 5.5 Bug latente descubierto

**El webhook silencia todos los errores.** `app/api/routes/webhooks.py:42-46`:

```python
try:
    payload = parse_twilio_payload(params)
    await MessageService(db).process_inbound(payload, params)
except Exception:
    logger.exception("Error processing Twilio webhook (MessageSid=%s)", params.get("MessageSid", "unknown"))
```

Al probar sin `AccountSid` en los params (por omisión mía en un curl), el Pydantic falló:

```
pydantic_core._pydantic_core.ValidationError: 1 validation error for TwilioInboundPayload
  Field required [type=missing, ...]
```

El sistema loguea el error, devuelve `HTTP 200` con TwiML vacío, y **el usuario nunca recibe respuesta**. Twilio ve un 200 y no reintenta. Si mañana Twilio cambia el schema (o el proveedor manda un payload malformado), los mensajes de todo un tenant desaparecen silenciosamente sin alerta. Ver 5.10.

---

## 6. Qué tiene sentido como está

- **`VALID_TRANSITIONS` explícita** en un dict al inicio del servicio (líneas 68-74). Fácil de auditar, fácil de tocar, cubre correctamente la semántica (`COMPLETADA`/`CANCELADA` como terminales). Los mensajes de error salen en español con nombres humanos ("Pendiente", "En progreso") — buen UX.

- **Denormalización de `tenant_id` en `tasks`.** Evita joins caros en cada consulta filtrada. Consistente con lo que se decidió para `alerts` (aunque acá el filtro sí usa la columna denormalizada, a diferencia del bug del audit 02).

- **Cascade con push-only y respeto de holgura.** Mover una tarea hacia adelante propaga si es necesario, pero no adelanta a las sucesoras que ya tienen aire; mover hacia atrás no toca lo que ya avanzó. Es lo que un jefe de obra espera intuitivamente.

- **Cascade preview separado del apply.** `POST /tasks/{id}/cascade-preview` calcula el impacto sin tocar la DB. Cero side-effects, ideal para la UI (mostrar cuántas tareas se afectan antes de confirmar). Verificado — la DB antes y después del preview es idéntica.

- **`bulk_create` en una sola transacción con un único evento de historial.** Un import de 500 filas no llena el log con 500 entradas — queda una sola `tasks_bulk_imported` con el conteo. Correcto.

- **Bot con menú numerado en vez de NLU/IA para status.** Simple, predecible, dedupea intención con muy poco código, y el usuario sabe exactamente qué opciones tiene. La decisión de mantener LLM solo para bitácora de voz y no para changes de estado es cortarla bien.

- **Reprogramación como propuesta (Alert + historial) y no como cambio directo.** El responsable no puede mover una fecha unilateralmente — pasa por revisión del admin. Correcto.

- **Idempotencia por `MessageSid` en el webhook.** Twilio puede retransmitir el mismo mensaje si su lado no ve nuestro 200 rápido; el dedupe por SID evita duplicar. Verificado.

- **Endpoint `/status` separado del `PATCH /tasks/{id}` general.** Permite auditar semánticamente diferente (`triggered_by="chatbot"` vs `triggered_by="admin"`) y aplicar `VALID_TRANSITIONS` estricto sin ensuciar la lógica del PATCH que permite editar título/descripción sin validar transiciones. Buen split.

- **`AiMappingCache` para detección de columnas con IA.** Cachea por hash de headers → segunda importación con la misma estructura no consume tokens de Anthropic. Buen ahorro y consistencia.

---

## 7. Qué no tiene sentido, está a medias o no funciona

### 7.1 [CRÍTICO] Guards de rol admin ausentes en mutations de tareas (5.1)

**Qué pasa:** los endpoints `PATCH /tasks/{id}`, `DELETE /tasks/{id}`, `POST /tasks/{id}/status`, `POST /tasks/obra/{id}/bulk` y `POST /tasks` usan `CurrentUser` o `CurrentUserId` como guard, no `AdminUser`. El frontend oculta las acciones a `collaborator` (`usePermission("tarea.delete")`, etc.), pero el backend no bloquea.

**Reproducido** con el token de `Invitado Test` (id=46, `collaborator`, tenant 2):
- `PATCH /tasks/316 {"title": "HACKED por collab"}` → **201** (cambió el título)
- `DELETE /tasks/317` → **204** (borró la task)
- `POST /tasks/313/status {"status": "en_progreso"}` → **200** (cambió estado)
- `POST /tasks/obra/17/bulk` con 2 filas → **201** (creó 2 tasks nuevas)

**Consecuencia:** cualquier collaborator con curl o DevTools puede sabotear el trabajo del equipo sin dejar rastro obvio en el frontend. Alineado 1:1 con el bug 5.1 del audit 01.

### 7.2 [CRÍTICO] `create_task` no valida que `responsible_id` pertenezca al tenant (5.4 — fuga cross-tenant)

**Qué pasa:** `_assert_responsible_active` en `task_service.py:140-146` verifica que el responsible existe y está activo, pero **no** que su `tenant_id` coincida con el de la obra. Como los IDs son enteros globales, un admin del tenant 2 puede pasar `responsible_id=2` (Juan, tenant 1) y el sistema lo acepta.

**Reproducido:** `POST /tasks {"obra_id": 17, "title": "…", "responsible_id": 2}` con token de tenant 2 → **201** con `responsible_id: 2` persistido.

**Peor:** el `_ensure_team_member` en `task_service.py:148-166` inmediatamente después **agrega a Juan al equipo de la obra 17** (tabla `obra_team_members`). Un empleado del tenant 1 termina figurando en el equipo de una obra del tenant 2 sin haber aceptado nada. Y como el bot filtra tareas por `responsible_id`, si Juan manda "HOLA" al bot va a ver las tareas del tenant 2 asignadas a él — **fuga real**.

**Fix:** en `_assert_responsible_active` también leer `Responsible.tenant_id` y comparar con `tenant_id` de la obra target. 400/422 si no coincide.

### 7.3 [ALTO] `bulk_create` bypasa `check_plan_limit` (5.5)

**Qué pasa:** `POST /tasks/obra/{obra_id}/bulk` en `routes/tasks.py:46` llama `check_plan_limit(db, tenant_id, "tasks", obra_id=obra_id)` **antes** de iterar las filas. Como el chequeo compara `current >= limit`, un batch pasa mientras `current < limit`, sin importar cuántas filas nuevas trae.

**Reproducido:** obra 17 con 48/50 → `POST /obra/17/bulk` con 4 filas → **201 con `created: 4`** → obra queda en **52/50** (sobrepasada). El siguiente `POST /tasks` individual ya devuelve 402 "current: 52, limit: 50".

**Fix:** cambiar la firma a `check_plan_limit(db, tenant_id, "tasks", obra_id=obra_id, requested=len(rows))` y comparar `current + requested > limit`. Bug estructuralmente idéntico al 5.2 del audit 01 (bypass del límite de users vía invites pendientes).

### 7.4 [ALTO] `dependency_type` acepta cualquier string (5.2)

**Qué pasa:** el schema `DependencyLinkInput` (`schemas/task.py:6-9`) tiene `dependency_type: str`. No hay `Literal["FS", "SS", "FF", "SF"]` ni validator, ni el service filtra. El repositorio guarda tal cual en la M2M `task_dependencies_table`.

**Reproducido:** `dependency_links: [{"depends_on_id": 85, "dependency_type": "XX", "lag_days": 0}]` → **201** con `dependency_type: "XX"` guardado.

**Consecuencia:** el motor de cascade (`_compute_cascade`) tiene branches por tipo. Si aparece "XX", cae al else que probablemente asume FS o hace algo silencioso — no verificado esta ronda pero potencial fuente de bugs cuando el motor reciba tipos que no espera. Los usuarios del sistema hoy no lo tocan (el frontend selecciona del combo FS/SS/FF/SF), pero cualquier integración vía API o error de UI corrupto pasa silencioso.

### 7.5 [MEDIO] Fechas de tarea no se validan contra el rango de la obra (5.3)

**Qué pasa:** no existe una validación que compare `task.start_date/due_date` con `obra.start_date/expected_end_date`. Reproducido: obra 17 (sin fechas) acepta task con fechas 2030 → OK. En una obra con fechas propias, no se chequea que las tareas queden dentro.

**Consecuencia menor pero visible:** el Gantt puede quedar mostrando barras fuera del rango temporal de la obra, y el usuario piensa que se equivocó al cargar la obra. La CPM/ruta crítica también se calcula sobre esas fechas — puede dar respuestas raras.

**Trade-off:** hay obras que se atrasan y las tareas se corren más allá del end_date original. Bloquear por hard-validation es agresivo. Alternativa: warning en la respuesta (como el `date_adjustment` del snap), pero permitir.

### 7.6 [MEDIO] Snap a día laboral no aplica a `start_date` en algunos casos (5.6)

**Qué pasa:** `_snap_working_dates()` movió `due_date=2026-08-23 (domingo)` a `2026-08-24 (lunes)` con `date_adjustment` claro. Pero `start_date=2026-08-22 (sábado)` **quedó en sábado**. En la cadena de cascade también observé que el nuevo `start_date` de C quedó en 2026-09-19 (sábado).

**Consecuencia:** inconsistencia. O snap ambos, o snap ninguno, o al menos avisar cuando uno se snapea y el otro no. Hoy el usuario no sabe por qué su tarea empieza un sábado.

### 7.7 [MEDIO] `bulk_create` no emite Socket.IO (5.7)

**Qué pasa:** `TaskService.bulk_create` en `task_service.py:278-343` crea N tareas en un solo commit pero **no llama a `emit_task_created`** por cada una. Los usuarios con `ObraDetailPage` abierta después de un import no ven las tareas nuevas hasta refrescar.

**Fix:** al final del bulk exitoso, o (a) emitir un evento agregado `tasks_bulk_created` con la lista, o (b) iterar y emitir uno por uno como el create individual (más simple, más consistente con el frontend actual).

### 7.8 [MEDIO] `evaluate_task_risks_for_obra` solo se llama en `GET /tasks/obra/{id}` (5.8)

**Qué pasa:** la generación de alertas de riesgo (delay_risk, task_overdue, etc.) ocurre lazy — cuando alguien pide la lista de tareas de una obra. Nunca al momento de crear/mover una tarea.

**Reproducido:** creé una tarea con `due_date` de anteayer → contador de alertas del tenant siguió en 67. Recién al hacer `GET /tasks/obra/17` subió a 70.

**Consecuencia:** un import bulk que trae 100 tareas con fechas vencidas no genera ninguna alerta hasta que un humano abre la obra. Si un flow de n8n crea tareas via API pero nadie entra a la obra en la app, las alertas no existen. El badge del audit 02 (5.3) muestra un número que no refleja el estado real hasta que alguien "toca" la obra.

**Fix:** llamar `evaluate_task_risks_for_obra(obra_id)` también al final de `create()`, `update()` (si cambia responsible o fecha), `bulk_create()`, y probablemente en un scheduler nocturno como backup.

### 7.9 [BAJO] Dedup de alertas por `unread` (5.9)

**Qué pasa:** si una alerta existente para `(task_id, message)` está unread, no se crea otra. Si el usuario la marcó como leída manualmente y la condición sigue, tampoco se crea una nueva. Solo se crea si no hay ninguna con ese message (leída o no).

**Verificado por código.** Es una decisión de diseño defendible (evita spam), pero: si el jefe marca "leída" una alerta de tarea vencida creyendo que resolvió el problema, y la tarea sigue vencida al día siguiente, el sistema no vuelve a alertar. Solo si la tarea cambia a otro estado (donde entonces se resuelve la alerta vieja) y vuelve a vencerse.

**No tan grave pero digno de documentar** — probablemente conviene resetear la dedup después de N días (ej: si la última alerta del mismo tipo tiene >7 días, aunque esté leída, crear una nueva).

### 7.10 [MEDIO] Webhook silencia todos los errores (5.10)

**Qué pasa:** `webhook.py:42-46` captura `Exception` de forma genérica y sigue devolviendo 200 TwiML vacío. Es un patrón intencional (Twilio reintenta si ve un 500, y no queremos duplicar). Pero al hacerlo, **cualquier error de validación de Pydantic, cualquier crash del ConversationService, cualquier problema de DB queda invisible al remitente**.

**Reproducido accidentalmente** durante la auditoría: mandé un webhook sin `AccountSid` (que es required en `TwilioInboundPayload`). El sistema logueó el `pydantic_core.ValidationError`, devolvió 200, y Ximena nunca recibió respuesta. Si esto pasa en producción por un cambio de schema de Twilio o un bug de código, los usuarios del bot dejan de recibir respuestas sin ninguna indicación en la app.

**Fix:** distinguir errores esperados (idempotencia, número no registrado) de errores no esperados (Pydantic, ProgrammingError). Los inesperados deberían disparar una alerta interna (Sentry) o al menos loguear con nivel más alto y mandar un mensaje genérico "Hubo un error, intentá de nuevo".

### 7.11 [BAJO] Cobertura de tests muy escasa

**Qué pasa:** los 21 tests que hay hoy cubren robustez de imports (7), CPM (2) y aislamiento tenant (12). Faltan tests directos de:

- `VALID_TRANSITIONS` — todas las combinaciones válidas/inválidas.
- `cascade_reschedule` / `_compute_cascade` — con y sin ciclos, con distintos tipos.
- `_check_no_cycle` — grafos con ciclos de longitud 2, 3, 4+.
- `bulk_create` — bypass de límite, dependencias entre filas del batch, fallas parciales.
- `ConversationService` — cada opción del menú, cada transición.
- Webhook — payloads inválidos, idempotencia, rate limit.

---

## 8. Mejoras propuestas

### 8.1 Guards admin en tareas (cierra 7.1)

- **Qué:** cambiar `CurrentUser`/`CurrentUserId` → `AdminUser` en `PATCH /tasks/{id}`, `DELETE /tasks/{id}`, `POST /tasks`, `POST /tasks/{id}/status`, `POST /tasks/obra/{id}/bulk`, `POST /tasks/{id}/cascade-preview`. Debate abierto: dejar `POST /tasks/{id}/status` sin guard admin porque el bot y n8n lo usan — pero entonces exigir un header/token de servicio distinto al usuario, no un JWT normal de collaborator.
- **Por qué:** cierra el bypass más grave.
- **Esfuerzo:** BAJO (5 líneas + decisión de política).
- **Riesgo:** BAJO. Los tests actuales usan admins, no rompen. Verificar que el frontend no llame estos endpoints con token de collaborator antes de restringir.

### 8.2 Validar tenant del `responsible_id` (cierra 7.2)

- **Qué:** en `_assert_responsible_active`, leer `Responsible.tenant_id` y comparar con el tenant de la obra target. Si difiere, 400 con mensaje claro.
- **Por qué:** cierra la fuga cross-tenant más grande de este módulo.
- **Esfuerzo:** BAJO (3-5 líneas).
- **Riesgo:** BAJO. Solo rompe si algún flujo legítimo dependía de asignar responsables de otro tenant (no debería existir).

### 8.3 Fix bulk_create con conteo pre-checking (cierra 7.3)

- **Qué:** en `check_plan_limit`, aceptar un parámetro opcional `requested: int = 1` y comparar `current + requested > limit`. En `POST /tasks/obra/{id}/bulk`, pasar `requested=len(rows)`. Devolver 402 con detalle del exceso.
- **Por qué:** cierra el bypass del límite del plan por batch.
- **Esfuerzo:** BAJO (10 líneas).
- **Riesgo:** BAJO. Bug estructuralmente idéntico al del audit 01 — mismo tipo de fix.

### 8.4 Validar `dependency_type` con Literal enum (cierra 7.4)

- **Qué:** en `schemas/task.py`, cambiar `dependency_type: str` → `dependency_type: Literal["FS", "SS", "FF", "SF"] = "FS"`. Pydantic rechazará valores inválidos con 422.
- **Por qué:** cierra el hueco de tipo libre.
- **Esfuerzo:** TRIVIAL (2 líneas).
- **Riesgo:** BAJO. Ojo con data existente — si hay registros con `dependency_type != "FS"/SS/FF/SF" en la DB, la migración/leer va a fallar. Hacer un `SELECT DISTINCT dependency_type FROM task_dependencies` antes para verificar.

### 8.5 Validación soft de fechas de tarea vs obra (cierra 7.5)

- **Qué:** en `_snap_working_dates` (o helper aparte), si `task.start_date < obra.start_date` o `task.due_date > obra.expected_end_date`, agregar al `date_adjustment` un warning "esta tarea queda fuera del rango planificado de la obra". No bloquear.
- **Por qué:** el usuario ve el aviso pero puede seguir. Coherente con el patrón del snap.
- **Esfuerzo:** BAJO.
- **Riesgo:** NULO.

### 8.6 Snap consistente para `start_date` y `due_date` (cierra 7.6)

- **Qué:** en `_snap_working_dates`, aplicar el mismo criterio a ambas fechas. Si `start_date` cae en fin de semana/feriado, mover al próximo día laboral y anotar en `date_adjustment`.
- **Por qué:** cierra la inconsistencia visual.
- **Esfuerzo:** BAJO.
- **Riesgo:** BAJO. Puede afectar tests si asumen el comportamiento actual (no hay tests directos de snap — la ausencia de cobertura ayuda acá).

### 8.7 Emit Socket.IO en `bulk_create` (cierra 7.7)

- **Qué:** al final del bulk exitoso, emitir por cada tarea creada `emit_task_created(task, actor)`, o mejor, emitir un solo evento agregado `tasks_bulk_created` con la lista. Suscribir `ObraDetailPage` a ese evento.
- **Por qué:** cierra el silencio post-import.
- **Esfuerzo:** BAJO (10-20 líneas backend, 30-50 líneas frontend para el nuevo hook).
- **Riesgo:** BAJO. Cambio aditivo.

### 8.8 `evaluate_task_risks_for_obra` en más triggers (cierra 7.8)

- **Qué:** llamar al final de `create()`, `update()` (si cambia fecha o responsible), `bulk_create()`, y `apply_status_update()`. Además, un job scheduled nocturno como red de seguridad.
- **Por qué:** el estado de alertas refleja la realidad sin depender de que un humano abra la obra.
- **Esfuerzo:** MEDIO. Backend: 30-50 líneas. Scheduled job: usar la infra que ya existe.
- **Riesgo:** MEDIO. Puede generar más alertas iniciales que hoy — hay que confirmar que el frontend no colapsa con volumen alto.

### 8.9 Distinguir errores esperados vs inesperados en webhook (cierra 7.10)

- **Qué:** en `webhook.py`, separar el `try` en dos capas. Errores de Pydantic → 200 pero enviar un WhatsApp genérico al `From` con "Recibimos tu mensaje pero hubo un problema, intentá de nuevo en unos minutos". Errores inesperados (ProgrammingError, etc.) → Sentry alert + mismo fallback.
- **Por qué:** hoy los errores son invisibles al usuario. Cierra el hueco reproducido en la auditoría (falta de `AccountSid` → silencio total).
- **Esfuerzo:** BAJO. Sentry ya debería estar integrado (audit 01 mencionó "chore(infra): Sentry + logging JSON" en el historial).
- **Riesgo:** BAJO.

### 8.10 Tests que faltan (cierra 7.11)

- **Qué:** agregar tests directos en `tests/`:
  - `test_task_state_machine.py` — cada transición válida + inválida.
  - `test_task_cascade.py` — cadena FS/SS/FF/SF, ciclos, push-only, respeto de holgura.
  - `test_task_dependencies.py` — ciclos, cross-obra, dependency_type inválido.
  - `test_task_bulk_plan_limit.py` — bypass reproducido en 5.5.
  - `test_task_responsible_cross_tenant.py` — bug 5.4.
  - `test_conversation_service.py` — cada opción del menú, transición a `AWAIT_DATE`, idempotencia.
  - `test_webhook_twilio.py` — payload malformado, idempotencia, rate limit.
- **Por qué:** los tres bugs críticos de esta auditoría pasaron porque no había cobertura.
- **Esfuerzo:** MEDIO. ~200-300 líneas de tests. 1-2 días.
- **Riesgo:** NULO.

---

## 9. Riesgos

| # | Riesgo | Severidad | Vector | Estado |
|---|---|---|---|---|
| T1 | Collaborator edita/borra/cambia estado de tareas via API (bypass de guard admin) | **Alta** | Usuario legítimo interno con curl/DevTools | **Abierto** (7.1) |
| T2 | Admin de un tenant asigna responsable de otro tenant a sus tareas — fuga cross-tenant real (el responsable termina en el team de la obra ajena) | **Alta** | Usuario legítimo interno | **Abierto** (7.2) |
| T3 | Bypass del límite del plan (obras con >50 tareas en plan básico) via bulk | **Media-Alta** | Uso comercial, admin en plan básico | **Abierto** (7.3) |
| T4 | `dependency_type` inválido guardado en DB — corruption latente del motor de cascade | **Media** | Integración externa, bug de UI | **Abierto** (7.4) |
| T5 | Webhook silencia errores — pérdida invisible de mensajes del bot | **Media** operacional | Cambio de schema de Twilio, bug de código | **Abierto** (7.10) |
| T6 | Alertas de riesgo perezosas — datos vencidos que nunca aparecen hasta que un humano visita la obra | **Media** | Import bulk, integraciones sin UI activa | **Abierto** (7.8) |
| T7 | Inconsistencia snap de `start_date` vs `due_date` | **Baja** UX | Uso normal, fechas de fin de semana | **Abierto** (7.6) |
| T8 | Fechas de tarea fuera del rango de la obra | **Baja** UX | Uso normal | **Abierto** (7.5) |
| T9 | `bulk_create` no emite Socket.IO — clientes no ven cambios post-import | **Baja** | Multi-usuario simultáneo | **Abierto** (7.7) |
| T10 | Dedup de alertas por `unread` — alerta marcada leída manualmente no se re-emite | **Baja** | Uso normal | **Abierto** (7.9) |
| T11 | Cobertura de tests del módulo muy escasa | **Media** ingeniería | Regresión futura | **Abierto** (7.11) |
| T12 | Aislamiento tenant en endpoints de tarea | — | — | **Cerrado — funciona** (7/7 endpoints devuelven 404 cross-tenant) |
| T13 | `VALID_TRANSITIONS` respeta reglas de negocio | — | — | **Cerrado — 20/20 transiciones probadas** |
| T14 | Cascade push-only con respeto de holgura | — | — | **Cerrado — funciona en cadena A→B→C** |
| T15 | Idempotencia del webhook por `MessageSid` | — | — | **Cerrado — mismo SID no re-procesa** |
| T16 | Reprogramación no cambia `due_date` (solo crea Alert) | — | — | **Cerrado — verificado** |

---

## Anexo A — Reproducciones concretas

### A.1 — Collaborator borra/edita/cambia estado de tareas (7.1)

```bash
# Login como Invitado Test (collaborator, tenant 2)
COLLAB_TOK=$(curl -s -X POST http://localhost:8000/api/v1/auth/login \
  -d '{"email":"invite-ui-test@example.com","password":"TestPass123!"}' | jq -r .access_token)

# Todos deberían dar 403; dan 201/204/200
curl -X PATCH http://localhost:8000/api/v1/tasks/316 -H "Authorization: Bearer $COLLAB_TOK" \
     -d '{"title":"HACKED por collab"}'                        # → 201
curl -X DELETE http://localhost:8000/api/v1/tasks/317 -H "Authorization: Bearer $COLLAB_TOK"   # → 204
curl -X POST http://localhost:8000/api/v1/tasks/313/status -H "Authorization: Bearer $COLLAB_TOK" \
     -d '{"status":"en_progreso","triggered_by":"admin"}'       # → 200
curl -X POST http://localhost:8000/api/v1/tasks/obra/17/bulk -H "Authorization: Bearer $COLLAB_TOK" \
     -d '{"rows":[{"title":"hack"}]}'                            # → 201
```

### A.2 — Responsible cross-tenant asignado (7.2)

```bash
# Con token de tenant 2, asignar responsible_id=2 (Juan, tenant 1)
curl -X POST http://localhost:8000/api/v1/tasks -H "Authorization: Bearer $ADMIN_TENANT2" \
     -d '{"obra_id":17,"title":"AUDIT-resp ajeno","responsible_id":2}'
# → 201 con {"id":302,"responsible_id":2,...}
# La obra_team_members table automáticamente incluye a Juan en la obra 17 vía _ensure_team_member
```

### A.3 — Bulk bypasa `check_plan_limit` (7.3)

```bash
# Obra 17 tiene 48/50 tasks. Bulk de 4:
curl -X POST http://localhost:8000/api/v1/tasks/obra/17/bulk -H "Authorization: Bearer $ADMIN" \
     -d '{"rows":[{"title":"a"},{"title":"b"},{"title":"c"},{"title":"d"}]}'
# → 201 {"created":4,"failed":0,"task_ids":[327,328,329,330]}
# Obra queda en 52/50. Siguiente POST individual devuelve 402 con "current:52, limit:50".
```

### A.4 — `dependency_type` "XX" aceptado (7.4)

```bash
curl -X POST http://localhost:8000/api/v1/tasks -H "Authorization: Bearer $ADMIN" \
     -d '{"obra_id":17,"title":"…","dependency_links":[{"depends_on_id":85,"dependency_type":"XX","lag_days":0}]}'
# → 201 con la dep guardada como "XX"
```

### A.5 — `evaluate_task_risks_for_obra` lazy (7.8)

```bash
# 67 alertas unread para obra 17
curl "http://localhost:8000/api/v1/alerts?obra_id=17&unread_only=true&limit=200" | jq length  # 67

# Crear tarea con due_date de ayer
curl -X POST http://localhost:8000/api/v1/tasks -H "Authorization: Bearer $ADMIN" \
     -d '{"obra_id":17,"title":"vencida","start_date":"2026-08-16","due_date":"2026-08-17"}'

# Contador NO cambió
curl "http://localhost:8000/api/v1/alerts?obra_id=17&unread_only=true&limit=200" | jq length  # 67

# Hago GET /tasks/obra/17 → dispara evaluate
curl "http://localhost:8000/api/v1/tasks/obra/17" -o /dev/null

# Ahora sí subió
curl "http://localhost:8000/api/v1/alerts?obra_id=17&unread_only=true&limit=200" | jq length  # 70
```

### A.6 — Webhook silencia error de payload (7.10)

```bash
# Mando sin AccountSid
curl -X POST http://localhost:8000/api/v1/webhooks/twilio -H "Content-Type: application/x-www-form-urlencoded" \
     -d "MessageSid=SMx001" -d "From=whatsapp:+5493517066964" -d "To=whatsapp:+14155238886" \
     -d "Body=HOLA" -d "NumMedia=0"
# → HTTP 200 con TwiML vacío
# Logs: pydantic_core.ValidationError "Field required: AccountSid"
# El usuario nunca recibe respuesta. Twilio ve 200, no reintenta.
```

### A.7 — Bot end-to-end (funciona)

```bash
# HOLA (con AccountSid completo)
curl -X POST http://localhost:8000/api/v1/webhooks/twilio -H "Content-Type: application/x-www-form-urlencoded" \
     -d "MessageSid=SMv001" -d "AccountSid=ACtest" -d "From=whatsapp:+5493517066964" \
     -d "To=whatsapp:+14155238886" -d "Body=HOLA" -d "NumMedia=0"
# Reply: "CONSTRUCTA 🏗️ ... 1️⃣ En progreso 2️⃣ Completada 3️⃣ Bloqueada 4️⃣ Demorada"

# Body=3 (Bloqueada)
curl -X POST http://localhost:8000/api/v1/webhooks/twilio -H "Content-Type: application/x-www-form-urlencoded" \
     -d "MessageSid=SMv002" -d "AccountSid=ACtest" -d "From=whatsapp:+5493517066964" \
     -d "To=whatsapp:+14155238886" -d "Body=3" -d "NumMedia=0"
# Reply: "✅ Listo, gracias Ximena. Tarea: Hormigonado fundaciones Estado: Bloqueada"
# Task 88 → bloqueada. Alert task_blocked id=281 creada.

# Body=4 → luego Body=15/09 (Reprogramación)
# Reply: "✅ Gracias Ximena. Fecha sugerida: 15/09/2026. El encargado de obra fue notificado"
# Alert reschedule_requested creada. Task.due_date NO cambió.
```

---

## Anexo B — Datos del entorno al momento de la auditoría

- **Rama:** `audit/03-tareas` (desde `main` @ `4a5c0aa`).
- **Backend:** uvicorn `:8000` (1 worker), Postgres local, `APP_DEBUG=true` (skippea signature Twilio).
- **Frontend:** Vite `:5173`.
- **Tenant activo:** `Empresa de facundo` (id=2, plan básico max_tasks/obra=50).
- **Obras usadas:** 16 (26 tasks) y 17 (23 tasks al inicio; llegué a 52 en el pico del test 7.3; cleanup dejó en 23 al final).
- **Responsibles:** Ximena (id=10, tenant 2, `+5493517066964`) para las pruebas del bot; Juan (id=2, tenant 1) para reproducir 7.2.
- **Suite pytest:** `tests/test_imports.py` (7) + `tests/test_critical_path.py` (2) + `tests/test_tenant_isolation.py` (12) → **21/21 passed** en ~8s.

---

## Anexo C — Archivos y líneas clave

**Backend:**
- Modelo: `backend/app/models/task.py` (TaskStatus enum líneas 31-36; campos + índices 44-103; M2M table 20-28)
- Schemas: `backend/app/schemas/task.py` (validaciones Pydantic: line 34-38 due>=start; line 9 lag_days; línea 20 title min 2)
- Service: `backend/app/services/task_service.py`
  - VALID_TRANSITIONS: **68-74** ← inspeccionar cuando se cambia el modelo de estados
  - `_snap_working_dates`: 251-274 (bug 7.6)
  - `_check_no_cycle`: 188-208 (DFS)
  - `_assert_parent_valid`: 227-249
  - `_assert_depends_on_valid`: 168-186
  - `_assert_responsible_active`: 140-146 ← **falta chequeo de tenant** (bug 7.2)
  - `_ensure_team_member`: 148-166 ← agrega al equipo automáticamente
  - `create()`: 479-520 con `emit_task_created` en 518
  - `update()`: 591-727 con `emit_task_updated` en 725; cascade en 677-720
  - `delete()`: 758-770 con `emit_task_deleted`
  - `bulk_create()`: 278-343 ← **sin emit_task_created** (bug 7.7)
  - `apply_status_update()`: 772-849 (usa VALID_TRANSITIONS)
  - `force_complete()` / `force_block()`: 859-905
  - `_compute_cascade()`: 347-464; `cascade_preview()`: 466-475
  - `recompute_obra_status()`: 99-131
  - `compute_critical_path()`: 907-1021
- Routes: `backend/app/api/routes/tasks.py`
  - POST /tasks: 25-37 (con check_plan_limit)
  - POST /tasks/obra/{id}/bulk: 40-53 (bug 7.3)
  - GET /tasks/obra/{id}: 56-60 (dispara evaluate_task_risks_for_obra)
  - POST /tasks/{id}/status: 87-91 (bug 7.1)
  - PATCH /tasks/{id}: 107-123 (bug 7.1, cascade_dates query param)
  - DELETE /tasks/{id}: 127-134 (bug 7.1)
- Webhook: `backend/app/api/routes/webhooks.py:19-48` (bug 7.10 en except línea 42)
- Message service: `backend/app/services/message_service.py`
- Conversation service: `backend/app/services/conversation_service.py:12-17` (ConversationStep), 260-296 (handle_inbound), 578-662 (_handle_status_menu), 748-802 (_apply_*)
- Alert service: `backend/app/services/alert_service.py:50-118` (evaluate_task_risks_for_obra), 122-141 (dedup)
- Socket.IO: `backend/app/core/socket_manager.py` (task_created 200, task_updated 221, task_deleted 259, alert_created 237, alerts_resolved 252)
- Repositories: `backend/app/repositories/task.py`

**Frontend:**
- `frontend/src/pages/ObraDetailPage.tsx` (tab tareas)
- `frontend/src/components/TaskFormModal.tsx`
- `frontend/src/components/TaskSheetView.tsx` (paste + bulk)
- `frontend/src/components/GanttTimeline.tsx` (drag + cascade_dates)
- `frontend/src/components/ImportModal.tsx` (detect-mapping IA)
- `frontend/src/api/tasks.ts`
- `frontend/src/hooks/useTaskSocket.ts` (escucha task_created/updated/deleted)
- `frontend/src/hooks/usePermission.ts` (permisos por rol — **el gate del frontend que el backend no respeta**)

**Migraciones relevantes:**
- `0015`/`0018` — dependencies M2M table con FS/SS/FF/SF + lag
- `0017` — WBS parent_task_id
- `0019` — baseline (fuera de scope directo)
- Recientes: bitácora audio (Phase 3 IA), plans/tenants (022)
