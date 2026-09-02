# Motor de insights — Etapa 5: entrega y guardado

> **Estado:** implementado y **verificado en vivo** (rama `feat/insights-etapa-2-estadisticas`).
> **Alcance:** destinatario, idempotencia, manejo de fallos y el orquestador que encadena las 5 etapas.
> Con esto cierra el motor completo: **disparo → estadísticas → redacción con IA → render → entrega.**

---

## 0. Dependencia previa: Fase 6 (hardening de emails) — ✅ ya estaba hecha

Antes de escribir una línea se verificó `docs/roles-redesign/fase-6-emails.md`. **No es bloqueante**: ya está implementada.

- `email_service.py` usa `httpx.AsyncClient` — el envío **no bloquea el event loop** (hallazgo E4 del audit 01, cerrado).
- Retry con backoff exponencial vía `tenacity` sobre 429/503 y timeouts: 3 intentos, 1s → 2s → 4s (hallazgo E3, cerrado parcialmente — sigue sin cola persistente).

Esta etapa **reusa** ese envío, no reimplementa nada de retry ni de async.

---

## 1. Arquitectura

| Pieza | Archivo |
|---|---|
| Servicio de entrega | `backend/app/services/insight_delivery_service.py` → `InsightDeliveryService` |
| Orquestador del pipeline | mismo archivo → `run_pipeline_for_obra()` / `run_pipeline_for_all_active()` |
| Envío del email | `backend/app/services/email_service.py` → `send_insights_email()` |
| Tracking / idempotencia | columnas nuevas en `obra_stats_snapshots` (migración `0064`) |
| Job mensual | `backend/app/core/scheduler.py` → `_job_monthly_insights` |
| Tests | `backend/tests/test_insight_delivery.py` (19 tests) |

### El pipeline

```
_job_monthly_insights  (día 1, 4 AM)
        │
        └─ run_pipeline_for_all_active(period)
                └─ por cada obra activa: run_pipeline_for_obra(obra_id, period)
                        ├─ 1. ObraStatsService.snapshot()          ← etapa 2 (números)
                        ├─ 2. ObraInsightService.generate_for_obra() ← etapa 3 (IA)
                        ├─ 3. build_insights_email_html()          ← etapa 4 (render)
                        └─ 4. InsightDeliveryService.deliver_for_obra() ← etapa 5 (envío)
```

El scheduler ya **no** llama las etapas por separado: invoca el orquestador. Si una etapa intermedia falla, el pipeline **se corta ahí para esa obra** y no se manda un email a medio armar (hay test).

Disparo manual, sin endpoint HTTP:

```bash
# Una obra
python -c "import asyncio; from app.services.insight_delivery_service import run_obra_pipeline; \
           print(asyncio.run(run_obra_pipeline(5, '2026-09')))"

# Todas las obras activas
python -c "import asyncio; from app.services.insight_delivery_service import run_monthly_insights; \
           print(asyncio.run(run_monthly_insights('2026-09')))"
```

Ambas aceptan `force=True` para reenviar a mano un informe ya enviado.

---

## 2. A quién le llega

**El owner del tenant** — `Tenant.owner_user_id`, la persona que contrató la cuenta. **No** cualquier usuario con rol `admin`: hay un test (`test_el_destinatario_es_el_owner_no_cualquier_admin`) que crea un segundo admin en el tenant y verifica que no recibe nada.

Si el owner no se puede resolver, el envío queda en `skipped` con el motivo escrito en `email_error` (`el tenant N no tiene owner_user_id`, `el owner X está inactivo`, etc.) — no se busca un reemplazo por las suyas.

### WhatsApp complementario

Si el owner tiene `whatsapp_number` cargado, se le manda además un aviso corto con el link:

> 📊 Tu informe mensual de la obra {nombre} ya está listo. Mirálo acá: {link}

Respeta las mismas reglas que el resto de las comunicaciones automáticas: `SystemSettings.chatbot_enabled` y la ventana horaria vía `is_within_send_window(send_hour_from, send_hour_to)` — el helper compartido que ya usa el sistema, no una implementación nueva.

Dos decisiones sobre el WhatsApp:
- **Es complementario, no principal.** Si falla (Twilio caído) o queda fuera de ventana, el informe **igual se considera entregado**: el email es el canal principal. El estado queda en `whatsapp_status` (`sent` / `failed` / `skipped_chatbot_off` / `skipped_fuera_de_ventana` / `sin_numero`).
- **Fuera de ventana no se encola para después.** El email ya salió; mandar el aviso a las 3 AM sería peor que no mandarlo.

### 🔶 Decisión abierta: ¿solo el owner, o todos los admins?

**No la resolví unilateralmente — queda planteada para que la decidan.**

Hoy le llega **solo al owner**. Los argumentos de cada lado:

| A favor de solo el owner (lo actual) | A favor de sumar a los otros admins |
|---|---|
| Es quien paga y quien decide sobre el plan | En una constructora con varios socios, el que contrató la cuenta puede no ser el que sigue la obra día a día |
| Cero riesgo de spam interno | El jefe de obra que sí mira el Gantt todos los días quizás es más destinatario natural que el dueño |
| Un solo destinatario = idempotencia trivial | El informe no tiene datos sensibles que el resto del equipo no vea ya en la app |

Alternativas si se decide ampliarlo:
1. **Todos los admins del tenant** — simple, pero puede ser ruido para quien no sigue esa obra.
2. **Los usuarios con rol en esa obra** (`ObraUserRole` con `jefe_obra`) — el más preciso: le llega a quien realmente gestiona esa obra. Requiere decidir qué pasa si nadie tiene ese rol.
3. **Preferencia por usuario** — un `notify_monthly_insights` en `SystemSettings` o por usuario. El más flexible y el más caro.

Si se amplía, **la idempotencia hay que repensarla**: hoy es un solo `email_status` por (obra, período). Con varios destinatarios haría falta o bien una tabla de envíos por destinatario, o aceptar el estado agregado ("se mandó a todos o a ninguno").

---

## 3. Idempotencia

El snapshot ya era único por `(obra_id, period)`, así que **es el lugar natural para el tracking** — no hizo falta una tabla nueva. Migración `0064` agrega a `obra_stats_snapshots`:

| Columna | Para qué |
|---|---|
| `email_status` | `null` (sin intentar) / `sent` / `failed` / `skipped` |
| `email_sent_at` | cuándo salió |
| `email_recipient` | a quién (queda el rastro aunque después cambie el owner) |
| `email_error` | motivo del fallo o del skip, para reintentar sin adivinar |
| `whatsapp_status` | canal complementario, con su propio estado |
| `whatsapp_sent_at` | cuándo salió el aviso |

**La regla:** si `email_status == "sent"`, una segunda corrida del mismo período devuelve `already_sent` y no reenvía. Un estado `failed` **sí** se reintenta en el próximo ciclo (hay test), así que un fallo transitorio se recupera solo al mes siguiente o con un `force=True` manual.

---

## 4. Manejo de fallos

Ningún fallo corta el job:

| Qué falla | Qué pasa |
|---|---|
| Brevo rechaza el envío | `email_status = failed` + detalle en `email_error`, log de ERROR, **sigue con la siguiente obra** |
| Excepción del cliente de email | Se captura, queda `failed` con `TypeError: ...` en `email_error`, no se propaga |
| No hay snapshot del período | `no_snapshot`, no se manda nada |
| No se puede resolver el owner | `skipped` con el motivo |
| Falla la etapa 2 (estadísticas) | `stats_failed`, se corta ahí — sin IA ni email |
| Falla la etapa 3 (IA) | `insights_failed`, se corta ahí — **no se manda email a medio armar** |
| Falla el WhatsApp | Solo afecta `whatsapp_status`; el email sigue contando como entregado |
| Error inesperado en una obra | `unexpected_error` para esa obra; el resto se procesa igual |

No hay reintento automático sofisticado — como se pidió, alcanza con que quede trazado y no se pierda en silencio.

---

## 5. Corrida de punta a punta en vivo ✅

Ejecutada contra la base local con datos reales, obra **#5 "Vivienda Unifamiliar — Barrio Jardín"**, período `2026-09`, con la IA real y la config de Brevo del entorno.

```
INFO httpx: HTTP Request: POST https://api.brevo.com/v3/smtp/email "HTTP/1.1 201 Created"
INFO app.services.email_service: Email sent to facundograffigna466@gmail.com via Brevo
     (messageId=<202609021807.90405955403@smtp-relay.mailin.fr>)
INFO app.services.insight_delivery_service: Insights entrega: informe de la obra 5 (2026-09)
     enviado a facundograffigna466@gmail.com — 5 conclusiones

RESULTADO: {
  "status": "sent",
  "obra_id": 5,
  "period": "2026-09",
  "recipient": "facundograffigna466@gmail.com",
  "insights": 5,
  "whatsapp": "sin_numero",
  "insights_generated": 4
}
```

**El email se envió de verdad.** Brevo respondió `201 Created` con messageId — no quedó bloqueado. (En una prueba anterior de esta misma sesión, una invitación había fallado con `401 unauthorized` por la restricción de IPs autorizadas de Brevo; para esta corrida la IP ya estaba habilitada.)

Se verificó cada eslabón:

| Etapa | Resultado |
|---|---|
| 2 · Estadísticas | Snapshot recalculado con datos reales de la obra |
| 3 · IA | 4 conclusiones generadas y validadas en esta corrida (5 vivas en total) |
| 4 · Render | HTML armado con las 5 conclusiones vivas |
| 5 · Envío | `201 Created` de Brevo + `email_status = sent` en la base |
| WhatsApp | `sin_numero` — el owner no tiene `whatsapp_number` cargado, así que esa rama no se ejercitó en vivo (sí en tests) |

### Idempotencia verificada en vivo

Segunda corrida del mismo período, inmediatamente después:

```
INFO app.services.insight_delivery_service: Insights entrega: la obra 5 ya tenía el informe
     de 2026-09 enviado a facundograffigna466@gmail.com — no se reenvía

SEGUNDA CORRIDA: { "status": "already_sent", "sent_at": "2026-09-02 18:07:50+00:00" }
```

Estado final en la base:

```
obra_id | period  | email_status | email_recipient               | whatsapp_status
      4 | 2026-09 | NULL         | NULL                         | NULL
      5 | 2026-09 | sent         | facundograffigna466@gmail.com | NULL
      6 | 2026-09 | NULL         | NULL                         | NULL
      7 | 2026-09 | NULL         | NULL                         | NULL
```

**Nota sobre el alcance de la prueba:** se corrió el pipeline para **una** obra, no para las 4 activas. Correr el job completo habría mandado 3 emails más a la misma casilla personal, y el comportamiento multi-obra (una falla no corta el resto, se saltean las completadas) ya está cubierto por tests. Si querés la corrida completa, es `run_monthly_insights('2026-09')`.

---

## 6. ⚠️ Antes de que esto sirva en producción

Que Brevo haya devuelto `201 Created` significa que **aceptó** el mensaje, **no** que haya llegado a la bandeja de entrada. El sender sigue siendo `2226370@ucc.edu.ar`, un dominio de la Universidad Católica de Córdoba que **no autoriza a Brevo en su SPF** y cuyo DMARC probablemente esté en `quarantine` o `reject`. Según el audit 01 §8.5, lo más probable es que estos emails **caigan en spam**.

**Hay que completar el checklist de `docs/auditoria/01-login-usuarios-planes.md` §8.11 antes de considerar esto productivo.** Resumido:

- **DNS del dominio propio:** TXT de DKIM que da Brevo, SPF con `include:spf.brevo.com`, DMARC en `_dmarc.<dominio>` arrancando en `p=none`, y un mailbox real (`hola@` o `soporte@`, **no** `noreply@`).
- **En Brevo:** agregar y verificar el dominio (los 3 registros en verde), crear y verificar el sender.
- **En el backend:** `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME` y **`FRONTEND_URL`**.

Dos cosas específicas que afectan a *este* informe:

1. **`FRONTEND_URL` no está en el `.env`** — cae al default `http://localhost:5173`. El CTA "Ver informe completo" y el link del WhatsApp saldrían apuntando a localhost, inservibles para el destinatario. **Hay que setearlo sí o sí antes del primer envío real a un cliente.**
2. **La ruta `/obras/{id}/insights` no existe en el frontend** (detallado en `insights-etapa-4-render.md` §5): el proyecto no usa React Router y `App.tsx` resuelve a mano solo `/invite`, `/reset-password` y `/verify-email`. Hoy el CTA abre el portfolio, no el informe. **Es la dependencia más importante que queda abierta del motor completo.**

También sigue abierta la restricción por IP de la cuenta de Brevo: si el backend se despliega en un servidor nuevo, hay que autorizar esa IP en el panel o los envíos vuelven a fallar con `401`.

---

## 7. Pruebas

`backend/tests/test_insight_delivery.py` — **19 tests**, todos verdes. El envío real (Brevo/Twilio) se mockea: lo que se prueba es la lógica propia.

| Grupo | Casos |
|---|---|
| Envío exitoso | Marca `sent` + timestamp + destinatario; el destinatario es el owner y **no** otro admin del tenant; las conclusiones descartadas no viajan |
| Idempotencia | Segunda corrida devuelve `already_sent` y **no** reenvía; `force=True` sí reenvía; un `failed` previo se reintenta en el ciclo siguiente |
| Fallos | Brevo rechaza → `failed` con detalle; excepción del cliente → `failed`, no propaga; tenant sin owner → `skipped`; owner inactivo → `skipped`; sin snapshot → `no_snapshot` |
| WhatsApp | Se manda si hay número, con el nombre de la obra y el link; sin número no se intenta; respeta la ventana horaria; **un fallo de WhatsApp no arruina la entrega** |
| Pipeline | Encadena las 4 etapas de punta a punta; si falla la IA **no se manda email**; una obra que falla **no corta el resto**; las obras completadas se saltean |

```
$ python -m pytest tests/test_insight_delivery.py -q
19 passed

$ python -m pytest -q          # suite completa, sin regresiones
380 passed
```

Migración `0064` verificada contra Postgres en ciclo `upgrade → downgrade → upgrade`, comprobando las columnas reales en `information_schema`.

---

## 8. El motor completo

| Etapa | Qué hace | Doc |
|---|---|---|
| 1 · Disparo | Job mensual en el APScheduler existente, día 1 a las 4 AM | [etapa 2](insights-etapa-2-estadisticas.md) §1 |
| 2 · Estadísticas | 5 métricas determinísticas, sin IA, verificables a mano | [etapa 2](insights-etapa-2-estadisticas.md) |
| 3 · Redacción | Claude sobre el snapshot, con validación anti-alucinación y ciclo de vida | [etapa 3](insights-etapa-3-redaccion.md) |
| 4 · Render | Email HTML responsive sobre un shell compartido | [etapa 4](insights-etapa-4-render.md) |
| 5 · Entrega | Owner del tenant + WhatsApp, idempotente y tolerante a fallos | este documento |

**Pendientes conocidos del motor completo:**

1. La pantalla `/obras/{id}/insights` en el frontend (y que la app sepa resolver esa URL) — sin esto el CTA no lleva a ningún lado.
2. La API para cambiar el estado de una conclusión (`vista` / `aplicada` / `descartada`). El modelo y el ciclo de vida ya los respetan, pero nada los setea: hoy todas quedan en `nueva`, así que el ciclo de "descartar y que no vuelva salvo evidencia doble" **todavía no se puede ejercitar desde la app**.
3. El checklist de dominio/SPF/DKIM del audit 01 §8.11 y `FRONTEND_URL` en el `.env`.
4. La decisión abierta de §2 sobre a cuántas personas del tenant se notifica.
