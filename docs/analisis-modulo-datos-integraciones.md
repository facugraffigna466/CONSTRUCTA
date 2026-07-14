# Análisis: Modelo de datos e Integraciones externas

> Módulo auditado: el esquema de datos como conjunto (consistencia multi-tenant, integridad referencial, índices, convenciones) y las integraciones externas (n8n, Brevo/email, OpenAI/Anthropic, Twilio) — patrón de llamada, timeouts, reintentos y manejo de secretos.
> Fecha: 2026-07-02 | Rama: `main`

---

## TL;DR

Este documento explica **la causa raíz** de la clase de bug que apareció en los seis audits anteriores. A nivel de datos: **`tenant_id` no está denormalizado en las tablas hijas.** Solo 8 de ~22 entidades tienen la columna; el resto (task, task_material, alert, calendar, baseline, solicitud_cotizacion, purchase_order, obra_team_member, historial, message, conversation_session, settings…) llegan al tenant **a través del padre** (task → obra → tenant_id). Por eso cada verificación de pertenencia exige un JOIN que el código, seguido, **omite** — y ahí nacen los IDOR. Si `tenant_id` estuviera en las hijas (o si el acceso siempre pasara por un helper que hace el join), el aislamiento sería trivial de garantizar.

En integraciones, el panorama es **sano**: las llamadas externas tienen timeout, la mayoría corre en `asyncio.to_thread` (no bloquean el event loop) y hay idempotencia en el webhook. Falta reintento con backoff ante fallas transitorias, y hay una dependencia fuerte de **n8n** como orquestador externo (reminders, overdue, no-response) que conviene tener en cuenta para la operación.

---

## 1. Modelo de datos — consistencia multi-tenant

### Estado actual

| Con `tenant_id` (8) | Sin `tenant_id` (van por el padre) (14) |
|---|---|
| user, tenant, obra, responsible, supplier, budget, plano, ai_mapping_cache | task, task_material, alert, calendar, baseline, solicitud_cotizacion, purchase_order, obra_team_member, historial, message, conversation_session, settings, plan*, bitacora |

*`plan` sin tenant es correcto (los planes son globales).

### Gaps detectados y cómo resolverlos

---

#### Gap 1 — `tenant_id` no denormalizado → causa raíz de los IDOR

**Impacto:** Alto — es el origen del problema de seguridad transversal

Para saber si una tarea es del tenant del usuario, hay que hacer `task → obra → obra.tenant_id`. El código a menudo salta ese join (usa `CurrentUserId` y un "assert" que solo chequea existencia). El resultado son los ~15 IDOR encontrados. No es que falte el chequeo en un lugar: **falta la infraestructura de datos que lo haría natural.**

**Solución profesional — dos caminos (elegir uno):**

**A) Helper de acceso único (menos cambios de esquema):**
```python
# Un único helper que SIEMPRE hace el join y se usa en TODOS los endpoints por obra/tarea:
async def assert_obra_access(db, obra_id: int, user: User) -> Obra:
    obra = await db.get(Obra, obra_id)
    if not obra or (obra.tenant_id is not None and obra.tenant_id != user.tenant_id):
        raise NotFoundError("Obra", obra_id)   # 404 cross-tenant
    return obra
# Y para entidades hijas: resolver el obra_id y pasar por el mismo helper.
```

**B) Denormalizar `tenant_id` en las hijas de mayor tráfico (más robusto):**
Agregar `tenant_id` a `task` (y opcionalmente material/alert/calendar), copiado de la obra al crear, con índice. El chequeo pasa a ser `WHERE tenant_id = :t` sin join, y una policy a nivel de query (o RLS de Postgres) lo hace imposible de olvidar.

**Recomendación:** A ahora (rápido, tapa las fugas), B como hardening definitivo si se va a escalar mucho. Idealmente, además, **Row-Level Security (RLS) de PostgreSQL** con `tenant_id` como política — el aislamiento deja de depender de que el dev se acuerde.

**Esfuerzo estimado:** A: 1 día (helper + aplicarlo en ~15 endpoints + tests) · B: +1-2 días (migración + backfill + índices)

---

#### Gap 2 — `tenant_id` es `nullable` en varias tablas

**Impacto:** Medio

En `responsible`, `budget`, `supplier`, etc., `tenant_id` es `nullable=True` (legado de datos previos al multi-tenant). Filas con `tenant_id=NULL` **se saltean** el chequeo `tenant_id != user.tenant_id` (la comparación con NULL es falsa) → podrían quedar visibles para todos.

**Solución profesional:** backfillear los NULL al tenant correcto, y luego hacer la columna `NOT NULL`. Mientras tanto, tratar `tenant_id IS NULL` explícitamente en los filtros.

**Esfuerzo estimado:** 2-3h (migración + backfill)

---

## 2. Integridad referencial

### Qué funciona

| Aspecto | Estado |
|---------|--------|
| FKs con `ondelete` explícito en todas las relaciones a `obras` | ✅ |
| Cascada correcta a hijas duras (tareas, equipo, baseline, calendario, planos, órdenes, cotizaciones) | ✅ |
| `SET NULL` en historial (preserva auditoría tras borrar) | ✅ (intencional) |

### Gaps detectados

- **Gap 1 (Bajo-Medio):** `SET NULL` en `alert` y `budget` deja **huérfanos** al borrar la obra (ya notado en el audit del núcleo). Decidir cascade vs filtrado de huérfanos.
- **Gap 2 (Bajo):** verificar `ondelete` en las FKs a `tasks` (task_material, message, historial, alert) — al cascadear una obra→tareas, las hijas de tarea deben cascadear también (si son RESTRICT, el borrado de obra fallaría por la nieta). Dado que el borrado funciona, probablemente ya cascadean, pero conviene confirmarlo en una migración de revisión.

**Esfuerzo estimado:** 1-2h (revisión de FKs de segundo nivel)

---

## 3. Índices y escala

### Qué funciona

| Aspecto | Estado |
|---------|--------|
| `index=True` en las FKs principales (`obra_id`, `task_id`, `tenant_id`, `responsible_id`) | ✅ |
| `whatsapp_number` indexado (lookup del chatbot) | ✅ |

### Gaps detectados

- **Gap 1 (Bajo):** para queries de listado a escala, revisar índices **compuestos** en los patrones reales: `(obra_id, order_index)` para tareas, `(tenant_id, created_at)` para obras/alertas, `(status)` para filtros. Muchos filtros individuales ya tienen índice; faltan los compuestos de los ORDER BY frecuentes.
- **Gap 2 (Bajo):** sin estrategia de retención/particionado para `historial` y `message` (crecen sin techo en obras activas).

**Esfuerzo estimado:** 2-3h (índices compuestos según los queries más usados)

---

## 4. Convenciones y tipos

### Qué funciona

- SQLAlchemy 2.0 async con `Mapped[]` typing en todos los modelos.
- `created_at`/`updated_at` con `timezone=True` de forma consistente.
- 39 migraciones Alembic secuenciales (ya destacado en el audit transversal).
- Soft-delete (`is_active`) en responsables y usuarios; **falta** en obras (hard delete — ver audit del núcleo).

Sin gaps relevantes acá — la disciplina de modelado es buena.

---

## 5. Integraciones externas — patrón de llamada

### Qué funciona

| Integración | Patrón | Estado |
|---|---|---|
| OpenAI (transcripción) | `requests.post` en `asyncio.to_thread`, `timeout=120`, `raise_for_status` | ✅ no bloquea |
| Twilio / WhatsApp (media) | `requests.get` en `to_thread`, `timeout=60` | ✅ no bloquea |
| Anthropic (bitácora/presupuestos) | llamada con manejo de error → estado `error` | ✅ degrada |
| Brevo (email) | `requests.post`, `timeout=10` | ⚠️ verificar `to_thread` |

### Gaps detectados y cómo resolverlos

---

#### Gap 1 — Sin reintento/backoff ante fallas transitorias

**Impacto:** Medio

Las llamadas externas (transcripción, WhatsApp, email, IA) usan `raise_for_status`: un 429/503 transitorio del proveedor **falla de una** (deja la entrada en `error` o pierde el email). No hay reintento con backoff exponencial.

**Solución profesional:** un wrapper de reintento (p. ej. `tenacity`) para 429/5xx con backoff y tope de intentos, en las 3-4 llamadas externas. Combinar con el job de reproceso de bitácora (audit de comunicación).

**Esfuerzo estimado:** 2-3h

---

#### Gap 2 — Verificar que el envío de email no bloquee el event loop

**Impacto:** Medio (a confirmar)

`email_service` usa `requests.post(..., timeout=10)`. Si se llama desde un contexto async **sin** `asyncio.to_thread` (como sí hacen transcripción y WhatsApp), bloquea el event loop hasta 10s por email — degrada la concurrencia de todo el backend.

**Solución profesional:** envolver la llamada de Brevo en `asyncio.to_thread` (o migrar a `httpx.AsyncClient`), igual que las otras integraciones.

**Esfuerzo estimado:** 30 min

---

#### Gap 3 — Manejo de secretos de integración (cross-ref)

Ya cubierto en el audit transversal (Gap de config): las keys de Twilio/Brevo/OpenAI/Anthropic tienen default `""` y no se validan en startup. En producción, un secreto vacío falla en silencio.

---

## 6. n8n como orquestador externo

### Qué funciona

| Aspecto | Estado |
|---------|--------|
| Endpoints internos para n8n, gated por `InternalAuth` (API key) | ✅ |
| Flujos delegados: `mark-overdue`, `send-reminders`, `check-no-response`, `responsibles/lookup`, `tasks/due-soon`, `tasks/{id}/status` | ✅ |
| Separación limpia entre la API de usuario (JWT) y la interna (API key) | ✅ |

### Gaps detectados y cómo resolverlos

---

#### Gap 1 — Dependencia crítica de n8n sin visibilidad

**Impacto:** Medio

Flujos importantes (recordatorios, detección de vencidas, no-respuesta) dependen de que **n8n** llame a estos endpoints. Si n8n se cae o se desconfigura, esas alertas/recordatorios **dejan de ocurrir en silencio** — y no hay un heartbeat/monitoreo que lo detecte. Además, hay solapamiento parcial con **APScheduler** (que también corre jobs), sin una división documentada de quién hace qué.

**Solución profesional:** documentar claramente qué dispara APScheduler vs n8n; agregar un heartbeat (última vez que n8n llamó) y una alerta interna si pasa >X horas sin actividad esperada. A mediano plazo, evaluar consolidar los jobs en el scheduler propio (con lock de Redis, ver audit transversal) para no depender de un orquestador externo en flujos críticos.

**Esfuerzo estimado:** 2-3h (heartbeat + doc) / 1 día (consolidar en scheduler)

---

#### Gap 2 — `InternalAuth` pasa si la key está vacía (cross-ref)

**Impacto:** Medio — seguridad

Ya notado en los audits de auth y transversal: si `INTERNAL_API_KEY=""`, la dependency no debería aceptar requests. Como estos endpoints disparan efectos (crear alertas, mandar recordatorios), es importante que la puerta interna no quede abierta.

**Esfuerzo estimado:** 30 min

---

## 7. IA (OpenAI / Anthropic) — como sistema

### Qué funciona

| Aspecto | Estado |
|---------|--------|
| Degradado con gracia sin keys (bitácora y presupuestos) | ✅ |
| **Caché de mapeos de IA** (`ai_mapping_cache`, con `tenant_id`) — evita recomputar matcheos | ✅ |
| Transcripción y análisis en `to_thread` (no bloquean) | ✅ |

### Gaps detectados

- **Gap 1 (Medio, cross-ref):** sin control de **costo/uso de IA por tenant/plan** (repetido en bitácora y presupuestos). Es a la vez control de gasto y gancho de monetización.
- **Gap 2 (Bajo):** los modelos están hardcodeados (`gpt-4o-mini-transcribe`, `claude-haiku-4-5`); conviene que sean configurables por variable de entorno para poder cambiar/actualizar sin deploy.

**Esfuerzo estimado:** control de uso 3-4h (compartido) · modelos por env 30 min

---

## 8. Resumen: Fortalezas vs Debilidades

### Fortalezas

1. **Modelado limpio** (SQLAlchemy 2.0 typed, timestamps consistentes, 39 migraciones ordenadas).
2. **FKs con `ondelete` explícito** y cascada coherente.
3. **Integraciones no bloqueantes** (`to_thread`) con timeouts en todas.
4. **Webhook idempotente** + **caché de IA** con tenant.
5. **Separación API usuario (JWT) vs interna (API key)**.

### Debilidades (ordenadas por impacto)

| # | Debilidad | Categoría |
|---|-----------|-----------|
| 1 | `tenant_id` no denormalizado → causa raíz de los ~15 IDOR | Arquitectura de datos |
| 2 | `tenant_id` nullable → filas que saltean el chequeo | Datos / Seguridad |
| 3 | Sin reintento/backoff en llamadas externas | Confiabilidad |
| 4 | Email posiblemente bloqueante (verificar `to_thread`) | Performance |
| 5 | Dependencia de n8n sin heartbeat ni monitoreo | Operación |
| 6 | Huérfanos por `SET NULL` (alert/budget) | Datos |
| 7 | Sin control de costo/uso de IA | Costo / Monetización |
| 8 | Faltan índices compuestos para ORDER BY frecuentes | Escala |

---

## 9. Prioridad de correcciones

### P0 — Base del hardening

| Tarea | Qué cambiar | Esfuerzo |
|-------|-------------|---------|
| Helper único de acceso por tenant (join obligatorio) | `services/*`, `deps.py` | 1 día |
| `InternalAuth` falla si la key está vacía | `core/deps.py` | 30 min |
| Backfill + `NOT NULL` de `tenant_id` en tablas legadas | migración | 2-3h |

### P1 — Confiabilidad

| Tarea | Qué cambiar | Esfuerzo |
|-------|-------------|---------|
| Reintento/backoff en llamadas externas (`tenacity`) | `bitacora_service`, `email_service`, `message_service` | 2-3h |
| Email en `to_thread` / `httpx.AsyncClient` | `email_service.py` | 30 min |
| Heartbeat/monitoreo de n8n + doc de división con APScheduler | `notifications`/`scheduler`, docs | 2-3h |
| Cascada/limpieza de huérfanos (alert/budget) | migración | 1-2h |

### P2 — Escala y hardening definitivo

| Tarea | Qué cambiar | Esfuerzo |
|-------|-------------|---------|
| Denormalizar `tenant_id` en `task` (+ hijas) con índice | migración + creación de tareas | 1-2 días |
| Row-Level Security (RLS) de Postgres por `tenant_id` | migración + policies | 2-3 días |
| Índices compuestos según queries reales | migración | 2-3h |
| Control de uso de IA por tenant/plan | `models/ai_usage.py`, servicios, `plan_limits` | 3-4h |
| Modelos de IA por variable de entorno | `config.py`, servicios | 30 min |

---

## 10. Cierre — auditoría del sistema, completa de punta a punta

Con este documento, la auditoría cubre **todo el sistema en 7 documentos**:

1. `auth-planes` — autenticación, planes, monetización, seguridad de acceso.
2. `obras-tareas-cronograma` — núcleo operativo.
3. `comunicacion-campo` — WhatsApp, alertas, tiempo real, bitácora.
4. `compras-documentos` — procurement y documentos.
5. `transversal-infra` — testing, CI/CD, observabilidad, deployment.
6. `complementos` — responsables, settings, calendario, exports, baseline, SSE, dashboard.
7. `frontend` — arquitectura, estado, UX, a11y, performance.
8. `datos-integraciones` (este) — esquema, integridad, integraciones externas.

**El diagnóstico converge en una sola conclusión.** El producto es funcionalmente muy avanzado y algorítmicamente sólido. Toda la deuda de seguridad tiene **una raíz única y estructural**: `tenant_id` no está en las tablas hijas, así que el aislamiento depende de que cada endpoint recuerde hacer el join — y muchos no lo hacen. **Se arregla de raíz** con un helper de acceso obligatorio (rápido) y, definitivamente, con `tenant_id` denormalizado + RLS de Postgres. Acompañado de su set de tests de tenant, blinda las ~15 fugas de una.

El resto de la deuda es de **producción** (CI/CD, Docker, observabilidad, Redis, archivos con auth, routing por URL) y de **negocio** (billing, trial, landing). Ninguna es una feature faltante: el producto ya hace lo que promete. Lo que falta es convertirlo de "demo muy avanzada y correcta" en "SaaS multi-empresa desplegable, seguro y vendible".
