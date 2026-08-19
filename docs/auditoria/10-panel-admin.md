# Auditoría 10 — Panel Admin

> Módulo auditado: pantalla `AdminPage.tsx` → endpoint `GET /admin/usage`, gestión de planes y límites de tenant. Auditoría conducida con backend y DB en vivo.

---

## 1. Resumen ejecutivo

El Panel Admin es una pantalla **puramente informativa** que hace exactamente lo que promete: mostrar el plan del tenant con sus límites y el consumo actual. Los conteos son correctos para todos los tenants con `tenant_id` válido, y el componente visual `UsageBar` maneja correctamente los límites nulos (plan enterprise → "ilimitado"). Los límites de obras y tareas se aplican realmente en el backend.

Sin embargo, **no está production-ready** por tres razones:

1. **El patrón condicional de conteo tiene una rama `else` que produciría datos globales de todos los tenants** si `tenant_id=NULL`. Hoy ese estado no ocurre por código normal, pero el modelo lo permite (columna nullable), el comentario del código admite que el bug ya se manifestó antes para tareas, y la rama incorrecta está viva esperando ser activada por un cambio de código o un usuario de ops sin tenant. En la prueba en vivo: cuando `tenant_id=NULL`, el endpoint colapsa con 500 (antes de que los conteos se expongan), pero la rama global está ahí.

2. **`tenant.active_until` no se hace cumplir en ningún lado del sistema.** Probado en vivo: con `active_until` = ayer, el tenant sigue logueándose, creando obras y accediendo a todos los endpoints. El campo es cosmético.

3. **No hay forma de cambiar el plan desde la app.** El CTA es un `mailto:` que apunta a `hola@constructa.app`. Si ese dominio no está registrado, el email rebota en silencio.

---

## 2. Inventario de funcionalidad

| Función | Implementada | Probada y funciona | Archivo(s) |
|---------|-------------|-------------------|------------|
| `GET /admin/usage` con guard `AdminUser` | Sí | Sí | `backend/app/api/routes/admin.py:15` |
| Mostrar nombre del tenant y plan | Sí | Sí (tenant 2 → "Empresa de facundo / Básico") | `AdminPage.tsx:119-139` |
| Barra de uso: obras (current / limit) | Sí | Sí (2/3 para tenant 2) | `AdminPage.tsx:143`, `UsageBar` |
| Barra de uso: usuarios activos (current / limit) | Sí | Sí (2/6 para tenant 2) | `AdminPage.tsx:144` |
| Total de tareas (informativo, sin límite global) | Sí | Sí (49 para tenant 2) | `AdminPage.tsx:149-161` |
| Límite por obra mostrado como texto | Sí | Sí ("hasta 50 tareas por obra") | `AdminPage.tsx:155-160` |
| Barra naranja al 80% / roja al 100% | Sí | Sí | `UsageBar component:20-24` |
| Mensaje "Límite alcanzado" al 100% | Sí | Sí | `UsageBar:45-49` |
| Advertencia `active_until` (banner naranja) | Sí (visual) | Sí (se muestra) | `AdminPage.tsx:134-138` |
| `active_until` bloquea acceso al sistema | **No** | **No** — probado en vivo, expirado sigue operando | — |
| Botón "Contactar" para upgrade | Sí (`mailto:`) | Parcial — el link se genera, pero el dominio no está verificado | `AdminPage.tsx:172-176` |
| CTA oculto en plan enterprise (limits = null) | Sí | Sí (enterprise no ve "¿Necesitás más capacidad?") | `AdminPage.tsx:164` |
| Botón "Actualizar" con spinner | Sí | Sí | `AdminPage.tsx:89-96` |
| Enforcement límite obras (`POST /obras` → 402) | Sí | **Sí — reproducido** (3/3 → 402 con mensaje estructurado) | `plan_limits.py:36-44`, `obras.py:16` |
| Enforcement límite users (`POST /users/invite` → 402) | Parcial | Parcial — cuenta solo `is_active=TRUE` (ver audit 01/09) | `plan_limits.py:46-55` |
| Enforcement límite tasks/obra (`POST /tasks` → 402) | Sí (código) | No reproducido esta ronda (requiere 50 tareas en una obra) | `plan_limits.py:57-66`, `tasks.py:27` |
| Cambio de plan desde UI | **No** | — | — |
| Esquema Pydantic `PlanUsage` / `TenantRead` | Sí | Sí | `schemas/plan.py` |

---

## 3. Hallazgo de fuga de conteo global

### 3.1 El patrón de código

`backend/app/api/routes/admin.py`, líneas 38-52:

```python
obras_q = await db.execute(
    select(func.count()).where(Obra.tenant_id == tenant_id) if tenant_id
    else select(func.count(Obra.id))                          # ← cuenta TODAS las obras
)
users_q = await db.execute(
    select(func.count()).where(User.tenant_id == tenant_id, User.is_active == True) if tenant_id
    else select(func.count(User.id)).where(User.is_active == True)  # ← cuenta TODOS los activos
)
tasks_q = await db.execute(
    select(func.count(Task.id)).where(Task.tenant_id == tenant_id) if tenant_id
    else select(func.count(Task.id))                          # ← cuenta TODAS las tareas
)
```

Si `current_user.tenant_id` es `None` (o cualquier valor falsy), la condición ternaria cae al `else`, que lanza queries sin filtro de tenant. En la DB de prueba, eso daría:
- `obras_count = 14` (en vez del valor real del tenant)
- `users_count = 10` (en vez del valor real)
- `tasks_count = 148` (en vez del valor real)

El comentario en el código ya documenta que este bug se manifestó para `tasks_count` en versiones anteriores:
> *"Antes contaba todas las del sistema (número equivocado en el panel del tenant + fuga del total global de tareas de otras empresas)."*

La "corrección" fue agregar `Task.tenant_id == tenant_id` a la cláusula WHERE del branch `if tenant_id`, pero la rama `else` de los tres counters sigue sin filtro.

### 3.2 ¿Puede un admin real tener `tenant_id = None`?

**En la práctica hoy: No.** Verificado contra la DB en vivo:

```
Users with tenant_id=NULL: 0
```

- `POST /auth/register` crea tenant + usuario en la misma transacción; siempre setea `user.tenant_id = tenant.id`.
- `POST /users/invite` pone `tenant_id = current_user.tenant_id` (el admin que invita siempre tiene tenant).

**Sin embargo, el modelo y el esquema de BD lo permiten:**

```python
# app/models/user.py:28
tenant_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("tenants.id"), nullable=True)
```

`usuarios.tenant_id` es `nullable=True` en el modelo SQLAlchemy y en la migración 0022. La migración 0041 forzó `NOT NULL` en `obras`, `tasks`, y otras tablas hija — pero **no en `users`**.

Escenarios que podrían producir `tenant_id=NULL`:
- Un usuario de operaciones creado directamente en la DB (para debugging / seeding).
- Un bug en un futuro endpoint que olvide asignar `tenant_id`.
- Pre-migración 0022: el backfill usó `SELECT id FROM tenants LIMIT 1` (orden no determinístico), que podría haber asignado tenants incorrectos a usuarios legacy.

### 3.3 Prueba en vivo del else-branch

Se creó un usuario con `tenant_id=NULL` directamente en la DB (`null-tenant-test@example.com`, `role=admin`, `is_active=True`) y se le solicitó `GET /admin/usage`.

**Resultado: HTTP 500 "Error interno del servidor".**

El colapso NO es por las queries de conteo — ocurre antes. `TenantRead.created_at` es de tipo `datetime` (no opcional en el schema Pydantic), pero el código pasa `None` cuando `tenant is None`:

```python
tenant_read = TenantRead(
    ...
    created_at=tenant.created_at if tenant else None,  # ← None en campo datetime obligatorio
    ...
)
```

Pydantic lanza `ValidationError` → FastAPI devuelve 500 antes de que las queries de conteo se ejecuten.

**Conclusión:** hoy, el state `tenant_id=NULL` produce un crash (500), no una fuga de datos. Pero:

1. La fuga existía antes y se documentó (ver comentario del código).
2. Si se corrige el crash (haciendo `created_at` opcional o poniendo un fallback), las queries de conteo global seguirían ahí, exponiendo los totales del sistema.
3. Un refactor futuro que reordene el código (poner los conteos antes de la construcción de `TenantRead`) expondría los datos sin avisar.
4. El patrón incorrecto está en tres lugares y es un accidente esperando ocurrir.

---

## 4. ¿Los límites del plan se aplican de verdad?

### Obras — ✅ Enforcement probado

Tenant 2 (plan básico, `max_obras=3`) tenía 2 obras. Probado en vivo:

```
POST /obras (tercera)  → 200 OK  (obra creada, id=35)
POST /obras (cuarta)   → 402 Payment Required:
  "Alcanzaste el límite de obras para el plan basico (3/3). Actualizá tu plan para continuar."
```

El modal `UpgradeModal.tsx` parsea el 402 estructurado y lo muestra correctamente.

### Usuarios — ⚠️ Enforcement parcialmente bypaseable

El check cuenta `is_active=TRUE`. Las invitaciones pendientes (`is_active=FALSE`) no se cuentan. Se puede invitar N usuarios de golpe (todos quedan pendientes, 0 activos), y cuando todos aceptan, el tenant supera el límite sin que nadie lo haya bloqueado. Este bug fue reproducido en la auditoría 01 con 8 usuarios activos sobre un límite de 6. **Referencia: audit 01, secciones 3 y 5.2.**

### Tareas por obra — ✅ En código, no reproducido en esta ronda

`plan_limits.py:57-66` y `tasks.py:27` tienen la llamada. No se reprodujo porque requiere 50 tareas en una sola obra (tenant 2 tiene 26 y 23). Se documenta como "en código".

---

## 5. Vigencia del tenant (`active_until`)

### Resultado de la prueba en vivo

Se modificó `tenants.id=8` (`CONSTRUCTA Demo SRL`, plan enterprise) para tener `active_until = NOW() - INTERVAL '1 day'` (fecha pasada) y se verificó el acceso:

```
POST /auth/login            → 200 OK  (login funciona)
GET  /obras                 → 200 OK  (4 obras devueltas)
POST /obras                 → 200 OK  (nueva obra creada, id=34)
GET  /admin/usage           → 200 OK  (muestra active_until vencido, sin bloqueo)
```

**El sistema no hace cumplir `active_until` en ningún punto del código.** El campo no aparece en:
- `get_current_user()` (`deps.py`) — solo verifica `is_active`.
- `require_admin()` — solo verifica `role`.
- `check_plan_limit()` — solo verifica conteos vs límites del plan.
- Ningún middleware ni interceptor.

`active_until` aparece en exactamente tres lugares del código:
1. `Tenant` model (`tenant.py:19`) — definición de columna.
2. `admin.py:33` — se devuelve en la respuesta de `GET /admin/usage`.
3. `AdminPage.tsx:134-138` — se muestra un banner amarillo informativo.

**Conclusión: `active_until` es un dato que se almacena y se muestra, pero nunca se hace cumplir. Una suscripción "vencida" tiene exactamente las mismas capacidades que una activa.**

---

## 6. Qué tiene sentido como está

**Pantalla puramente informativa:** Para una etapa donde los upgrades son sales-assisted (el CTA lleva a un email de contacto), una pantalla de lectura que muestra consumo vs límites es exactamente lo que el admin necesita. No necesita ser más compleja mientras el proceso de venta es manual.

**CTA oculto para plan enterprise:** El bloque "¿Necesitás más capacidad?" solo aparece cuando `obras_limit !== null || users_limit !== null`. Enterprise (todo null) no lo ve. Correcto — no tiene sentido mostrarle upgrade a alguien en el plan máximo.

**`UsageBar` con colores semánticos:** Verde < 80%, naranja 80-99%, rojo al límite. Funciona bien visualmente. El componente es limpio y reutilizable (se usa también en `ConfiguracionPage.tsx`).

**Tareas mostradas sin límite global:** El plan limita tareas *por obra*, no el total. Mostrar el total con `limit=null` (sin barra de porcentaje) y aclarar el límite por obra como texto es técnicamente correcto. La anotación "Tu plan permite hasta X tareas por obra" es clara.

**Guard `AdminUser` en el único endpoint:** Correcto. No tiene sentido que un collaborator vea métricas del plan o del tenant.

**Botón "Actualizar" con spinner:** Pequeño detalle bien resuelto — el admin puede refrescar los datos sin recargar la página, y el spinner da feedback durante la carga.

---

## 7. Qué no tiene sentido, está a medias o no funciona

### 7.1 `active_until` es decorativo

El sistema permite gestionar un campo de vigencia del tenant, mostrarlo como advertencia en el panel, pero nunca lo hace cumplir. Si la intención era modelar una suscripción con fecha de vencimiento (para planes anuales o trials), el campo existe pero no produce ningún comportamiento diferente cuando vence. Es una promesa incumplida que puede confundir a futuras personas que lean el código y asuman que el sistema corta el acceso.

Si la intención era solo informativa ("acordate de renovar antes de esta fecha"), es válido, pero el banner en `AdminPage.tsx` dice "Activo hasta: {fecha}" en color naranja — una advertencia que implica que algo va a pasar cuando llegue esa fecha. Nada pasa.

### 7.2 Rama `else` en queries de conteo (riesgo latente)

Detallado en sección 3. El patrón `if tenant_id else count(*)` sin filtro de tenant es incorrecto en las tres queries. Hoy no se activa, pero el estado que lo activa (`tenant_id=NULL`) es alcanzable en la DB y el modelo lo permite.

### 7.3 `tasks_count` mide el total, el límite es por obra — la relación no es directa

El panel muestra "49 tareas totales (todas las obras)" y abajo dice "Tu plan permite hasta 50 tareas por obra." Un admin que ve "49" podría pensar "casi al límite global", cuando en realidad tiene 2 obras con 26 y 23 tareas cada una — ambas holgadas respecto al límite de 50 por obra. Si alguna obra llegara a 50, el 402 aparece al crear la siguiente tarea, sin que el panel haya advertido nada específico sobre esa obra.

No hay barra de progreso por obra para el límite de tareas. El único warning es el 402 en el momento de la acción.

### 7.4 No hay forma de cambiar el plan desde la app

El CTA lleva a `mailto:hola@constructa.app`. Sin saber si ese dominio está registrado y configurado, el email podría rebotar silenciosamente. Además, no hay self-serve: el admin no puede ver los detalles de todos los planes disponibles desde la pantalla, solo sabe que existe el plan "Pro" (hardcodeado en el texto: "El plan Pro tiene 20 obras, 30 usuarios y tareas ilimitadas"). Si se cambian los planes en la DB, esa descripción queda desactualizada.

### 7.5 `TenantRead.created_at` no es opcional pero se le pasa `None`

```python
class TenantRead(BaseModel):
    created_at: datetime   # no Optional
```

Cuando `tenant is None`, el código pasa `created_at=None`, lo que crashea con 500. Debería ser `created_at: datetime | None` o manejarse con un tenant vacío placeholder. Este crash es el que "salva" de la fuga de datos, pero por razones equivocadas.

### 7.6 El CTA "Contactar" hardcodea la descripción del plan Pro

```tsx
<p>El plan Pro tiene 20 obras, 30 usuarios y tareas ilimitadas.</p>
```

Si los límites del plan Pro cambian en la DB (seed), el texto en pantalla no se actualiza. Debería derivar los valores del siguiente plan desde los datos de la API.

---

## 8. Mejoras propuestas

### P0 — Corregir el patrón de conteo en `admin.py`

**Qué cambiar:** eliminar la rama `else` de las tres queries y reemplazarla por un retorno de error explícito si `tenant_id` es None.

```python
@router.get("/usage", response_model=PlanUsage)
async def get_tenant_usage(current_user: AdminUser, db: DbSession):
    tenant_id = current_user.tenant_id
    if not tenant_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Usuario sin tenant asignado. Contactá soporte.",
        )
    # ... resto del código sin condición ternaria
    obras_q = await db.execute(select(func.count()).where(Obra.tenant_id == tenant_id))
    users_q = await db.execute(
        select(func.count()).where(User.tenant_id == tenant_id, User.is_active == True)
    )
    tasks_q = await db.execute(select(func.count(Task.id)).where(Task.tenant_id == tenant_id))
```

**Por qué:** elimina el riesgo de fuga de datos global cuando `tenant_id=None`, produce un error comprensible en lugar de un 500 opaco, y es más explícito que el patrón ternario.

**Esfuerzo:** BAJO (5 líneas). **Riesgo:** NULO.

El mismo cambio aplica a `plan_limits.py:24-26`, que ya tiene:
```python
if tenant_id is None:
    return  # silently skip — correcto, no cambia nada
```
Ese está bien; el problema es solo `admin.py`.

### P0 — Hacer NOT NULL a `users.tenant_id` en una migración

**Qué cambiar:** una migración que haga `ALTER TABLE users ALTER COLUMN tenant_id SET NOT NULL`.

**Por qué:** cierra la posibilidad estructural del estado `tenant_id=NULL`. Migración 0041 lo hizo para `obras` y tablas hija; `users` se olvidó.

**Esfuerzo:** BAJO (migración de una línea + backfill de seguridad si hay nulos). **Riesgo:** BAJO — el backfill de la migración 0022 ya asignó tenants a todos los usuarios existentes, así que no debería haber nulos. Verificar antes con `SELECT COUNT(*) FROM users WHERE tenant_id IS NULL`.

### P1 — Hacer cumplir `active_until`

**Qué cambiar:** en `get_current_user()` (`deps.py`), después de verificar `user.is_active`, verificar también si el tenant del usuario tiene `active_until` vencida:

```python
if user.tenant_id:
    from app.models.tenant import Tenant
    tenant = await db.get(Tenant, user.tenant_id)
    if tenant and tenant.active_until and tenant.active_until < datetime.now(timezone.utc):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "tenant_expired", "message": "Tu plan venció. Contactá soporte para renovarlo."},
        )
```

**Por qué:** si el campo existe y se muestra como advertencia, debería producir algún comportamiento. Actualmente es una promesa que no se cumple.

**Esfuerzo:** BAJO backend, BAJO frontend (mostrar mensaje de "plan vencido" en lugar de error genérico). **Riesgo:** MEDIO — hay que asegurarse de que ningún tenant en producción tenga `active_until` en el pasado accidentalmente antes de desplegar. Agregar un endpoint de ops para extender `active_until` antes de activar.

**Alternativa más conservadora:** no bloquear el acceso, pero sí enviar un email al owner cuando `active_until < NOW() + 7 days` (recordatorio de renovación). Bajo riesgo, bajo esfuerzo, más acorde con la etapa actual.

### P1 — Corregir `TenantRead.created_at` a opcional

```python
class TenantRead(BaseModel):
    ...
    created_at: datetime | None = None
```

**Por qué:** el código puede pasar `None` al campo; el schema debe reflejarlo. El crash actual es el síntoma; el schema incorrecto es la causa raíz.

**Esfuerzo:** TRIVIAL (una línea). **Riesgo:** NULO.

### P2 — Descripción del plan Pro dinámica

**Qué cambiar:** en `AdminPage.tsx`, en lugar de hardcodear "El plan Pro tiene 20 obras, 30 usuarios y tareas ilimitadas", derivar los valores del siguiente tier desde la API.

Esto requiere que `GET /admin/usage` devuelva también la lista de planes disponibles (o al menos el siguiente), o un endpoint separado `GET /plans`.

**Esfuerzo:** MEDIO. Requiere endpoint nuevo. **Riesgo:** BAJO.

**Alternativa más simple:** mantener el texto hardcodeado pero agregar un comentario en el código de que se debe actualizar si cambian los planes en la migración de seed.

### P2 — Advertencia por obra cerca del límite de tareas

**Qué cambiar:** en `AdminPage.tsx`, listar las obras con su porcentaje de uso de tareas cuando el tenant tiene `tasks_per_obra_limit` definido. Al menos un warning visual si alguna obra está al 80%+ de su límite.

Requiere que `GET /admin/usage` devuelva una lista de obras con `task_count` por obra, o un endpoint `GET /obras?include_task_count=true`.

**Esfuerzo:** MEDIO. **Riesgo:** BAJO.

### P2 — CTA con planes reales

**Qué cambiar:** en `AdminPage.tsx`, mostrar un resumen de todos los planes disponibles (nombre, precios, límites) cuando el usuario quiere "ver más". Consumir los datos de `GET /plans` (endpoint nuevo).

**Esfuerzo:** MEDIO (endpoint + UI). **Riesgo:** BAJO.

---

## 9. Riesgos

| Severidad | Hallazgo | Detalles | Estado |
|-----------|----------|----------|--------|
| **MEDIO** | Rama `else` en queries de conteo puede exponer totales globales | Si `tenant_id=NULL`, las queries de obras/users/tasks cuentan el sistema entero. Hoy el crash de TenantRead lo bloquea antes, pero es un accidente esperando ocurrir en un refactor. | **Abierto** — `admin.py:39-52` |
| **MEDIO** | `active_until` no se hace cumplir | Un tenant con suscripción vencida opera igual que uno activo. El campo es solo cosmético. | **Abierto** — sin enforcement en `deps.py` ni en ningún middleware |
| **BAJO** | `users.tenant_id` nullable en modelo y DB | El schema permite el estado que activa las ramas de conteo global. Una migración NOT NULL lo cerraría. | **Abierto** — modelo `user.py:28`, no cubierto por migración 0041 |
| **BAJO** | `TenantRead.created_at` no opcional pero recibe None | Produce 500 en lugar de 400 cuando `tenant_id=NULL`. Es el crash que "salva" de la fuga, pero por razones accidentales. | **Abierto** — `schemas/plan.py:22` |
| **BAJO** | Límite de usuarios bypasseable vía invitaciones masivas | Documentado en auditoría 01 sección 5.2. El check cuenta solo activos. | **Abierto** (heredado de audit 01/09) |
| **INFO** | Descripción del plan Pro hardcodeada en `AdminPage.tsx` | Puede quedar desactualizada si se modifican los límites del plan en la DB. | **Abierto** — `AdminPage.tsx:169` |
| **INFO** | CTA email a `hola@constructa.app` — dominio no verificado | Si el dominio no tiene MX configurado, los emails rebotan silenciosamente. | **Pendiente verificar** |

### Nota sobre la "fuga" cross-tenant

Contrariamente a la preocupación inicial, en la prueba en vivo el estado `tenant_id=NULL` produce un **500, no una fuga de datos**. Pero el camino al 500 pasa por queries que SÍ cuentan globalmente, y una corrección futura del crash sin eliminar esas queries expondría los datos. El fix correcto es eliminar las ramas `else` globales, no solo parchear el schema.
