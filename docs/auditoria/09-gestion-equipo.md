# Auditoría 09 — Gestión de equipo (usuarios web)

> Módulo auditado: invitación de miembros, roles, verificación de email, recuperación de contraseña, eliminación de miembros y pantalla EquipoPage.
> Nota: este módulo cubre los **usuarios con login web** (tabla `users`). Los responsables de WhatsApp (tabla `responsibles`) fueron auditados en el reporte 04.

---

## 1. Resumen ejecutivo

El flujo de invitación funciona de punta a punta: el admin invita por email, el invitado acepta con nombre y contraseña, queda autenticado automáticamente. El sistema de roles (admin / collaborator) está correctamente aplicado tanto en backend como en frontend. La recuperación de contraseña es robusta (token de un solo uso, TTL 1h, auto-login al aceptar).

Hay dos problemas concretos que requieren atención: el email de invitación se envía de forma sincrónica (bloquea el event loop de uvicorn) y los emails que ya existen en **cualquier tenant** generan conflicto, lo que impide invitar a un usuario que ya usa Constructa en otra empresa. Adicionalmente, no existe flujo de reenvío de invitación, y cuando una invitación expira el admin no tiene forma de renovarla sin intervención manual en la base de datos.

---

## 2. Inventario de funcionalidad

### Backend

| Endpoint | Guard | Descripción |
|----------|-------|-------------|
| `GET /users` | `AdminUser` | Lista todos los miembros del tenant |
| `POST /users/invite` | `AdminUser` | Invita por email; verifica límite de plan |
| `PATCH /users/{id}/role` | `AdminUser` | Cambia rol; bloquea auto-cambio |
| `DELETE /users/{id}` | `AdminUser` | Elimina miembro; bloquea auto-eliminación y eliminar admins |
| `GET /auth/invite/{token}` | — | Obtiene contexto de invitación sin consumir token |
| `POST /auth/accept-invite` | — | Acepta la invitación; activa la cuenta |
| `POST /auth/forgot-password` | — | Genera token de reset; no revela si el email existe |
| `POST /auth/reset-password` | — | Valida token de un solo uso; auto-login |
| `POST /auth/verify-email` | — | Marca `is_verified=True` |

### Frontend

| Componente | Ruta / Ubicación |
|------------|------------------|
| `EquipoPage.tsx` | Tab "Equipo" en sidebar |
| `InviteModal.tsx` | Modal desde EquipoPage |
| `AcceptInvitePage.tsx` | `/invite/{token}` |
| `ResetPasswordPage.tsx` | `/reset-password?token=…` |
| `VerifyEmailPage.tsx` | `/verify-email?token=…` |
| `usePermission.ts` | Hook centralizado de permisos |

---

## 3. Flujo de invitación probado de punta a punta

```
Admin abre InviteModal
  → ingresa email + selecciona rol (admin / collaborator)
  → POST /users/invite
      → check_plan_limit("users") — cuenta solo is_active=True
      → AuthService.invite():
          - busca email en TODA la DB (no solo el tenant)
          - si existe → ConflictError 409
          - si no: crea User(is_active=False, hashed_password="", role=rol, invitation_token, TTL 72h)
      → send_invite_email() — llama Brevo API sincrónicamente
      → devuelve { invite_token, invite_url }
  → InviteModal muestra "Email enviado a {email}" + link de respaldo con el token

Invitado recibe email → hace click en link → /invite/{token}
  → AcceptInvitePage carga:
      → GET /auth/invite/{token}  (no consume el token)
          → devuelve { company_name, role } si token válido y no expirado
          → devuelve 400 si is_active=True (ya aceptado) o si expiró
  → muestra: "Fuiste invitado a {empresa} como {rol}"
  → formulario: Nombre completo + Contraseña + Confirmar
  → POST /auth/accept-invite { token, full_name, password }
      → busca user por token
      → verifica expiración: `invitation_expires_at < datetime.now(timezone.utc)`
      → setea full_name, password (hasheada), is_active=True, limpia token
      → genera access_token + refresh_token
      → devuelve tokens + user info
  → AcceptInvitePage guarda tokens → auto-login → redirige a la app
```

**Lo que funciona bien:**
- El invitado ve el contexto (empresa, rol) antes de comprometerse con la cuenta.
- El auto-login post-aceptación elimina fricción.
- El token es single-use: una vez aceptado, `invitation_token` se limpia y `GET /auth/invite/{token}` devuelve 400 ("ya activo").
- `secrets.token_urlsafe(32)` — entropía adecuada (256 bits).

---

## 4. Roles y permisos en la práctica

### Definición de permisos (frontend)

`usePermission.ts` define la matriz completa:

```
admin:        obra.create / obra.edit / obra.delete
              tarea.create / tarea.edit / tarea.delete / tarea.move
              miembro.invite / miembro.remove
              configuracion.edit / documentos.upload

collaborator: obra.edit
              tarea.create / tarea.edit / tarea.move
              documentos.upload
```

Notable:
- `collaborator` no puede **crear obras** ni **eliminar tareas**.
- `collaborator` no puede invitar ni remover miembros.
- `collaborator` no puede acceder a Configuración.

### Aplicación en backend

| Restricción | Dónde se aplica |
|-------------|-----------------|
| Solo admin invita | `AdminUser` dep en `POST /users/invite` |
| Solo admin cambia roles | `AdminUser` dep en `PATCH /users/{id}/role` |
| No auto-cambio de rol | Check explícito: `current_user.id == id → 403` |
| No eliminar admins | Check explícito: `target.role == "admin" → 403` |
| No auto-eliminación | Check explícito: `current_user.id == id → 403` |
| Aislamiento de tenant | Todos los endpoints filtran por `tenant_id`; cross-tenant → 404 |

### Protección del último admin

El sistema combina tres restricciones que, juntas, garantizan que siempre quede al menos un admin:
1. Un admin no puede eliminarse a sí mismo.
2. Un admin no puede cambiar su propio rol.
3. Un admin no puede eliminar a otro admin.

No hay ningún camino válido para que un tenant quede sin admin activo.

---

## 5. Recuperación de contraseña probada de punta a punta

```
Usuario en LoginPage → "¿Olvidaste tu contraseña?"
  → ingresa email
  → POST /auth/forgot-password
      → rate limit: 5 requests / 300s por IP
      → busca user por email; si no existe → responde igual (no revela existencia)
      → genera reset_token con TTL 1h, guarda en DB
      → send_password_reset_email() — Brevo API sincrónicamente
      → responde 200 en todos los casos

Usuario recibe email → link /reset-password?token=…
  → ResetPasswordPage valida token
  → formulario: Nueva contraseña + Confirmar
  → POST /auth/reset-password { token, new_password }
      → rate limit: 10 requests / 60s
      → busca user por reset_token
      → verifica que no expiró
      → hashea nueva contraseña, limpia reset_token (single-use)
      → genera access_token + refresh_token
      → devuelve tokens → auto-login
```

**Lo que funciona bien:**
- Token de un solo uso: se limpia al usarlo.
- TTL 1h es razonable y se comunica en el email.
- No revela si el email existe (respuesta idéntica).
- Auto-login al resetear elimina el paso extra de "ahora iniciá sesión".

---

## 6. Sentido del flujo de uso real

**Caso típico:** Un jefe de obra (admin) quiere incorporar a un capataz como collaborator. Abre Configuración → Equipo → "Invitar miembro", pone el email y el rol. El capataz recibe un email, hace click, pone su nombre y contraseña, y ya puede ver las obras.

El flujo es directo y cubre el caso de uso principal correctamente. El "Link de respaldo" en el modal es una válvula de escape práctica cuando el email de Brevo no llega (spam, configuración incorrecta del dominio). No es un flujo de seguridad, es una herramienta de soporte que el admin usa conscientemente.

**Caso problemático:** El mismo capataz ya tiene cuenta en otro tenant de Constructa con el mismo email. El admin no puede invitarlo — obtiene un error 409. No hay mensaje claro en el frontend que explique por qué.

---

## 7. Cómo se muestra al usuario (EquipoPage)

- Lista todos los miembros del tenant con nombre, email, rol, estado y fecha de ingreso.
- Los invitados pendientes (`is_active=False`) muestran badge "Pendiente" y no tienen avatar.
- El selector de rol es un `<select>` inline con actualización optimista y rollback en error.
- El botón de eliminar solo aparece para non-admins y non-self — consistente con las restricciones del backend.
- Al cerrar InviteModal se recarga la lista automáticamente.

**Lo que falta:**
- No hay botón de "Reenviar invitación" para tokens expirados.
- No hay distinción visual entre "invitación expirada" e "invitación pendiente" — ambas muestran el mismo badge.
- No hay confirmación visual de error si el email falla en Brevo (el modal muestra éxito independientemente).

---

## 8. Qué tiene sentido

- **Roles binarios (admin / collaborator):** Para el tamaño del equipo típico en obras de construcción, dos roles son suficientes. No hay sobre-ingeniería de permisos granulares.
- **TTL de 72h para invitaciones:** Razonable — da tiempo al invitado sin dejar tokens abiertos indefinidamente.
- **Auto-login post-aceptación y post-reset:** Reduce fricción donde el usuario ya demostró su identidad.
- **Verificación de email no bloquea el login:** Para un contexto B2B donde el admin invita a personas conocidas, exigir verificación antes del primer login sería innecesariamente restrictivo.
- **Hard delete sin soft-delete:** Para usuarios, la eliminación inmediata tiene sentido. El acceso se revoca en el próximo request (el `get_current_user` falla al no encontrar el id en la DB).
- **Plan limit cuenta solo `is_active=True`:** Los invitados pendientes no consumen cupo hasta que acepten — correcto.
- **`AcceptInvitePage` muestra contexto antes de aceptar:** El invitado sabe a qué empresa y con qué rol está siendo añadido antes de crear su contraseña.

---

## 9. Qué no tiene sentido

### 9.1 Email sincrónico bloquea el event loop

`send_invite_email()` usa `requests.post` (librería HTTP sincrónica) dentro de un handler `async`. Uvicorn tiene un único event loop por worker; una llamada de 1-3 segundos a la API de Brevo congela el procesamiento de todas las demás requests entrantes durante ese tiempo.

Lo mismo ocurre en `send_password_reset_email()` y `send_verification_email()`.

### 9.2 Conflicto de email cross-tenant

`AuthService.invite()` busca el email en **toda** la tabla `users`, sin filtrar por `tenant_id`. Si el email ya existe en cualquier tenant, la invitación falla con `ConflictError`. Esto impide invitar a un usuario que ya usa Constructa con otra empresa — un escenario perfectamente válido en el contexto SaaS.

### 9.3 Sin flujo de reenvío de invitación

Si una invitación expira (72h), el admin no tiene forma de renovarla desde la UI:
1. No existe endpoint `POST /users/invite/resend` ni `DELETE /users/{id}/invite`.
2. Intentar invitar el mismo email de nuevo falla con 409 (el usuario pendiente ya existe).
3. La única solución es eliminar al usuario pendiente desde la lista y volver a invitar — pero el botón de eliminar no aparece para usuarios `is_active=False` (son non-admins en teoría, pero la UI no diferencia pendientes de activos para este control).

Verificando el código: el botón de eliminar en `EquipoPage` aparece cuando `m.id !== user?.id && m.role !== "admin"`. Un miembro pendiente (`is_active=False`) tiene `role="collaborator"` típicamente, así que el botón sí debería aparecer. Pero el flujo conceptual no está documentado ni es obvio para el admin.

### 9.4 Token de invitación visible en la UI

`InviteModal.tsx` muestra `invite_url` (que contiene el token) como "Link de respaldo" que el admin puede copiar. El token de 72h queda expuesto en el clipboard del admin. Aunque el riesgo es bajo (solo quien tiene el link puede usarlo y solo para esa cuenta), es contrario a las buenas prácticas de manejo de tokens.

### 9.5 Inconsistencia timezone en `accept_invite()`

`get_invite_context()` (línea 104-106) normaliza el datetime antes de comparar:
```python
expires = inv.invitation_expires_at.replace(tzinfo=timezone.utc) if ...else inv.invitation_expires_at
```

`accept_invite()` (línea 119) compara directamente:
```python
if user.invitation_expires_at < datetime.now(timezone.utc):
```

En PostgreSQL ambas son timezone-aware y funciona. En SQLite (dev) las columnas se guardan como naive, lo que hace que `accept_invite()` levante `TypeError` al comparar naive con aware. Este bug solo afecta el entorno de desarrollo.

### 9.6 `is_verified=True` default en `UserRead` schema

```python
class UserRead(BaseModel):
    is_verified: bool = True  # default True
```

Si el ORM no mapea el campo `is_verified` por algún bug, la API devuelve `True` aunque el usuario no haya verificado. El default debería ser `False`.

### 9.7 Fallo silencioso de email

Si `BREVO_API_KEY` no está configurada o Brevo falla, `send_invite_email()` captura la excepción y no hace nada. La respuesta del endpoint es 201 Created. El admin ve "Email enviado a {email}" aunque el email nunca salió. El "Link de respaldo" mitiga esto parcialmente, pero el admin no sabe que el email falló.

---

## 10. Mejoras propuestas

### P0 — Críticas

**Email asíncrono:**
```python
# En send_invite_email, send_password_reset_email, etc.:
import httpx

async def send_invite_email(to_email: str, invite_url: str, role: str) -> None:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            "https://api.brevo.com/v3/smtp/email",
            headers={"api-key": settings.BREVO_API_KEY, ...},
            json={...},
            timeout=10.0,
        )
        resp.raise_for_status()
```
Migrar las tres funciones de `email_service.py` de `requests` a `httpx` async. Alternativamente, mover el envío a una tarea de background con `BackgroundTasks`.

**Conflicto cross-tenant:**
En `invite()`, cambiar el lookup de email para que solo falle si el email ya existe **en el mismo tenant**:
```python
existing = await user_repo.get_by_email_and_tenant(email, tenant_id)
if existing:
    raise ConflictError(...)
```
Si el email existe en otro tenant, crear un nuevo `User` con ese email para este tenant.

### P1 — Importantes

**Endpoint de reenvío / cancelación de invitación:**
```http
POST /users/{id}/reinvite   # genera nuevo token, nuevo TTL, reenvía email
DELETE /users/{id}/invite   # cancela invitación pendiente (equivale a eliminar el user inactivo)
```

**Indicador de fallo de email:**
Si `send_invite_email()` lanza excepción, devolver warning en la respuesta:
```json
{ "invite_token": "...", "invite_url": "...", "email_sent": false, "email_error": "Brevo API timeout" }
```
El frontend puede mostrar un banner amarillo en lugar de ocultar el problema.

**Distinguir pendiente de expirado en UI:**
`EquipoPage` debería comparar `invitation_expires_at` con la fecha actual y mostrar "Invitación expirada" con opción de reenviar, en lugar del badge genérico "Pendiente".

### P2 — Menores

**Default `is_verified: bool = False` en `UserRead`:**
Cambio de una línea que evita falsos positivos si el campo no se mapea correctamente.

**Timezone en `accept_invite()`:**
Agregar la misma normalización que usa `get_invite_context()`:
```python
expires = user.invitation_expires_at
if expires.tzinfo is None:
    expires = expires.replace(tzinfo=timezone.utc)
if expires < datetime.now(timezone.utc):
    raise TokenExpiredError()
```

**Ocultar token del link de respaldo:**
En lugar de mostrar la URL completa, mostrar un botón "Copiar link" que copie al clipboard sin renderizar el token en pantalla.

---

## 11. Riesgos

| Severidad | Hallazgo | Impacto |
|-----------|----------|---------|
| **ALTO** | Email sincrónico bloquea event loop | Degradación de performance con múltiples invitaciones concurrentes; timeout de requests en bajo carga |
| **MEDIO** | Conflicto cross-tenant bloquea invitaciones | Un usuario registrado en cualquier otro tenant no puede ser invitado — falla silenciosamente para el admin |
| **MEDIO** | Sin flujo de reenvío de invitación expirada | Admin queda sin herramienta para recuperar invitaciones caídas; workaround (eliminar + reinvitar) no es obvio |
| **BAJO** | Token de invitación visible en UI | Token queda en clipboard del admin; bajo riesgo pero contrario a buenas prácticas |
| **BAJO** | Fallo silencioso de email | Admin cree que el email llegó cuando no salió; mitigado por el link de respaldo |
| **BAJO** | `is_verified=True` default en UserRead | Si el campo no se mapea, la API reporta verificación falsa |
| **INFO** | Timezone comparison inconsistency en `accept_invite()` | Solo afecta SQLite (dev); producción con PostgreSQL no se ve afectada |
| **INFO** | Verificación de email no bloquea login | Decisión de diseño válida para B2B; documentar como intencional |
