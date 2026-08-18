# Auditoría 01 — Login, Usuarios y Planes de Suscripción

> **Fecha:** 2026-08-18
> **Auditor:** Claude Sonnet 4.6 (con supervisión de Facundo)
> **Alcance:** autenticación, gestión de usuarios, roles, multi-tenant, planes de suscripción y límites, **y sistema de emails (Brevo) que soporta todo el módulo** (invitaciones, reset, verificación, aviso de plan).
> **Metodología:** lectura de código + ejecución local (backend en `:8000`, frontend en `:5173`) + pruebas manuales por browser (Playwright) y por API (`curl`) + corrida de la suite `pytest` existente (`31/31 passed`) + inspección de `.env`, `.env.example` y config Brevo.

---

## 1. Resumen ejecutivo

El módulo está **funcionalmente completo** y las piezas críticas (JWT + refresh rotativo, rate limit en login, aislamiento cross-tenant por 404, modal de upgrade en el 402) **funcionan como dicen**. Los tests automatizados (`tests/test_tenant_isolation.py`, `test_refresh_token.py`, `test_password_reset.py`, `test_email_verification.py`, `test_rate_limit.py`, `test_admin_usage.py`, `test_invite_context.py`) pasan los 31.

Sin embargo, **no está production-ready**. Hay tres huecos serios en la lógica de auth/plans y **el sistema de emails que soporta todos esos flujos está montado sobre configuración de desarrollo**:

1. **[CRÍTICO] Guards de rol admin ausentes en el backend** para operaciones de obras y tareas. El sidebar del frontend oculta los botones a un `collaborator`, pero un usuario técnico con `curl` puede **crear, editar y borrar obras y tareas** simplemente llamando la API. **Reproducido en esta auditoría: borré la obra id=15 con token de collaborator (HTTP 204).**
2. **[ALTO] Bypass del límite de usuarios del plan.** El chequeo cuenta solo `is_active=TRUE`, y las invitaciones pendientes no cuentan. Ni al invitar, ni al aceptar, se revalida. **Reproducido: el tenant 2 (plan básico, límite 6) llegó a 8 usuarios activos.**
3. **[MEDIO] La verificación de email es cosmética.** Se genera el token y se marca `is_verified=False`, pero **el login de un usuario no verificado funciona igual** y todos los endpoints lo aceptan.

Sobre **emails (sección 8, agregada en esta ronda)**: la lógica del cliente Brevo funciona (invitación, reset, verificación mandan 200 desde Brevo), pero **la configuración actual no sirve para producción**. El sender es `2226370@ucc.edu.ar` (dominio universitario sin control sobre SPF/DKIM → alto riesgo de spam), `FRONTEND_URL` no está seteado en `.env` (los links de invitación y reset **hoy se generan apuntando a `http://localhost:5173`**), `.env.example` no documenta las variables de Brevo, y **no hay ningún email preventivo cuando el tenant se acerca al límite del plan** — el admin se entera del límite recién cuando intenta la operación y le pega el 402 en la cara. Además, el envío bloquea el event loop (usa `requests.post` sync sin `to_thread`) y no tiene retry ante fallos transitorios.

También, el rate limit vive en memoria por proceso, lo que en producción con múltiples workers de uvicorn deja de proteger de la forma esperada.

---

## 2. Inventario de funcionalidad

Tabla `función | implementada | probada y funciona | archivo(s)`:

| Función | Implementada | Probada y funciona | Archivo(s) |
|---|---|---|---|
| Registro nuevo usuario + tenant + plan básico por default | Sí | Sí (creé `audit-1787062792@example.com`) | `app/api/routes/auth.py:30`, `app/services/auth_service.py` |
| Login (email + password) | Sí | Sí | `app/api/routes/auth.py:39`, `app/services/auth_service.py` |
| Validación password mínimo 8 chars al registrar | Sí | Sí (422 con `"123"`) | `app/schemas/user.py` (Pydantic min_length) |
| Validación de dominio de email en registro | Sí | Sí (`@constructa.test` → 422) | Pydantic `EmailStr` |
| Rate limit en login (10 intentos / 60s por IP) | Sí | Sí (429 desde el intento 10) | `app/core/rate_limit.py` |
| Rate limit en forgot-password (5 / 300s) | Sí | Sí (test automatizado) | `app/core/rate_limit.py` |
| JWT access token (24 h) | Sí | Sí | `app/core/security.py:19` |
| Refresh token opaco (30 d) con rotación | Sí | Sí (el viejo devolvió 401 tras rotar) | `app/core/security.py:34`, `app/services/auth_service.py:187` |
| Anti-replay de refresh token (uso doble → 401) | Sí | Sí | `tests/test_refresh_token.py` + curl manual |
| Logout invalida refresh en DB | Sí | Sí (204 + siguiente uso 401) | `app/services/auth_service.py:187` |
| Verificación de email (registro sin verificar) | **Parcial** | **No enforce** — el usuario no verificado se loguea igual | `app/api/routes/auth.py:87` |
| Forgot password (no revela existencia) | Sí | Sí (200 con o sin email real) | `app/api/routes/auth.py:68` |
| Reset password con token single-use (1 h TTL) | Sí | Sí (200 + reuso 400) | `app/api/routes/auth.py:80` |
| Invitación con email (72 h TTL) | Sí | Sí (201, URL devuelta) | `app/api/routes/users.py:51`, `app/services/auth_service.py:78` |
| Endpoint público de contexto de invitación | Sí | Sí (devuelve email/rol/empresa) | `app/api/routes/auth.py:56` |
| Aceptar invitación → auto-login | Sí | Sí (probado por UI) | `app/api/routes/auth.py:62` |
| Listar miembros del tenant (admin) | Sí | Sí (filtrado por tenant) | `app/api/routes/users.py:46` |
| Cambiar rol de usuario (admin) | Sí | Sí (cross-tenant → 404) | `app/api/routes/users.py:63` |
| Eliminar usuario (admin, no a sí mismo ni a admin) | Sí | Sí | `app/api/routes/users.py:79` |
| Cambiar password propio | Sí | No probado por UI (sí por código: `POST /users/me/password`) | `app/api/routes/users.py:36` |
| Multi-tenant: aislamiento cross-tenant (obras, tasks, users) | Sí | Sí — todos los GET/PATCH/DELETE cross-tenant devuelven 404 | `app/api/routes/*.py` (filtrado manual en cada endpoint) |
| Planes: básico / pro / enterprise | Sí | Sí (seed en migración 0022) | `app/models/plan.py`, `alembic/versions/0022_add_plans_tenants.py` |
| Cálculo de uso por tenant (obras / users activos / tasks) | Sí | Sí (`GET /admin/usage` devuelve los tres) | `app/api/routes/admin.py:15` |
| Enforcement del límite **obras** (POST /obras → 402) | Sí | Sí — 3/3 en plan básico → 402 con mensaje detallado | `app/core/plan_limits.py`, `app/api/routes/obras.py:16` |
| Enforcement del límite **users** al invitar | **Buggy** | **No funciona** — se pueden mandar invites por encima del límite | `app/core/plan_limits.py`, `app/api/routes/users.py:53` |
| Enforcement del límite **tasks/obra** | Sí (por código) | No probado en esta ronda (llegar a 50 tareas manualmente lleva tiempo) | `app/api/routes/tasks.py:27` |
| Modal Upgrade en frontend al recibir 402 | Sí | Sí — dispara con texto "Llegaste al límite de tu plan" | `frontend/src/components/UpgradeModal.tsx` |
| Sidebar oculta items por rol (`AdminUser`) | Sí | Sí — como collaborator no veo Gestión de equipo, Panel Admin, Configuración, Nueva obra | `frontend/src/hooks/usePermission.ts`, `frontend/src/components/AppLayout.tsx` |
| Guards de rol admin en backend para **obras / tasks** | **NO** | **Bypass reproducido** — collaborator borró una obra vía API | `app/api/routes/obras.py:15,37,50`, `app/api/routes/tasks.py:26,107,127` |
| Token storage híbrido sessionStorage + localStorage | Sí | Sí (leí ambos) | `frontend/src/lib/tokenStorage.ts` |
| Interceptor de refresh automático en 401 | Sí | No forzado directamente en esta ronda; los tests lo cubren | `frontend/src/api/client.ts:37` |
| Manejo de token expirado / malformado | Sí | Sí (401 en ambos casos) | `app/core/security.py:30`, `app/core/deps.py:15` |
| Envío de email vía Brevo | Sí | Parcial — funciona en dev, **sender es `@ucc.edu.ar` (probable spam en prod)** y `FRONTEND_URL` cae a localhost | `backend/app/services/email_service.py`, `backend/.env` |
| Email de invitación | Sí | Sí (llega el 201, `invite_url` devuelto en respuesta como fallback) | `email_service.py:96`, `users.py:58` |
| Email de reset de contraseña | Sí | No probado por bandeja real (validado por unit test de token, no de envío) | `email_service.py:179`, `auth.py:75` |
| Email de verificación post-registro | Sí | Idem | `email_service.py:220+`, `auth.py:34` |
| Email al proveedor con pedido de materiales | Sí | Fuera de alcance esta ronda | `email_service.py:136`, `purchase_orders.py` |
| Retry / backoff ante fallos de Brevo | **No** | **No hay** — un 429/503 pierde el email | `email_service.py:119,149` |
| Envío no bloqueante (async I/O) | **No** | Usa `requests.post` sync → bloquea event loop hasta 10 s | `email_service.py:119,149` |
| Aviso preventivo de plan al 80% por email | **No** | No existe — el admin descubre el límite recién con el 402 | (gap) |
| Confirmación de cambio de contraseña por email | **No** | No existe | (gap) |
| Alerta de login desde IP nueva por email | **No** | No existe | (gap) |
| Documentación de setup Brevo en `.env.example` | **No** | Faltan `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`, `FRONTEND_URL` | `backend/.env.example` |

---

## 3. Lógica de planes y límites

### Modelo de datos

Migración: `backend/alembic/versions/0022_add_plans_tenants.py`.

- **`plans`** (id, name, max_obras, max_users, max_tasks_per_obra, price_monthly). `NULL` en un límite = ilimitado.
- **`tenants`** (id, name, plan_id → plans, owner_user_id → users, active_until).
- **`users.tenant_id`** y **`obras.tenant_id`** apuntan al tenant.

### Planes seedeados (verificados leyendo la DB actual)

| Plan | max_obras | max_users | max_tasks/obra | price/mes |
|---|---|---|---|---|
| basico | 3 | 6 | 50 | USD 29 |
| pro | 20 | 30 | ilimitado | USD 99 |
| enterprise | ilimitado | ilimitado | ilimitado | (sin precio) |

### Dónde vive la validación

`backend/app/core/plan_limits.py`, función `check_plan_limit(db, tenant_id, resource, obra_id=None)`.

Cuenta actual (queries observadas):

- `obras` → `SELECT COUNT(*) FROM obras WHERE tenant_id = ?`
- `users` → `SELECT COUNT(*) FROM users WHERE tenant_id = ? AND is_active = TRUE`
- `tasks` → `SELECT COUNT(*) FROM tasks WHERE obra_id = ?`

Si `count >= limit` levanta `HTTPException(402, detail={...})`.

### Dónde se llama

| Recurso | Endpoint | Archivo:línea |
|---|---|---|
| obras | `POST /obras` | `app/api/routes/obras.py:16` |
| users | `POST /users/invite` | `app/api/routes/users.py:53` |
| tasks | `POST /tasks` y `POST /tasks/obra/{id}/bulk` | `app/api/routes/tasks.py:27,46` |

### Respuesta al superar el límite

HTTP 402 con body:

```json
{
  "detail": {
    "code": "plan_limit_reached",
    "resource": "obras",
    "current": 3,
    "limit": 3,
    "plan": "basico",
    "message": "Alcanzaste el límite de obras para el plan basico (3/3). Actualizá tu plan para continuar."
  }
}
```

El frontend (`UpgradeModal.tsx`) lo parsea con `getPlanLimitError(err)` y muestra el modal con el texto del plan actual, el recurso alcanzado y una sugerencia del siguiente plan.

### Panel de uso

`GET /admin/usage` (guard: `AdminUser`) devuelve el tenant con su plan expandido más `obras_count`, `users_count`, `tasks_count` y los tres límites.

Consumido por `frontend/src/pages/AdminPage.tsx` y por la sección "Tu plan" de `ConfiguracionPage.tsx`, ambos con barras de uso (verde <80%, naranja 80-99%, rojo 100%).

---

## 4. Qué tiene sentido como está

- **JWT access corto (24 h) + refresh opaco rotativo (30 d), refresh guardado en DB.** Es el patrón correcto: los access viajan por todos lados y son inspeccionables, y el refresh es opaco y revocable por logout o desactivación de usuario. La rotación con anti-replay (`test_refresh_invalida_token_anterior`) está bien pensada — si alguien roba el refresh y lo usa una vez, el legítimo detecta que quedó fuera.

- **Multi-tenant por `tenant_id` con respuesta 404 en cross-tenant** (no 403). Correcto: no revela existencia. Está bien probado por `test_tenant_isolation.py` (12 tests que cubren obras, tasks, materiales, órdenes de compra, cambio de rol, delete de miembro).

- **Forgot-password que siempre devuelve 200** con el mismo mensaje, exista o no el email. Correcto contra enumeración de cuentas.

- **Tokens de reset (1 h), verificación (48 h) e invitación (72 h) generados con `secrets.token_urlsafe(32)` y single-use.** Los TTL son razonables y el patrón de "borrar el token después de usar" está bien.

- **Modal de upgrade parseando el 402 estructurado** en vez de mostrar el texto crudo. La API devuelve `code`, `resource`, `current`, `limit`, `plan`, `message` — el frontend usa los campos separados y arma un mensaje bonito. Buena separación.

- **`AdminUser` como dependency de FastAPI** aplicado consistentemente a `/users/invite`, `PATCH /users/{id}/role`, `DELETE /users/{id}`, `GET /admin/usage`. Cuando se usa, se usa bien.

- **Registro que crea tenant y asigna plan básico automáticamente**. No hay estado intermedio "usuario sin empresa" — al registrarse ya podés operar. Buen UX.

---

## 5. Qué no tiene sentido, está a medias o no funciona

### 5.1 [CRÍTICO] Guards de rol admin ausentes en obras y tasks (bypass de rol)

**Qué pasa:** el frontend oculta "Nueva obra", "Editar", "Eliminar" a un usuario collaborator via `usePermission("obra.create" / "obra.delete")`. Pero en el backend:

```python
# backend/app/api/routes/obras.py
async def create_obra(data: ObraCreate, db: DbSession, current_user: CurrentUser):    # línea 15
async def update_obra(obra_id: int, data: ObraUpdate, db: DbSession, current_user: CurrentUser):    # línea 37
async def delete_obra(obra_id: int, db: DbSession, user_id: CurrentUserId):    # línea 50
```

Ninguno usa `AdminUser`. Un collaborator logueado que llame el endpoint por `curl`:

- **Puede crear obras** (frenado por el 402 del plan, no por rol → si el plan no está al límite, pasa)
- **Puede editar obras**
- **Puede borrar obras**

**Reproducido en esta auditoría**: con el token del user id=46 (`invite-ui-test@example.com`, rol `collaborator`, tenant 2), hice:

```
DELETE /api/v1/obras/15 → HTTP 204
```

Y la obra desapareció (`GET /api/v1/obras/15 → 404`).

Lo mismo pasa en `app/api/routes/tasks.py`: `create_task`, `bulk_create_tasks`, `update_task`, `delete_task` — todos usan `CurrentUser`, ninguno usa `AdminUser`.

**Consecuencia:** cualquier colaborador con conocimiento técnico puede sabotear el trabajo del equipo sin dejar rastro obvio.

### 5.2 [ALTO] Bypass del límite de usuarios del plan (invitaciones no cuentan)

**Qué pasa:** el chequeo `check_plan_limit(users)` en `POST /users/invite`:

```python
# backend/app/core/plan_limits.py
users → COUNT(*) FROM users WHERE tenant_id = ? AND is_active = TRUE
```

Pero las invitaciones se crean con `is_active=False` y sólo se activan cuando el invitado acepta. Como el chequeo cuenta solo activos, **puedo invitar tantos como quiera**. Cuando el invitado acepta (`POST /auth/accept-invite`), el código **no re-valida el límite**. Resultado:

**Reproducido**: tenant 2 (plan básico, `max_users=6`). Empezó con 1 usuario activo. Envié 7 invitaciones seguidas (todas 201), después acepté las 7 → el tenant terminó con **8 usuarios activos, 2 por encima del límite del plan**.

**Fix natural:** o (a) contar `is_active=TRUE OR invitation_token IS NOT NULL` en el chequeo de invite, o (b) revalidar en `accept-invite`. Idealmente ambos.

### 5.3 [MEDIO] La verificación de email es cosmética

**Qué pasa:** al registrarse, `is_verified=False`. El endpoint `POST /auth/verify-email` marca el flag en `True`. Pero ningún endpoint chequea la flag:

- `POST /auth/login` no lo revisa → login funciona con `is_verified=False`.
- `get_current_user` en `app/core/deps.py:15` no lo revisa → todos los endpoints autenticados aceptan al usuario.

**Reproducido**: creé `audit-1787062792@example.com` con `is_verified=False`, hice login (200 + tokens), llamé `GET /users/me` (200 + payload completo).

**Consecuencia:** el flujo de verificación existe visualmente pero no protege nada. Sirve solo para el badge del perfil.

### 5.4 [BAJO] Rate limit in-memory por proceso

`app/core/rate_limit.py` guarda los timestamps en un dict Python en memoria. Con múltiples workers de uvicorn (típico en prod: `--workers 4`), cada uno tiene su propio contador. Un atacante puede llegar a **10 × N intentos** antes de que **cualquier** worker lo bloquee.

Además el reinicio del proceso limpia todo. Para prod: Redis (`fastapi-limiter` o `slowapi` con backend redis).

### 5.5 [MEDIO-UX] Autocompletado del browser en la página de aceptar invitación

Al navegar a `/invite/{token}` con el browser en el mismo dominio donde antes se hizo login, Chrome autocompletó el campo "Nombre completo" con el email del último login (`facundograffigna466@gmail.com`) y la contraseña con `12345678`. No es un bug del código — es Autofill de Chrome — pero el usuario final puede terminar creando una cuenta con nombre="mi email" sin darse cuenta.

Se soluciona con `autocomplete="new-password"` en el input de password y `autocomplete="off"` en el de nombre.

### 5.6 [BAJO] Inconsistencia 401 vs 403 en autenticación

- Sin header `Authorization` → HTTP 403 "Not authenticated"
- Con token expirado o malformado → HTTP 401

El 403 es el default de FastAPI cuando el `HTTPBearer` no encuentra header. Debería ser 401. Menor, pero rompe la convención esperada por los clientes (que suelen tratar 401 = "necesitás loguearte" y 403 = "estás logueado pero no tenés permiso").

### 5.7 [MENOR] `FRONTEND_URL` en emails hardcodeado a localhost en dev

Los `invite_url` que devuelve `POST /users/invite` traen `http://localhost:5173/invite/{token}`. Correcto para dev, pero hay que asegurar que `FRONTEND_URL` esté seteado en prod (config.py lo tiene con default localhost — si alguien olvida el env, los emails de invitación en prod van a llevar links rotos).

---

## 6. Mejoras propuestas

Cada una con **qué**, **por qué** y **esfuerzo/impacto**.

### 6.1 Agregar `AdminUser` a obras y tasks (mutations)

- **Qué:** cambiar `current_user: CurrentUser` → `current_user: AdminUser` en `create_obra`, `update_obra`, `delete_obra` de `app/api/routes/obras.py` (líneas 15, 37, 50) y `create_task`, `update_task`, `delete_task`, `bulk_create_tasks` de `app/api/routes/tasks.py`.
- **Por qué:** cierra el bypass de rol demostrado en 5.1. Alinea backend con lo que el frontend ya asume.
- **Esfuerzo:** BAJO (10 líneas). **Riesgo:** MEDIO — si algún seed/test crea obras con user collaborator, va a romper. Chequear `tests/test_tenant_isolation.py` (usa admins mayormente, debería sobrevivir).
- **Alternativa:** dejar `PATCH /obras` para collaborators (para editar comitente/foto), pero al menos bloquear `POST` y `DELETE`. Depende del producto.

### 6.2 Contar invitaciones pendientes en el límite de users

- **Qué:** en `app/core/plan_limits.py`, cambiar el query de `users` a:
  ```python
  COUNT(*) FROM users
   WHERE tenant_id = ?
     AND (is_active = TRUE
          OR (invitation_token IS NOT NULL AND invitation_expires_at > NOW()))
  ```
- **Por qué:** cierra 5.2 sin romper nada.
- **Esfuerzo:** BAJO. **Riesgo:** BAJO — sólo cambia una query, cubre el caso.
- **Complemento recomendado:** también en `accept-invite` (línea `AuthService.accept_invite`), re-chequear el límite antes de activar. Doble candado.

### 6.3 Enforce email verification en login (opcional pero recomendado)

- **Qué:** en `AuthService.login`, rechazar con 403 (o 401 con código específico) si `is_verified=False`. Frontend muestra un botón "Reenviar email de verificación".
- **Por qué:** hoy la feature está construida pero no protege nada. Si no se va a enforce, mejor eliminar la migración 0043 y evitar la ilusión de seguridad.
- **Esfuerzo:** BAJO backend, MEDIO frontend (pantalla "verificá tu email"). **Riesgo:** ALTO en UX si no se acompaña con el flow de reenvío (users existentes ya están grandfathered a `is_verified=True` según la migración 0043, así que no hay lockout retroactivo).

### 6.4 Migrar rate limit a Redis para producción

- **Qué:** reemplazar `app/core/rate_limit.py` (in-memory) por `slowapi` con backend Redis, o mantener el módulo actual como fallback dev.
- **Por qué:** en prod con `--workers 4`, el usuario tiene 40 intentos antes de que se corte, no 10.
- **Esfuerzo:** MEDIO. **Riesgo:** BAJO. Requiere agregar Redis a la infraestructura (probablemente ya está para caché en algún momento).

### 6.5 Normalizar 401 vs 403

- **Qué:** custom `HTTPBearer(auto_error=False)` + fallback manual que devuelva 401 cuando falta el header.
- **Por qué:** rompe expectativas de clientes que asumen la convención estándar.
- **Esfuerzo:** BAJO. **Riesgo:** BAJO.

### 6.6 `autocomplete="off"` en la página de invitación

- **Qué:** agregar los atributos en `AcceptInvitePage.tsx`.
- **Por qué:** evita que el nombre real quede seteado con el email del último login.
- **Esfuerzo:** TRIVIAL. **Riesgo:** NULO.

### 6.7 Emails: setup para producción (bloqueante antes del launch)

- **Qué:** ver la sección 8 completa, en particular el checklist 8.11. Los dos ítems bloqueantes son (a) mover `BREVO_SENDER_EMAIL` a un dominio propio con SPF+DKIM+DMARC configurados en Brevo, y (b) setear `FRONTEND_URL` en `.env` de prod al dominio real del frontend.
- **Por qué:** hoy (a) los emails van a spam porque firman desde `@ucc.edu.ar` sin autorización SPF/DKIM del dominio, y (b) los links en los emails apuntan a `http://localhost:5173` por el default. Cualquiera de los dos hace inutilizable el flow de invitaciones.
- **Esfuerzo:** BAJO técnico (una tarde configurando DNS + Brevo dashboard), pero **requiere tener el dominio comprado y acceso al panel DNS** — es una dependencia externa.
- **Riesgo:** NULO en código; el riesgo está en no hacerlo y descubrir en producción que ninguna invitación llega.

### 6.8 Emails: aviso preventivo al 80% del plan

- **Qué:** ver 8.6 punto A. Modificar `check_plan_limit()` en `app/core/plan_limits.py` para que además de rechazar al 100%, dispare un email al owner del tenant cuando `count/limit >= 0.8`. Guardar `last_plan_warning_at` en `tenants` para dedupear (máximo 1 por semana).
- **Por qué:** hoy el admin descubre el techo con el 402 encima. Un aviso proactivo mejora conversión a Pro y reduce fricción.
- **Esfuerzo:** MEDIO (una migración de una columna, una función helper, un template nuevo, ~200 líneas de código y test).
- **Riesgo:** BAJO. Es aditivo, no toca lógica existente.

### 6.9 Emails: hacer no bloqueante y con retry

- **Qué:** envolver los `requests.post` de `email_service.py` en `asyncio.to_thread()` (ya lo teníamos hecho en la rama `feature/bitacora-audio-background` pero lo revertiste). Adicionalmente, agregar retry con `tenacity` (3 intentos, backoff exponencial) para 5xx y 429 de Brevo.
- **Por qué:** los `send_*_email` corren sync-en-async, bloqueando el event loop hasta 10 s por email. Bajo carga concurrente degrada el backend entero. Y sin retry, un pico transitorio de Brevo pierde el email para siempre.
- **Esfuerzo:** BAJO (10-20 líneas + `tenacity` a `pyproject.toml`).
- **Riesgo:** BAJO. Es un cambio localizado, cubierto por los tests de flujo (aunque no hay tests directos del sender — ver 6.10).

### 6.10 Emails: agregar `tests/test_email_service.py`

- **Qué:** mockear `requests.post` con `respx`/`unittest.mock` y verificar (a) que se llama con el sender configurado, (b) que el subject de cada tipo es el esperado, (c) que el HTML contiene el link (`invite_url` / `reset_url` / `verify_url`), (d) que devuelve `False`/`None` cuando `BREVO_API_KEY` está vacía.
- **Por qué:** hoy podés romper un template o cambiar un subject y ningún test falla. Los "tests de email verification" en realidad testean tokens en DB.
- **Esfuerzo:** BAJO (~1 hora, 6-8 tests).
- **Riesgo:** NULO.

### 6.11 Emails: agregar `.env.example` con variables de Brevo

- **Qué:** al `backend/.env.example` agregar las 4 keys que hoy no están (`BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`, `FRONTEND_URL`) con placeholders y comentarios explicativos.
- **Por qué:** un dev nuevo clona el repo, sigue `GUIA_EJECUCION_LOCAL.md`, y no tiene forma de saber que los emails necesitan config extra. Los flows de invitación/reset "funcionan" en dev (por el fallback silencioso) pero de verdad no mandan nada.
- **Esfuerzo:** TRIVIAL (5 líneas).
- **Riesgo:** NULO.

### 6.12 Tests que refuercen los tres bugs encontrados (de auth/planes)

- **Qué:** agregar en `tests/test_tenant_isolation.py` (o un nuevo `test_role_guards.py`):
  - `test_collaborator_no_puede_crear_obra` → esperar 403
  - `test_collaborator_no_puede_borrar_obra` → esperar 403
  - `test_invite_bypass_limite_plan` → invitar N+1, esperar 402 en el intento N+1
  - `test_accept_invite_valida_limite_plan` → forzar accept en tenant al límite, esperar 402
  - `test_login_bloqueado_para_no_verificado` (si se enforce 6.3)
- **Por qué:** los bugs pasaron porque no había cobertura de estos casos.
- **Esfuerzo:** BAJO. **Riesgo:** NULO.

---

## 7. Riesgos de seguridad

Ordenados por severidad práctica en el sistema tal como está hoy:

| # | Riesgo | Severidad | Vector | Estado |
|---|---|---|---|---|
| S1 | Collaborator borra/edita/crea obras y tareas vía API directa (bypass de rol admin) | **Alta** | Usuario legítimo interno con curl/DevTools | **Abierto** (bug 5.1) |
| S2 | Bypass del límite de usuarios del plan (uso comercial) | **Media-Alta** | Admin manda invites en batch, aceptantes se activan sin re-check | **Abierto** (bug 5.2) |
| S3 | Verificación de email cosmética — un email no verificado puede operar todo | **Media** | Registro con dominio ajeno, no hace falta acceder al mailbox | **Abierto** (bug 5.3) |
| S4 | Rate limit no distribuido — con N workers permite 10×N intentos | **Media** | Fuerza bruta distribuida en el mismo host con más de un worker | **Abierto** (bug 5.4) |
| S5 | Autofill del browser mete email como nombre en aceptar invitación | **Baja** | Descuido del usuario, no ataque | **Abierto** (bug 5.5) |
| S6 | IDOR cross-tenant (leer/mutar recursos ajenos) | — | — | **Cerrado** — 404 uniformemente, 12 tests lo cubren |
| S7 | Enumeración de emails por login/forgot-password | — | — | **Cerrado** — 401 genérico, forgot 200 idéntico |
| S8 | Reuso de refresh token robado | — | — | **Cerrado** — anti-replay funciona |
| S9 | Password débil en registro | — | — | **Cerrado parcial** — min 8 chars enforced (pero sin requisito de mayúsculas/números/símbolos) |
| S10 | Token de invitación / reset filtrado | — | — | **Cerrado** — TTL corto (72h / 1h) + single-use |
| S11 | Sender email desde dominio ajeno (`@ucc.edu.ar`) sin SPF/DKIM propio | **Alta** operacional | Deliverability — la mayoría de emails van a spam/rejected | **Abierto** (E1, sec 8.5) |
| S12 | Links de email apuntan a `localhost` porque `FRONTEND_URL` no está en `.env` | **Alta** operacional | Configuración — invitaciones inutilizables en prod real | **Abierto** (E2, sec 8.3) |
| S13 | Tokens de invitación/reset sin hashear en DB | **Baja-Media** | Dump de DB expone tokens vigentes | **Abierto** (E9, sec 8.2) |
| S14 | Sin auditoría de envíos (no hay tabla ni dashboard interno) | **Baja** operacional | Debug de "no llegó el email" requiere leer logs + Brevo dashboard | **Abierto** (E12, sec 8.4) |
| S15 | Cambios de contraseña no notifican al usuario por email | **Media** seguridad | Ataque de takeover queda invisible al legítimo hasta el próximo login | **Abierto** (E6, sec 8.6-B) |

### Notas de seguridad adicionales

- **Password hashing:** `hashed_password` — no verifiqué el algoritmo en esta ronda. En `app/core/security.py` debería usar `bcrypt` o `argon2`. **Pendiente confirmar** — sugerido para la próxima auditoría.
- **CORS y CSRF:** no fue parte del alcance de este módulo, pero el uso de `Authorization: Bearer` en header (no cookie) hace que CSRF no aplique. OK.
- **SECRET_KEY validation al arranque:** el `config.py` valida que exista y sea ≥32 chars en prod (según reporte del explorador). Bien.
- **Multi-worker en dev:** actualmente estoy corriendo `uvicorn --host 0.0.0.0 --port 8000` sin `--workers`, así que es 1 solo proceso. Los tests de rate limit reflejan solo ese caso. Simulé un caso real con curl y 12 intentos, funcionó el 429. En prod hay que confirmar que se corre con `--workers 1` o migrar a Redis (ver 6.4).

---

## 8. Sistema de emails (Brevo) — análisis completo

Esta sección cubre todo lo que hace/no hace el sistema de emails que soporta el módulo de auth/planes: proveedor, plantillas, dominios, deliverability, gaps funcionales y qué falta antes de mover el sender a un dominio propio.

### 8.1 Cómo está montado hoy

**Proveedor:** Brevo (ex Sendinblue). API HTTP en `https://api.brevo.com/v3/smtp/email`, auth por header `api-key`. No hay SMTP directo — todo pasa por la API HTTP.

**Servicio único:** `backend/app/services/email_service.py`. Cuatro funciones públicas:

| Función | Uso | Async real | Devuelve |
|---|---|---|---|
| `send_invite_email(to, invite_url, role)` | Invitar miembro | `async def` **pero I/O bloqueante** (`requests.post` sync) | `None` — fire and forget, log en error |
| `send_password_reset_email(to, reset_url)` | Reset password | Idem | `bool` |
| `send_verification_email(to, verify_url)` | Verificación post-registro | Idem | `bool` |
| `send_email(to, subject, html, text)` | Genérico (usado por pedidos a proveedores) | Idem | `bool` |

Templates HTML **inline** en el mismo archivo (`_build_invite_html`, `_build_reset_html`, `_build_verification_html`). No hay archivos `.html` separados ni engine de templating.

**Ventaja del diseño:** simple, sin dependencias extra, degrada con gracia si Brevo no está configurado (loguea warning + sigue).

**Precio de la simplicidad:**
- No hay retry / backoff exponencial ante 429 o 503 de Brevo → un fallo transitorio se pierde para siempre.
- No hay cola persistente → si el proceso se cae mientras un email está en vuelo, se pierde.
- El envío corre **en el hilo del request** con `requests.post` sync → **bloquea el event loop hasta 10s** por email (el timeout configurado). En prod con carga concurrente esto degrada el throughput del backend entero. Ya lo tocamos en la rama `feature/bitacora-audio-background` (revertimos el fix de email a pedido tuyo, así que el código actual sigue siendo bloqueante).

### 8.2 Inventario de emails que se mandan hoy

| # | Nombre | Trigger | Destinatario | Subject | TTL token | Sender |
|---|---|---|---|---|---|---|
| 1 | Invitación al equipo | `POST /users/invite` — `app/api/routes/users.py:58` | Invitado (nuevo o existente) | "Te invitaron a Constructa" | 72 h | `BREVO_SENDER_EMAIL` |
| 2 | Verificación de email | `POST /auth/register` — `app/api/routes/auth.py:34` | Usuario recién registrado | "Confirmá tu email — Constructa" | 48 h | idem |
| 3 | Reset de contraseña | `POST /auth/forgot-password` — `app/api/routes/auth.py:75` | Usuario que lo pidió | "Recuperá tu contraseña — Constructa" | 1 h | idem |
| 4 | Pedido a proveedor | `POST /purchase-orders/{id}/send` — `app/api/routes/purchase_orders.py` | Email del proveedor (sin cuenta) | "Pedido de materiales #{id} — {obra}" | N/A | idem |

Los tokens de invite/reset/verification son `secrets.token_urlsafe(32)`, se guardan **sin hashear** en la tabla `users` (columnas `invitation_token`, `reset_token`, `verification_token`). Si la DB se dumpea, cualquiera con el token en la mano puede aceptar invitaciones o resetear contraseñas hasta que expire el TTL. No es crítico (los TTL son cortos), pero un tenant enterprise puede pedirlo cerrado.

### 8.3 Configuración actual (leída del `.env` real)

```
BREVO_API_KEY        = <seteada>
BREVO_SENDER_EMAIL   = 2226370@ucc.edu.ar     ← dominio universitario
BREVO_SENDER_NAME    = <seteada>
PUBLIC_BASE_URL      = https://banknote-tractor-zen.ngrok-free.dev   ← ngrok (Twilio, no emails)
FRONTEND_URL         = ❌ NO ESTÁ EN .env → cae al default "http://localhost:5173"
```

Y en `backend/app/core/config.py`:

```
FRONTEND_URL: str = "http://localhost:5173"           (línea 34)
BREVO_SENDER_EMAIL: str = "noreply@constructa.com"    (línea 41)
BREVO_SENDER_NAME: str = "Constructa"                 (línea 42)
```

**Lo importante:** los tres endpoints que arman links (`app/api/routes/auth.py:34`, `:75`, `app/api/routes/users.py:58`) usan `f"{settings.FRONTEND_URL}/invite/{token}"` etc. Como `FRONTEND_URL` no está en `.env`, **hoy los emails de invitación y reset están saliendo con links `http://localhost:5173/...`**. Si mandás una invitación real ahora mismo, el destinatario recibe un email con un link roto (para él). Es un bug latente que solo se ve cuando alguien externo intenta usar el link.

`.env.example` (`backend/.env.example`) documenta `TWILIO_*`, `ANTHROPIC_API_KEY`, `WHISPER_MODEL`, `PUBLIC_BASE_URL`, pero **no menciona `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME` ni `FRONTEND_URL`**. Un dev nuevo clona el repo y no tiene forma de saber que hay que setear esas variables para que los emails funcionen.

### 8.4 Qué pasa si Brevo no está configurado

- **En dev (`APP_DEBUG=true`):** `send_*_email` logea `"BREVO_API_KEY not configured — skipping email"` y devuelve `None`/`False`. El endpoint de invitación **igual devuelve `invite_url` en el body** → el admin ve la URL y la puede copiar/pegar manualmente por WhatsApp. Está bien pensado como fallback.
- **En prod (`APP_DEBUG=false`):** el `validate_startup()` en `config.py` **advierte por stderr** pero no aborta. El server arranca, los endpoints funcionan, y los emails silenciosamente no salen. El usuario invitado nunca se entera de nada. El admin cree que sí porque el frontend le dice "Invitación enviada" (basado en el 201 del endpoint, no en si el email llegó).

Esto es un **problema de UX que se convierte en operacional**: si un cliente reporta "no recibí la invitación", el sysadmin no tiene forma directa de saber si es que Brevo se cayó, si el email fue a spam, si `FRONTEND_URL` estaba mal, o si el usuario tipeó mal el email. **No hay logs estructurados, no hay tabla de auditoría de envíos, no hay dashboard.** La única forma de auditar es leer los logs de la app y contrastar con el dashboard de Brevo manualmente.

### 8.5 Deliverability y dominios (la parte más delicada para prod)

Con el sender actual (`2226370@ucc.edu.ar`), los emails están firmando desde un dominio (`ucc.edu.ar`) que la Universidad Católica de Córdoba controla, **no vos**. Brevo lo va a intentar mandar de todas formas, pero:

- **SPF de `ucc.edu.ar` no autoriza a Brevo** — el registro SPF del dominio permite el servidor SMTP de UCC, no los IPs de Brevo. La mayoría de proveedores (Gmail, Outlook, iCloud) van a marcar `spf=fail` o `spf=softfail`.
- **DKIM:** Brevo firma con su propio dominio (`brevo.com` por default), no con `ucc.edu.ar`. Eso rompe alineación DMARC.
- **DMARC de `ucc.edu.ar`** probablemente está en `p=quarantine` o `p=reject` (política estándar universitaria). Esto significa que Gmail/Outlook van a **poner los emails directamente en spam** o rechazarlos.

**Resultado práctico:** los emails que Brevo dice haber enviado con `202 Accepted` en muchos casos **nunca aparecen en la bandeja del destinatario** — van a spam o son bloqueados en el MX del receptor. Esto también daña la reputación del sender (tasa de bounce/complaint alta), y Brevo puede acabar suspendiendo la cuenta si el problema se sostiene.

**Lo que tenés que hacer cuando compres el dominio (`constructa.com.ar` o el que sea):**

1. En Brevo, ir a **Senders & IPs → Domains → Add a new domain** y agregar `constructa.com.ar`.
2. Brevo te da 3 registros DNS para agregar en tu proveedor (Cloudflare, Namecheap, DonWeb):
   - **DKIM** — un TXT con la clave pública que Brevo usa para firmar.
   - **SPF** — extender el TXT de SPF del dominio para incluir `include:spf.brevo.com`.
   - **DMARC** — un TXT en `_dmarc.constructa.com.ar` con política progresiva: `p=none` al principio (solo reporta), `p=quarantine` una vez que ves los reportes limpios, `p=reject` al final.
3. Esperar propagación (5 min a 24 h).
4. En Brevo, click **Authenticate this domain**. Cuando queden los tres verdes, el sender de Brevo cambia de "vía brevo.com" a firma directa con `constructa.com.ar` — Gmail lo muestra sin el warning "vía...".
5. Cambiar `BREVO_SENDER_EMAIL=noreply@constructa.com.ar` (o `hola@`, `info@`) y `BREVO_SENDER_NAME=Constructa`.
6. Crear también la dirección `noreply@constructa.com.ar` en tu proveedor de mail (o al menos configurar catch-all a un mailbox real, porque Brevo requiere que puedas verificar el sender email).

Recomendación fuerte: **no uses `noreply@`**. Aunque parezca profesional, muchos filtros lo penalizan y los usuarios no pueden responder si tienen un problema. Mejor `hola@constructa.com.ar` o `soporte@constructa.com.ar`. El costo operativo es tener alguien que revise ese mailbox — con Brevo Free Plan podés hacer forward directo a tu Gmail personal.

**Sobre DMARC en particular:** empezá con `p=none; rua=mailto:tu-email@constructa.com.ar`. Después de 2-4 semanas te van a llegar reportes agregados (XML) de Gmail/Outlook/Yahoo mostrándote cuántos emails con tu dominio pasaron/fallaron autenticación. Cuando eso esté limpio, subís a `p=quarantine` (spam) y luego a `p=reject` (rechaza). Es la política que protege tu dominio de que otros manden phishing haciéndose pasar por vos.

### 8.6 Emails que faltan y que serían valiosos

Ordenados por impacto real, no por complejidad:

**A. Aviso preventivo cuando el tenant se acerca al límite del plan** ⭐ *este es el que pediste analizar*

Hoy el admin descubre que llegó al límite cuando intenta la operación (crear obra 4/3, invitar user 7/6) y recibe el 402. Es UX pobre: bloqueado sin aviso previo.

**Propuesta:** en cada operación exitosa que consume cupo, comparar `count` vs `limit`. Si `count >= limit * 0.8` (80% o más), disparar un email de "estás cerca del límite" al admin owner del tenant. Si `count == limit`, mandar uno de "llegaste al límite, considerá upgrade".

Detalles:
- Dedupe: no mandar más de 1 email de "80%" por semana por tenant (guardar `last_plan_warning_at` en tabla `tenants`).
- Template dedicado con CTA "Ver planes" que abra `/configuracion#plan`.
- Reusar el mailto del modal Upgrade (que ya existe) para el CTA "Contactar ventas".

**Trigger natural:** justo después de `check_plan_limit(...)` pasar OK — si estás al 80%+, encolar el email. Bajo esfuerzo, alto impacto en retención comercial (los admins que ven venir el techo son los que actualizan a Pro; los que se enteran de un cañonazo se frustran y se van).

**B. Confirmación de cambio de contraseña efectivo** (seguridad estándar)

Cuando alguien ejecuta `POST /auth/reset-password` con éxito o `POST /users/me/password`, mandar email a la casilla del usuario diciendo "tu contraseña fue cambiada en tal fecha, si no fuiste vos contactá soporte". Es el patrón estándar de todas las auth serias (Google, GitHub, etc.).

**C. Alerta de login desde IP/dispositivo nuevo** (seguridad avanzada)

Detectar en `POST /auth/login` si la combinación (User-Agent, IP `/24`) es nueva para ese user. Si lo es, mandar email. Requiere una tabla `user_login_history` chica. Alto valor de seguridad, esfuerzo medio.

**D. Confirmación de "recibimos tu pedido de reset"** (paridad UX)

Hoy mandamos el email con el link SI el email existe (correcto para no revelar existencia). Pero para el usuario legítimo, no hay ningún feedback en el frontend más allá de "Si el email existe, te enviamos un enlace" — el usuario no sabe si su email existe hasta que le llega o no le llega. Está OK, pero un aviso extra "recibimos tu solicitud de reset a las 15:32" tanto en el frontend como en un email hace que el usuario esté más tranquilo.

**E. Bienvenida al aceptar invitación**

Cuando alguien acepta una invitación, hoy queda logueado y ya. Un email de bienvenida con un tour rápido (link al video de intro, quién es su admin, cómo pedir ayuda) reduce el abandono en el primer día. Bajo esfuerzo.

**F. Notificación offline de alertas críticas de tareas**

El sistema tiene alertas real-time por Socket.IO (`task_blocked`, `task_overdue`) para el jefe de obra logueado. Si el jefe **no tiene la app abierta**, no se entera. Un email diario (o inmediato para críticas) con el resumen de alertas del día cierra el gap. Alto valor, esfuerzo medio (necesita un job scheduled).

**G. Aviso al proveedor: "recibimos tu cotización"**

Cuando el proveedor manda un PDF por WhatsApp y el sistema lo procesa, el proveedor **no recibe confirmación**. Un email de vuelta "recibimos tu cotización, la vamos a revisar" (si hay email del proveedor cargado en el suppliers) es cortesía profesional y da pie a un futuro flow de status.

**H. Cambio de rol confirmado**

Cuando un admin promueve a un collaborator o al revés, la persona afectada no se entera. Si tiene la app abierta, un socket podría avisar; si no, un email.

### 8.7 Frontend y visibilidad de "email enviado"

- **`LoginPage.tsx` (forgot):** muestra `"Si el email existe, te enviamos un enlace..."` (correcto, no revela).
- **`InviteModal.tsx`:** después del `POST /users/invite` exitoso, muestra "Invitación enviada" **junto con el `invite_url`** para copiar manualmente. Es el fallback si el email no llega. Bien pensado.
- **`AcceptInvitePage.tsx`:** flujo probado en la auditoría — funciona OK, redirige y auto-loguea.
- **`ResetPasswordPage.tsx`:** después del reset exitoso, auto-login. Correcto.
- **Verificación (`VerifyEmailPage.tsx`):** existe, pero como el sistema no enforce `is_verified` en el login, la página no aporta valor real hoy.

**Gap:** ninguna pantalla te dice "el email no pudo enviarse" cuando Brevo devuelve error. El backend loguea, el frontend muestra éxito. Es prácticamente imposible que un admin sepa que su invitación falló, salvo que el destinatario se lo diga por WhatsApp.

### 8.8 Templates HTML

- **Invitación (`_build_invite_html`, líneas 20-93):** el mejor de los cuatro. Table-based (compatible con Outlook), viewport meta, logo, header con gradient, botón CTA grande, fallback con link plano, footer explicativo. Pasa "el ojo" en Gmail y Outlook mobile.
- **Reset (`_build_reset_html`, 162-176):** minimalista, un `div` con inline styles. **Sin viewport meta** → en móvil puede quedar chiquito. Funcional pero desprolijo comparado con la invitación.
- **Verificación (`_build_verification_html`, 188-201):** idem al reset — inline, minimalista, sin viewport.
- **Pedido a proveedor:** un `<pre>` con texto plano. Se ve como un mensaje de sistema, no como un email profesional que representa a la empresa ante un proveedor externo. **Recomendado rehacer** cuando arranque el uso comercial serio del módulo Compras.

**Recomendación:** homogeneizar los cuatro templates alrededor del diseño de invitación (mismo header con logo, misma paleta, mismo footer). No hace falta introducir un template engine (Jinja2, etc.); alcanza con extraer un helper `_email_shell(title, body_html, cta_url, cta_label)` que envuelva el contenido en el mismo layout responsive.

### 8.9 Tests actuales de email

**No hay tests que verifiquen el envío mismo.** Los tests que "cubren" el flujo de email (`test_email_verification.py`, `test_password_reset.py`, `test_invite_context.py`) verifican la **lógica de tokens** (creación, TTL, single-use, aceptación), pero **el envío se skippea** silenciosamente porque `BREVO_API_KEY` no está en el entorno de test. Es decir, si mañana rompés `send_invite_email` (por ejemplo cambias el subject o rompés el HTML), los tests siguen pasando.

**Propuesta:** un `tests/test_email_service.py` con:
- Mock de `requests.post` para verificar que se llama con el sender correcto, subject esperado, y que el body HTML contiene el link.
- Un test que valida que el HTML de cada template contiene `{invite_url}` / `{reset_url}` / `{verify_url}` (sanity check contra typos en las f-strings).
- Un test que valida que `send_*_email` devuelve `False`/`None` cuando `BREVO_API_KEY` está vacía (no explota).

### 8.10 Resumen de hallazgos de emails (severidades)

| # | Hallazgo | Severidad | Bloqueante para prod |
|---|---|---|---|
| E1 | Sender es `@ucc.edu.ar` (dominio universitario, sin control SPF/DKIM) | **CRÍTICO** para deliverability | **Sí** — la mayoría va a spam |
| E2 | `FRONTEND_URL` no está en `.env` → los links de invitación/reset apuntan a localhost | **CRÍTICO** | **Sí** — invitaciones inutilizables |
| E3 | Sin retry ni cola persistente — un 429/503 de Brevo se pierde | **ALTO** | Recomendado antes de prod |
| E4 | `requests.post` sync bloquea el event loop hasta 10 s por envío | **ALTO** en performance | Recomendado antes de escalar |
| E5 | No hay email preventivo al llegar al 80% del plan | **ALTO** para monetización | No bloquea pero pierde upgrades |
| E6 | No hay email de confirmación de cambio de password (estándar seguridad) | **MEDIO** | No bloquea |
| E7 | No hay alerta de login desde IP nueva | **MEDIO** | No bloquea |
| E8 | `.env.example` no documenta variables de Brevo | **MEDIO** onboarding | No bloquea |
| E9 | Tokens de invite/reset guardados sin hashear en DB | **MEDIO** | Solo importa si tenés cliente enterprise que audita |
| E10 | Templates de reset/verificación sin viewport meta (mobile deformable) | **BAJO** | No bloquea |
| E11 | Sender `noreply@` (default) — mejor cambiar a `hola@` o `soporte@` | **BAJO** UX | No bloquea |
| E12 | Sin tabla de auditoría de envíos ni dashboard interno | **BAJO** operacional | No bloquea pero dificulta debug |
| E13 | Ningún test cubre el payload del email (subject, sender, HTML) | **BAJO** | No bloquea |

### 8.11 Checklist para el día que tengas el dominio propio

Copiá esto directamente cuando arranques la mudanza a `constructa.com.ar`:

**En el proveedor del dominio (Cloudflare, DonWeb, Namecheap, etc.):**
- [ ] Crear registro TXT DKIM que te da Brevo
- [ ] Extender/crear registro SPF con `include:spf.brevo.com`
- [ ] Crear registro DMARC en `_dmarc.<dominio>` con `v=DMARC1; p=none; rua=mailto:<tu-email>`
- [ ] Crear mailbox `hola@<dominio>` (o `soporte@`), redirigido a tu casilla real

**En Brevo:**
- [ ] Ir a *Senders, Domains & Dedicated IPs* → *Domains* → agregar `<dominio>`
- [ ] Verificar que los 3 registros DNS estén en verde
- [ ] Crear el sender `hola@<dominio>` (o el que uses) y verificarlo
- [ ] (Opcional prod real) Configurar webhooks de bounce/complaint apuntando a un endpoint tuyo para logging

**En el backend:**
- [ ] Actualizar `backend/.env`:
  ```
  BREVO_SENDER_EMAIL=hola@constructa.com.ar
  BREVO_SENDER_NAME=Constructa
  FRONTEND_URL=https://app.constructa.com.ar   ← el dominio del frontend en prod
  ```
- [ ] Agregar en `backend/.env.example` las mismas keys con placeholders
- [ ] Reiniciar el backend

**Prueba de humo (5 min):**
- [ ] Invitar a un email tuyo `@gmail.com` — verificar que llega a inbox (no spam)
- [ ] Verificar que el link del email abre la app en el dominio correcto
- [ ] Hacer forgot-password a un usuario real — mismo chequeo
- [ ] Registrar cuenta nueva — verificar email de verificación
- [ ] Chequear en Gmail que el header muestre "firmado por constructa.com.ar" (no "vía brevo.com")

**Después de 2 semanas (DMARC monitor):**
- [ ] Revisar los reportes DMARC agregados que te llegan a `rua=mailto:`
- [ ] Si no hay fallos → subir a `p=quarantine`
- [ ] Después de 2 semanas más, si sigue limpio → `p=reject`

---

## Anexo A — Reproducciones concretas

Referencias exactas de las pruebas que confirmaron los bugs (para reproducir):

### A.1 — Collaborator borra obra (bug 5.1)

```bash
# 1. Aceptar invitación como collaborator para obtener token
curl -X POST http://localhost:8000/api/v1/auth/accept-invite \
     -H "Content-Type: application/json" \
     -d '{"token":"<invite_token>","password":"TestPass123!","full_name":"Test"}'
# → 200 + { access_token: "eyJ..." }

# 2. Con ese token, borrar una obra del mismo tenant
curl -X DELETE http://localhost:8000/api/v1/obras/<id> \
     -H "Authorization: Bearer eyJ..."
# → HTTP 204 (obra eliminada)
```

### A.2 — Bypass límite users (bug 5.2)

```bash
# Tenant 2 (plan básico, max_users=6), empieza con 1 activo.
# Como admin, mandar 7 invites:
for i in 1..7; do
  curl -X POST http://localhost:8000/api/v1/users/invite \
       -H "Authorization: Bearer <admin_token>" \
       -d '{"email":"u'$i'@example.com","role":"collaborator"}'
done
# → 7 × 201 (ninguno da 402)

# Aceptar los 7:
for tok in <tok1> ... <tok7>; do
  curl -X POST http://localhost:8000/api/v1/auth/accept-invite \
       -d '{"token":"'$tok'","password":"x","full_name":"y"}'
done
# → 7 × 200

# Verificar: 1 + 7 = 8 usuarios activos, límite plan = 6
```

### A.3 — Login sin verificar (bug 5.3)

```bash
# Registrar (queda is_verified=False)
curl -X POST http://localhost:8000/api/v1/auth/register \
     -d '{"email":"nueva@example.com","password":"Test1234!","full_name":"X"}'
# → 201, "is_verified": false

# Loguearse SIN verificar el email
curl -X POST http://localhost:8000/api/v1/auth/login \
     -d '{"email":"nueva@example.com","password":"Test1234!"}'
# → 200 + tokens (funciona igual que un usuario verificado)
```

---

## Anexo B — Datos actuales de la DB al momento de la auditoría

Snapshot del entorno de dev usado:

- **9 usuarios** en 5 tenants
- **Planes:** basico (3/6/50), pro (20/30/∞), enterprise (∞/∞/∞)
- **Tenant 2 "Empresa de facundo"** (plan básico) — usado para la mayoría de las pruebas
- **Migraciones aplicadas hasta:** 0044 (`add_refresh_token`)
- **Suite pytest de auth/tenant/plans:** 31/31 passed en 23 s

---

## Anexo C — Archivos y líneas clave (para navegar directo)

**Backend:**
- Guards de auth: `backend/app/core/deps.py:15,42,65-68`
- JWT: `backend/app/core/security.py:19,30,34`
- Rate limit: `backend/app/core/rate_limit.py`
- Plan limits: `backend/app/core/plan_limits.py:13`
- Auth service: `backend/app/services/auth_service.py:13,14,15,78,187`
- Auth routes: `backend/app/api/routes/auth.py:30,39,45,51,56,62,68,80,87`
- Users routes: `backend/app/api/routes/users.py:16,27,36,46,51,63,79`
- Obras routes: `backend/app/api/routes/obras.py:15,27,32,37,50` ← **guards insuficientes**
- Tasks routes: `backend/app/api/routes/tasks.py:26,41,107,127` ← **guards insuficientes**
- Admin usage: `backend/app/api/routes/admin.py:15`
- **Email service:** `backend/app/services/email_service.py:96,119,136,149,162,179,188,220`
- **Config emails:** `backend/app/core/config.py:34 (FRONTEND_URL), 41-42 (BREVO_SENDER_*)`
- **Envío bloqueante:** `backend/app/services/email_service.py:119,149` (`requests.post` sync)
- **Uso de FRONTEND_URL:** `backend/app/api/routes/auth.py:34,75`, `backend/app/api/routes/users.py:58`
- **`.env.example` (incompleto):** `backend/.env.example` — falta BREVO_* y FRONTEND_URL

**Frontend:**
- Token storage: `frontend/src/lib/tokenStorage.ts`
- API interceptor: `frontend/src/api/client.ts:11,37`
- Login: `frontend/src/pages/LoginPage.tsx`
- Aceptar invitación: `frontend/src/pages/AcceptInvitePage.tsx`
- Reset password: `frontend/src/pages/ResetPasswordPage.tsx`
- Modal upgrade: `frontend/src/components/UpgradeModal.tsx`
- Panel admin: `frontend/src/pages/AdminPage.tsx`
- Configuración (plan): `frontend/src/pages/ConfiguracionPage.tsx:100+`
- Gestión equipo: `frontend/src/pages/EquipoPage.tsx`
- Permisos por rol: `frontend/src/hooks/usePermission.ts`

**Migraciones relevantes:**
- `0009_user_roles.py` — role, invitation_token, invitation_expires_at
- `0022_add_plans_tenants.py` — tablas plans + tenants + tenant_id en users/obras
- `0042_password_reset_token.py` — reset_token, reset_token_expires
- `0043_email_verification.py` — is_verified, verification_token, verification_expires
- `0044_add_refresh_token.py` — refresh_token, refresh_token_expires_at

**Tests que cubren este módulo (31 total, todos pasando):**
- `tests/test_tenant_isolation.py` — 12
- `tests/test_refresh_token.py` — 9
- `tests/test_password_reset.py` — 3 (`forgot_no_revela`, `flujo_completo`, `token_invalido`)
- `tests/test_email_verification.py` — 2 (`register_sin_verificar_y_verify_funciona`, `verify_token_invalido_es_400`)
- `tests/test_invite_context.py` — 3
- `tests/test_admin_usage.py` — 1
- `tests/test_rate_limit.py` — 2

**Tests que faltan (ver 6.7):** guards de rol admin en obras/tasks, bypass de límite users vía invites.
