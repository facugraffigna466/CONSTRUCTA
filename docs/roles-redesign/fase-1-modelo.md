# Fase 1 — Modelo de datos para permisos por obra

> **Alcance:** solo modelo de datos + repositorio + schemas Pydantic. Los guards que consumen esta tabla los implementa la Fase 2; el backfill de datos existentes lo hace la Fase 5. Esta fase deja la tabla vacía y las herramientas para leer/escribir.

**Fecha:** 2026-08-23
**Rama:** `audit/05-planos` (continuidad del bloque de rediseño de roles).
**Base:** cierra sobre el trabajo de [`fase-0-guards.md`](./fase-0-guards.md), que aseguró que las mutaciones globales solo las hace un admin de empresa. Esta fase agrega la posibilidad de que un *no-admin* tenga permisos concretos sobre una obra específica.

---

## 1. Diseño de la tabla

### 1.1 Nombre y columnas

| Nombre | Tipo | Nullable | Nota |
|---|---|---|---|
| `id` | `serial` | not null | PK |
| `obra_id` | `integer` | not null, index, FK obras ON DELETE **CASCADE** | Si se borra la obra, la asignación deja de tener sentido — cascade. |
| `user_id` | `integer` | not null, index, FK users ON DELETE **CASCADE** | Si se borra el usuario, ídem. En la práctica los users se dan de baja con `is_active=False`; el CASCADE es para el caso de hard-delete. |
| `tenant_id` | `integer` | not null, index, FK tenants (sin CASCADE) | **Denormalizado desde la obra**, siguiendo la misma política que `Task`, `Alert`, `ObraTeamMember`, etc. Permite filtros por tenant sin join. |
| `role` | `obra_user_role_type` (ENUM PG) | not null | Valores: `jefe_obra`, `colaborador`, `solo_lectura`. |
| `created_at` | `timestamptz` | not null, default NOW() | Auditoría básica — cuándo se asignó. |

**Constraint:** `UNIQUE (obra_id, user_id)` con nombre `uq_obra_user_role`. Un usuario tiene como máximo un rol por obra; si necesita cambiarlo, se hace UPDATE de la fila existente (implementado como upsert en el repositorio).

**Índices:** btree en `obra_id`, `user_id`, `tenant_id` (los tres lookups que la Fase 2 y la Fase 3 van a ejercitar).

### 1.2 Migración

Archivo: `backend/alembic/versions/0046_add_obra_user_roles.py`
Revision: `0046`, downgrade a `0045`.

- Crea la tabla vacía. No hace backfill.
- Deja que SQLAlchemy cree el tipo ENUM `obra_user_role_type` al crear la tabla. El downgrade dropea explícitamente la tabla y después el tipo (Postgres no lo hace en cascada).
- No agrega columnas ni constraints a `users` u `obras`.

**Corrida en dev:**

```
$ alembic upgrade head
INFO  [alembic.runtime.migration] Running upgrade 0045 -> 0046, add obra_user_roles table (Fase 1 rediseño de roles)
```

Verificación en Postgres:

```
$ \d obra_user_roles
    Column   |           Type           | Nullable | Default
------------+--------------------------+----------+-----------------
 id         | integer                  | not null | nextval(...)
 obra_id    | integer                  | not null |
 user_id    | integer                  | not null |
 tenant_id  | integer                  | not null |
 role       | obra_user_role_type      | not null |
 created_at | timestamp with time zone | not null | now()
Indexes:
    "obra_user_roles_pkey" PRIMARY KEY, btree (id)
    "ix_obra_user_roles_obra_id"   btree (obra_id)
    "ix_obra_user_roles_tenant_id" btree (tenant_id)
    "ix_obra_user_roles_user_id"   btree (user_id)
    "uq_obra_user_role" UNIQUE CONSTRAINT, btree (obra_id, user_id)
FKs: obra→obras(CASCADE), user→users(CASCADE), tenant→tenants
```

---

## 2. Definición de roles (referencia para Fase 2)

> Esta sección es **contrato**: los guards de la Fase 2 se escriben contra estas reglas exactas. Si algún caso no está listado, la Fase 2 decide y lo agrega acá.

Reglas transversales:

- **Todo se resuelve dentro del tenant.** Un rol en una obra solo aplica sobre esa obra y sus recursos hijos (tareas, planos, alertas, historial, materiales, bitácora, equipo de la obra). Nunca cross-tenant.
- **El admin de empresa (`users.role == 'admin'`) es superset absoluto.** No necesita fila en `obra_user_roles`. Puede todo lo que cualquier rol puede + operaciones a nivel empresa (settings, plan, invitar/sacar usuarios, borrar obras).
- **Un `users.role == 'collaborator'` sin fila en `obra_user_roles`** para esa obra **no ve la obra** (equivalente a que no existiera para ese usuario). Los endpoints de mutación siguen rechazando por Fase 0 con 403; el filtro de listado / GET queda para Fase 2.
- **Los operadores de campo sin login (`Responsible` / `ObraTeamMember`)** son un mundo aparte — el bot valida por número de WhatsApp, no por esta tabla. Ver §5.
- **`POST /tasks/{id}/status`** sigue abierto a cualquier user autenticado (Fase 0 documentó el motivo). Cuando la Fase 2 lo revise, el criterio va a ser: el usuario puede si (a) es admin de empresa, o (b) tiene rol `jefe_obra`/`colaborador` en la obra de esa tarea, o (c) es el responsable asignado a la tarea.

### 2.1 `jefe_obra` — control total de UNA obra

**Puede:**

- CRUD completo de **tareas** de la obra (crear, editar, borrar, cambiar estado, bulk create, reorder, cascade-preview).
- CRUD completo de **planos** de la obra (upload, marcar vigente, borrar).
- CRUD completo de **materiales por tarea** y **presupuesto** de la obra.
- CRUD completo de **solicitudes de cotización** y **órdenes de compra** dentro de la obra (crear, enviar por WA/email, marcar recibido).
- Gestionar el **equipo de la obra**: agregar/quitar `Responsible`s (chatbot) y **asignar `colaborador`/`solo_lectura` a otros users** sobre esta obra. No puede degradar admins de empresa ni ascender a otro user a `jefe_obra` (esa promoción la hace un admin de empresa).
- Configurar el **calendario laboral** de la obra, exportaciones (Excel, MS Project), baseline, ruta crítica.
- Leer y responder **alertas**, cerrar eventos del **historial** de la obra.
- Escribir en la **bitácora** de la obra.

**No puede:**

- Borrar la **obra en sí** (queda reservado al admin de empresa; una obra es un contrato/proyecto con implicancias comerciales).
- Modificar los **datos maestros** de la obra que hacen a su identidad: nombre, cliente, fechas de inicio pactadas. Estos siguen siendo del admin de empresa. (Fechas de tareas y avance sí puede.) Semilla para la Fase 2: `PATCH /obras/{id}` sigue exigiendo admin de empresa.
- Nada a nivel **empresa**: configuración global, invitar/sacar usuarios de la empresa, cambiar plan, ver `/admin`, editar Settings del sistema, gestionar proveedores globales (aunque sí puede usarlos en compras de la obra).
- Actuar sobre **otras obras**.

### 2.2 `colaborador` — operar día a día dentro de UNA obra

**Puede:**

- Crear / editar / cerrar **tareas** de la obra (sin borrar).
- Cambiar el **estado** de tareas de la obra (equivalente al canal manual del bot pero desde web).
- **Subir planos** y documentos de la obra (sin marcar vigente ni borrar).
- Cargar / editar **materiales por tarea**, ver presupuesto.
- Registrar recepción de **órdenes de compra** que ya fueron enviadas (marcar recibido, adjuntar remito). No puede crear ni enviar nuevas.
- Escribir en la **bitácora**, responder **alertas** que le lleguen, ver **historial**.
- Ver el **equipo de la obra** (no lo edita).

**No puede:**

- Borrar tareas, planos, materiales, órdenes.
- Marcar planos como vigentes ni borrarlos.
- Crear/enviar solicitudes de cotización u órdenes de compra nuevas (esto sí lo hace `jefe_obra`).
- Modificar la obra en sí (nombre, cliente, fechas maestras).
- Gestionar quién está asignado a la obra (ni users ni responsables).
- Nada a nivel empresa.

### 2.3 `solo_lectura` — visibilidad sin acción

**Puede:**

- **GET** de todos los recursos de la obra: tareas, planos (descarga con URL firmada), materiales, presupuesto, órdenes, bitácora, historial, alertas, equipo, calendario, exportaciones (Excel, MS Project) — cualquier cosa que hoy sea `GET` o generación de reporte read-only.

**No puede:**

- Cualquier mutación (POST, PATCH, DELETE) sobre cualquier recurso de la obra. Sin excepciones.
- Marcar alertas como leídas / cerrarlas (eso es mutación).
- Subir planos (aunque hoy la Fase 0 lo permita para `users.role=collaborator`, cuando la Fase 2 aplique roles por-obra este bloqueo va a pasar por encima).
- Nada a nivel empresa.

Este rol es el que la mayoría de las constructoras van a querer para: cliente/comitente (si en el futuro habilitamos que se loggee), consultor externo, auditor, personal en on-boarding.

### 2.4 Resumen matricial

| Capacidad | admin empresa | jefe_obra | colaborador | solo_lectura |
|---|:---:|:---:|:---:|:---:|
| Ver/listar obras del tenant | todas | esa obra | esa obra | esa obra |
| Crear obra | ✅ | ❌ | ❌ | ❌ |
| Editar/borrar obra (datos maestros) | ✅ | ❌ | ❌ | ❌ |
| CRUD tareas (crear/editar/borrar) | ✅ | ✅ | crea/edita, no borra | ❌ |
| Cambiar estado tarea | ✅ | ✅ | ✅ | ❌ |
| Bulk create tareas | ✅ | ✅ | ❌ | ❌ |
| Upload plano | ✅ | ✅ | ✅ | ❌ |
| Marcar plano vigente / borrar | ✅ | ✅ | ❌ | ❌ |
| Materiales/presupuesto (CRUD) | ✅ | ✅ | crea/edita, no borra | ❌ |
| Crear/enviar cotización u orden | ✅ | ✅ | ❌ | ❌ |
| Marcar orden recibida | ✅ | ✅ | ✅ | ❌ |
| Bitácora (escribir) | ✅ | ✅ | ✅ | ❌ |
| Historial / alertas (leer, cerrar) | ✅ | ✅ | leer + cerrar | leer |
| Asignar `colaborador`/`solo_lectura` a esta obra | ✅ | ✅ | ❌ | ❌ |
| Asignar `jefe_obra` a esta obra | ✅ | ❌ | ❌ | ❌ |
| Invitar/sacar users de la empresa | ✅ | ❌ | ❌ | ❌ |
| Cambiar plan / Settings globales | ✅ | ❌ | ❌ | ❌ |
| Ver panel `/admin` | ✅ | ❌ | ❌ | ❌ |

---

## 3. Repositorio y schemas

### 3.1 Repositorio (`app/repositories/obra_user_role.py`)

Hereda de `BaseRepository[ObraUserRole]`. Métodos específicos:

- `get_role(obra_id, user_id) -> ObraUserRoleType | None` — el lookup que la Fase 2 va a usar dentro del guard `permite_editar_obra(user, obra, action)`.
- `get_by_pair(obra_id, user_id) -> ObraUserRole | None` — fila completa (para PATCH/DELETE).
- `list_by_obra(obra_id) -> list[ObraUserRole]` — para la pantalla "Equipo de la obra" (Fase 3).
- `list_by_user(user_id) -> list[ObraUserRole]` — para filtrar el portfolio del collaborator (Fase 2/3).
- `set_role(*, obra_id, user_id, tenant_id, role) -> ObraUserRole` — **upsert** por (obra_id, user_id). El caller es responsable de haber leído `tenant_id` de la obra (no confiar en input del cliente para evitar cross-tenant).
- `remove(obra_id, user_id) -> bool` — quita al user de la obra.

Smoke-test corrido contra la BD local (`postgres://.../constructa`): `set_role` crea la primera vez, actualiza en la segunda (mismo `id`), `get_role` devuelve el enum, `list_by_obra` lista, `remove` borra y devuelve `True`.

### 3.2 Schemas (`app/schemas/obra_user_role.py`)

- `ObraUserRoleCreate { obra_id, user_id, role }` — `tenant_id` no se recibe del cliente.
- `ObraUserRoleUpdate { role }` — deliberadamente solo permite cambiar el rol; para reasignar a otro user u otra obra se borra y se crea (mantiene el histórico limpio).
- `ObraUserRoleRead { id, obra_id, user_id, tenant_id, role, created_at }` — `from_attributes=True`.

Ninguno expone datos sensibles del user (email, avatar, etc.); si la Fase 3 necesita hidratación, lo hace en el service, no en el schema.

---

## 4. Decisiones de nombres y convención

### 4.1 `ObraUserRole` en vez de `ObraUserAssignment` o `ObraUserMember`

- `ObraTeamMember` ya existe y significa "responsable de campo (WhatsApp, sin login) que participa en la obra". Nombrar al modelo nuevo `ObraUserMember` invitaría a confundirlos y a intentar unificarlos — precisamente lo que la auditoría 04 pidió que no hagamos todavía.
- El sustantivo distintivo del modelo nuevo NO es la asignación en sí (todas las junction tables son asignaciones), sino **el rol que se le está dando a un user en una obra**. `Role` en el nombre lo hace obvio.
- El pedido inicial sugirió el nombre; no encontré razón para desviarme.

### 4.2 Enum SQLAlchemy en vez de VARCHAR + CHECK

- Consistente con `TaskStatus`, `ObraStatus`, `AlertType`, etc. — todos los estados con dominio cerrado del proyecto usan `enum.Enum` + `SAEnum`.
- Type-safe en el código de la Fase 2/3 (mypy y editor completions).
- `member_type` en `ObraTeamMember` es `VARCHAR(20)` sin CHECK — pero ese campo nació antes de la política de enums y no aplica al de acá.

### 4.3 `tenant_id` denormalizado y NOT NULL

- Misma política que Fase 2 de denormalización (migraciones 0040/0041): toda tabla hija de `obras` guarda `tenant_id` para poder filtrar sin join, y NOT NULL desde el día uno (no arrastramos el problema de nullables como pasó con obras/tasks originales).
- El caller es responsable de leerlo de la obra (`Obra.tenant_id`) antes de invocar el repositorio — el schema **no** lo acepta del cliente.

### 4.4 Solo `created_at`, sin `updated_at`

- El único mutable de la fila es el `role`. Un `updated_at` sería útil para auditar "cuándo se cambió el rol del user X en la obra Y", pero:
  - El requisito explícito del enunciado fue "role, created_at".
  - El evento de cambio de rol va a quedar en `historial_eventos` (append-only) cuando la Fase 3 exponga los endpoints — ese es el lugar canónico de auditoría en este sistema, no un `updated_at` en la fila.
  - Si en la Fase 3 aparece un caso concreto que lo pide, se agrega ahí con una migración chica.

### 4.5 Sin relación bidireccional en `User`

- `Obra` sí gana `user_roles: list[ObraUserRole]` (paralelo a `team_members`).
- `User` NO gana el relationship inverso para no tener que tocar `user.py` en esta fase y no agregar ruido en un modelo que ya tiene muchas columnas.
- Cuando la Fase 3 lo necesite (probablemente para el listado "mis obras" del collaborator), `ObraUserRoleRepository.list_by_user(user_id)` cubre el uso sin relationship. Si termina justificándose, se agrega ahí.

---

## 5. Cómo se relaciona con lo que ya existe

- **No reemplaza `users.role`** (admin/collaborator). El campo global sigue existiendo y sigue diferenciando quién puede operar a nivel empresa. Lo que cambia es que "colaborador" deja de ser un permiso global sobre todas las obras y pasa a ser el estado por defecto de un user sin fila en esta tabla.
- **No reemplaza ni consume `ObraTeamMember`** (responsables de campo). Los `Responsible` son contactos de WhatsApp identificados por número (`whatsapp_number` unique). No tienen login. La auditoría 04 identificó que hay traslape conceptual con `User` y sugirió eventualmente unificar; hasta entonces, cada uno tiene su propia junction con `Obra`. Un mismo humano que tiene login **y** número puede terminar como una fila en `users` + una en `responsibles` — la unificación se hace en Fase avanzada.
- **`obra.manager_id`** sigue apuntando a un `User` (creador/dueño de la obra). El manager conceptualmente equivale a `jefe_obra` para esa obra, pero **no se materializa** una fila `ObraUserRole` para él en esta fase — la Fase 5 va a decidir la política de backfill (probablemente: al asignar un manager, se crea/actualiza la fila con `role=jefe_obra`).
- **Guards actuales (Fase 0)** siguen valiendo tal cual. Los mutation endpoints exigen admin de empresa. La Fase 2 los va a suavizar para que también acepten users con rol adecuado en esta tabla — pero es un cambio aditivo: el admin nunca deja de poder.

---

## 6. Archivos entregados

**Backend — producción (5 archivos):**

- `backend/app/models/obra_user_role.py` — modelo + enum `ObraUserRoleType`.
- `backend/app/models/obra.py` — se agregó relationship `user_roles`.
- `backend/app/models/__init__.py` — registro del modelo y del enum en `__all__`.
- `backend/app/schemas/obra_user_role.py` — Create/Update/Read.
- `backend/app/repositories/obra_user_role.py` — repositorio con lookups específicos + upsert.

**Migración:**

- `backend/alembic/versions/0046_add_obra_user_roles.py`.

**Sin tocar en esta fase (a propósito):**

- Endpoints y guards (Fase 2).
- Frontend (Fase 3 va a agregar la UI de gestión).
- Datos existentes (Fase 5).

---

## 7. Verificación

- `alembic upgrade head` corre limpio contra la BD local (`postgres://.../constructa`) y la tabla queda como se describió en §1.2.
- Smoke-test del repositorio contra la BD real: `set_role` (create), `set_role` (upsert), `get_role`, `list_by_obra`, `remove` — todo funciona como se espera; los tipos ENUM se serializan correctamente en ambos sentidos.
- Suite de tests relevantes (`test_role_guards`, `test_plan_limits`, `test_tenant_isolation`, `test_planos`, `test_health`): **65 passed, 0 failed**. No hay regresiones — el modelo nuevo se registra en el metadata sin conflictos con los demás.

---

## 8. Notas para las próximas fases

- **Fase 2** (guards): implementar `permite_editar_obra(user, obra, action)` / `permite_leer_obra(user, obra)` en un módulo nuevo `app/core/obra_permissions.py` (o similar). Este módulo tira de `ObraUserRoleRepository.get_role()` y compara contra la matriz de §2.4. Los routers existentes cambian su dependency de `AdminUser` a un `require_obra_permission(action=...)` para las acciones que la matriz habilita a non-admins.
- **Fase 3** (UI + endpoints de gestión): agregar `POST/PATCH/DELETE /obras/{id}/team-users` (o el path que se decida) que consume los schemas de acá. La pantalla "Equipo de la obra" del frontend gana un tab para users con rol.
- **Fase 4** (afinado): reevaluar `POST /tasks/{id}/status` para que use el guard nuevo con la regla (c) del §2 (usuario es responsible de la tarea).
- **Fase 5** (backfill): decidir la política de datos históricos. Sugerido: para cada obra existente, crear `ObraUserRole(user_id=obra.manager_id, role=jefe_obra)`. Los demás collaborators del tenant quedan sin acceso hasta que un admin los asigne explícitamente (política estricta) — o migrar a `colaborador` en todas las obras del tenant (política permisiva compatible con el comportamiento previo). El enunciado del rediseño insinuó preferir la política estricta, pero la Fase 5 lo confirma con el usuario.
