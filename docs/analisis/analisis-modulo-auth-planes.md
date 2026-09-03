# Análisis: Login · Registro · Planes · Onboarding de cliente

> Módulo auditado: flujo inicial de adquisición, autenticación y planes.  
> Fecha: 2026-07-02 | Rama: `feature/compras-cotizaciones`

---

## TL;DR

El sistema tiene una **base técnica sólida**: JWT + bcrypt, multi-tenancy real, límites de plan aplicados en backend, invitaciones por email con tokens que expiran. Lo que falta casi todo es de **capa de producto**: no hay landing, no hay billing, no hay reset de contraseña, no hay página de precios, no hay trial. El esqueleto del SaaS está bien hecho, pero la experiencia de "como lo vende un cliente" no existe todavía.

---

## 1. Login

### Qué funciona

| Aspecto | Estado |
|---------|--------|
| POST `/auth/login` con email + password | ✅ |
| Verificación de contraseña con bcrypt | ✅ |
| JWT generado con `HS256`, 24 horas de vida | ✅ |
| Manejo de usuario inactivo (403) | ✅ |
| Frontend: toggle login/registro en la misma página | ✅ |
| Frontend: show/hide password | ✅ |
| Frontend: mensaje de error "Credenciales inválidas" | ✅ |
| Token guardado en `sessionStorage` **y** `localStorage` | ✅ |
| Interceptor axios: en 401 limpia token y redirige a login | ✅ |

### Gaps detectados y cómo resolverlos

---

#### Gap 1 — No hay refresh token

**Impacto:** Alto  
El JWT dura 24 horas fijas. Cuando vence, el usuario se desloguea sin aviso. En obra, el jefe que abrió la app el lunes se cae el martes sin hacer nada.

**Solución profesional — patrón access + refresh token:**

El estándar de la industria (usado por Google, Notion, Linear) es un sistema de dos tokens:

```
access_token  → JWT de corta vida (15-60 minutos). Se manda en cada request.
refresh_token → Token opaco de larga vida (30-90 días). Se usa SOLO para renovar el access token.
```

**Implementación en CONSTRUCTA:**

*Backend:*
```python
# Nueva tabla
class RefreshToken(Base):
    __tablename__ = "refresh_tokens"
    id: Mapped[int]
    user_id: Mapped[int]          # FK a users
    token_hash: Mapped[str]       # SHA-256 del token, no el token en claro
    expires_at: Mapped[datetime]
    revoked: Mapped[bool]         # default False
    created_at: Mapped[datetime]

# Nuevo endpoint
POST /auth/refresh
  Body: { refresh_token: str }
  → valida token, chequea no revocado, no expirado
  → genera nuevo access_token (y opcionalmente rota el refresh_token)
  → retorna { access_token, expires_in }
```

*Frontend:*
```typescript
// En el interceptor de axios, antes de redirigir al login:
if (status === 401 && !isRefreshRequest) {
  const newToken = await refreshAccessToken();  // llama /auth/refresh
  if (newToken) {
    retry(originalRequest, newToken);
  } else {
    clearTokens(); window.location.href = "/";
  }
}
```

**El refresh token debe guardarse en `httpOnly cookie`**, no en localStorage, para protegerlo de XSS. Esto requiere que el backend setee la cookie en la respuesta del login.

**Esfuerzo estimado:** 6-8h backend + 3h frontend

---

#### Gap 2 — No hay "Olvidé mi contraseña"

**Impacto:** Alto — bloqueante para producción  
Si un usuario pierde la password, no tiene forma de recuperarla.

**Solución profesional — reset por email con token de un solo uso:**

Este es el patrón que usa toda la industria (GitHub, Slack, Notion).

```
Usuario → "Olvidé contraseña" → ingresa email
Backend → genera reset_token (32 bytes random, SHA-256 en BD)
        → guarda reset_token_hash + reset_token_expires_at (15-30 min)
        → envía email con link: /reset-password/{token}
Usuario → abre link → ingresa nueva contraseña
Backend → verifica token no expirado, no usado
        → actualiza hashed_password
        → invalida el token (marca como used=True o lo borra)
        → responde con JWT (login automático)
```

**Implementación en CONSTRUCTA:**

*Backend:*
```python
# Agregar al modelo User:
reset_password_token: Mapped[str | None]   # SHA-256 del token
reset_password_expires_at: Mapped[datetime | None]

# Nuevos endpoints en auth.py:
POST /auth/forgot-password
  Body: { email: str }
  → SIEMPRE responde 200 (no revelar si el email existe)
  → si existe: genera token, envía email, guarda hash

POST /auth/reset-password
  Body: { token: str, new_password: str }
  → verifica hash, verifica expiración
  → actualiza contraseña, limpia token
  → retorna access_token
```

*Frontend:*
```
LoginPage.tsx → agregar link "¿Olvidaste tu contraseña?" bajo el form
ResetPasswordPage.tsx → nueva página en /reset-password/{token}
```

**Seguridad crítica:** nunca guardar el token en claro en BD (guardar SHA-256). Siempre responder 200 en `/forgot-password` aunque el email no exista, para no revelar qué emails están registrados (user enumeration attack).

**Esfuerzo estimado:** 4-6h total

---

#### Gap 3 — No hay "Recordarme" ni sesión permanente real

**Impacto:** Medio  
El localStorage guarda el token pero igual vence a las 24h.

**Solución profesional:**  
Con el sistema de refresh token implementado en Gap 1, "Recordarme" es trivial:

```typescript
// En el login form:
const [remember, setRemember] = useState(false);

// Al hacer login, pasar la preferencia al backend:
POST /auth/login { email, password, remember_me: true }

// Backend: si remember_me=true → refresh token dura 90 días. Si false → 24h.
```

Esto es exactamente lo que hace Notion, Slack y la mayoría de apps B2B.

**Esfuerzo estimado:** 1h (una vez implementado el refresh token)

---

#### Gap 4 — No hay logout de todos los dispositivos

**Impacto:** Bajo-Medio

**Solución profesional:**  
Con la tabla `refresh_tokens` del Gap 1, se implementa con una sola query:

```python
# Endpoint nuevo:
POST /auth/logout-all
  → UPDATE refresh_tokens SET revoked=True WHERE user_id = current_user.id
```

*Frontend:* botón en `ConfiguracionPage` → "Cerrar sesión en todos los dispositivos". Lo usa GitHub, Google, Notion.

**Esfuerzo estimado:** 30 min (una vez implementado refresh tokens)

---

#### Gap 5 — UX de login básica

**Impacto:** Bajo

**Solución profesional:**  
El patrón de la industria para login pages de SaaS B2B:

- Logo + nombre del producto arriba centrado (identidad de marca)
- Separación visual clara entre "Iniciar sesión" y "Crear cuenta" (no un toggle, sino links diferenciados)
- Link explícito "¿Olvidaste tu contraseña?" bajo el input de password
- Social login opcional (Google OAuth — ver sección de OAuth más abajo)
- Copy emocional: "Bienvenido de vuelta" vs "Empezá gratis hoy"
- Referencia en registro: "Ya tenés cuenta? Iniciá sesión"
- URLs propias: `/login` y `/register` (no el mismo componente toggled)

---

## 2. Registro

### Qué funciona

| Aspecto | Estado |
|---------|--------|
| POST `/auth/register` crea usuario con `role="admin"` | ✅ |
| Crea Tenant automáticamente con plan "básico" | ✅ |
| Hash de contraseña con bcrypt | ✅ |
| Validación mínimo 8 caracteres en password | ✅ |
| Validación email duplicado (409 Conflict) | ✅ |
| Frontend: errores específicos (409, 422) con mensajes en español | ✅ |
| Después del registro, hace login automático (2 requests) | ✅ |
| `company_name` se usa como nombre del Tenant | ✅ |

### Gaps detectados y cómo resolverlos

---

#### Gap 1 — No hay verificación de email

**Impacto:** Alto — problema de calidad de datos y seguridad  
El usuario puede registrarse con cualquier email inventado. No recibe ningún correo de bienvenida ni de confirmación.

**Solución profesional — verificación opcional vs obligatoria:**

Hay dos enfoques según el contexto del producto:

**Opción A — Verificación obligatoria (máxima calidad de datos):**
```
Registro → usuario en estado "pendiente"
         → recibe email de verificación (link con token de 24h)
         → hasta verificar: puede loguearse pero ve banner "Verificá tu email"
         → después de 7 días sin verificar: cuenta desactivada automáticamente
```

**Opción B — Verificación suave (mejor conversión, usado por Notion, Linear):**
```
Registro → usuario activo inmediatamente (puede usar la app)
         → recibe email de bienvenida con link de verificación
         → si no verifica en 72h: recordatorio automático
         → sin verificar: puede usar todo excepto invitar a otros
```

Para un SaaS B2B de construcción, se recomienda **Opción B**: no bloquear al usuario en el momento de mayor motivación (justo después de registrarse).

*Backend:*
```python
# Agregar al modelo User:
email_verified: Mapped[bool] = mapped_column(default=False)
email_verify_token: Mapped[str | None]
email_verify_expires_at: Mapped[datetime | None]

# En register: generar token, guardar hash, enviar email
# Nuevo endpoint:
POST /auth/verify-email
  Body: { token: str }
  → valida token, marca email_verified=True, limpia token
```

**Esfuerzo estimado:** 3-4h

---

#### Gap 2 — Doble request register + login (edge case no manejado)

**Impacto:** Bajo  
Si el register tiene éxito pero el login falla, el usuario queda con cuenta sin token.

**Solución profesional:**  
El patrón más limpio es que el endpoint `/auth/register` devuelva directamente el access token (y el refresh token), eliminando el segundo request:

```python
# Antes (actual):
POST /auth/register → 201 UserRead (sin token)
# Después hacer POST /auth/login para obtener token

# Propuesto (profesional):
POST /auth/register → 201 { user: UserRead, access_token: str, token_type: "bearer" }
```

Esto es lo que hacen Stripe, Vercel y la mayoría de las APIs modernas: el registro es un flujo único que te deja logueado.

**Esfuerzo estimado:** 1h (cambio puntual en `auth_service.py` y `auth.py`)

---

#### Gap 3 — `company_name` opcional en registro

**Impacto:** Medio  
En una app B2B, el nombre de la empresa es crítico para todo: facturas, invitaciones, panel admin.

**Solución profesional:**  
Hacer el campo requerido tanto en frontend como backend:

```python
# Schema actual:
class UserCreate(BaseModel):
    company_name: str | None = None  # opcional

# Propuesto:
class UserCreate(BaseModel):
    company_name: str = Field(min_length=2, max_length=255)
```

Además, las apps más cuidadas agregan un **segundo paso de onboarding** justo después del registro (en lugar de meter todo en un form):
```
Paso 1: Email + contraseña (fricción mínima para convertir)
Paso 2: Nombre de empresa + nombre propio (contexto, ya registrado)
Paso 3: ¿Para qué vas a usar CONSTRUCTA? (segmentación para onboarding personalizado)
```
Notion y Linear usan este patrón de 2-3 pasos porque reduce el abandono del form inicial.

**Esfuerzo estimado:** 30 min para hacer required + 4h para el wizard de onboarding

---

#### Gap 4 — No hay email de bienvenida post-registro

**Impacto:** Medio  
El usuario se registra y entra a una app vacía sin orientación.

**Solución profesional — email de bienvenida + secuencia de onboarding:**

El estándar en SaaS B2B es una secuencia de 3-5 emails automáticos:

| Timing | Asunto | Contenido |
|--------|--------|-----------|
| Inmediato | "Bienvenido a CONSTRUCTA 🏗️" | Confirmación + primer paso sugerido ("Creá tu primera obra") |
| Día 2 | "¿Sabías que podés importar desde Excel?" | Feature discovery |
| Día 5 | "Tus obras en el bolsillo — invitá a tu equipo" | Expansión del equipo |
| Día 14 | "¿Cómo va tu obra?" | Engagement check + link al soporte |

Esto se implementa con:
- **Brevo (ya integrado):** tiene secuencias automáticas por trigger
- O con APScheduler en el backend para enviar emails programados
- O con un proveedor especializado como Customer.io (más profesional)

*Implementación mínima viable:*
```python
# En auth_service.py, después de crear el user:
await email_service.send_welcome_email(user.email, user.full_name, tenant.name)
```

**Esfuerzo estimado:** 2h (email único) / 1-2 días (secuencia completa)

---

#### Gap 5 — No hay URLs propias para registro

**Impacto:** Bajo-Medio  
No hay `/register` separado. Cualquier campaña de marketing con "Registrate aquí" lleva al login toggle.

**Solución profesional:**  
Con React Router (o el sistema de routing actual de App.tsx):

```tsx
// App.tsx - agregar detección de ruta:
const path = window.location.pathname;
if (path === "/register") → mostrar LoginPage en modo "register"
if (path === "/login")    → mostrar LoginPage en modo "login"
```

Esto permite URLs directas para campañas, Google Ads y referencias.

---

## 3. Sistema de Planes

### Arquitectura actual

```
plans (BD)
├── básico:     3 obras | 6 users | 50 tareas/obra | $29/mes
├── pro:        20 obras | 30 users | ilimitado | $99/mes  
└── enterprise: ilimitado | ilimitado | ilimitado | precio custom

tenants
└── tiene plan_id, owner_user_id, active_until (puede ser NULL)

users
└── tiene tenant_id (aislamiento de datos por tenant)
```

### Qué funciona

| Aspecto | Estado |
|---------|--------|
| Tabla `plans` y `tenants` correctamente modeladas | ✅ |
| Al registrarse, se crea tenant con plan "básico" automáticamente | ✅ |
| `check_plan_limit()` aplicado en 3 puntos: crear obra, invitar usuario, crear tarea | ✅ |
| Respuesta HTTP 402 con body estructurado (code, resource, current, limit, plan, message) | ✅ |
| Panel admin (`/admin`) muestra uso actual vs límite con barras de color | ✅ |
| Barras con colores semáforo: verde (0-79%), amarillo (80-99%), rojo (100%) | ✅ |
| `active_until` en Tenant permite modelar expiración de suscripción | ✅ |
| Aislamiento de datos: obras, usuarios y responsables filtrados por `tenant_id` | ✅ |

### Gaps detectados y cómo resolverlos

---

#### Gap 1 — No hay billing real

**Impacto:** Alto — bloqueante para monetización  
No hay integración con ningún procesador de pagos. El botón de upgrade abre un `mailto:`. El sistema no puede cobrar nada hoy.

**Solución profesional — integración con Stripe (global) o Mercado Pago (LATAM):**

Para Argentina/LATAM, **Mercado Pago** es el estándar de hecho. Stripe también funciona pero tiene menor penetración local. Las empresas SaaS de la región suelen ofrecer ambos.

**Flujo de upgrade con Stripe Checkout (el más rápido de implementar):**

```
Usuario en /admin → click "Upgrade a Pro"
  → Backend: POST /billing/create-checkout-session
    → stripe.checkout.Session.create(
        price_id="price_xxxx",       # ID del precio en Stripe dashboard
        customer_email=user.email,
        metadata={ tenant_id: tenant.id },
        success_url="/admin?upgraded=true",
        cancel_url="/admin",
      )
    → retorna { checkout_url }
  → Frontend: redirige a checkout_url (página de pago hosted de Stripe)
  → Usuario paga en Stripe
  → Stripe llama webhook: POST /billing/webhook
    → evento checkout.session.completed
    → actualizar tenant.plan_id a "pro"
    → actualizar tenant.active_until a now + 30 días
    → enviar email de confirmación
```

**Tablas adicionales recomendadas:**
```sql
CREATE TABLE billing_events (
  id SERIAL PRIMARY KEY,
  tenant_id INT REFERENCES tenants(id),
  stripe_event_id VARCHAR(255) UNIQUE,   -- idempotencia
  event_type VARCHAR(100),               -- checkout.completed, payment_failed, etc.
  amount NUMERIC(10,2),
  currency VARCHAR(3),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Esfuerzo estimado:** 2-3 días (Stripe) / 3-4 días (Mercado Pago, API más compleja)

---

#### Gap 2 — `active_until` no se verifica en ningún lugar

**Impacto:** Medio  
El campo existe en BD pero nada lo chequea. Si alguien deja de pagar, el sistema sigue funcionando indefinidamente.

**Solución profesional — dependency de FastAPI que chequea expiración:**

```python
# En app/core/deps.py — agregar una nueva dependency:
async def ActiveTenant(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    if current_user.tenant_id is None:
        return current_user  # sin tenant, dejar pasar (no debería ocurrir)
    
    tenant = await db.get(Tenant, current_user.tenant_id)
    if tenant and tenant.active_until and tenant.active_until < datetime.now(UTC):
        raise HTTPException(
            status_code=402,
            detail={
                "code": "subscription_expired",
                "message": "Tu suscripción venció. Renovála para continuar.",
                "expired_at": tenant.active_until.isoformat(),
            }
        )
    return current_user

# Usar en endpoints protegidos:
@router.post("/obras")
async def create_obra(current_user: Annotated[User, Depends(ActiveTenant)], ...):
```

Con Stripe, el webhook `invoice.payment_failed` setea `active_until = now` para cortar el acceso.

**Esfuerzo estimado:** 2h

---

#### Gap 3 — No hay trial

**Impacto:** Medio  
Las apps SaaS con trial tienen tasas de conversión 2-3x mayores que sin trial.

**Solución profesional — trial de 14 días en plan Pro:**

El patrón estándar (usado por Notion, Linear, Vercel) es **"Empieza en Pro, después decidís"**:

```python
# En auth_service.py, al crear el tenant:
pro_plan = await db.scalar(select(Plan).where(Plan.name == "pro"))
tenant = Tenant(
    name=tenant_name,
    plan_id=pro_plan.id,                            # empieza en Pro
    trial_ends_at=datetime.now(UTC) + timedelta(days=14),  # nuevo campo
    owner_user_id=user.id,
)

# Nueva columna en tenants:
trial_ends_at: Mapped[datetime | None]

# En check_plan_limit(): si trial_ends_at > now → usar límites de Pro
#                        si trial_ends_at < now → degradar a Básico automáticamente
```

*Frontend:* banner en la app durante el trial: `"Tu prueba de Pro vence en X días — Seguí con Pro por $99/mes"`.

**Esfuerzo estimado:** 3-4h

---

#### Gap 4 — No hay self-service upgrade

**Impacto:** Alto  
El usuario no puede cambiarse de plan solo. Depende de intervención manual.

**Solución profesional:**  
Con Stripe implementado (Gap 1), el upgrade flow se reduce a:

```
AdminPage → "Upgrade a Pro" → Stripe Checkout → webhook → tenant actualizado
```

Sin Stripe, como solución intermedia rápida, se puede agregar un **formulario de solicitud de upgrade** que envía el request al email interno:

```tsx
// En AdminPage.tsx — reemplazar el mailto: por un modal:
<UpgradeRequestModal plan="pro" onSubmit={sendUpgradeRequest} />
// sendUpgradeRequest → POST /billing/request-upgrade
// Backend → envía email interno con los datos del tenant
// El equipo lo procesa manualmente y actualiza la BD
```

Esto es temporal pero más profesional que un mailto puro.

**Esfuerzo estimado:** 1h (formulario) / 2-3 días (Stripe real)

---

#### Gap 5 — Error 402 no manejado en el frontend al crear obra

**Impacto:** Medio  
En EquipoPage el 402 está manejado (muestra "Límite alcanzado"). Pero en PortfolioPage, si se intenta crear la 4ta obra en plan básico, el 402 probablemente cae en el catch genérico y muestra un error poco claro.

**Solución profesional — handler centralizado de errores 402:**

```typescript
// En api/client.ts — en el interceptor de respuesta:
if (status === 402) {
  const detail = err.response.data?.detail;
  // Emitir evento global para que cualquier componente lo escuche:
  window.dispatchEvent(new CustomEvent("plan-limit-reached", { detail }));
}

// En App.tsx o un provider:
useEffect(() => {
  const handler = (e: CustomEvent) => setPlanLimitModal(e.detail);
  window.addEventListener("plan-limit-reached", handler);
  return () => window.removeEventListener("plan-limit-reached", handler);
}, []);

// PlanLimitModal muestra: qué límite se alcanzó, cuánto tenés, botón "Upgrade"
```

Esto es lo que hace Linear: en cualquier parte de la app donde llegue un 402, aparece el mismo modal de upgrade.

**Esfuerzo estimado:** 2h

---

#### Gap 6 — No hay página de precios pública

**Impacto:** Alto — para comercialización

**Solución profesional:**  
Toda empresa SaaS tiene `/pricing` como una de sus páginas más importantes (2da después de home en términos de conversión). Debe contener:

- **Tabla comparativa** de planes (columnas: básico / pro / enterprise)
- **Toggle mensual / anual** (con descuento del 20% anual para incentivar)
- **FAQ** sobre precios (¿puedo cancelar? ¿hay prueba gratis?)
- **Social proof**: "Más de X empresas constructoras usan CONSTRUCTA"
- **CTA claro**: "Empezar gratis" (no "Contactar ventas" como primer paso)

```tsx
// frontend/src/pages/PricingPage.tsx
// Accesible desde / (landing) y desde el link "Ver planes" en AdminPage
// Se muestra sin autenticación (parte del marketing site)
```

---

#### Gap 7 — Precios hardcodeados en migración SQL

**Impacto:** Bajo  
Cambiar `$29` a `$35` requiere una migración de BD.

**Solución profesional:**  
Los precios deben manejarse en el sistema de billing (Stripe Dashboard, no en BD propia). Si se quiere flexibilidad sin Stripe:

```python
# En app/core/config.py:
PLAN_PRICES: dict = {
    "basico": 29.0,
    "pro": 99.0,
}
```

Con Stripe, el precio vive en Stripe y la BD solo guarda el `stripe_price_id`, no el número. Así un cambio de precio es una variable de entorno, no una migración.

---

## 4. Sistema de Invitaciones

### Qué funciona

| Aspecto | Estado |
|---------|--------|
| Admin invita por email (Brevo API) | ✅ |
| Token seguro: 32 bytes `secrets.token_urlsafe()` | ✅ |
| Token expira en 72 horas | ✅ |
| Usuario invitado queda con `is_active=False` hasta aceptar | ✅ |
| Página `/invite/{token}` para completar perfil y crear contraseña | ✅ |
| Al aceptar, recibe JWT directamente (sin pasar por login) | ✅ |
| El modal de invitación muestra la URL para copiar (fallback si el email falla) | ✅ |
| Verifica límite de plan antes de invitar (402) | ✅ |
| Verifica email duplicado (409) | ✅ |

### Gaps detectados y cómo resolverlos

---

#### Gap 1 — Si BREVO_API_KEY está vacío, la invitación puede fallar con 500

**Impacto:** Medio

**Solución profesional — degradado gracioso con log de advertencia:**

```python
# En email_service.py:
async def send_invite_email(self, ...) -> bool:
    if not settings.BREVO_API_KEY:
        logger.warning(
            "BREVO_API_KEY no configurado — email de invitación no enviado. "
            f"invite_url={invite_url}"
        )
        return False   # no lanza excepción, retorna False
    
    try:
        # ...llamada a Brevo...
        return True
    except Exception as e:
        logger.error(f"Error enviando email de invitación: {e}")
        return False   # idem: falla silenciosa + log

# En users.py (el endpoint de invite):
email_sent = await email_service.send_invite_email(...)
# La respuesta siempre incluye invite_url, independientemente de si el email llegó:
return InviteResponse(
    invite_token=token,
    invite_url=invite_url,
    email_sent=email_sent,   # ← campo extra para que el frontend sepa
)
```

*Frontend:* si `email_sent=False`, mostrar aviso: `"No pudimos enviar el email. Compartí este link manualmente."` — con el link visible para copiar.

**Esfuerzo estimado:** 1-2h

---

#### Gap 2 — No hay reenvío de invitación

**Impacto:** Medio  
Si el token expiró o el email fue a spam, el admin tiene que borrar el usuario y volver a invitar.

**Solución profesional — endpoint de reenvío:**

```python
# Nuevo endpoint:
POST /users/{user_id}/resend-invite
  → solo si user.is_active == False (usuario pendiente)
  → genera nuevo token (invalida el anterior)
  → actualiza invitation_expires_at (ahora + 72h)
  → reenvía email
  → retorna nuevo invite_url
```

*Frontend:* en la lista de invitados pendientes (ver Gap 3 abajo), botón "Reenviar" por fila.

**Esfuerzo estimado:** 1-2h

---

#### Gap 3 — Invitaciones pendientes son invisibles para el admin

**Impacto:** Medio  
EquipoPage solo muestra usuarios `is_active=True`. Los invitados que todavía no aceptaron no aparecen en ningún lado.

**Solución profesional — sección "Pendientes de aceptar" en EquipoPage:**

```python
# En GET /users — agregar parámetro opcional:
GET /users?include_pending=true
→ retorna activos + is_active=False separados en la respuesta:
{
    "members": [...usuarios activos...],
    "pending_invites": [...usuarios con is_active=False...]
}
```

*Frontend:* en EquipoPage, después de la tabla principal:
```
┌─────────────────────────────────────────────────────┐
│ Invitaciones pendientes (2)                         │
│ ──────────────────────────────────────────────────  │
│ juan@constructora.com  ·  Colaborador               │
│ Enviada hace 3 días  ·  [Reenviar]  [Cancelar]      │
│ maria@constructora.com  ·  Admin                    │
│ Vence en 15 horas  ·  [Reenviar]  [Cancelar]        │
└─────────────────────────────────────────────────────┘
```

**Esfuerzo estimado:** 3-4h (backend + frontend)

---

#### Gap 4 — Invitaciones vencidas acumulan en la BD

**Impacto:** Bajo  
Con el tiempo, la tabla `users` acumula filas `is_active=False` de invitaciones expiradas que nadie aceptó.

**Solución profesional — job de limpieza periódico:**

El backend ya usa APScheduler (tiene `scheduler` en `app/core/scheduler.py`). Se agrega un job:

```python
# En scheduler.py:
@scheduler.scheduled_job("cron", hour=3, minute=0)  # todos los días a las 3 AM
async def cleanup_expired_invites():
    async with AsyncSessionLocal() as db:
        cutoff = datetime.now(UTC) - timedelta(days=7)  # 7 días de gracia
        await db.execute(
            delete(User)
            .where(User.is_active == False)
            .where(User.invitation_expires_at < cutoff)
        )
        await db.commit()
        logger.info("Invitaciones vencidas eliminadas")
```

Alternativamente (más conservador): no borrar, sino marcar `invitation_token=NULL` para que el registro no interfiera con futuros reintentos.

**Esfuerzo estimado:** 1h

---

#### Gap 5 — FRONTEND_URL no validado en startup

**Impacto:** Alto en producción  
Si `FRONTEND_URL=http://localhost:5173` en producción, todos los emails de invitación llevan a un link roto.

**Solución profesional — validación de configuración en startup:**

```python
# En app/main.py — al inicio del lifespan/startup:
@asynccontextmanager
async def lifespan(app: FastAPI):
    if "localhost" in settings.FRONTEND_URL and settings.ENV == "production":
        raise ValueError(
            "FRONTEND_URL tiene localhost en entorno de producción. "
            "Configurá la variable de entorno correctamente."
        )
    yield
```

También se recomienda tener un checklist de variables de entorno requeridas en producción, validadas en startup.

**Esfuerzo estimado:** 30 min

---

## 5. Control de Roles y Acceso

### Qué funciona

| Aspecto | Estado |
|---------|--------|
| `AdminUser` dep en backend (403 si no es admin) | ✅ |
| `CurrentUser` dep: verifica token válido y usuario activo | ✅ |
| Frontend: páginas admin-only muestran `<AccessDenied />` si no es admin | ✅ |
| Sidebar oculta items de admin a collaborators | ✅ |
| El rol se fija en invite/registro y se puede cambiar solo desde EquipoPage | ✅ |
| Un admin no puede cambiar su propio rol (previene quedar sin admins) | ✅ |
| Un admin no puede borrarse a sí mismo | ✅ |

### Gaps detectados y cómo resolverlos

---

#### Gap 1 — No hay mínimo de admins por tenant

**Impacto:** Bajo  
Un admin puede borrar todos los otros admins, quedando como único administrador. Si ese admin se va, el tenant queda sin administración.

**Solución profesional:**

```python
# En DELETE /users/{user_id}:
admin_count = await db.scalar(
    select(func.count()).where(
        User.tenant_id == current_user.tenant_id,
        User.role == "admin",
        User.is_active == True,
    )
)
if target_user.role == "admin" and admin_count <= 1:
    raise HTTPException(400, detail="No podés eliminar al único administrador del tenant.")
```

**Esfuerzo estimado:** 30 min

---

#### Gap 2 — No hay granularidad de permisos

**Impacto:** Bajo — roadmap futuro  
Todos los collaborators pueden ver todas las obras. En empresas grandes, puede ser un problema.

**Solución profesional — RBAC (Role-Based Access Control) a nivel obra:**

El patrón estándar es una tabla de permisos por recurso:

```sql
CREATE TABLE obra_permissions (
  user_id INT REFERENCES users(id),
  obra_id INT REFERENCES obras(id),
  permission VARCHAR(50),   -- "view", "edit", "manage"
  PRIMARY KEY (user_id, obra_id, permission)
);
```

Esto permite: "Juan puede ver la Obra A pero no la Obra B". Se implementa agregando un filtro en los queries de obras para colaboradores (admins ven todo).

**Esfuerzo estimado:** 1-2 días (roadmap futuro, no urgente ahora)

---

#### Gap 3 — No hay log de auditoría de accesos

**Impacto:** Bajo

**Solución profesional:**  
Las apps empresariales mantienen un audit log de acciones sensibles:

```sql
CREATE TABLE audit_log (
  id SERIAL PRIMARY KEY,
  tenant_id INT,
  actor_user_id INT,       -- quién hizo la acción
  action VARCHAR(100),     -- "invite_sent", "role_changed", "member_removed", "login"
  target_user_id INT,      -- a quién le pasó (si aplica)
  metadata JSONB,          -- detalles adicionales
  ip_address INET,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

Esto es estándar en cualquier app con compliance (GDPR, ISO 27001). No es urgente para MVP, pero sí para crecer.

---

## 6. Seguridad General

### Fortalezas actuales

- **bcrypt** para passwords — correcto, algoritmo estándar de la industria
- **JWT con `exp` claim** — tokens auto-expiran sin invalidación activa
- **Invitations con `secrets.token_urlsafe(32)`** — 256 bits de entropía
- **SQL injection**: SQLAlchemy ORM con parámetros vinculados
- **Schemas Pydantic**: nunca se filtra `hashed_password` en respuestas
- **Datos aislados por `tenant_id`**: un usuario no puede ver datos de otro tenant

### Gaps detectados y cómo resolverlos

---

#### Gap 1 — No hay rate limiting en login

**Impacto:** Alto  
El endpoint `/auth/login` puede ser atacado con fuerza bruta ilimitada.

**Solución profesional — `slowapi` + Redis:**

```python
# pip install slowapi redis

# En app/main.py:
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# En auth.py:
@router.post("/login")
@limiter.limit("5/minute")     # 5 intentos por minuto por IP
@limiter.limit("20/hour")      # 20 intentos por hora por IP
async def login(request: Request, ...):
```

Con Redis como storage, el rate limiting funciona correctamente en deployments con múltiples workers/instancias (el conteo es compartido).

**Nivel profesional adicional:** rate limit también por email (no solo por IP), para prevenir ataques distribuidos contra una cuenta específica:

```python
@limiter.limit("10/hour", key_func=lambda req: req.body_email)  # pseudocódigo
```

**Esfuerzo estimado:** 1-2h

---

#### Gap 2 — Tokens sin revocación (no hay logout real)

**Impacto:** Medio  
Al hacer logout, el frontend borra el token local, pero el JWT sigue siendo válido en el servidor hasta que expire.

**Solución profesional — JWT ID (jti) con blacklist en Redis:**

```python
# Al crear el token:
import uuid
jti = str(uuid.uuid4())
payload = { "sub": str(user_id), "exp": expire, "jti": jti }
token = jwt.encode(payload, settings.SECRET_KEY, algorithm="HS256")

# Al hacer logout:
POST /auth/logout
  → extraer jti del token
  → redis.setex(f"blacklist:{jti}", ttl=remaining_token_lifetime, value="1")

# En la dependency CurrentUser:
def decode_access_token(token):
    payload = jwt.decode(...)
    jti = payload.get("jti")
    if redis.exists(f"blacklist:{jti}"):
        raise HTTPException(401, detail="Token revocado")
```

Esta es la solución que usa Supabase, Auth0 y la mayoría de auth providers. Requiere Redis (que en muchos deployments ya existe para caching).

**Esfuerzo estimado:** 3-4h (si Redis ya está en el stack)

---

#### Gap 3 — No hay validación de fortaleza de contraseña más allá de 8 caracteres

**Impacto:** Medio

**Solución profesional:**

```python
import re

def validate_password_strength(password: str) -> None:
    if len(password) < 8:
        raise ValueError("Mínimo 8 caracteres")
    # No requerir mayúscula/número/símbolo de forma obligatoria
    # (el NIST 800-63B ya no lo recomienda) — en su lugar, usar un score:
    # Recomendación actual: solo verificar que no sea una contraseña común
    COMMON_PASSWORDS = {"password", "12345678", "contraseña", "qwerty123"}
    if password.lower() in COMMON_PASSWORDS:
        raise ValueError("Contraseña demasiado común")
```

El NIST (el estándar global de seguridad) recomienda desde 2020 **no exigir caracteres especiales** sino evitar contraseñas comunes y usar longitud mínima de 8. Exigir `Aa1!` de forma obligatoria tiene el efecto opuesto: la gente escribe `Password1!` y eso es predecible.

**Esfuerzo estimado:** 1h

---

#### Gap 4 — No hay HTTPS forzado en código

**Impacto:** Alto en producción

**Solución profesional:**

```python
# En app/main.py (solo en producción):
from fastapi.middleware.httpsredirect import HTTPSRedirectMiddleware
if settings.ENV == "production":
    app.add_middleware(HTTPSRedirectMiddleware)
```

Más importante: el proxy inverso (nginx/Caddy) debe forzar HTTPS y agregar headers de seguridad:

```nginx
# nginx config:
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header X-Content-Type-Options nosniff;
add_header X-Frame-Options DENY;
add_header Content-Security-Policy "default-src 'self'";
```

**Esfuerzo estimado:** 1h (configuración de infraestructura)

---

#### Gap 5 — `INTERNAL_API_KEY` vacío por defecto

**Impacto:** Medio  
Si se usa en endpoints internos, cualquier request sin el header pasa si la key no está configurada.

**Solución profesional:**

```python
# En deps.py — la dependency InternalAuth debe fallar si la key no está configurada:
async def InternalAuth(x_api_key: str = Header(...)):
    if not settings.INTERNAL_API_KEY:
        raise HTTPException(500, detail="INTERNAL_API_KEY no configurada en el servidor")
    if x_api_key != settings.INTERNAL_API_KEY:
        raise HTTPException(401, detail="API key inválida")
```

---

## 7. Flujo de Cliente — "Cómo lo ve alguien que quiere comprar CONSTRUCTA"

### El flujo real hoy

```
1. Alguien llega a localhost:5173 (no hay dominio real)
2. Ve el login/registro — no hay landing, no hay descripción del producto
3. Se registra con email + password (sin verificación)
4. Entra directo a la app en el plan básico (3 obras, 6 users, 50 tareas)
5. Usa la app hasta toparse con un límite (402)
6. Ve en el Panel Admin sus barras de uso y un botón "Necesitás más → envianos un email"
7. Espera que alguien del equipo CONSTRUCTA lo suba de plan manualmente
```

### Cómo debería verse — el flujo ideal de un SaaS B2B moderno

```
1. El cliente llega a constructa.com (landing page)
   → Ve propuesta de valor, screenshots, testimonios, precios
   → CTA principal: "Empezar prueba gratis de 14 días"

2. Click → /register
   → Form en 2 pasos: email+password / empresa+nombre
   → Registro exitoso → email de bienvenida automático

3. Entra a la app en trial de Pro (14 días)
   → Banner: "Prueba Pro — 12 días restantes — Seguir con Pro →"
   → Onboarding checklist: "Creá tu primera obra / Invitá a tu equipo / ..."

4. Al vencer el trial → modal: "Tu prueba terminó. Elegí tu plan:"
   → Básico ($29/mes) / Pro ($99/mes) / Enterprise (contactar)
   → Click "Elegir Pro" → Stripe Checkout → pago → activo

5. Si llegó al límite de plan → modal contextual de upgrade
   → "Alcanzaste el límite de obras del plan Básico (3/3). 
      Pasá a Pro para obras ilimitadas."
   → Botón "Upgrade a Pro" → Stripe Checkout
```

### Gaps críticos y soluciones

---

#### Gap 1 — No hay landing page

**Impacto:** Crítico para comercialización

**Solución profesional:**

Dos enfoques posibles:

**Opción A — Landing integrada en la app React (recomendada para MVP):**
```tsx
// App.tsx — si no hay token, mostrar landing antes del login:
if (!token && window.location.pathname === "/") {
  return <LandingPage onRegister={() => navigate("/register")} />;
}
```

La landing tiene: hero (propuesta de valor), features (3-4 screenshots), pricing (tabla de planes), CTA (Empezar gratis).

**Opción B — Sitio de marketing separado (recomendada a mediano plazo):**
Un dominio como `constructa.com` con Astro o Next.js para el marketing site (SEO, blog, casos de uso), y `app.constructa.com` para la webapp. Esta es la arquitectura de Notion, Linear, Vercel.

**Esfuerzo estimado:** 1-2 días (opción A, integrada)

---

#### Gap 2 — No hay trial gratis de Pro

**Impacto:** Alto — conversión  
(Ver solución completa en Sección 3, Gap 3)

---

#### Gap 3 — No hay self-service upgrade

**Impacto:** Alto  
(Ver solución completa en Sección 3, Gap 4)

---

#### Gap 4 — No hay email de bienvenida ni onboarding

**Impacto:** Medio  
(Ver solución completa en Sección 2, Gap 4)

---

#### Gap 5 — No hay facturas ni comprobantes

**Impacto:** Alto cuando haya billing

**Solución profesional:**  
Stripe genera facturas automáticamente por cada cobro. El cliente recibe PDF por email sin que CONSTRUCTA tenga que hacer nada. Solo hay que activar "Email customers about charges" en la configuración de Stripe.

Para facturación AFIP (Argentina): se necesita integración con un servicio como **AfipFact** o **TusFacturas** que genere la factura electrónica AFIP-compatible. Esto es un requerimiento legal para cobrar a empresas en Argentina.

---

## 8. Resumen: Fortalezas vs Debilidades

### Fortalezas

1. **Arquitectura multi-tenant limpia.** Datos correctamente aislados, extensible a N clientes sin cambios de arquitectura.
2. **Plan limits en backend.** El chequeo es robusto: se aplica antes de escribir, retorna errores descriptivos con contexto estructurado.
3. **Sistema de invitaciones con tokens seguros.** 256 bits de entropía, expiración, fallback copy-URL. Mejor que muchos proyectos similares.
4. **Rol-based access bien separado.** La distinción admin/collaborator está respetada en frontend y backend.
5. **Token storage con estrategia dual.** sessionStorage per-tab + localStorage para persistencia sin conflictos entre tabs.
6. **Schemas de respuesta limpios.** Nunca se filtra información sensible en las respuestas.

### Debilidades (ordenadas por impacto)

| # | Debilidad | Categoría |
|---|-----------|-----------|
| 1 | No hay billing real — el sistema no puede cobrar | Monetización |
| 2 | No hay reset de contraseña — bloqueante en producción | Auth |
| 3 | No hay rate limiting en login — riesgo de seguridad | Seguridad |
| 4 | No hay refresh token — sesiones de 24h fijas | Auth |
| 5 | No hay landing page ni pricing — sin experiencia de compra | Producto |
| 6 | No hay verificación de email en registro | Auth / Datos |
| 7 | `active_until` sin lógica de enforcement | Planes |
| 8 | No hay trial — baja conversión esperada | Producto |
| 9 | No hay invitaciones pendientes visibles | UX Equipo |
| 10 | No hay email de bienvenida | Onboarding |

---

## 9. Prioridad de correcciones

### P0 — Bloqueantes para producción real

| Tarea | Qué cambiar | Esfuerzo |
|-------|-------------|---------|
| Password reset (forgot + reset por email) | `auth.py`, `email_service.py`, `LoginPage.tsx` | 4-6h |
| Rate limiting en `/auth/login` (`slowapi`) | `main.py`, `auth.py` | 1-2h |
| Degradado gracioso si BREVO_API_KEY está vacío | `email_service.py` | 1h |
| Validar FRONTEND_URL en startup | `main.py` | 30 min |
| Mínimo 1 admin por tenant al borrar | `users.py` | 30 min |
| Handler 402 centralizado en frontend | `api/client.ts`, `App.tsx` | 2h |

### P1 — Importantes para experiencia de cliente

| Tarea | Qué cambiar | Esfuerzo |
|-------|-------------|---------|
| Register devuelve token directamente | `auth.py`, `auth_service.py`, `LoginPage.tsx` | 1h |
| Email de bienvenida post-registro | `auth_service.py`, `email_service.py` | 2h |
| Invitaciones pendientes en EquipoPage | `users.py` (GET), `EquipoPage.tsx` | 3-4h |
| Reenviar invitación vencida | `users.py` (nuevo endpoint), `EquipoPage.tsx` | 1-2h |
| `company_name` requerido en registro | `schemas/user.py`, `LoginPage.tsx` | 30 min |
| Limpieza automática de invites vencidos | `scheduler.py` | 1h |

### P2 — Para comercialización real

| Tarea | Qué cambiar | Esfuerzo |
|-------|-------------|---------|
| Refresh token (access 60min + refresh 30d) | `auth.py`, `models/`, nueva tabla, `api/client.ts` | 6-8h |
| Trial de 14 días en Pro al registrarse | `auth_service.py`, `tenant model`, `check_plan_limit` | 3-4h |
| Landing page pública con propuesta de valor | nuevo `LandingPage.tsx` | 1-2 días |
| Página de precios pública `/pricing` | nuevo `PricingPage.tsx` | 4-6h |
| Integración Stripe / Mercado Pago | nuevo `billing.py`, webhook, `AdminPage.tsx` | 2-3 días |
| Modal de upgrade contextual en 402 | `App.tsx`, nuevo `PlanLimitModal.tsx` | 2h |
| Email de onboarding (serie 3 emails) | `scheduler.py`, `email_service.py` | 1-2 días |
| Verificación de email en registro | `auth.py`, `models/user.py`, `email_service.py` | 3-4h |

---

## 10. Archivos clave por corrección

| Corrección | Backend | Frontend |
|-----------|---------|----------|
| Password reset | `auth.py` (2 endpoints), `email_service.py`, `user.py` (2 campos) | `LoginPage.tsx` (link), nueva `ResetPasswordPage.tsx` |
| Refresh token | `auth.py` (nuevo endpoint), nueva `models/refresh_token.py`, `deps.py` | `api/client.ts` (interceptor), `lib/tokenStorage.ts` |
| Rate limiting | `main.py` (slowapi setup), `auth.py` (decorador) | — |
| Welcome email | `auth_service.py` | — |
| Invites pendientes | `users.py` (filtro is_active) | `EquipoPage.tsx` (nueva sección) |
| Reenviar invite | `users.py` (POST /{id}/resend-invite) | `EquipoPage.tsx` (botón) |
| 402 centralizado | — | `api/client.ts`, `App.tsx`, nuevo `PlanLimitModal.tsx` |
| active_until enforcement | `deps.py` (nueva dependency `ActiveTenant`) | `App.tsx` (manejar 402 de expiración) |
| Trial | `auth_service.py`, `tenant model` (trial_ends_at), `plan_limits.py` | `AdminPage.tsx` (banner trial), nuevo `TrialBanner.tsx` |
| Billing | nuevo `billing.py` (webhook, checkout), `tenant model` | `AdminPage.tsx`, nuevo `UpgradeModal.tsx` |
| Landing | — | nuevo `LandingPage.tsx`, `App.tsx` (routing) |
| Pricing | — | nuevo `PricingPage.tsx` |
