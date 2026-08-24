# Fase 2 — Enforcement de permisos por obra

> **Alcance:** aplicar la tabla `ObraUserRole` (Fase 1) sobre todos los endpoints backend scoped a una obra puntual, más filtrar los listados globales al conjunto de obras visibles para cada usuario. No toca frontend ni el flujo de invitación (Fase 3 en adelante).

**Fecha:** 2026-08-23
**Base:** cierra sobre [`fase-1-modelo.md`](./fase-1-modelo.md) (matriz de capacidades por rol) y [`fase-0-guards.md`](./fase-0-guards.md).

---

## 1. Módulo nuevo `app/core/obra_permissions.py`

Un solo lugar donde vive toda la política. Interfaz:

- **`assert_obra_access(db, user, obra_id, min_role) -> Obra`** — helper directo, para handlers cuyo `obra_id` viene del body (no de la URL).
- **`visible_obra_ids(db, user) -> set[int] | None`** — helper para filtrar listados: `None` significa "todas las del tenant" (admin); un `set` significa "estas ids" (non-admin, puede estar vacío).
- **`require_obra_role(min_role)`** — FastAPI dependency factory. Resuelve el path param `{obra_id}` y aplica la política. Uso típico:
  ```python
  current_user: Annotated[User, Depends(require_obra_role(ObraUserRoleType.COLABORADOR))]
  ```
- **`require_task_obra_role(min_role)`**, **`require_plano_obra_role`**, **`require_alert_obra_role`**, **`require_bitacora_obra_role`**, **`require_purchase_order_obra_role`**, **`require_solicitud_obra_role`**, **`require_budget_obra_role`** — variantes para endpoints donde el `obra_id` viene indirecto (a través de `task_id`, `plano_id`, etc.). Todas resuelven la fila padre, validan tenant y delegan en `assert_obra_access`.
  - `require_task_material_obra_role` es alias de `require_task_obra_role` (mismo path param `task_id`).
  - Las variantes para modelos donde `obra_id` puede ser NULL (`Budget`, `BitacoraEntry`, `Alert`) usan `allow_null_obra=True` — cuando la fila no tiene obra, solo admin de empresa pasa.

Política (idéntica en las tres formas):

1. **Admin de empresa** (`users.role == "admin"`) → pasa siempre en cualquier obra de su tenant.
2. **Non-admin sin fila** en `ObraUserRole` para esa obra → **404** (aislamiento: no revelamos que la obra existe — mismo criterio que ya usa el resto del sistema).
3. **Non-admin con fila** pero rol menor al mínimo pedido → **403** ("Tu rol en esta obra no alcanza para esta acción").

Los niveles se comparan numéricamente: `solo_lectura (1) < colaborador (2) < jefe_obra (3)`. `jefe_obra` puede todo lo del colaborador; colaborador todo lo del solo_lectura.

Detalle relevante: `_resolve_and_assert` verifica tenant solo si el modelo tiene columna `tenant_id` denormalizada. Si no la tiene (ej. `PurchaseOrder`), el chequeo va cubierto por `assert_obra_access(obra_id)` — sin perder aislamiento.

---

## 2. Endpoints tocados y nivel de rol final

**Convención de columna "Rol":** `ADM` = admin de empresa (no reemplazable por jefe_obra); `JO` = jefe_obra; `COL` = colaborador; `SL` = solo_lectura. Prefijo global: `/api/v1`.

### 2.1 Obras (`obras.py`)

| Endpoint | Rol | Nota |
|---|---|---|
| `POST /obras` | ADM | Sin cambios respecto a Fase 0. |
| `GET /obras` | (filtrado) | Cualquier user autenticado. Admin ve todo el tenant; non-admin solo obras donde tenga fila. |
| `GET /obras/{obra_id}` | SL | Antes `CurrentUser` global. |
| `PATCH /obras/{obra_id}` | ADM | Datos maestros de la obra (nombre, cliente, fechas base). |
| `DELETE /obras/{obra_id}` | ADM | Borrar obra reservado a admin de empresa. |
| `GET /obras/{obra_id}/historial` | SL | |

### 2.2 Tareas (`tasks.py`)

| Endpoint | Rol | Nota |
|---|---|---|
| `POST /tasks` | COL | `obra_id` del body → `assert_obra_access` inline. |
| `POST /tasks/obra/{obra_id}/bulk` | JO | Carga masiva. |
| `GET /tasks/obra/{obra_id}` | SL | |
| `POST /tasks/obra/{obra_id}/reorder` | COL | Mutación, pero no cambia datos de tarea individual. |
| `GET /tasks/due-soon` | — | No scoped a obra (global por manager, usado por n8n). Sin cambios. |
| `GET /tasks/{task_id}` | SL | `require_task_obra_role`. |
| `POST /tasks/{task_id}/status` | COL | Ver §3.1 sobre la regla (c) diferida. |
| `POST /tasks/{task_id}/cascade-preview` | SL | No muta, es un preview. |
| `PATCH /tasks/{task_id}` | COL | |
| `DELETE /tasks/{task_id}` | JO | |

### 2.3 Planos (`planos.py`)

| Endpoint | Rol | Nota |
|---|---|---|
| `POST /obras/{obra_id}/planos` | COL | Fase 0 lo dejó abierto por diseño; ahora exige rol COL en la obra. |
| `GET /obras/{obra_id}/planos` | SL | |
| `PATCH /planos/{plano_id}/vigente` | JO | Corregir versión canónica = decisión de gestión. |
| `DELETE /planos/{plano_id}` | JO | |

### 2.4 Alertas (`alerts.py`)

| Endpoint | Rol | Nota |
|---|---|---|
| `GET /alerts?obra_id=` | SL (obra) o filtrado (sin obra) | Con `obra_id` valida SL sobre esa obra. Sin `obra_id`, admin ve todo; non-admin recibe solo alertas cuyo `obra_id` está en su `visible_obra_ids`. |
| `PATCH /alerts/mark-all-read?obra_id=` | COL (obra) o filtrado (sin obra) | Sin `obra_id` para non-admin: itera las obras visibles y marca en cada una. |
| `PATCH /alerts/{alert_id}/read` | COL | `require_alert_obra_role`. |

### 2.5 Bitácora (`bitacora.py`)

| Endpoint | Rol | Nota |
|---|---|---|
| `POST /obras/{obra_id}/bitacora/audio` | COL | |
| `POST /obras/{obra_id}/bitacora/texto` | COL | |
| `GET /bitacora?obra_id=` | SL (obra) o filtrado | Sin `obra_id` filtra a obras visibles; entradas sin `obra_id` se dejan pasar solo si el user es admin. |
| `GET /bitacora/pending-count?obra_id=` | SL (obra) | Sin `obra_id`: cualquier user autenticado (count agregado). |
| `GET /bitacora/unassigned` | ADM | Notas huérfanas → solo admin las resuelve. Reemplaza el `CurrentUser` histórico. |
| `GET /tasks/{task_id}/bitacora` | SL | |
| `POST /bitacora/{entry_id}/transcript` | COL | |
| `POST /bitacora/{entry_id}/reprocess` | COL | |
| `POST /bitacora/{entry_id}/obra` | JO | Requiere JO sobre la nota ORIGINAL (o admin si `obra_id` de la nota es NULL) **y** JO sobre la obra DESTINO. |
| `POST /bitacora/{entry_id}/suggestions/{index}/apply` | COL | La sugerencia crea/edita tarea = COL. |
| `POST /bitacora/{entry_id}/suggestions/{index}/dismiss` | COL | |
| `DELETE /bitacora/{entry_id}` | JO | |

### 2.6 Calendario laboral (`calendar.py`)

| Endpoint | Rol |
|---|---|
| `GET /obras/{obra_id}/calendar` | SL |
| `PUT /obras/{obra_id}/calendar` | JO |
| `POST /obras/{obra_id}/calendar/exceptions` | JO |
| `DELETE /obras/{obra_id}/calendar/exceptions/{exception_id}` | JO |
| `POST /obras/{obra_id}/calendar/load-holidays` | JO |

### 2.7 Baseline (`baseline.py`) y Ruta crítica (`critical_path.py`)

| Endpoint | Rol |
|---|---|
| `POST /obras/{obra_id}/baseline` | JO |
| `GET /obras/{obra_id}/baseline` | SL |
| `GET /obras/{obra_id}/critical-path` | SL |

### 2.8 Exports (`exports.py`) y Imports (`imports.py`)

| Endpoint | Rol |
|---|---|
| `GET /exports/obras/{obra_id}/excel` | SL |
| `GET /exports/obras/{obra_id}/presupuesto-excel` | SL |
| `GET /exports/template-excel` | — (plantilla global, sin cambios) |
| `POST /imports/project-excel` (preview) | — (no crea nada) |
| `POST /imports/project-excel/confirm` | JO | `obra_id` del body → `assert_obra_access` inline. |

### 2.9 Equipo de obra (`obra_team.py`)

| Endpoint | Rol |
|---|---|
| `GET /obras/{obra_id}/team` | SL |
| `POST /obras/{obra_id}/team` | JO |
| `PATCH /obras/{obra_id}/team/{responsible_id}` | JO |
| `DELETE /obras/{obra_id}/team/{responsible_id}` | JO |

Fase 0 los tenía en ADM; Fase 2 los baja a JO (el jefe_obra gestiona su equipo — ver `fase-1-modelo.md` §2.1). La asignación de **users con rol** a la obra sigue siendo ADM y se implementa en Fase 3.

### 2.10 Compras (`purchase_orders.py`, `task_materials.py`, `solicitudes.py`)

| Endpoint | Rol |
|---|---|
| `GET /obras/{obra_id}/presupuesto` | SL |
| `GET /obras/{obra_id}/purchase-orders` | SL |
| `POST /obras/{obra_id}/purchase-orders` | JO |
| `POST /purchase-orders/{order_id}/send` | JO |
| `POST /purchase-orders/{order_id}/receive` | COL |
| `GET /tasks/{task_id}/materials` | SL |
| `POST /tasks/{task_id}/materials` | COL |
| `PATCH /tasks/{task_id}/materials/{material_id}` | COL |
| `DELETE /tasks/{task_id}/materials/{material_id}` | JO |
| `GET /obras/{obra_id}/solicitudes-cotizacion` | SL |
| `POST /obras/{obra_id}/solicitudes-cotizacion` | JO |
| `POST /obras/{obra_id}/analisis-compras` | SL |
| `POST /solicitudes-cotizacion/{solicitud_id}/confirmar` | JO |
| `POST /solicitudes-cotizacion/{solicitud_id}/confirmar-contratista` | JO |
| `DELETE /solicitudes-cotizacion/{solicitud_id}` | JO |

### 2.11 Budgets (`budgets.py`)

Budgets tiene la particularidad de que `obra_id` es nullable (algunos son globales del tenant).

| Endpoint | Rol |
|---|---|
| `POST /budgets/upload` con `obra_id` | COL |
| `POST /budgets/upload` sin `obra_id` | ADM |
| `POST /budgets/text` con `obra_id` | COL |
| `POST /budgets/text` sin `obra_id` | ADM |
| `GET /budgets?obra_id=` | SL (obra) o filtrado |
| `GET /budgets/{budget_id}` | SL (obra) o ADM (huérfano) |
| `DELETE /budgets/{budget_id}` | JO (obra) o ADM (huérfano) |
| `POST /budgets/compare` | admin o si todos los budgets están en obras visibles del user |

---

## 3. Decisiones que ameritan explicitación

### 3.1 `POST /tasks/{task_id}/status` — regla (c) diferida

`fase-1-modelo.md` §2 mencionaba tres reglas de acceso a este endpoint: (a) admin, (b) rol COL/JO en la obra, (c) es el responsible asignado a la tarea. En esta fase implemento **(a) + (b)** y difiero **(c)** a Fase 4.

Motivo: `Task.responsible_id` apunta a `responsibles.id`, no a `users.id`. Un `Responsible` es un contacto de WhatsApp sin login; no tiene relación directa con un `User` autenticado más allá del `whatsapp_number`. Match user↔responsible ameritaría una query extra por request y no hay caso operativo que lo requiera hoy — el bot entra por webhook con firma HMAC (no JWT), así que no cruza este endpoint. El día que un mismo humano tenga login **y** número, la Fase 4 (que también reevalúa el desdoble User/Responsible) va a resolver esto de forma coherente.

Test canary: `test_colaborador_puede_cambiar_estado_de_tarea` (colab con rol COL → 200 o 400 pero **nunca 403/404**) y `test_solo_lectura_NO_puede_cambiar_estado_de_tarea` (colab con rol SL → 403).

### 3.2 `GET /bitacora/unassigned` requiere ADM

Antes cualquier user autenticado del tenant podía verlo. Ahora, como estas entradas por definición no tienen `obra_id` (son notas de WhatsApp sin obra asignada), no hay un rol por-obra que las cubra — el único criterio coherente con la matriz es "solo admin de empresa". Si en el futuro se decide que `jefe_obra` también deba poder verlas (para triage), se afloja acá.

### 3.3 `POST /bitacora/{entry_id}/obra` requiere JO sobre origen Y destino

Reasignar una nota de obra A a obra B implica: (i) sacarla de A (requiere JO sobre A), (ii) ponerla en B (requiere JO sobre B). Fue implementado como dos chequeos secuenciales: la dependency valida JO en la obra ACTUAL de la nota (o admin si `obra_id` de la nota es NULL, gracias a `allow_null_obra=True`), y el handler valida JO sobre la obra DESTINO via `assert_obra_access`.

### 3.4 Budgets sin obra son globales del tenant → ADM

`Budget.obra_id` es nullable. El caso `NULL` representa un presupuesto general del tenant (no atribuido a ninguna obra). No hay rol por-obra que aplique — la Fase 2 asigna ADM en ese subcaso, tanto para create como para read y delete. Con `obra_id` presente, la política estándar (SL/COL/JO) aplica.

### 3.5 Alertas y bitácora "sin obra_id explícito" — filtrado en Python

Los endpoints `GET /alerts` y `GET /bitacora` aceptan un `obra_id` opcional. Cuando falta, el service traía todo el tenant (comportamiento previo). Ahora, si el user no es admin, filtro en Python las filas cuyo `obra_id` no está en `visible_obra_ids(user)`. Es correcto funcionalmente y evita cambiar la firma del service (que otros lugares consumen), a costo de traer más filas de las necesarias. Si el volumen escala, se puede refactorizar el service para aceptar `obra_ids: set[int] | None` y filtrar en SQL.

### 3.6 `obra_permissions.py` acepta modelos sin `tenant_id` denormalizado

`PurchaseOrder` es el único modelo hijo de obra sin `tenant_id` denormalizado. `_resolve_and_assert` verifica tenant solo si el modelo tiene esa columna; si no, delega el aislamiento a `assert_obra_access(obra_id)` (que compara `Obra.tenant_id == user.tenant_id`). Sin este ajuste, `send_order` para admin de A sobre una order de A devolvía 404 (bug detectado por el test `test_order_send_is_idempotent`).

---

## 4. Tests

### 4.1 Tests nuevos

**`backend/tests/test_role_guards.py` — reescrito** para reflejar la política Fase 2. 24 tests, todos pasan.

Estructura del fixture `ctx`: crea tenant + admin + colaborador **sin fila en `ObraUserRole`**. Cada test que necesita el colab con un rol específico llama `await _assign(...)` antes del request. Esto documenta la intención de cada test explícitamente.

Cobertura:

- **Oracle transversal:** colab sin fila → 404 en GET obra; admin → 200; `solo_lectura` → 200 en GET pero 403 en cualquier mutación (crear, editar, borrar tarea).
- **Obras:** un colab con **jefe_obra en la obra** no puede crear/editar/borrar obra (ADM). Admin sí puede.
- **Tareas:** colab con **COL** puede crear y editar tarea, no puede borrarla ni hacer bulk (JO). Colab con **JO** puede borrar. Colab con **COL** puede cambiar estado; con **SL** no. Colab sin fila → 404 en status.
- **Planos:** colab con **COL** puede subir. Colab con **COL** no puede borrar; con **JO** sí.
- **Aislamiento entre obras (`ctx_two_obras`):** colab con `jefe_obra` en obra A puede operar en A, recibe 404 en obra B, no puede mutar tareas de B. `GET /obras` devuelve solo A. Admin ve las dos.

**`backend/tests/test_planos.py` — fixture actualizado** para asignar rol COLABORADOR al colab en la obra. Ningún test se agregó ni se sacó — los 8 existentes siguen semánticamente:
- `test_collaborator_can_upload` → sigue esperando 201 (COL puede subir).
- `test_collaborator_cannot_delete` → sigue esperando 403 (COL no puede borrar; ahora sale porque rol < JO en vez de por AdminUser).
- `test_set_latest_requires_admin` → sigue esperando 403.
- `test_update_records_who_uploaded_each_version` → colab hace v2, ahora legítimo porque tiene rol.

### 4.2 Tests existentes ajustados

Solo `test_planos.py` requirió cambio (el fixture, ver arriba). `test_role_guards.py` se reescribió entero. Ningún otro archivo se tocó — todos los tests de mutaciones existentes usaban tokens **admin de empresa**, que en Fase 2 es superset absoluto y sigue pasando.

Un fallo antiguo, `test_tenant_isolation.py::test_order_send_is_idempotent`, dejó de ser flaky después del fix descripto en §3.6.

### 4.3 Resultado de la suite

Última corrida por bloques:

| Bloque | Módulos | Resultado |
|---|---|---|
| A | `test_role_guards` (24), `test_planos` (?), `test_tenant_isolation`, `test_plan_limits`, `test_bitacora`, `test_alerts_filter`, `test_admin_usage`, `test_critical_path` | **86 passed** |
| B | `test_email_verification`, `test_health`, `test_imports`, `test_infra_robustez`, `test_invite_context`, `test_password_reset`, `test_rate_limit`, `test_refresh_token`, `test_startup_validation`, `test_tenant_denorm`, `test_upload_signing` | **53 passed** |
| **Total** | 19 módulos + `test_role_guards` reescrito | **139 passed, 0 failed** |

Suite completa en un solo comando (`pytest --tb=line -q`): **139 passed, 0 failed** en 25s. No hubo flakes de I/O esta vez — el issue de fase 0 se resolvió cuando los guards pararon de disparar retries dentro de la misma transacción SQLite.

---

## 5. Archivos entregados

**Backend — producción (14 archivos):**

- **Módulo nuevo:** `backend/app/core/obra_permissions.py` — la política, en un solo lugar.
- **Routers modificados (13):** `obras.py`, `tasks.py`, `planos.py`, `alerts.py`, `bitacora.py`, `calendar.py`, `baseline.py`, `critical_path.py`, `exports.py`, `imports.py`, `obra_team.py`, `purchase_orders.py`, `task_materials.py`, `solicitudes.py`, `budgets.py`.

**Backend — tests (2 archivos):**

- `backend/tests/test_role_guards.py` — reescrito (24 tests nuevos).
- `backend/tests/test_planos.py` — fixture extendido con rol COL para el colab.

**Sin tocar (a propósito):**

- Frontend (Fase 3).
- Flujo de invitación / gestión de user roles por-obra (Fase 3).
- Backfill de datos existentes (Fase 5).
- `POST /webhooks/twilio` (usa firma HMAC, no JWT — fuera del scope de la política).

---

## 6. Notas para las próximas fases

- **Fase 3 (UI + endpoints de gestión):** exponer `POST/PATCH/DELETE /obras/{id}/user-roles` (o el path que se decida) que consume los schemas ya creados en Fase 1. La pantalla "Equipo de la obra" gana un tab de "Usuarios con login" separado del de "Responsables". La asignación de rol `jefe_obra` sigue siendo ADM (matriz §2.1); `colaborador` y `solo_lectura` los puede asignar el propio `jefe_obra`.
- **Fase 4 (afinado):** implementar la regla (c) en `POST /tasks/{task_id}/status` — el usuario puede si es el responsible de la tarea. Requiere primero decidir la política de match user↔responsible (probablemente por `whatsapp_number`).
- **Fase 5 (backfill):** política sugerida — para cada `Obra` existente, crear `ObraUserRole(user_id=obra.manager_id, role=jefe_obra)`. Los demás collaborators del tenant quedan sin acceso hasta que un admin/JO los asigne (política estricta). Alternativa permisiva: migrar todo el equipo del tenant a `colaborador` en todas las obras. Decisión final con el usuario antes de correr el script.
- **Socket manager:** `socket_manager.connect` sigue suscribiendo al usuario a **todas** las rooms `obra_{id}` del tenant. Cuando la Fase 3 aterrice, filtrar la suscripción a `visible_obra_ids(user)`. No es urgente porque los eventos son informativos (no confidenciales) y el filtrado real de datos ya está en los endpoints REST, pero es consistencia deseable.
