# Fase 0 — Cerrar guards y bypasses del sistema binario admin/collaborator

> **Alcance:** parche de seguridad previo al rediseño del sistema de roles. No introduce granularidad nueva ni permisos por-obra — eso es la Fase 1. Esta fase solo cierra los agujeros que las auditorías 01, 03 y 05 identificaron en el modelo binario actual (`admin` vs `collaborator`).

**Fecha:** 2026-08-23
**Rama:** `audit/05-planos` (parte del bloque previo al rediseño de roles).

---

## 1. Rutas tocadas y decisión en cada endpoint

### 1.1 Obras (`backend/app/api/routes/obras.py`)

| Endpoint | Antes | Ahora | Nota |
|---|---|---|---|
| `POST /obras` (`create_obra`) | `CurrentUser` | **`AdminUser`** | Mutación pura del portfolio. No hay caso legítimo de collaborator creando obras. |
| `PATCH /obras/{id}` (`update_obra`) | `CurrentUser` | **`AdminUser`** | Ídem. |
| `DELETE /obras/{id}` (`delete_obra`) | `CurrentUserId` | **`AdminUser`** | Ídem. Cambió también la firma: `user_id: CurrentUserId` → `current_user: AdminUser` (pasa `current_user.id` al service). |
| `GET /obras`, `GET /obras/{id}`, `GET /obras/{id}/historial` | `CurrentUser` | `CurrentUser` | Lecturas, sin cambios. |

### 1.2 Tareas (`backend/app/api/routes/tasks.py`)

| Endpoint | Antes | Ahora | Nota |
|---|---|---|---|
| `POST /tasks` (`create_task`) | `CurrentUser` | **`AdminUser`** | El collaborator no debería crear tareas nuevas en el plan de obra. |
| `POST /tasks/obra/{id}/bulk` (`bulk_create_tasks`) | `CurrentUser` | **`AdminUser`** | Carga masiva desde Excel. Además se pasó a chequear `requested=len(rows)` (ver §2). |
| `PATCH /tasks/{id}` (`update_task`) | `CurrentUser` | **`AdminUser`** | |
| `DELETE /tasks/{id}` (`delete_task`) | `CurrentUser` | **`AdminUser`** | |
| **`POST /tasks/{id}/status` (`update_task_status`)** | `CurrentUserId` | **`CurrentUserId` (sin cambios)** | **Decisión documentada, ver abajo.** |
| `POST /tasks/obra/{id}/reorder` (`reorder_tasks`) | `CurrentUserId` | `CurrentUserId` (sin cambios) | Fuera del alcance explícito del pedido; sin datos hoy para decidir si el collaborator debe reordenar el WBS. Marcado para Fase 1. |
| `POST /tasks/{id}/cascade-preview` | `CurrentUserId` | `CurrentUserId` (sin cambios) | No muta nada. |
| Lecturas (`GET /tasks/obra/{id}`, `GET /tasks/{id}`, `GET /tasks/due-soon`) | `CurrentUserId` | `CurrentUserId` (sin cambios) | `due-soon` lo consume n8n. |

Import: se removió `CurrentUser` (ya no queda ningún endpoint que lo use en este módulo).

#### Decisión: por qué `POST /tasks/{id}/status` sigue abierto a collaborator

El enunciado del pedido explícitamente pone este endpoint bajo la lupa como caso dudoso ("cambiar el estado de una tarea propia"). Tres razones para mantenerlo sin `AdminUser` en esta fase:

1. **Bot de WhatsApp / n8n.** El bot toma reportes de campo del responsable de la tarea y llama este endpoint con el JWT emitido para el flujo de conversación. Bloquearlo con `AdminUser` rompe el circuito principal del producto (que es *justamente* que la obra reporte desde WhatsApp).
2. **Ejemplo canónico del rediseño.** El pedido menciona textualmente "cambiar el estado de una tarea propia" como el caso que debería seguir permitido. Es el caso del colaborador que ya está asignado a una tarea y la marca en progreso / completada.
3. **Fase 1 lo reemplaza.** El sistema de permisos por-obra que viene va a poder expresar "el usuario tiene permiso de update_status sobre las tareas donde es responsable"; hasta entonces, aplicar `AdminUser` acá sería un backslide sobre un flujo que el negocio necesita.

**Cobertura:** un test explícito (`tests/test_role_guards.py::test_collaborator_puede_cambiar_estado_de_tarea`) valida el comportamiento como afirmativo y sirve de canary para no regresarlo por accidente.

### 1.3 Planos (`backend/app/api/routes/planos.py`)

| Endpoint | Antes | Ahora | Nota |
|---|---|---|---|
| `POST /obras/{id}/planos` (`upload_plano`) | `CurrentUser` | **`CurrentUser` (sin cambios — decisión documentada)** | |
| `PATCH /planos/{id}/vigente` (`set_plano_vigente`) | `AdminUser` (ya) | `AdminUser` | Ya estaba correcto por el fix previo de `audit/05-planos`. |
| `DELETE /planos/{id}` (`delete_plano`) | `AdminUser` (ya) | `AdminUser` | Ídem. |

#### Decisión: por qué `upload_plano` sigue abierto a collaborator

- El test `tests/test_planos.py::test_collaborator_can_upload` (línea 99) **valida explícitamente** que un collaborator recibe 201 al subir. Es política de producto declarada, no un bug.
- El caso de uso real es: el maestro mayor / jefe de obra (colaborador) sube la foto o PDF marcado del plano desde el campo. Bloquear esto rompe el flujo.
- Solo la **corrección** (marcar la versión vigente) y la **destrucción** (borrar) del plano requieren admin, que es lo que el fix previo ya había implementado.

Se agregó `tests/test_role_guards.py::test_collaborator_si_puede_subir_plano` para dejar explícita la decisión **en el módulo de guards** (redundante con el test de planos, intencional: los dos tests fallarían si alguien cambia el guard sin darse cuenta).

---

## 2. Bypasses del plan corregidos

### 2.1 Conteo de usuarios ignoraba invitaciones pendientes

**Archivo:** `backend/app/core/plan_limits.py`

**Bug:** `check_plan_limit(..., "users")` contaba `WHERE tenant_id=? AND is_active=TRUE`. Con eso, un admin podía mandar N invitaciones (todas devolvían 201 porque `is_active` seguía en `False`), y cuando las N se aceptaban en batch el tenant terminaba por encima del límite del plan.

**Fix:** el conteo ahora incluye los usuarios **activos** o los que tienen una **invitación viva** (`invitation_token IS NOT NULL AND invitation_expires_at > NOW()`):

```python
select(func.count()).where(
    User.tenant_id == tenant_id,
    or_(
        User.is_active == True,
        (User.invitation_token.isnot(None)) & (User.invitation_expires_at > now),
    ),
)
```

Adicionalmente:
- La firma de `check_plan_limit` ahora acepta `requested: int = 1` (default 1, por retro-compatibilidad).
- La comparación pasó de `current >= limit` a `current + requested > limit`. Semánticamente idéntica cuando `requested=1`; permite chequear correctamente el bulk (`requested=len(rows)`) y el "estamos por debajo del límite" con `requested=0` (usado por el doble candado de `accept_invite`, ver 2.3).

### 2.2 `bulk_create_tasks` bypaseaba el límite

**Archivo:** `backend/app/api/routes/tasks.py`

Antes se llamaba `check_plan_limit(...)` sin importar cuántas filas venían en el bulk. Si el limit era 50 y `current=48`, un bulk de 4 filas dejaba la obra en 52/50.

**Fix:** ahora se pasa `requested=len(data.rows)`. También se removió el import redundante de `check_plan_limit` dentro del handler (ya estaba a nivel módulo).

### 2.3 Doble candado en `accept-invite`

**Archivo:** `backend/app/services/auth_service.py`

**Fix:** antes de flipear `is_active=True` sobre el usuario invitado, se re-invoca `check_plan_limit(session, tenant_id, "users", requested=0)`. Con el nuevo conteo, la invitación viva del propio usuario ya está incluida en `current`, así que `requested=0` verifica "estamos dentro del límite ahora mismo" sin duplicar el slot.

**Caso que cubre:** el admin invita N usuarios, después baja de plan (o alguien manipula la DB), y las invitaciones pendientes siguen queriendo aceptarse. Sin este candado el tenant podría terminar por encima del límite aún con el fix del `invite` original.

Bonus del fix: se normalizó el manejo de `invitation_expires_at.tzinfo` (SQLite devuelve naive) para no romper la comparación en tests.

---

## 3. Suite de tests

### 3.1 Baseline (antes de los cambios)

**No obtenido en una sola corrida.** Al ejecutar `pytest --tb=short -q` sobre toda la suite en un solo comando, el proceso queda "colgado" (0 output después de varios minutos, CPU ~0%). El síntoma es un `sqlite3.OperationalError: disk I/O error` intermitente en el archivo `/tmp/constructa_test.db` compartido — típico de aiosqlite cuando muchos tests reciclan el schema en sucesión rápida. No es una regresión de la Fase 0 (reproducido antes y después de mis cambios) y no bloquea la fase.

**Reemplazo del baseline:** corrí la suite en tres bloques secuenciales cubriendo el 100% de los módulos existentes. Todo lo relacionado con los cambios (auth, obras, tasks, planos, admin, tenants) se ejecutó explícitamente.

### 3.2 Tests nuevos agregados

Dos archivos nuevos, 16 tests, todos pasando:

**`backend/tests/test_role_guards.py` (11 tests)** — un test por endpoint tocado, más sanity checks:

- `test_collaborator_no_puede_crear_obra` — POST `/obras` → 403
- `test_collaborator_no_puede_editar_obra` — PATCH `/obras/{id}` → 403
- `test_collaborator_no_puede_borrar_obra` — DELETE `/obras/{id}` → 403
- `test_admin_si_puede_crear_obra` — POST `/obras` con admin → 201 (sanity: el guard no rompe el flujo)
- `test_collaborator_no_puede_crear_tarea` — POST `/tasks` → 403
- `test_collaborator_no_puede_editar_tarea` — PATCH `/tasks/{id}` → 403
- `test_collaborator_no_puede_borrar_tarea` — DELETE `/tasks/{id}` → 403
- `test_collaborator_no_puede_bulk_tasks` — POST `/tasks/obra/{id}/bulk` → 403
- `test_collaborator_puede_cambiar_estado_de_tarea` — POST `/tasks/{id}/status` con collab → **no 403** (canary de la decisión documentada)
- `test_collaborator_no_puede_borrar_plano` — DELETE `/planos/{id}` → 403 (test regressional del fix previo)
- `test_collaborator_si_puede_subir_plano` — POST `/obras/{id}/planos` con collab → 201 (canary de la decisión documentada)

**`backend/tests/test_plan_limits.py` (5 tests)** — reproducen el bypass y validan la corrección:

- `test_invitaciones_pendientes_cuentan_hacia_el_limite` — plan `max_users=3`, admin activo + 2 invitaciones pendientes → 3/3; la 3ra invitación falla con **402** (`code=plan_limit_reached`, `resource="usuarios"`). Este es exactamente el bypass del audit 01 §5.2.
- `test_invitaciones_vencidas_no_cuentan` — invitaciones con `invitation_expires_at` en el pasado liberan slot (verificación complementaria).
- `test_accept_invite_revalida_limite` — invito 2 usuarios (3/3), después bajo el límite del plan a 2 (queda 3/2), aceptar la invitación falla con **402**. Cubre el doble candado.
- `test_bulk_create_tasks_respeta_requested` — precargo 3 tareas (limit 5), bulk de 3 → 402 (repro del audit 03 §7.3).
- `test_bulk_create_tasks_dentro_del_limite_pasa` — sanity: precargo 2, bulk de 3 → 201.

### 3.3 Tests existentes revisados

Ninguno de los tests actuales asumía que un collaborator pudiera crear/editar/borrar obras o tareas. Los tests de mutación (`test_tenant_isolation.py`) siempre usan tokens **admin**; el único uso de `collaborator` en la suite era para probar aislamiento cross-tenant sobre el propio endpoint de admin (cambio de rol, delete de usuarios), que sigue funcionando.

En planos (`tests/test_planos.py`) el test `test_collaborator_can_upload` sigue pasando porque la decisión fue mantener el upload abierto.

### 3.4 Resultado final de la suite

Corrida por bloques:

| Bloque | Módulos | Resultado |
|---|---|---|
| 1 (auth + roles + mutaciones) | `test_invite_context`, `test_tenant_isolation`, `test_planos`, `test_admin_usage`, `test_role_guards`, `test_plan_limits` | **67 passed, 1 failed** |
| 2 (features no relacionadas — a) | `test_alerts_filter`, `test_bitacora`, `test_critical_path`, `test_email_verification`, `test_health`, `test_imports`, `test_infra_robustez`, `test_password_reset` | **30 passed** |
| 3 (features no relacionadas — b) | `test_rate_limit`, `test_refresh_token`, `test_startup_validation`, `test_tenant_denorm`, `test_upload_signing` | **29 passed** |
| **Total** | 19 módulos | **126 passed, 1 failed** |

**El único fallo** es `tests/test_tenant_isolation.py::test_order_send_is_idempotent`, con `sqlite3.OperationalError: disk I/O error` — flaky por el file-based SQLite compartido cuando corre en el bloque grande. **Re-ejecutado aislado (`pytest tests/test_tenant_isolation.py::test_order_send_is_idempotent`) → pasa en 0.89s.** Sin relación con los cambios de la Fase 0 (el test no involucra roles ni límites de plan; ejercita idempotencia de envío de purchase orders).

**Nuevos (Fase 0):** 16/16 pasan.

---

## 4. Notas para Fase 1

Cosas que quedan explícitamente **fuera** de esta fase y son entrada de la siguiente:

1. **Permisos por-obra.** Reemplazar el binario `admin`/`collaborator` global por un modelo tipo `role_in_obra` (arquitecto, jefe, comprador, etc.) que exprese cosas como "este user puede update_status sobre tareas donde es responsable en esta obra".
2. **`POST /tasks/{id}/status`** debe re-evaluarse cuando exista esa granularidad. Idealmente: "el collaborator puede cambiar el estado solo si es el responsable de la tarea, o tiene el rol jefe-de-obra en esa obra".
3. **`reorder_tasks` y `cascade-preview`** también quedan sin cambios; la decisión de si el jefe de obra puede reordenar el WBS es de producto y va a depender del modelo de la Fase 1.
4. **`InternalAuth` para bot/n8n.** Hoy el bot usa el JWT del usuario impersonado. Cuando existan permisos por-obra, conviene separar el actor "sistema" del actor "user" para no ensuciar los eventos de historial.
5. **`is_verified`.** El flag existe pero no bloquea login. Es un tema relacionado con la seguridad de la cuenta, no de RBAC, pero conviene resolverlo antes de abrir el sistema a permisos más granulares.

---

## 5. Diff resumen

**Backend — código productivo (4 archivos):**

- `backend/app/api/routes/obras.py` — 3 endpoints migrados a `AdminUser`.
- `backend/app/api/routes/tasks.py` — 4 endpoints migrados a `AdminUser`; bulk pasa `requested=len(rows)`; import limpiado.
- `backend/app/core/plan_limits.py` — conteo de users incluye invitaciones vivas; agregado parámetro `requested`; `>=` → `+requested >`.
- `backend/app/services/auth_service.py` — `accept_invite` re-invoca `check_plan_limit`.

**Backend — tests (2 archivos nuevos):**

- `backend/tests/test_role_guards.py` (11 tests).
- `backend/tests/test_plan_limits.py` (5 tests).

**Sin tocar:**

- `backend/app/api/routes/planos.py` — decisión de mantener upload abierto y delete ya estaba con `AdminUser`.
- Frontend — no aplica (el frontend ya ocultaba las acciones a collaborators; los guards del backend son la brecha real que faltaba).
