# Análisis: WhatsApp/Chatbot · Alertas · Bitácora · Tiempo real (Comunicación de campo)

> Módulo auditado: el diferenciador del producto — conectar el campo con el plan. Chatbot de WhatsApp, alertas, tiempo real (Socket.IO), presencia/edición colaborativa y bitácora de obra por voz con IA.
> Fecha: 2026-07-02 | Rama: `main`

---

## TL;DR

Este cluster está, en general, **mejor resuelto que el núcleo operativo** en cuanto a robustez: el webhook de Twilio valida firma HMAC, es idempotente por `MessageSid` y nunca propaga errores (no dispara reintentos); el socket **autentica con JWT** en el `connect`; la bitácora **degrada con gracia** sin API keys y aísla por tenant; el chatbot es una máquina de estados de verdad, con paginación, navegación y ordenamiento por urgencia.

El problema crítico está en el **tiempo real**: en el `connect`, el usuario se une a las salas de **todas las obras de la base** (`list_all()` sin filtro de tenant), así que recibe eventos en vivo (tareas, alertas, presencia, bitácora) de **otras empresas**. Es una fuga cross-tenant en tiempo real. Además, el estado de presencia/edición vive **en memoria del proceso**, lo que rompe con más de un worker/instancia. A nivel producto, falta un camino de **notificación offline** para alertas críticas (hoy solo llegan por socket + badge in-app), lo cual es irónico en una app cuyo lema es "que no se pierda nada".

---

## 1. Chatbot de WhatsApp

### Qué funciona

| Aspecto | Estado |
|---------|--------|
| Máquina de estados real (`ConversationSession` con `step`, `selected_task_id`, `task_options`, `expires_at`) | ✅ |
| Flujo completo: elegir obra → elegir tarea → menú de estado → pedir fecha | ✅ |
| Paginación de tareas (más/anterior), navegación (MENU/INICIO/HOLA reinician) | ✅ |
| Cancelar / volver | ✅ |
| Ordenamiento por urgencia y etiquetas ("necesita atención") | ✅ |
| Parseo de opciones numéricas y de fechas en lenguaje natural | ✅ |
| Aplicar transiciones desde WhatsApp (en curso / finalizada / demorada) respetando `VALID_TRANSITIONS` | ✅ |
| Sesión con expiración (`expires_at`) | ✅ |

### Gaps detectados y cómo resolverlos

---

#### Gap 1 — Sin rate limiting por número

**Impacto:** Bajo-Medio

La firma HMAC de Twilio garantiza que el mensaje viene de Twilio, pero no limita a un **responsable real** que mande decenas de mensajes (por error o abuso). Cada inbound dispara queries + posible llamada a IA (si trae audio). No hay throttle por `From`.

**Solución profesional:** un rate limit por número de teléfono (p. ej. 20 mensajes / 5 min por `From`), con un mensaje "Estás yendo muy rápido, esperá un momento". Se puede hacer con un contador en Redis o una tabla ligera con ventana deslizante.

**Esfuerzo estimado:** 2-3h

---

#### Gap 2 — Sesiones vencidas no se limpian

**Impacto:** Bajo

`ConversationSession` tiene `expires_at`, pero conviene verificar que hay un job que borra/expira las sesiones viejas; si no, la tabla crece. El backend ya tiene APScheduler.

**Solución profesional:** job diario `DELETE FROM conversation_sessions WHERE expires_at < now()`.

**Esfuerzo estimado:** 30 min

---

## 2. Integración de mensajería (webhook Twilio)

### Qué funciona

| Aspecto | Estado |
|---------|--------|
| Verificación de **firma HMAC-SHA1** de Twilio (`verify_twilio_signature`) | ✅ |
| **Idempotencia** por `MessageSid` (`get_by_external_id` → skip duplicados) | ✅ |
| Siempre responde **200 con TwiML vacío**; la respuesta real va por REST | ✅ |
| Errores se loguean y **no propagan** (no dispara reintentos de Twilio) | ✅ |
| Guarda `external_message_id=MessageSid` para trazabilidad | ✅ |

### Gaps detectados y cómo resolverlos

---

#### Gap 1 — Un solo proveedor (Twilio), sin Evolution ni WhatsApp Cloud API

**Impacto:** Bajo-Medio — lock-in

El CLAUDE.md menciona "Twilio / Evolution API", pero en el código **solo existe Twilio** (`integrations/twilio/`). No hay abstracción de proveedor: la lógica de envío/recepción está acoplada a Twilio. Twilio para WhatsApp es caro a escala; la **WhatsApp Cloud API** (Meta) o **Evolution** son alternativas frecuentes en LATAM.

**Solución profesional:** una interfaz `MessagingProvider` (send_text, send_template, parse_inbound, verify_signature) con implementación `TwilioProvider`, para poder sumar `EvolutionProvider` / `MetaCloudProvider` sin tocar el resto. Es refactor, no urgente, pero evita el lock-in.

**Esfuerzo estimado:** 1-2 días (abstracción) — solo si se planea cambiar/agregar proveedor

---

## 3. Alertas

### Qué funciona

| Aspecto | Estado |
|---------|--------|
| Evaluación de riesgos por obra (`evaluate_task_risks_for_obra`) | ✅ |
| **Deduplicación** por (campos clave + mensaje) contra alertas **no leídas** | ✅ |
| Tipos de alerta (delay_risk, task_blocked, task_overdue, no_response, order_received) | ✅ |
| Listado y "marcar todas leídas" **scopeados por tenant** (`tenant_id=current_user.tenant_id`) | ✅ |
| Emisión en tiempo real a la sala de la obra (badge + toast en el front) | ✅ |

### Gaps detectados y cómo resolverlos

---

#### Gap 1 — Sin notificación offline para alertas críticas

**Impacto:** Medio — contradice la propuesta de valor

Las alertas llegan **solo** por socket (toast en vivo) + badge in-app. Si el jefe no tiene la app abierta, se entera recién al abrirla. Para una app cuyo lema es "que no se pierda nada", una tarea bloqueada o vencida debería alcanzar al jefe aunque esté offline. Ya existen los dos canales para hacerlo: **WhatsApp** (el bot) y **email** (Brevo).

**Solución profesional — fallback por criticidad:**
```
Alerta creada (task_blocked / task_overdue)
  → si el jefe está online (socket) → toast (como hoy)
  → si NO está online (o pasaron N min sin leerla) → WhatsApp/email al jefe
```
Se implementa con un job corto que revisa alertas críticas no leídas de hace >N minutos y las despacha por WhatsApp/email, marcando `notified_offline=True` para no duplicar.

**Esfuerzo estimado:** 3-4h

---

#### Gap 2 — `PATCH /alerts/{id}/read` no valida tenant

**Impacto:** Bajo — seguridad

El "marcar una alerta leída" usa `CurrentUserId` y no chequea que la alerta pertenezca al tenant del usuario. En teoría, un usuario podría marcar leída una alerta de otra empresa (IDOR de bajo impacto, no lee datos, solo cambia un flag).

**Solución profesional:** pasar `CurrentUser` y verificar `alert.obra.tenant_id == user.tenant_id` (o filtrar el update por tenant).

**Esfuerzo estimado:** 30 min

---

#### Gap 3 — Evaluación de alertas acoplada al `GET /tasks`

**Impacto:** Bajo-Medio

(Referencia cruzada con el audit del núcleo operativo, Sección 2, Gap 4.) `evaluate_task_risks_for_obra` corre en cada listado de tareas; debería dispararse por el cambio de fecha/estado y por el scheduler, no por una lectura.

**Esfuerzo estimado:** 1-2h

---

## 4. Tiempo real (Socket.IO) — presencia y edición colaborativa

### Qué funciona

| Aspecto | Estado |
|---------|--------|
| **Autenticación JWT en `connect`** (rechaza sin token, expirado, inválido, usuario inactivo) | ✅ |
| Presencia global (`online_users`) y por obra (`presence_update` con viewers) | ✅ |
| Indicador de **edición colaborativa** (`start_editing_task`/`stop_editing_task` → quién edita qué tarea) | ✅ |
| `ping_timeout` para detectar desconexiones | ✅ |
| Eventos de tarea en tiempo real (created/updated/deleted) + bitácora | ✅ |

### Gaps detectados y cómo resolverlos

---

#### Gap 1 — En el `connect` se une a las salas de TODAS las obras (fuga cross-tenant en tiempo real)

**Impacto:** Alto — seguridad (el gap crítico del cluster)

```python
# socket_manager.py — handler connect
obras = await ObraRepository(db).list_all()      # ← sin tenant_id
for obra in obras:
    await sio.enter_room(sid, f"obra_{obra.id}")
```

`list_all()` sin `tenant_id` devuelve **todas las obras de la base**. El usuario entra a la sala `obra_{id}` de **cada** obra existente, incluidas las de otras empresas → recibe en vivo sus eventos de tareas, alertas, presencia y bitácora. Es la contraparte en tiempo real de las fugas del núcleo operativo.

**Solución profesional:**
```python
obras = await ObraRepository(db).list_all(tenant_id=user.tenant_id)
for obra in obras:
    await sio.enter_room(sid, f"obra_{obra.id}")
```
Y cubrir el caso de obras creadas **después** de conectarse: al crear una obra, hacer que los sockets del tenant entren a la nueva sala (o re-evaluar salas en el próximo evento).

**Esfuerzo estimado:** 1-2h (fix directo) + 1-2h (obras nuevas post-connect)

---

#### Gap 2 — Estado de presencia/edición en memoria del proceso (rompe con múltiples workers)

**Impacto:** Medio — escala

`_sessions`, `_viewers` y `_editing` son diccionarios en memoria del proceso. Con un solo worker funciona; pero al escalar horizontalmente (uvicorn `--workers N`, o varias instancias detrás de un balanceador), cada worker tiene su propio estado: la presencia se ve incompleta, la edición colaborativa no se sincroniza y los `emit` a salas no llegan a los sockets conectados a otro worker.

**Solución profesional:** usar el **adaptador de Redis de Socket.IO** (`socketio.AsyncRedisManager`) como backplane, y mover la presencia a Redis (o mantenerla en memoria pero con el manager compartido para los rooms). Es el patrón estándar para Socket.IO multi-instancia.

**Esfuerzo estimado:** 4-6h (Redis ya requerido para rate limiting / blacklist de tokens del otro audit)

---

#### Gap 3 — Edición colaborativa es "soft lock" (último en guardar gana)

**Impacto:** Bajo-Medio

El indicador muestra quién está editando una tarea, pero no **impide** que dos personas la editen a la vez: gana el último `PATCH`. No hay bloqueo optimista (versión/`updated_at`) ni resolución de conflicto.

**Solución profesional:** concurrencia optimista — el `PATCH` manda el `updated_at` que el cliente tenía; si no coincide con el de la BD, responde `409 Conflict` y el front avisa "otra persona modificó esta tarea". Es lo que hacen Notion/Linear a nivel campo.

**Esfuerzo estimado:** 3-4h

---

## 5. Bitácora de obra por voz (IA)

### Qué funciona

| Aspecto | Estado |
|---------|--------|
| Pipeline audio → transcripción (`gpt-4o-mini-transcribe`) → análisis (`claude-haiku-4-5`) → sugerencias aplicables | ✅ |
| **Degradado con gracia sin keys**: sin `OPENAI_API_KEY` queda `pendiente_transcripcion`; sin `ANTHROPIC_API_KEY`, `pendiente_analisis` | ✅ |
| Máquina de estados completa (`pendiente_transcripcion/analisis/obra`, `procesado`, `error`) con campo `error` | ✅ |
| **Aislamiento por tenant** (`get_scoped`) en cada lectura | ✅ |
| Transcripción en `asyncio.to_thread` (no bloquea el event loop) | ✅ |
| Flujo WhatsApp: si el responsable no dice la obra, queda `pendiente_obra` + recordatorios cada 30 min (job) | ✅ |
| Confirmación de vuelta al reporter (`_notify_reporter`) y aviso en tiempo real al jefe (`emit_bitacora_created`) | ✅ |
| Sugerencias editables antes de aplicar; vínculo nota ↔ tarea | ✅ |

### Gaps detectados y cómo resolverlos

---

#### Gap 1 — Entradas "pendientes" no se reprocesan solas al configurar las keys

**Impacto:** Medio

Si una entrada quedó `pendiente_transcripcion`/`pendiente_analisis` (por falta de key o error transitorio de la API), no hay un job que las reintente automáticamente cuando la key ya está o la API se recupera. Quedan colgadas hasta una acción manual.

**Solución profesional:** job periódico que toma las entradas en estado pendiente/error con `< N` reintentos y reintenta el paso que corresponda (transcribir o analizar), con backoff y tope de intentos.

**Esfuerzo estimado:** 2-3h

---

#### Gap 2 — Costo de IA sin control ni presupuesto

**Impacto:** Bajo-Medio

Cada nota de voz consume transcripción + análisis (dos llamadas a IA). No hay límite por tenant/plan ni métrica de consumo. Un uso intensivo (o abuso) puede disparar costos.

**Solución profesional:** contabilizar llamadas de IA por tenant (tabla `ai_usage`) y atarlo al plan (p. ej. Básico: N notas/mes). Es también un gancho de monetización, no solo control de costo.

**Esfuerzo estimado:** 3-4h

---

#### Gap 3 — Sin validación de tamaño/tipo del audio entrante

**Impacto:** Bajo

Conviene validar el tamaño y el mime del audio antes de mandarlo a transcribir (un archivo enorme o no-audio desperdicia una llamada a la API y puede fallar).

**Esfuerzo estimado:** 1h

---

## 6. Resumen: Fortalezas vs Debilidades

### Fortalezas

1. **Webhook a prueba de balas.** Firma HMAC + idempotencia por `MessageSid` + siempre-200 + errores que no propagan. Mejor manejo de webhook que la media.
2. **Socket autenticado con JWT** y con chequeo de usuario activo en el `connect`.
3. **Bitácora que degrada con gracia** (justo lo que el audit de auth pedía para Brevo) y con aislamiento por tenant real.
4. **Chatbot conversacional serio**, con estados persistidos, paginación, navegación y urgencia.
5. **Alertas con dedup** y listado/marca por tenant.
6. **Presencia y edición colaborativa** funcionando (indicador de quién edita qué).

### Debilidades (ordenadas por impacto)

| # | Debilidad | Categoría |
|---|-----------|-----------|
| 1 | El `connect` une a las salas de TODAS las obras → fuga cross-tenant en tiempo real | Seguridad |
| 2 | Presencia/edición en memoria → se rompe con múltiples workers/instancias | Escala |
| 3 | Sin notificación offline para alertas críticas (solo socket + in-app) | Producto |
| 4 | Bitácora pendiente no se reprocesa sola | Confiabilidad |
| 5 | Edición colaborativa sin bloqueo optimista (último gana) | Datos |
| 6 | Un solo proveedor de mensajería (Twilio), sin abstracción | Lock-in |
| 7 | `PATCH /alerts/{id}/read` sin scope de tenant | Seguridad (bajo) |
| 8 | Sin rate limit por número en el chatbot | Abuso |
| 9 | Costo de IA de la bitácora sin control ni presupuesto | Costo / Monetización |

---

## 7. Prioridad de correcciones

### P0 — Seguridad

| Tarea | Qué cambiar | Esfuerzo |
|-------|-------------|---------|
| Salas de socket solo del tenant en `connect` | `core/socket_manager.py` (`list_all(tenant_id)`) | 1-2h |
| Unir sockets del tenant a obras creadas post-connect | `core/socket_manager.py`, `routes/obras.py` | 1-2h |
| Scope de tenant en `PATCH /alerts/{id}/read` | `routes/alerts.py` | 30 min |

### P1 — Confiabilidad y producto

| Tarea | Qué cambiar | Esfuerzo |
|-------|-------------|---------|
| Notificación offline (WhatsApp/email) de alertas críticas | `alert_service.py`, `scheduler.py`, `message_service.py`/`email_service.py` | 3-4h |
| Reproceso automático de bitácora pendiente | `scheduler.py`, `bitacora_service.py` | 2-3h |
| Sacar evaluación de alertas del `GET /tasks` | `routes/tasks.py`, `alert_service.py` | 1-2h |
| Rate limit por número en el chatbot | `webhooks.py`/`message_service.py` (Redis) | 2-3h |
| Limpieza de sesiones de conversación vencidas | `scheduler.py` | 30 min |

### P2 — Escala y robustez

| Tarea | Qué cambiar | Esfuerzo |
|-------|-------------|---------|
| Adaptador Redis para Socket.IO multi-worker + presencia en Redis | `core/socket_manager.py` | 4-6h |
| Bloqueo optimista en edición de tareas (409 por `updated_at`) | `task_service.py`, front | 3-4h |
| Abstracción `MessagingProvider` (Twilio/Meta/Evolution) | `integrations/` | 1-2 días |
| Control de costo/uso de IA por tenant/plan | nueva tabla `ai_usage`, `bitacora_service.py`, `plan_limits.py` | 3-4h |
| Validación de tamaño/tipo de audio | `bitacora_service.py`, `webhooks.py` | 1h |

---

## 8. Archivos clave por corrección

| Corrección | Backend | Frontend |
|-----------|---------|----------|
| Salas socket por tenant | `core/socket_manager.py` (`connect`) | — |
| Alertas offline | `services/alert_service.py`, `core/scheduler.py`, `services/message_service.py` | — |
| Reproceso bitácora | `core/scheduler.py`, `services/bitacora_service.py` | — |
| Alerta mark-read por tenant | `api/routes/alerts.py` | — |
| Rate limit chatbot | `api/routes/webhooks.py`, `services/message_service.py` | — |
| Redis para Socket.IO | `core/socket_manager.py` | — |
| Bloqueo optimista | `services/task_service.py`, `api/routes/tasks.py` | `TaskSheetView.tsx`, `TaskFormModal.tsx` |
| Abstracción de proveedor | `integrations/` (nueva interfaz + `TwilioProvider`) | — |
| Uso de IA por plan | nueva `models/ai_usage.py`, `services/bitacora_service.py`, `core/plan_limits.py` | `AdminPage.tsx` (métrica) |
