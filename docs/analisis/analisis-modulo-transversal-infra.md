# Análisis: Configuración · Notificaciones · Calidad · Infraestructura (Transversal / Production-readiness)

> Módulo auditado: la capa transversal que no es una feature pero decide si el sistema es desplegable — configuración y secretos, CORS, jobs/notificaciones, settings, testing, observabilidad, base de datos y deployment.
> Fecha: 2026-07-02 | Rama: `main`

---

## TL;DR

Acá está la **deuda de "pasar de demo a producto"**. La disciplina de base de datos es buena (39 migraciones Alembic secuenciales, config tipada con Pydantic, degradado con gracia sin API keys). Pero faltan tres pilares de producción: **no hay tests automatizados** (cero, ni backend ni frontend), **no hay CI/CD ni configuración de deployment** (sin Dockerfile, sin GitHub Actions, todo apunta a localhost), y **no hay observabilidad** (ni manejo global de errores, ni tracking tipo Sentry, ni logging estructurado). En un sistema con lógica compleja (CPM, cascade, multi-tenant, máquina de estados del chatbot), la ausencia de tests es el riesgo de calidad más grande del proyecto.

---

## 1. Configuración y secretos

### Qué funciona

| Aspecto | Estado |
|---------|--------|
| Config tipada con `pydantic-settings` (`BaseSettings`) | ✅ |
| `SECRET_KEY` requerido (sin default → falla si no está) | ✅ |
| `.env` para desarrollo | ✅ |
| Degradado con gracia si faltan keys de integración (Twilio/Brevo/OpenAI/Anthropic → `""`) | ✅ |
| `DEBUG` como flag | ✅ |

### Gaps detectados y cómo resolverlos

---

#### Gap 1 — Secretos con default `""` y sin validación en el arranque

**Impacto:** Alto en producción

`TWILIO_*`, `INTERNAL_API_KEY`, `BREVO_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `PUBLIC_BASE_URL` tienen default `""`. En dev está bien (degradan con gracia), pero en **producción** un secreto vacío pasa desapercibido: emails que no salen, chatbot que no responde, IA que no procesa — sin que nada avise en el arranque.

**Solución profesional — validación de config al startup según entorno:**

```python
# Agregar un discriminador de entorno:
ENV: str = "development"   # development | staging | production

# En el lifespan de main.py, si ENV == "production", exigir lo crítico:
REQUIRED_IN_PROD = ["SECRET_KEY", "DATABASE_URL", "PUBLIC_BASE_URL", "INTERNAL_API_KEY"]
missing = [k for k in REQUIRED_IN_PROD if not getattr(settings, k)]
if settings.ENV == "production" and missing:
    raise RuntimeError(f"Faltan variables requeridas en producción: {missing}")
```

(Es el mismo Gap 5 del audit de auth/invitaciones, generalizado.)

**Esfuerzo estimado:** 1-2h

---

#### Gap 2 — No hay discriminador de entorno (`ENV`)

**Impacto:** Medio

Solo hay `DEBUG: bool`. No hay `ENV` (development/staging/production), del que dependen: forzar HTTPS, validar secretos, ajustar CORS, activar/desactivar tracking de errores. Varias recomendaciones de los otros audits (HTTPS redirect, validación de `FRONTEND_URL`) lo necesitan.

**Solución profesional:** agregar `ENV` a `Settings` y derivar de él los comportamientos de producción.

**Esfuerzo estimado:** 30 min

---

#### Gap 3 — `INTERNAL_API_KEY` vacío deja pasar los endpoints internos

**Impacto:** Medio — seguridad

(Cross-ref audit de auth, Sección 6, Gap 5.) Los endpoints de `notifications` (`send-reminders`, `mark-overdue`, `check-no-response`) se protegen con `InternalAuth`, pero si la key está vacía, la dependency no debería dejar pasar nada.

**Solución profesional:** que `InternalAuth` falle con 500 si `INTERNAL_API_KEY` no está configurada, en vez de aceptar cualquier request.

**Esfuerzo estimado:** 30 min

---

## 2. CORS y seguridad de transporte

### Qué funciona

| Aspecto | Estado |
|---------|--------|
| CORS **no** usa wildcard `*` (lista explícita) | ✅ |
| `allow_credentials=True` coherente con orígenes explícitos | ✅ |

### Gaps detectados y cómo resolverlos

---

#### Gap 1 — Orígenes CORS hardcodeados a localhost

**Impacto:** Alto en producción

```python
allow_origins=[
    "http://localhost:5173", "http://127.0.0.1:5173",
    "http://localhost:5174", "http://127.0.0.1:5174",
]
```

En producción, el dominio real del frontend **no está** en la lista → el navegador bloquea todas las requests. Además, no es configurable por entorno.

**Solución profesional:** los orígenes vienen de una variable:

```python
# config.py
ALLOWED_ORIGINS: list[str] = ["http://localhost:5173"]
# main.py
allow_origins=settings.ALLOWED_ORIGINS
```

Y en producción, el proxy inverso agrega los headers de seguridad (HSTS, X-Frame-Options, CSP) — ver audit de auth, Sección 6, Gap 4.

**Esfuerzo estimado:** 1h

---

## 3. Notificaciones y jobs programados (scheduler)

### Qué funciona

| Aspecto | Estado |
|---------|--------|
| Endpoints internos: `send-reminders`, `mark-overdue`, `check-no-response` (gated por `InternalAuth`) | ✅ |
| APScheduler para jobs periódicos (recordatorio de obra en bitácora, riesgos) | ✅ |
| Separación de disparadores internos vs API de usuario | ✅ |

### Gaps detectados y cómo resolverlos

- **Gap 1 (Medio):** los jobs de APScheduler corren **en el proceso del backend**. Con múltiples workers/instancias, cada uno correría los jobs → duplicación (dos recordatorios, dos evaluaciones). Se necesita un **lock distribuido** (Redis) o un único worker de jobs (o mover a un cron externo / n8n, que ya se usa para algunas cosas).
  - **Solución:** APScheduler con jobstore/lock en Redis, o designar una sola instancia como "scheduler leader". **Esfuerzo:** 2-3h.
- **Gap 2 (Bajo):** no hay observabilidad de los jobs (si un job falla, ¿alguien se entera?). Loggear inicio/fin/error de cada job y exponer un health del scheduler.

---

## 4. Settings de la aplicación

### Qué funciona

| Aspecto | Estado |
|---------|--------|
| `GET/PATCH /settings` **solo-admin** (`AdminUser`) | ✅ |

### Gaps detectados

- **Gap 1 (a verificar):** confirmar que los settings estén scopeados por tenant (cada empresa sus settings) y no sean globales. Si son globales, un admin de una empresa cambiaría los de todas. Dado el patrón del resto del sistema, conviene auditarlo junto con el hardening de tenant.

---

## 5. Testing y calidad

### Estado actual

| Aspecto | Estado |
|---------|--------|
| Tests backend del proyecto | ❌ **0** (los 76 "test_*.py" son de dependencias en `.venv`) |
| Tests frontend | ❌ **0** |
| Red de seguridad actual | `tsc -b` + `py_compile` + `import app.main` + prueba manual |

### Gaps detectados y cómo resolverlos

---

#### Gap 1 — No hay tests automatizados (el mayor riesgo de calidad)

**Impacto:** Alto

El sistema tiene lógica que **grita por tests**: `VALID_TRANSITIONS`, `_check_no_cycle` (DFS), `compute_critical_path` (CPM), `cascade_reschedule`, `_snap_working_dates`, la máquina de estados del chatbot, el rollup de materiales, el aislamiento multi-tenant. Hoy, cualquier refactor se valida a mano. Cada uno de los bugs de tenant que encontró esta auditoría **lo habría atrapado un test de autorización**.

**Solución profesional — pirámide mínima:**

```
Backend (pytest + httpx + pytest-asyncio):
  - Unit: CPM, cascade, transiciones, ciclos, snapping de fechas (lógica pura, rápida)
  - Integration: cada endpoint con un usuario de OTRO tenant → debe dar 404/403
    (este set solo habría prevenido TODAS las fugas cross-tenant del sistema)
Frontend (Vitest + Testing Library):
  - Componentes críticos: planilla (selección/insert), Gantt (drag→PATCH)
E2E (Playwright):
  - Flujos: alta de obra, cargar tareas, cambiar estado, chatbot mock
```

Arrancar por el **set de integración de autorización por tenant**: es el de mayor ROI (previene la clase de bug más grave del sistema) y sirve de red para el "hardening de autorización" recomendado.

**Esfuerzo estimado:** 2-3 días para una base sólida (1 día solo para el set de tenant)

---

#### Gap 2 — No hay CI que corra tsc/py_compile/tests en cada push

**Impacto:** Alto

No hay `.github/workflows`. El `tsc` roto que se coló con el PR #27 (`NuevaSolicitudModal`) es evidencia directa: **un CI lo habría frenado antes del merge.**

**Solución profesional:** un workflow de GitHub Actions con dos jobs: backend (`ruff` + `py_compile` + `pytest`) y frontend (`tsc -b` + `vitest`), obligatorio para mergear.

**Esfuerzo estimado:** 2-3h

---

## 6. Observabilidad (logging, errores, tracking)

### Gaps detectados y cómo resolverlos

---

#### Gap 1 — Sin manejo global de excepciones

**Impacto:** Medio-Alto

El único middleware es CORS. No hay `@app.exception_handler` global: una excepción no controlada devuelve el 500 por defecto de FastAPI (y en `DEBUG` puede filtrar el stack trace al cliente).

**Solución profesional:** handler global que loguee la excepción con contexto (request id, user, tenant) y devuelva un 500 genérico sin filtrar internals.

**Esfuerzo estimado:** 1-2h

---

#### Gap 2 — Sin tracking de errores (Sentry) ni logging estructurado

**Impacto:** Medio-Alto — a ciegas en producción

No hay `logging.basicConfig`/`dictConfig` en la app: el logging usa los defaults de Python (nivel WARNING, sin formato estructurado, sin correlación). Y no hay integración con un tracker (Sentry/GlitchTip). En producción, **no te enterás de que algo se rompió** hasta que un usuario se queja.

**Solución profesional:**
- Logging estructurado (JSON) con nivel por `ENV`, incluyendo request-id/tenant.
- Sentry SDK (`sentry-sdk[fastapi]`): captura excepciones + performance, con el `ENV` y el `release`. Free tier alcanza para empezar.

**Esfuerzo estimado:** 2-3h

---

#### Gap 3 — Health check no verifica dependencias

**Impacto:** Bajo

`GET /health` devuelve `{"status": "ok"}` fijo, sin chequear DB ni dependencias. Un balanceador lo vería "sano" aunque la base esté caída.

**Solución profesional:** `/health` (liveness, fijo) + `/ready` (readiness: hace un `SELECT 1` a la DB y chequea lo crítico).

**Esfuerzo estimado:** 1h

---

## 7. Base de datos y migraciones

### Qué funciona

| Aspecto | Estado |
|---------|--------|
| 39 migraciones Alembic **secuenciales** (0001→0039), sin saltos | ✅ |
| Migraciones acompañan cada feature (disciplina de esquema) | ✅ |
| SQLAlchemy 2.0 async con `Mapped[]` typing | ✅ |

### Gaps detectados

- **Gap 1 (Bajo):** verificar que haya índices en las columnas de filtro más usadas (`tenant_id`, `obra_id`, `task_id`, `status`, fechas) — la mayoría ya tiene `index=True`, pero conviene un repaso para queries de listado a escala.
- **Gap 2 (Bajo):** no se observó estrategia de backup/PITR documentada; es responsabilidad del hosting de la DB, pero conviene dejarlo escrito.

---

## 8. Deployment / CI-CD

### Estado actual

| Aspecto | Estado |
|---------|--------|
| Dockerfile / docker-compose | ❌ no hay |
| CI/CD (GitHub Actions, etc.) | ❌ no hay |
| Config de hosting (Railway/Render/Fly/…) | ❌ no hay |
| Todo apunta a `localhost` | ⚠️ |

### Gaps detectados y cómo resolverlos

---

#### Gap 1 — No hay artefacto ni pipeline de deployment

**Impacto:** Alto — bloqueante para producción

El proyecto no es desplegable tal cual: no hay imagen, ni pipeline, ni configuración de entorno productivo. (Coincide con el "flujo de cliente" del audit de auth: no hay dominio, todo es localhost.)

**Solución profesional — stack mínimo de deploy:**
- **Backend:** `Dockerfile` (python 3.12-slim, uvicorn) + variables de entorno + `alembic upgrade head` en el arranque.
- **Frontend:** build estático servido por CDN/host (Vercel/Netlify/Cloudflare Pages) o nginx.
- **DB:** Postgres gestionado (Railway/Render/Supabase/Neon).
- **Archivos:** bucket S3/R2 (ver audit de compras/documentos, Gap de storage).
- **Redis:** para rate limiting, blacklist de tokens, Socket.IO multi-worker y locks de scheduler (aparece como dependencia recurrente en los 4 audits).

**Esfuerzo estimado:** 2-3 días (setup completo de infraestructura)

---

## 9. Resumen: Fortalezas vs Debilidades

### Fortalezas

1. **Disciplina de migraciones** (39 secuenciales, una por feature).
2. **Config tipada** con Pydantic + degradado con gracia sin keys.
3. **CORS restrictivo** (sin wildcard) y endpoints internos gated.
4. **Separación clara** entre disparadores internos (jobs/n8n) y API de usuario.

### Debilidades (ordenadas por impacto)

| # | Debilidad | Categoría |
|---|-----------|-----------|
| 1 | Cero tests automatizados (backend + frontend) | Calidad |
| 2 | Sin CI/CD ni Dockerfile ni config de deploy | Deployment |
| 3 | Sin observabilidad (errores/Sentry/logging estructurado) | Operación |
| 4 | CORS hardcodeado a localhost | Producción |
| 5 | Secretos sin validación de startup + sin `ENV` | Configuración |
| 6 | Sin manejo global de excepciones | Robustez |
| 7 | Jobs de scheduler sin lock (duplican con N workers) | Escala |
| 8 | Health sin chequeo de dependencias | Operación |

---

## 10. Prioridad de correcciones

### P0 — Habilitantes de producción

| Tarea | Qué cambiar | Esfuerzo |
|-------|-------------|---------|
| CI que corre tsc + py_compile + tests en cada PR | `.github/workflows/ci.yml` | 2-3h |
| Set de tests de autorización por tenant (integración) | `backend/tests/test_tenant_isolation.py` | 1 día |
| CORS + secretos por `ENV` con validación de startup | `config.py`, `main.py` | 2-3h |
| Dockerfile backend + build frontend + `alembic upgrade` | `Dockerfile`, config de host | 1 día |

### P1 — Observabilidad y robustez

| Tarea | Qué cambiar | Esfuerzo |
|-------|-------------|---------|
| Handler global de excepciones + logging estructurado | `main.py` | 1-2h |
| Sentry (errores + performance) | `main.py`, `requirements` | 2-3h |
| `/ready` con chequeo de DB | `main.py` | 1h |
| `InternalAuth` falla si la key está vacía | `deps.py` | 30 min |
| Lock de scheduler (Redis) o leader único | `scheduler.py` | 2-3h |

### P2 — Base de tests amplia

| Tarea | Qué cambiar | Esfuerzo |
|-------|-------------|---------|
| Unit tests de la lógica (CPM, cascade, transiciones, ciclos) | `backend/tests/` | 1-2 días |
| Tests de componentes críticos del front (planilla, Gantt) | `frontend/**/*.test.tsx` (Vitest) | 1-2 días |
| E2E de flujos clave (Playwright) | `e2e/` | 2-3 días |

---

## 11. Archivos clave por corrección

| Corrección | Ubicación |
|-----------|-----------|
| CI/CD | `.github/workflows/ci.yml` (nuevo) |
| Tests de tenant | `backend/tests/test_tenant_isolation.py` (nuevo) |
| CORS + ENV | `backend/app/core/config.py`, `backend/app/main.py` |
| Handler global + logging | `backend/app/main.py` |
| Sentry | `backend/app/main.py`, `backend/requirements.txt` |
| `/ready` | `backend/app/main.py` |
| InternalAuth | `backend/app/core/deps.py` |
| Scheduler lock | `backend/app/core/scheduler.py` |
| Dockerfile / deploy | `backend/Dockerfile` (nuevo), config de host |

---

## 12. Cierre — auditoría del sistema completa (4 clusters)

Con este cuarto documento, la auditoría cubre **todo el sistema**:

1. **Auth · Planes · Onboarding** (`analisis-modulo-auth-planes.md`) — falta la capa de producto/monetización (billing, landing, reset de password, refresh token).
2. **Núcleo operativo** (`analisis-modulo-obras-tareas-cronograma.md`) — motor sólido; deuda de autorización por tenant en tareas.
3. **Comunicación de campo** (`analisis-modulo-comunicacion-campo.md`) — robusto; fuga cross-tenant en las salas de socket; sin notificación offline.
4. **Compras · Documentos** (`analisis-modulo-compras-documentos.md`) — despareja; **archivos públicos sin auth** (el gap más grave); IDOR en materiales/cotizaciones.
5. **Transversal · Infra** (este doc) — sin tests, sin CI/CD, sin observabilidad.

### Los 3 frentes de trabajo, en orden

1. **Hardening de autorización (P0 transversal a 3 audits).** Un solo concepto —scopear todo por tenant— aplicado en ~9 puntos: tareas, materiales, cotizaciones, planos, historial, órdenes, alertas (mark-read), salas de socket y servido de archivos. Con un set de tests de integración que valide "usuario de otro tenant → 404" queda blindado. **Es lo primero, sí o sí, antes de un cliente multi-empresa.**
2. **Capa de producción.** CI/CD + Docker + observabilidad (Sentry/logging) + CORS/ENV + archivos en bucket con auth + Redis (rate limiting, tokens, socket multi-worker, locks). Convierte la demo en algo desplegable y operable.
3. **Capa de negocio/monetización** (del audit de auth). Billing real, trial, landing, pricing, reset de contraseña. Convierte lo desplegable en algo vendible.

El producto está **funcionalmente muy avanzado**; lo que falta es, casi todo, **capa de producción y de negocio**, no features.
