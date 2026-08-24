# Fase 6 — Emails: no bloqueantes, con retry, aviso 80% del plan

> **Alcance:** parte de CÓDIGO de los hallazgos de emails identificados en `docs/auditoria/01-login-usuarios-planes.md` §8. Independiente del rediseño de roles — no depende de las fases 0-5 ni ellas de esta.
>
> **NO cubre:** el paso de infraestructura (comprar dominio, configurar DNS/SPF/DKIM/DMARC en Brevo, verificar sender en un dominio propio). Ese trabajo lo hace el equipo manualmente siguiendo el checklist de la §8.11 del audit 01 — **este reporte lo remarca al final para que no se pierda**.

**Fecha:** 2026-08-24
**Base:** `docs/auditoria/01-login-usuarios-planes.md` §8 (sistema de emails Brevo), especialmente hallazgos E3, E4, E5, E8.

---

## 1. Lo que se implementó

### 1.1 `email_service.py` — no bloqueante y con retry (hallazgos E3 + E4)

**Antes:** `requests.post` sync dentro de `async def`. Bloquea el event loop hasta el timeout de 10s por email → degrada throughput bajo carga concurrente. Un `429` de Brevo se pierde para siempre porque no hay retry.

**Ahora:**

- **Cliente HTTP async real:** migré a `httpx.AsyncClient` (ya listado como dependencia en `requirements.txt:35`). No usa el thread pool; usa el event loop nativo de FastAPI.
- **Retry con backoff exponencial:** `tenacity.AsyncRetrying` con 3 intentos y esperas 1s → 2s → 4s (`wait_exponential(min=1, max=8)`).
- **Retry SOLO sobre errores transitorios:** 429 (rate limit), 503 (Brevo caído), timeouts / errores de red (`httpx.TimeoutException`, `httpx.NetworkError`). Los 400/401/422 NO se reintentan — son problemas de payload/config que reintentar no arregla y solo suma latencia.
- **Degradación silenciosa preservada:** si `BREVO_API_KEY` está vacía, se loguea WARNING y se devuelve `False`/`None` sin explotar (comportamiento previo mantenido para dev sin credenciales).
- **Fire-and-forget robusto:** cualquier excepción no manejada dentro de `_send_via_brevo` se atrapa, loguea y devuelve `False`. Un fallo del proveedor de email nunca puede tumbar el endpoint HTTP que lo invocó.

Nueva dependencia: `tenacity>=9.0` agregada en `backend/requirements.txt` (comentado por qué está ahí para el próximo dev).

### 1.2 `.env.example` completado (hallazgo E8)

Agregadas las 4 variables que estaban documentadas en el audit pero no en el archivo de ejemplo:

- `BREVO_API_KEY` — con nota explícita de qué pasa si está vacía (log WARNING + endpoint sigue funcionando, aceptable SOLO en dev).
- `BREVO_SENDER_EMAIL=noreply@constructa.local` — placeholder inofensivo. Aviso de que debe ser sender verificado en Brevo, y de que en prod requiere dominio propio con SPF/DKIM/DMARC.
- `BREVO_SENDER_NAME=Constructa` — placeholder razonable.
- `FRONTEND_URL=http://localhost:5173` — cae al default local; aviso explícito de que si no se setea en prod, los links de invitación/reset apuntan a `localhost` (inservibles para el destinatario). Este era el hallazgo E2 latente.

Ningún `.env` real fue tocado — solo `.env.example`.

### 1.3 Aviso preventivo al 80% del plan (hallazgo E5 / mejora 6.8)

**Cómo funciona:**

1. Cada llamada a `check_plan_limit(db, tenant_id, resource, ...)` que pasa (no lanza 402) invoca al final `_maybe_schedule_plan_warning(...)`.
2. Si `(current + requested) >= limit * 0.80`, se chequea el dedupe: `tenants.last_plan_warning_at`. Si el último aviso fue hace menos de 7 días → skip.
3. Si pasa el dedupe: se actualiza el timestamp EN LA MISMA SESIÓN (queda persistido cuando el request commit-ee) y se lanza `asyncio.create_task(...)` con el envío del email — no bloquea la respuesta HTTP.
4. La tarea de background abre su propia sesión de DB, resuelve el owner del tenant (`Tenant.owner_user_id → User.email`) y llama a `send_plan_warning_email(...)`.
5. Si el tenant no tiene owner, o el owner no tiene email, se skipea con log INFO — sin explotar.

**`requested=0`** (usado por el doble candado de `accept-invite`) **NO dispara** el aviso — no hay cambio real de estado, el user ya estaba contado como invitación viva y el aviso ya se disparó (o no) en el momento del invite original.

**Template del email:** función `send_plan_warning_email(...)` con HTML dedicado que muestra nombre del admin, nombre del tenant, contadores `X de Y`, porcentaje calculado, plan, y CTA "Ver planes disponibles" que apunta a `{FRONTEND_URL}/configuracion#plan`.

**Migración 0050:** nueva columna `tenants.last_plan_warning_at TIMESTAMP WITH TIME ZONE NULL`.

---

## 2. Tests

### 2.1 `tests/test_email_service.py` (16 tests, todos pasando)

Cubre lo que el audit §8.9 marcaba como gap: hasta ahora ningún test validaba que el sender, subject o HTML de los emails fueran correctos.

- **Sender + payload:** sender configurado desde `settings`, subject correcto por tipo (`invite` / `reset` / `verification` / `plan_warning`), HTML/text incluyen la URL correspondiente.
- **Degradación:** sin `BREVO_API_KEY`, `send_email` devuelve `False` y `send_invite_email` devuelve `None`; en ambos casos NO se hace ningún POST al mock.
- **Retry:**
  - Retry sobre 503 (2 intentos fallan → 3ro OK).
  - Retry sobre 429 (rate limit).
  - Retry sobre `httpx.ConnectTimeout`.
  - Agotamiento de 3 intentos consecutivos de 503 → devuelve `False` (no explota).
- **No-retry:** 400 y 401 se resuelven en 1 solo call — reintentar no arreglaría el bad payload.
- **Rol → label del HTML de invitación:** `admin` renderiza "Administrador"; `collaborator` renderiza "Colaborador".
- **Email de aviso de plan:** contiene nombre del admin, nombre del tenant, contadores, CTA al frontend y el porcentaje calculado (`80%`).

Uso de `unittest.mock.patch` sobre `httpx.AsyncClient` para no golpear la API real de Brevo en tests.

### 2.2 `tests/test_plan_warning_email.py` (8 tests, todos pasando)

- **Threshold cumplido / no cumplido:** al 80% dispara, al 40% no dispara, al 100% también dispara.
- **Dedupe:** si hubo aviso hace 3 días → no manda; si hace 10 días → manda.
- **`requested=0`:** el doble candado no dispara aviso.
- **Owner ausente / sin email:** `_send_plan_warning_now` skipea silenciosamente sin explotar.

Verifica que `tenants.last_plan_warning_at` se persiste correctamente después de disparar el aviso.

### 2.3 Resultado global

**Suite backend completa:** `pytest --tb=short -q` → **200 passed, 0 failed** en 54s. Los 24 tests nuevos de esta fase (16 + 8) más los 176 previos (fases 0-5 del rediseño de roles).

---

## 3. Archivos entregados

**Backend — código productivo (4 archivos):**

- `backend/app/services/email_service.py` — reescrito con `httpx.AsyncClient` + `tenacity` + template del aviso de plan.
- `backend/app/core/plan_limits.py` — helper `_maybe_schedule_plan_warning` + `_send_plan_warning_now`.
- `backend/app/models/tenant.py` — columna `last_plan_warning_at`.
- `backend/.env.example` — variables de email + `FRONTEND_URL` documentadas.
- `backend/requirements.txt` — agregado `tenacity>=9.0`.

**Migración (1):**

- `backend/alembic/versions/0050_tenant_last_plan_warning.py`.

**Tests (2 archivos nuevos):**

- `backend/tests/test_email_service.py` — 16 tests.
- `backend/tests/test_plan_warning_email.py` — 8 tests.

**Sin tocar:**

- Frontend — el aviso preventivo llega al mail del admin owner; la UI ya muestra el `invite_url` como fallback (audit §8.7).
- Endpoints HTTP — la firma pública de `check_plan_limit` no cambia; el aviso es efecto colateral.
- Ningún `.env` real. La configuración productiva es responsabilidad del checklist manual (ver §5).

---

## 4. Hallazgos del audit §8 cerrados en esta fase

| # | Hallazgo | Severidad | Estado post-fase |
|---|---|---|---|
| **E3** | Sin retry ni cola persistente ante 429/503 de Brevo | ALTO | ✅ Retry con backoff (3 intentos). Cola persistente NO — sigue siendo fire-and-forget con log en caso de agotamiento de retries. |
| **E4** | `requests.post` sync bloquea el event loop hasta 10s | ALTO en performance | ✅ Cerrado. `httpx.AsyncClient` no bloquea. |
| **E5** | No hay email preventivo al 80% del plan | ALTO para monetización | ✅ Implementado. Threshold + dedupe + fire-and-forget. |
| **E8** | `.env.example` no documenta variables de Brevo | MEDIO onboarding | ✅ Documentadas las 4 variables con comentarios claros. |
| **E13** | Ningún test cubre payload del email | BAJO | ✅ Cubierto con 16 tests. |

**Hallazgos que quedan fuera de esta fase** (por definición: infraestructura o requieren decisión de producto):

- **E1** (sender universitario `@ucc.edu.ar` sin control DNS): **infraestructura manual** — ver §5.
- **E2** (`FRONTEND_URL` no seteado en prod → links a localhost): parte del checklist manual — el default de `.env.example` es `localhost:5173`, hay que setearlo al dominio real en el deploy.
- **E6/E7** (emails de "password cambiado" y "login desde IP nueva"): mejoras de seguridad estándar que no son parte del scope de esta fase. Se pueden agregar en un ticket futuro.
- **E9** (tokens invite/reset sin hashear en DB): tema de seguridad enterprise, no bloquea prod.
- **E10** (templates reset/verificación sin viewport meta): mejora cosmética.
- **E11** (`noreply@` como sender): decisión de producto sobre naming.
- **E12** (sin auditoría de envíos): mejora operacional, no urgente.

---

## 5. Recordatorio explícito — falta el paso manual de infraestructura antes de prod

**Este código no sirve en producción hasta que un humano haga los siguientes pasos**, documentados originalmente en `docs/auditoria/01-login-usuarios-planes.md` §8.11:

**En el proveedor del dominio** (Cloudflare, DonWeb, Namecheap, etc.):
- [ ] Crear registro TXT **DKIM** con la clave que provee Brevo.
- [ ] Extender/crear registro **SPF** con `include:spf.brevo.com`.
- [ ] Crear registro **DMARC** en `_dmarc.<dominio>` con política inicial `v=DMARC1; p=none; rua=mailto:<tu-email>`.
- [ ] Crear mailbox `hola@<dominio>` (o `soporte@`), redirigido a una casilla real.

**En Brevo:**
- [ ] *Senders, Domains & Dedicated IPs* → *Domains* → agregar `<dominio>`.
- [ ] Verificar que los 3 registros DNS estén en verde.
- [ ] Crear el sender `hola@<dominio>` y verificarlo.

**En el backend:**
- [ ] Actualizar `backend/.env` (prod):
  ```
  BREVO_API_KEY=xkeysib-<real>
  BREVO_SENDER_EMAIL=hola@<dominio>
  BREVO_SENDER_NAME=Constructa
  FRONTEND_URL=https://app.<dominio>
  ```
- [ ] Reiniciar el backend.

**Prueba de humo (5 min):**
- [ ] Invitar a un email `@gmail.com` — verificar que llega a inbox (no spam).
- [ ] Verificar que el link del email abre la app en el dominio correcto.
- [ ] Forgot-password a un usuario real — mismo chequeo.
- [ ] Registrar cuenta nueva — verificar email de verificación.
- [ ] En Gmail, chequear el header: debe decir "firmado por `<dominio>`", no "vía brevo.com".

**Después de 2 semanas** (DMARC monitor):
- [ ] Revisar reportes DMARC agregados que llegan a `rua=mailto:`.
- [ ] Si limpio → subir política a `p=quarantine`. Después de 2 semanas más → `p=reject`.

Sin estos pasos, los emails que Brevo dice haber enviado con `202 Accepted` **pueden estar cayendo en spam de los destinatarios**, o siendo bloqueados directamente en el MX del receptor (audit §8.5). El código nuevo mejora la robustez, pero **no reemplaza la configuración de deliverability del dominio**.

---

## 6. Sub-fases del rediseño y esta fase

Esta fase es **independiente** del rediseño de roles (fases 0-5) — corrió en paralelo. El único punto de contacto es que el aviso 80% se dispara desde `check_plan_limit`, que también es tocado por el rediseño (Fase 0 fixed el bypass, Fase 3 agregó `requested=0` en accept-invite). El `TODO` explícito sobre `solo_lectura` + límite del plan sigue en `plan_limits.py` sin cambios — no fue parte del scope de esta fase.

Cierre integral:

- **Rediseño de roles (0-5):** completo, en producción, 176 tests.
- **Fase 6 emails:** completo, en código, 24 tests adicionales. Total: 200 tests / 0 failed.
- **Pendiente cross-fase:** decisión producto sobre `solo_lectura` vs `max_users` (documentado en `fase-3-invitacion.md §5` y en el TODO de `plan_limits.py:73-97`).
- **Pendiente esta fase:** paso manual de infraestructura de email (§5 de este reporte).
