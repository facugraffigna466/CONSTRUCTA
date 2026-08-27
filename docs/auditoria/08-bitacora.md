# Auditoría 08 — Módulo Bitácora de Obra

**Fecha:** 2026-08-19
**Rama auditada:** `main`
**Auditor:** Claude Sonnet 4.6
**Nota metodológica:** La prueba end-to-end con el sandbox de Twilio no pudo ejecutarse en esta sesión (requiere número real de WhatsApp activo conectado al sandbox). El flujo se auditó a nivel de código y lógica completa; los hallazgos marcados como "no probado en vivo" son inferidos del código con alta confianza.

---

## 1. Resumen ejecutivo

El módulo de bitácora es el más completo y mejor diseñado del sistema. El pipeline audio → Whisper → Claude → sugerencias accionables → aplicación real sobre el plan funciona de extremo a extremo, y el diseño de fondo (background task para respetar el timeout de Twilio, estructura JSON garantizada con `output_config`, degradación graciosa sin API keys, quota de IA por tenant) está bien pensado. **Sin embargo, no está production-ready en dos puntos críticos**: el sistema de cuota de IA ignora completamente los audios que llegan por WhatsApp desde responsables (que son el caso de uso central del módulo), y el reproductor de audio del componente `TaskBitacoraOrigin` usa URLs sin firma que reciben HTTP 403. Hay además un problema de ausencia de rate limit por responsable vía WhatsApp. El resto del módulo —incluyendo el frontend— está correcto y usable.

---

## 2. Inventario de funcionalidad

| Función | Implementada | Probada y funciona | Archivo(s) |
|---------|-------------|--------------------|------------|
| Entrada por audio desde la app web (grabar micrófono) | Sí | Sí (flujo verificado en código) | `BitacoraPage.tsx:523-543`, `bitacora.py:89-130` |
| Entrada por audio desde la app web (subir archivo) | Sí | Sí | `BitacoraPage.tsx:494-506`, `bitacora.py:89-130` |
| Entrada por texto desde la app web | Sí | Sí | `BitacoraPage.tsx:508-521`, `bitacora.py:133-151` |
| Entrada por nota de voz de WhatsApp (responsable) | Sí | No probado en vivo | `message_service.py:433-537` |
| Entrada por nota de voz de WhatsApp (staff) | Sí | No probado en vivo | `message_service.py:433-537` |
| Transcripción automática (Whisper `gpt-4o-mini-transcribe`) | Sí | No probado en vivo | `bitacora_service.py:304-317` |
| Análisis con IA (Claude Haiku + structured output JSON) | Sí | Sí (schema verificado + SDK v0.121.0) | `bitacora_service.py:369-425` |
| Sugerencias: reprogramar tarea (`reschedule_task`) | Sí | Sí (código verificado) | `bitacora_service.py:524-535` |
| Sugerencias: crear tarea (`create_task`) | Sí | Sí | `bitacora_service.py:537-568` |
| Sugerencias: cambiar estado (`update_status`) | Sí | Sí | `bitacora_service.py:570-582` |
| Sugerencias: nota de registro (`note`) | Sí | Sí | `bitacora_service.py:584-591` |
| Editar sugerencia antes de aplicar (ajuste manual del jefe) | Sí | Sí | `BitacoraPage.tsx:94-125`, `bitacora.py:245-263` |
| Aplicar sugerencia → acción real (crea/modifica tarea) | Sí | Sí | `bitacora_service.py:501-598` |
| Descartar sugerencia | Sí | Sí | `bitacora_service.py:601-611` |
| Notificación WhatsApp al responsable al aplicar sugerencia | Sí | No probado en vivo | `bitacora_service.py:598, 641-660` |
| Audio reproducible en web (URL firmada HMAC-SHA256, TTL 1h) | Sí (en BitacoraPage) | Sí | `signing.py`, `BitacoraPage.tsx:309` |
| Audio reproducible en componente de origen de tarea | **Buggy** — usa URL sin firmar | **No** — HTTP 403 | `TaskBitacoraOrigin.tsx:59` |
| Entrada manual de transcripción (fallback sin Whisper) | Sí | Sí | `bitacora.py:202-212` |
| Reprocesar entrada con error | Sí | Sí | `bitacora.py:215-227` |
| Asignar obra a nota sin asignar | Sí | Sí | `bitacora.py:230-242` |
| Estados: `pendiente_transcripcion / pendiente_analisis / pendiente_obra / procesado / error` | Sí | Sí | `bitacora.py:30-33`, `schemas/bitacora.py` |
| Degradación sin `OPENAI_API_KEY` | Sí | Sí | `bitacora_service.py:305-317` |
| Degradación sin `ANTHROPIC_API_KEY` | Sí | Sí | `bitacora_service.py:371-374` |
| Cuota mensual de IA por tenant (plan: 50/300/∞) | Parcial — **no aplica a WhatsApp** | Sí para web; No para WhatsApp | `bitacora_service.py:96-135` |
| Socket.IO `bitacora_created` (toast en app para el jefe) | Sí | No probado en vivo | `socket_manager.py:270-285`, `useActivityFeed.ts:79-83` |
| Recordatorio automático (scheduler cada 15 min) para notas sin obra | Sí | No probado en vivo | `scheduler.py:125-131`, `message_service.py:585-650` |
| Trazabilidad tarea → audio de origen (`TaskBitacoraOrigin`) | Sí | Sí (datos correctos; audio roto por bug de firma) | `TaskBitacoraOrigin.tsx`, `bitacora.py:193-199` |
| Contexto de obra en el prompt (tareas, fechas, responsables) | Sí | Sí (código verificado) | `bitacora_service.py:321-346` |
| Respeto de calendario laboral para fechas sugeridas | Sí | No probado en vivo | `bitacora_service.py:348-367` |
| Búsqueda por texto/resumen/responsable | Sí | Sí | `BitacoraPage.tsx:559-565` |
| Filtro "solo pendientes" | Sí | Sí | `BitacoraPage.tsx:550-565` |
| Badge de sugerencias pendientes en menú | Sí | No probado en vivo | `bitacora.py:173-181`, `fetchBitacoraPendingCount` |
| Paginación en `GET /bitacora` | Sí (limit/offset en API) | No expuesto en frontend | `bitacora.py:154-170` |
| Eliminación de entrada (con borrado de archivo en disco) | Sí | Sí | `bitacora.py:274-284` |
| Aislamiento multi-tenant en listado | Sí | Sí | `bitacora_service.py:176-199` |

---

## 3. Flujo completo probado

### Flujo A: Audio desde la app web (probado por código)

1. Usuario clica "Grabar audio" → `navigator.mediaDevices.getUserMedia({audio: true})` → `MediaRecorder` captura audio en webm
2. Al detener: Blob → `createAudioEntry(obraId, blob, "grabacion.webm")`
3. Frontend envía `multipart/form-data` a `POST /obras/{id}/bitacora/audio`
4. Backend:
   - Valida tenant (`ObraService.get_or_raise` con `tenant_id`) → 404 si obra ajena
   - Chequea cuota AI del mes (`assert_within_ai_quota`) → 429 si excedida
   - Valida content-type o extensión de audio → 400 si no es audio
   - Valida tamaño ≤ 25MB → 400 si excede
   - Guarda en disco: `backend/uploads/bitacora_{uuid}.webm`
   - Crea `BitacoraEntry` con `status="pendiente_transcripcion"`, `source="web"`, `created_by=user.id`
   - Llama `process_entry(entry, audio_bytes)`:
     - `asyncio.to_thread(_transcribe)` → POST a OpenAI Whisper con `language="es"`, modelo `gpt-4o-mini-transcribe`
     - Si OK: `entry.transcript = texto; entry.status = "pendiente_analisis"`
     - `_analyze(transcript, obra_id)` → genera contexto de tareas de la obra → POST a Claude Haiku con `output_config={"format": {"type": "json_schema", "schema": ...}}`
     - Claude devuelve JSON con `summary`, `key_points`, `suggestions[]`
     - `entry.status = "procesado"`, `entry.processed_at = now`
     - Emite Socket.IO `bitacora_created` a la sala de la obra
5. HTTP 201 con la entrada completa → frontend agrega al tope de la lista

**Tiempo total estimado en el request synchronous:** 30-60 segundos (Whisper ~10-20s + Claude Haiku ~5-10s). El frontend tiene `timeout: 180_000` (3 minutos).

**Detalle importante:** Para la vía web, el procesamiento ocurre **en el request HTTP mismo** (no en background). Esto significa que el usuario ve el indicador "Procesando con IA..." durante ese tiempo. Para audio largo o modelos lentos, puede parecer que la app se colgó.

### Flujo B: Nota de voz por WhatsApp (una sola obra — no probado en vivo)

1. Responsable envía nota de voz al número de CONSTRUCTA en Twilio
2. Twilio llama `POST /api/v1/webhooks/twilio` en < 15 segundos
3. Backend identifica al emisor: `get_by_whatsapp(from_number)` → Responsible; si no, User (staff)
4. Si número desconocido: responde "Este número no está registrado" → fin
5. Si `MessageType.AUDIO` y tiene `MediaUrl0`:
   - `_handle_bitacora_audio(payload, sender, is_staff)` en el mismo request
   - Descarga el audio de Twilio (basic auth SID:token)
   - Guarda en `backend/uploads/bitacora_{uuid}.ogg`
   - Obtiene obras del emisor: `_sender_obra_ids()` (para responsable: obras con tareas asignadas; para staff: obras que administra)
   - Si no tiene obras: "No tengo obras asociadas a tu número"
   - **Si tiene exactamente 1 obra:**
     - Crea `BitacoraEntry` con `obra_id=obras[0]`, `source="whatsapp"`, `responsible_id=resp.id`
     - Lanza `asyncio.create_task(_bg_process_entry())` en background
     - **Retorna inmediatamente al webhook:** "🎙️ Nota de voz recibida. La estoy procesando con IA — te aviso enseguida."
     - Background task: `sleep(2)` → nueva session de DB → Whisper + Claude → commit → envía resultado por WhatsApp al emisor
   - **Si tiene múltiples obras:**
     - Transcribe primero (`transcribe_audio` síncrono en el request)
     - Crea entry con `obra_id=None`, `status="pendiente_obra"`
     - Responde con lista de obras numeradas: "¿Para qué obra es?"
     - Próximo mensaje del responsable con número → `_handle_obra_selection` asigna la obra y lanza análisis en background

**Gap de cuota:** El paso de cuota (`assert_within_ai_quota`) se llama solo en los endpoints web. El flujo de WhatsApp en `message_service._handle_bitacora_audio` crea la entry directamente via `service.create_entry()` sin pasar por el chequeo. El análisis se hace igual. El costo de IA del responsable no cuenta hacia el límite del plan.

### Flujo C: Error de procesamiento

- Si Whisper falla → `entry.status = "error"` (si fue antes de tener transcript) o `"pendiente_transcripcion"` (si no había API key). El usuario ve el error en la tarjeta y puede pegar el texto manualmente.
- Si Claude falla → `entry.status = "pendiente_analisis"` (tiene transcript) o `"error"`. El botón "Reintentar análisis" está disponible.
- Si el background task de WhatsApp falla en el procesamiento interno → envía WhatsApp de error al emisor ("Hubo un problema al analizarla con IA; podés reintentarlo desde la app"). **Pero** si hay una excepción en el bloque exterior del background task (ej: falla de DB), no se envía ningún mensaje de error al responsable.

---

## 4. Control de acceso

### Quién puede GENERAR una entrada

| Canal | Condición |
|-------|-----------|
| App web (audio/texto) | Cualquier usuario autenticado del tenant que tenga acceso a la obra (`CurrentUser`; no se requiere ser `AdminUser`) |
| WhatsApp | Solo números registrados como `Responsible` o `User` con `whatsapp_number`; números desconocidos son rechazados |

**Por WhatsApp, el sistema NO valida que el responsable sea el "correcto" para una obra específica.** El chatbot le asigna la nota a la obra basándose en qué obras tienen tareas con ese responsable. Si un responsable está en 3 obras y manda una nota, el bot pregunta a cuál va. La asignación depende de la respuesta del responsable, no de validación adicional. Esto es razonable.

**Para staff por WhatsApp:** `_sender_obra_ids` devuelve las obras que el staff administra (`manager_id == sender.id`). Si es admin sin obras propias, devuelve todas las obras del tenant. Esto significa que un admin con WhatsApp registrado puede mandar notas de voz que aplican a cualquier obra del tenant sin restricción.

### Quién puede VER y ACTUAR sobre entradas

Todos los endpoints de bitácora usan `CurrentUser` (no `AdminUser`). Cualquier usuario autenticado del tenant puede:
- Ver todas las bitácoras de cualquier obra del tenant
- Aplicar sugerencias (que ejecutan acciones reales: crear tareas, cambiar estados, reprogramar)
- Descartar sugerencias
- Eliminar entradas
- Asignar obras a entradas sin asignar

**¿Tiene sentido este nivel de acceso?** Parcialmente. Para obras, el modelo de colaboración implica que todos los miembros del equipo pueden ver el estado del proyecto. Pero **aplicar sugerencias** (crear tareas, cambiar estado de tareas a "completada") es una acción de alta implicación que debería ser solo del jefe/admin. Un collaborador no debería poder marcar como "completada" una tarea que la IA sugirió cambiar, ni crear tareas que impacten el plan.

**Aislamiento multi-tenant:** Correcto. `list_entries` usa JOIN a obras con `tenant_id`. `get_scoped` verifica via `obra.tenant_id`. Entradas sin obra (WhatsApp pendiente) solo visibles al creador o al staff del mismo tenant.

**Información sensible:** Las bitácoras pueden contener: quejas sobre proveedores, problemas de seguridad en obra, información sobre atrasos, discusiones entre el equipo. No hay distinción de "confidencial" — todo el tenant ve todo.

---

## 5. Sentido del flujo de uso real

### Caso A: El obrero o responsable con manos sucias en la obra

El flujo de WhatsApp es el más realista para este caso. El responsable ya tiene WhatsApp, no instala nada. Manda una nota de voz. Recibe respuesta confirmando que se recibió en segundos, y el análisis en 30-60 segundos. **Esto tiene sentido** para el flujo diario.

**Lo que no tiene sentido:**
- Si el responsable trabaja en **múltiples obras**, el flujo requiere que antes de que llegue el análisis, el bot le pregunte en qué obra, y él tenga que responder. Esto rompe el flujo de "mando y me olvido": ahora hay que esperar la pregunta y responder. No es bloqueante pero añade fricción.
- La respuesta del bot cuando hay error de IA dice "podés reintentarlo desde la app". Para un obrero sin acceso a la web app, esta instrucción no sirve. No hay forma de reintentar desde WhatsApp.

### Caso B: El jefe revisando las notas del día

El flujo web es adecuado para el jefe: lista de tarjetas con resumen visible en el header (sin abrir), sugerencias con un click para aplicar/descartar, audio reproducible, transcripción colapsable. **El diseño tiene sentido** para la revisión diaria.

**Lo que no tiene sentido:**
- Las entradas "procesadas" con todas las sugerencias ya resueltas se colapsan por defecto — bien. Pero no hay forma de marcar manualmente "revisé esta entrada" si no tiene sugerencias (solo tiene resumen + puntos clave). El jefe puede querer marcar que ya tomó nota de la información.
- El orden es "pendientes primero, luego cronológico inverso". Correcto para la tarea del jefe.

### Caso C: Las sugerencias de la IA como herramienta de trabajo real

Esto es el punto más fuerte del módulo: las sugerencias se pueden aplicar en un clic y ejecutan acciones reales (`TaskService.update`, `TaskService.create`, `TaskService.apply_status_update_checked`). Los cambios se propagan por el sistema: historial, alertas, cascade de fechas. Las sugerencias se pueden editar antes de aplicar (ajustar fechas, título).

**Esto tiene sentido.** No es un chatbot decorativo — la IA propone y el humano decide.

**Punto de duda:** La IA referencia tareas por `task_id` del contexto. Si la tarea tiene un nombre similar a algo mencionado en el audio, el matching puede fallar. La IA puede proponer `task_id=15` cuando el audio dice "la losa del 2do piso" y la tarea se llama "Hormigonado — Losa 2°". El matcheo depende del sistema prompt y de cómo Claude interprete el contexto. Esto no es un bug de código sino una limitación inherente del modelo.

### Caso D: Volumen de bitácoras en una obra activa

Si una obra tiene 3 responsables mandando 2 notas de voz por día durante 6 meses: 1080 entradas. La página las carga todas de una (`limit=100` por defecto pero el frontend no pasa parámetros — siempre 100 como máximo). Con 1080 entradas y 100 visibles, el usuario tendría que paginar pero **no hay paginación en el frontend**. La API soporta `limit/offset` pero la UI no los usa. Pasado el mes 2 en una obra activa, la bitácora empieza a perder usabilidad.

---

## 6. Cómo se muestra al usuario

### `BitacoraPage.tsx` — la pantalla principal

La pantalla tiene tres zonas:
1. **Notas sin asignar** (banner naranja arriba): aparece cuando hay notas de WhatsApp sin obra. Correcto — es lo más urgente y tiene prioridad visual.
2. **Creador de entradas**: tabs Audio / Texto. El audio tiene dos modos: grabar desde el micrófono o subir archivo. Simple, claro.
3. **Lista de entradas**: tarjetas colapsables. Las que necesitan atención están expandidas por defecto.

**Lo que funciona bien en la UI:**
- Colapsado inteligente: la tarjeta muestra el resumen en una línea cuando está cerrada. El jefe escanea sin abrir.
- Badge naranja de sugerencias pendientes visible en el header de la tarjeta.
- Estado visible en chip (color-coded).
- Búsqueda full-text funciona client-side (no requiere nueva llamada al backend).
- Sugerencias aplicadas/descartadas se colapsan a una sola línea (no ocupan espacio visual).
- El audio es reproducible directamente con `<audio controls>`.
- La transcripción es colapsable ("Ver transcripción") — no satura la vista.

**Lo que no funciona bien en la UI:**
- **Sin paginación**: 100 entradas máximo. En una obra activa, el histórico no es accesible.
- **Sin fecha en el header colapsado** cuando hay resumen: el header muestra el resumen en lugar de la fecha, así que no se sabe cuándo fue esa nota sin abrir la tarjeta.
- **Sin modo "ya revisada"**: no hay forma de marcar una nota como "leída" / "revisada" si no tiene sugerencias pendientes.
- **No actualiza en tiempo real**: el Socket.IO evento `bitacora_created` llega al hook `useActivityFeed` (que alimenta el panel de presencia/actividad), pero **no recarga la lista de `BitacoraPage`**. Si el jefe tiene la página de bitácora abierta y llega una nota de WhatsApp, no aparece en su lista sin recargar manualmente.

### `TaskBitacoraOrigin.tsx` — componente dentro de una tarea

Aparece en la tarjeta de tarea para mostrar qué audio de bitácora originó o modificó esa tarea. El componente carga los audios relacionados y muestra resumen + cita de la sugerencia.

**Bug crítico:** El audio usa `e.audio_path` (sin firma) en lugar de `e.audio_url` (firmada). El elemento `<audio>` recibe un `/uploads/bitacora_xyz.ogg` sin `?exp=...&sig=...`. El endpoint `/uploads/{filename}` requiere firma para archivos no-imagen → **HTTP 403 → el audio no se puede reproducir en el contexto de la tarea**. Todo lo demás del componente es correcto.

---

## 7. Qué tiene sentido como está

**Pipeline de procesamiento con background task para WhatsApp:** El timeout de 15 segundos de Twilio hace imposible hacer Whisper + Claude de forma síncrona. El diseño de responder "estoy procesando" y luego notificar por separado es el único viable y está bien implementado.

**Structured output con JSON schema:** Usar `output_config` con JSON schema garantiza que Claude siempre devuelva JSON válido con la estructura exacta esperada. Evita el patrón frágil de pedir JSON en el prompt y parsear con `try/except`.

**Degradación graciosa sin API keys:** El módulo funciona parcialmente sin keys: sin OpenAI, el audio se guarda y el usuario puede pegar el texto manualmente; sin Anthropic, el texto es visible sin análisis. El sistema no se rompe — simplemente reduce funcionalidad de forma controlada.

**Contexto de obra en el prompt:** Incluir las tareas actuales con `task_id`, estado, fechas y responsable en el contexto de Claude permite que las sugerencias referencien tareas reales con IDs válidos. Es el mecanismo que hace que las sugerencias sean aplicables directamente.

**Respeto del calendario laboral en fechas sugeridas:** El método `_calendar_hint()` describe al modelo los días laborales y feriados de la obra. Las fechas sugeridas evitan caer en días no laborales. Si de todas formas Claude propone una fecha no laboral, `TaskService.update()` tiene lógica de ajuste (`_date_adjustment`), y el resultado note se muestra en la UI.

**apply_suggestion usa TaskService:** Las sugerencias no hacen un UPDATE directo en la BD — usan los mismos servicios que la UI. Esto garantiza que los cambios: (a) generen eventos de historial correctamente, (b) disparen alertas si corresponde, (c) respeten cascade de fechas si hay dependencias.

**Quota de IA por tier de plan:** El concepto es correcto — sin cota, un tenant puede gastar sin límite en AI. La implementación tiene un fallo crítico (ignora WhatsApp) pero la intención es válida.

**Signed URLs para audio con TTL 1h:** HMAC-SHA256 sobre `{filename}:{exp}` con SECRET_KEY. URLs que expiran reducen el riesgo de links de audio compartidos sin querer. Para el uso previsto (sesión de trabajo de pocas horas) es suficiente.

**`_sender_obra_ids` para responsables de múltiples obras:** Transcribir primero y preguntar la obra después es la forma correcta de manejar el caso multi-obra. Requiere una interacción extra del responsable pero preserva la nota.

---

## 8. Qué no tiene sentido, está a medias o no funciona

### 8.1 La cuota de IA ignora completamente WhatsApp [CRÍTICO]

`assert_within_ai_quota` en `bitacora_service.py:96` cuenta entradas con esta query:
```python
select(func.count())
.select_from(BitacoraEntry)
.join(User, BitacoraEntry.created_by == User.id)   # JOIN interno
.where(User.tenant_id == tenant_id, BitacoraEntry.created_at >= month_start)
```

Las entradas de WhatsApp desde responsables tienen `created_by = None` (línea 472: `created_by = sender.id if is_staff else None`). El `JOIN` interno sobre `created_by` excluye todos los `NULL`. Además, el check se llama en `create_audio_entry` y `create_text_entry` (rutas web), pero **nunca en `_handle_bitacora_audio`** del message_service (WhatsApp).

Resultado: un tenant en plan Básico (límite 50/mes) puede tener 10 responsables mandando 10 audios por día = 3000 análisis por mes sin que ninguno cuente hacia la cota. El costo de Whisper + Claude corre igual.

### 8.2 `TaskBitacoraOrigin` usa URL de audio sin firma [ALTO]

`frontend/src/components/TaskBitacoraOrigin.tsx:59`:
```typescript
{e.audio_path && (
  <audio controls src={`${BACKEND_URL}${e.audio_path}`} .../>
)}
```

`e.audio_path` es por ejemplo `/uploads/bitacora_abc123.ogg`. El endpoint `GET /uploads/{filename}` en `main.py:106` llama `requires_signature(safe)` que devuelve `True` para `.ogg` (no es imagen), y como no hay `exp` ni `sig` en la URL, devuelve **HTTP 403**. El audio no se reproduce.

`BitacoraPage.tsx:309` lo hace correctamente:
```typescript
<audio controls src={`${BACKEND_URL}${entry.audio_url ?? entry.audio_path}`} .../>
```
Usando `audio_url` (la URL firmada que devuelve la API) con `audio_path` solo como fallback. `TaskBitacoraOrigin` debería usar el mismo patrón.

### 8.3 Sin rate limit por número de WhatsApp [ALTO]

Un responsable puede mandar 20 notas de voz en 5 minutos. Cada una dispara descarga de Twilio + Whisper + Claude. No hay cooldown, no hay debounce, no hay límite por número. El costo se multiplica linealmente con el abuso.

### 8.4 Sin paginación en el frontend [MEDIO]

`fetchBitacora(obraId)` llama `GET /bitacora?obra_id={id}` sin pasar `limit` ni `offset`. La API tiene `limit=100` como default. Una obra activa puede superar eso. La UI no implementa "Cargar más" ni scroll infinito. Las entradas más viejas de 100 son inaccesibles desde la UI aunque existan en la BD.

### 8.5 `BitacoraPage` no actualiza en tiempo real al recibir nuevas entradas [MEDIO]

El Socket.IO evento `bitacora_created` es recibido por `useActivityFeed` (que lo convierte en una notificación de actividad tipo "Fulano mandó una nota de voz"). Pero **`BitacoraPage.tsx` no suscribe a este evento**. Si el jefe tiene abierta la página de bitácora y llega una nota de WhatsApp, la entrada no aparece hasta que recargue manualmente. Contrasta con cómo funciona el módulo de alertas que sí actualiza su estado en tiempo real.

### 8.6 Outer exception en background task no notifica al responsable [MEDIO]

En `_bg_process_entry`, el bloque `except Exception` externo no envía ningún WhatsApp al responsable. El responsable recibió "La estoy procesando — te aviso enseguida" pero si hay un error de infraestructura (DB caída, timeout de red), nunca recibe la respuesta prometida. El único camino de recuperación es que el jefe vea la entrada en error en la app y la reprocese manualmente.

### 8.7 Formato AMR de WhatsApp antiguo no soportado por Whisper [BAJO]

WhatsApp en dispositivos Android más viejos envía audio en formato AMR (`audio/amr`). El código guarda el archivo con extensión `.amr`. Whisper API no acepta AMR — el POST a OpenAI devuelve error. `process_entry` captura el error y deja la entrada en `status="error"` con mensaje genérico "Error en el procesamiento: ...". No hay mensaje específico sobre el formato no soportado, ni conversión automática de AMR.

### 8.8 Procesamiento en el request HTTP para entradas web (no background) [BAJO]

Para entradas por audio desde la web, el procesamiento (Whisper + Claude) ocurre en el request HTTP mismo. El timeout configurado en el frontend es 180 segundos (3 minutos). Para audios largos o cuando el API de OpenAI está lento, el request puede tardar más de lo esperado, y el usuario solo ve "Procesando con IA…" sin progreso. Si se supera el timeout del cliente, la entrada queda creada en disco pero el request ya terminó en error desde el punto de vista del usuario.

### 8.9 Colaboradores pueden aplicar sugerencias de alto impacto [BAJO]

Ningún endpoint de bitácora usa `AdminUser`. Un collaborador (rol no-admin) puede aplicar una sugerencia `create_task` o `update_status` que impacta el plan de obra. La misma persona no puede crear tareas vía la UI (el sidebar oculta ese botón), pero sí puede hacerlo a través de aplicar una sugerencia de bitácora. Inconsistencia de permisos.

---

## 9. Mejoras propuestas

### P0 — Crítico (bloquea la feature principal)

**9.1 Corregir cuota de IA para cubrir entradas de WhatsApp**

**Qué:** Cambiar el query de `assert_within_ai_quota` para contar también por `responsible_id` a través del tenant. Alternativamente, contar directamente por `obra.tenant_id`.

**Cómo:** En `bitacora_service.py:120-133`, reemplazar el JOIN con User por un JOIN con Obra:
```python
used = (await self.session.execute(
    select(func.count())
    .select_from(BitacoraEntry)
    .join(Obra, BitacoraEntry.obra_id == Obra.id)
    .where(Obra.tenant_id == tenant_id, BitacoraEntry.created_at >= month_start)
)).scalar_one()
```
Y también llamar a `assert_within_ai_quota` al inicio de `_handle_bitacora_audio` en `message_service.py`.

**Impacto:** Bajo. Solo agrega un JOIN y una llamada. **No rompe nada existente.**

**9.2 Corregir URL de audio en `TaskBitacoraOrigin`**

**Qué:** Usar `e.audio_url` (firmada) en lugar de `e.audio_path` en `TaskBitacoraOrigin.tsx`.

**Cómo:** En `TaskBitacoraOrigin.tsx:59`:
```typescript
{(e.audio_url || e.audio_path) && (
  <audio controls src={`${BACKEND_URL}${e.audio_url ?? e.audio_path}`} style={{ width: "100%", height: 34 }} />
)}
```
**Impacto:** Trivial. Un cambio de una línea. **No rompe nada.**

### P1 — Importante

**9.3 Agregar rate limit por número de WhatsApp**

**Qué:** Limitar cuántas notas de voz puede procesar un número en una ventana de tiempo.

**Cómo:** En `message_service._handle_bitacora_audio`, antes de crear la entry:
```python
# Contar entries de las últimas N horas para este responsible/user
recent = count(BitacoraEntry where responsible_id=resp.id and created_at > now-1h)
if recent >= MAX_PER_HOUR:  # e.g., 10
    return "Recibiste muchas notas de voz en poco tiempo. Esperá un momento antes de mandar otra."
```
**Impacto:** Bajo-medio. Agrega query, no toca lógica existente.

**9.4 Actualizar `BitacoraPage` en tiempo real con Socket.IO**

**Qué:** Suscribirse al evento `bitacora_created` en `BitacoraPage.tsx` y agregar la entrada a la lista cuando llega por WhatsApp.

**Cómo:**
```typescript
useEffect(() => {
  function handleBitacora(p: { entryId: number; obraId: number }) {
    if (p.obraId !== obraId) return;
    // Refetch the specific entry from API and prepend to list
    fetchBitacora(obraId).then(data => setEntries(data));
  }
  socket.on("bitacora_created", handleBitacora);
  return () => { socket.off("bitacora_created", handleBitacora); };
}, [obraId]);
```
**Impacto:** Bajo. Frontend-only. No rompe nada.

**9.5 Notificar al responsable en outer exception del background task**

**Qué:** Enviar un mensaje de error por WhatsApp si el bloque exterior del background task falla.

**Cómo:** En `_bg_process_entry` (message_service.py):
```python
except Exception:
    _log.exception("Error en bg processing de BitacoraEntry %s", entry_id)
    try:
        if sender_phone:
            await send_whatsapp_message(sender_phone, 
                "⚠️ No pudimos procesar tu nota de voz. El audio quedó guardado — podés ver el estado en la app.")
    except Exception:
        pass
```
**Impacto:** Bajo. Líneas adicionales en el except handler.

### P2 — Mejoras de usabilidad

**9.6 Agregar paginación en el frontend**

**Qué:** "Cargar más" al final de la lista usando los parámetros `limit/offset` ya implementados en la API.

**Cómo:** Mantener `offset` en el estado de `BitacoraPage`, botón "Cargar más" que llama `fetchBitacora(obraId, { limit: 30, offset: entries.length })` y hace append.
**Impacto:** Medio. Solo frontend.

**9.7 Agregar mensaje específico para AMR**

**Qué:** Si la transcripción falla por formato, detectarlo y guiar al usuario.

**Cómo:** En `_transcribe`, capturar la respuesta de error de OpenAI y retornar `None` con mensaje específico al llamador. `process_entry` ya maneja el caso de `None`.
**Impacto:** Bajo.

**9.8 Mover aplicación de sugerencias a rol AdminUser**

**Qué:** Restringir `apply_suggestion` y `dismiss_suggestion` a `AdminUser`.

**Cómo:** Cambiar deps en `bitacora.py:247,267`.
**Impacto:** Bajo en código. **Potencialmente disruptivo para usuarios colaboradores** que hoy pueden aplicar sugerencias (si hay alguno). Evaluar caso por caso.

---

## 10. Riesgos

| # | Riesgo | Probabilidad | Impacto | Archivo |
|---|--------|--------------|---------|---------|
| R1 | WhatsApp bypassa la cuota de IA — costo de Whisper+Claude ilimitado para planes pagos | Alta (cualquier tenant con responsables activos) | Alto (costo económico real) | `bitacora_service.py:120-133`, `message_service.py:470` |
| R2 | Audio no reproducible en `TaskBitacoraOrigin` por falta de firma — funcionalidad visible rota | Alta (sucede en todas las tareas con origen en bitácora) | Medio (UX broken) | `TaskBitacoraOrigin.tsx:59` |
| R3 | Responsable spamea notas de voz (sin rate limit) — costo de API crece sin control | Media | Alto | `message_service.py:433` |
| R4 | `BitacoraPage` no actualiza en tiempo real — jefe necesita recargar manualmente para ver notas de WhatsApp entrantes | Alta (sucede siempre) | Medio (confusión de UX) | `BitacoraPage.tsx:462-476` |
| R5 | Sin paginación frontend — bitácoras antiguas inaccesibles en obras activas (>100 entradas/mes) | Media | Medio | `BitacoraPage.tsx:462` |
| R6 | Background task de WhatsApp no notifica al responsable si falla el bloque exterior | Baja | Bajo-Medio (silencio inesperado) | `message_service.py:534` |
| R7 | Colaboradores pueden aplicar sugerencias de alto impacto (crear tareas, cambiar estados) pese a no tener esos permisos en la UI normal | Baja (requiere saber del endpoint) | Medio | `bitacora.py:245-263` |
| R8 | `output_config` requiere SDK anthropic >= 0.121.0 — no está pinneado en requirements.txt como comentario activo | Baja | Alto (todo el análisis dejaría de funcionar) | `bitacora_service.py:413`, `requirements.txt:29` |

---

## Apéndice — Mapa de archivos auditados

| Archivo | Rol |
|---------|-----|
| `backend/app/models/bitacora.py` | Modelo `BitacoraEntry` + estados |
| `backend/app/schemas/bitacora.py` | Schemas: Read, TextCreate, SuggestionEdit, AssignObra |
| `backend/app/api/routes/bitacora.py` | 10 endpoints; todos con `CurrentUser` |
| `backend/app/services/bitacora_service.py` | Pipeline AI (Whisper → Claude), quota, apply_suggestion |
| `backend/app/services/message_service.py:433-660` | WhatsApp handler: descarga, background task, obra selection, recordatorios |
| `backend/app/core/scheduler.py:58-63, 125-131` | Job remind_bitacora_obra (cada 15min) |
| `backend/app/core/signing.py` | HMAC-SHA256 para URLs de audio |
| `backend/app/core/config.py` | `CLAUDE_MODEL`, `WHISPER_MODEL`, API keys |
| `backend/app/core/socket_manager.py:270-285` | `emit_bitacora_created` |
| `backend/alembic/versions/0025_add_bitacora_entries.py` | Migración de la tabla |
| `backend/alembic/versions/0037_bitacora_reminded_at.py` | Columna `reminded_at` |
| `frontend/src/pages/BitacoraPage.tsx` | Página principal (lista + creador + sugerencias) |
| `frontend/src/api/bitacora.ts` | Todas las llamadas a la API |
| `frontend/src/components/TaskBitacoraOrigin.tsx` | Trazabilidad tarea → audio (bug de URL) |
| `frontend/src/hooks/useActivityFeed.ts:79-83` | Listener de `bitacora_created` (solo para feed de actividad) |

---

## 11. Adenda 2026-08-26 — verificación con tests reales + búsqueda de bugs nuevos

Auditoría original re-verificada con un workflow multi-agente (no solo lectura de código): reproducción con `pytest` real de los dos hallazgos P0, y 5 lentes de búsqueda de bugs nuevos con verificación adversarial (mínimo 2 de 3 votos independientes a favor) antes de admitir cada uno. Todo corrido contra el código actual del repo (rama `fix/whatsapp-planos-desambiguacion`, sin cambios propios en bitácora desde la fecha del audit original salvo el hardening de firmas de `signing.py` del 2026-08-21, que no toca estos bugs).

### 11.1 — Los dos P0 originales: confirmados con test real, no solo con lectura

- **§8.1 (cuota de IA ignora WhatsApp):** CONFIRMADO. Test que inserta 20 `BitacoraEntry` con `created_by=None` (el patrón exacto que deja `_handle_bitacora_audio`) prueba que `assert_within_ai_quota` no lanza aunque se alcance el límite; el mismo test, con las mismas 20 filas pero `created_by=<User>`, sí lanza 429. `grep` confirma que `_handle_bitacora_audio` nunca llama a `assert_within_ai_quota`.
- **§8.2 (audio sin firma en `TaskBitacoraOrigin`):** CONFIRMADO. `GET /uploads/{file}` sin query params → 403 real; la misma URL pero con la firma que la propia API ya devuelve en `audio_url` → 200 con el contenido correcto. El bug es puramente que el componente usa `audio_path` en vez de `audio_url`, dato que el backend ya expone bien.

### 11.2 — Hallazgos nuevos (no estaban en las secciones 8.1-8.9)

| # | Severidad | Hallazgo | Archivo |
|---|-----------|----------|---------|
| N1 | 🔴 Crítico | Un admin con `tenant_id=NULL` (estado que deja `create_admin.py`, script real y sin deprecar) ve y lista la bitácora de **todos los tenants** en `GET /bitacora` — `list_entries`/`get_scoped`/`list_unassigned` solo filtran `if tenant_id is not None` | `bitacora_service.py:176` |
| N2 | 🔴 Crítico | Una sugerencia "stale" (p. ej. tras reasignar la obra de una entrada con `assign_obra` y que el re-análisis falle) permite aplicar `reschedule_task`/`update_status` sobre una tarea de **otra obra**, sin que el usuario tenga ningún `ObraUserRole` ahí — el guard de ruta valida contra `entry.obra_id`, pero `TaskService` solo valida `tenant_id`, nunca el rol por-obra de la tarea real | `bitacora_service.py:524-532` |
| N3 | 🟠 Alto | `apply_suggestion`/`dismiss_suggestion` usan `get_or_raise` en vez de `get_scoped` — para entradas con `obra_id=NULL` (WhatsApp/web sin asignar todavía), el único guard es "sea admin", sin comparar tenant. Un admin de otra empresa puede descartar sugerencias ajenas (200 OK) y de paso la respuesta le filtra el transcript/resumen completo de la nota ajena | `bitacora_service.py:501,601` |
| N4 | 🟠 Alto | `ObraService.delete()` limpia archivos de planos pero no los audios de bitácora — mismo bug que se cerró para planos en `d081ae7`, sin replicar acá. Borrar una obra dejá los `.ogg`/`.mp3` huérfanos en `backend/uploads/` para siempre (grabaciones de voz, dato sensible) | `obra_service.py:104-136` |
| N5 | 🟡 Medio | Editar una sugerencia con fecha o `new_status` inválidos antes de aplicar (`date.fromisoformat`/`TaskStatus(...)` sin `try/except`) → `500` genérico en vez de `400`/`422` claro | `bitacora_service.py:528,576` |
| N6 | 🟡 Medio | `reprocess()` no chequea el `status` actual: reanalizar una entrada ya `procesado` reemplaza `suggestions` entero con `applied=False` para todas, perdiendo el registro de qué ya se aplicó — riesgo de tarea duplicada o de reprogramar dos veces si el usuario vuelve a aplicar "la misma" sugerencia | `bitacora.py:247` |
| N7 | 🟡 Medio | `reprocess()` es un no-op silencioso (`200 OK`, sin cambios ni error) cuando el archivo de audio ya no está en disco — el usuario aprieta "Reintentar" y no pasa nada, sin ninguna pista de por qué | `bitacora.py:257` |
| N8 | 🟡 Medio | Frontend: el filtro "Solo pendientes" (`hasPending`, línea 555) usa una definición de "necesita atención" más angosta que `needsAttention` de `EntryCard` (línea 247) — una entrada en `error`/`pendiente_transcripcion` sin sugerencias desaparece de la lista filtrada aunque sí necesite acción | `BitacoraPage.tsx:555,563` |
| N9 | 🟡 Medio | Frontend: el estado local `edit`/`editing` de una sugerencia se inicializa una sola vez desde el prop y nunca se resincroniza — cancelar sin resetear, o reprocesar la entrada mientras el editor está abierto, puede dejar aplicar valores obsoletos sobre la sugerencia equivocada | `BitacoraPage.tsx:55-69,198` |

Cada uno de N1-N9 tiene un test de reproducción real (`pytest`, corrido y borrado) documentado en el journal del workflow, salvo N8/N9 que son de solo lectura de frontend (no hay suite de tests en `frontend/`).

### 11.3 — Qué hacer, en orden

**Ya en el plan original (sigue vigente, ver §9):** 9.1 (cuota WhatsApp) y 9.2 (URL firmada en `TaskBitacoraOrigin`) siguen siendo P0 — ahora con test de reproducción, no solo análisis.

**Nuevo, a sumar al P0/P1:**
1. N2 y N3 (bypass de autorización por-obra y por-tenant en `apply_suggestion`/`dismiss_suggestion`) — mismo nivel que 9.1/9.2: son escritura no autorizada sobre datos de otro tenant/obra, confirmado con test. Arreglo: `get_scoped` en vez de `get_or_raise` en ambos métodos, y en `apply_suggestion` validar que `task.obra_id == entry.obra_id` antes de delegar a `TaskService`.
2. N1 (admin sin tenant ve todo) — acotado en probabilidad (requiere el estado legacy de `create_admin.py`) pero el impacto es máximo (fuga total entre tenants); arreglo barato: tratar `tenant_id is None` como "sin obras visibles" en vez de "sin filtro", o eliminar la posibilidad de crear un admin sin tenant.
3. N4 (audios huérfanos al borrar obra) — mismo patrón que el fix ya aplicado a planos; extender `ObraService.delete()`/`_cleanup_plano_files` para cubrir también `BitacoraEntry.audio_path`.
4. N5, N6, N7 — robustez de `apply_suggestion`/`reprocess`; bajo esfuerzo, sin romper nada existente (try/except + guard de status + mensaje de error explícito).
5. N8, N9 — frontend, cosmético/UX pero con un camino real a "el usuario ve datos viejos y confía en ellos"; bajo esfuerzo.

Todo lo demás de las secciones 8.3-8.9 del audit original (rate limit, paginación, tiempo real, permisos de collaborator, AMR, procesamiento síncrono web) sigue siendo válido y sin cambios de prioridad.

---

## 12. Re-verificación — tras el rediseño de roles y multi-tenant

Entre la adenda de la sección 11 y esta revisión aterrizó `b4933a4` ("sistema de roles por obra y permisos granulares", 2026-08-24, ~80 archivos) más la migración multi-tenant a `TenantMembership` (Fases 1-4) y ~40 commits más. Se re-chequeó cada hallazgo de roles/tenant contra el código de HOY, línea por línea, no contra lo escrito en las secciones anteriores.

### 12.1 — Ya resuelto

- **§8.9** (cualquier autenticado del tenant podía aplicar sugerencias de alto impacto): **RESUELTO**. Todos los endpoints de bitácora que mutan algo (`apply`, `dismiss`, `reprocess`, `transcript`, `assign_obra`, `delete`) ahora exigen `require_bitacora_obra_role(ObraUserRoleType.COLABORADOR|JEFE_OBRA)` — un usuario sin fila en `ObraUserRole` para esa obra ya no pasa. Matiz que sigue abierto: `apply`/`dismiss` piden solo `COLABORADOR`, no `JEFE_OBRA` — un colaborador con acceso legítimo a la obra puede seguir creando tareas o cerrando otras vía sugerencia; es una decisión de producto razonable con el modelo de roles nuevo, no el mismo bug de antes.
- **N1** (admin con `tenant_id=NULL` ve todos los tenants): **YA NO ES EXPLOTABLE**. `AuthService._finish_login` (línea 96-107) exige al menos una `TenantMembership` activa o corta con 403 "Account is inactive" — ni `register()` ni `login()` pueden dejar a alguien logueado sin membership. `create_admin.py` es el único camino que deja `tenant_id=NULL` (inserta directo en `users` sin tocar `tenant_memberships`), pero ese usuario **ya no puede loguearse en absoluto** con el flujo actual — el 403 corta antes de emitir ningún token. Housekeeping, no seguridad: `create_admin.py` quedó como script muerto (crea una cuenta con la que nadie puede entrar); conviene borrarlo o actualizarlo para que también cree la membership.

### 12.2 — Siguen exactamente igual (re-verificado hoy)

- **§8.1** (cuota de IA ignora WhatsApp) — el JOIN se movió de `User` a `TenantMembership` (`bitacora_service.py:127`, cambio de la migración multi-tenant, no un intento de arreglo), pero sigue siendo `INNER JOIN` sobre `BitacoraEntry.created_by`, y `_handle_bitacora_audio` (`message_service.py:667`) sigue dejando `created_by=None` para notas de un `Responsible`. Mismo bypass, mismo mecanismo.
- **§8.2** (`TaskBitacoraOrigin` usa `audio_path` sin firma) — línea 60, sin tocar.
- **N2** (sugerencia stale muta tareas de otra obra) — causa raíz ahora precisa: `PATCH /tasks/{id}` sí exige `require_task_obra_role` (rol correcto sobre la obra real de la tarea), pero `apply_suggestion` llama a `TaskService.update()`/`apply_status_update_checked()` **directo**, sin pasar por esa ruta — y `TaskService._get_obra_and_assert_access` (`task_service.py:90-99`) solo compara `tenant_id`, nunca `ObraUserRole`. El guard nuevo se sumó en la ruta de tareas pero no en el puente bitácora → tareas.
- **N3** (dismiss cruza tenant en notas sin obra) — con el guard nuevo puesto (`require_bitacora_obra_role`, `allow_null_obra=True`), `_resolve_and_assert` (`obra_permissions.py:142-158`) solo exige `_is_admin(user)` cuando el modelo no tiene `tenant_id` propio — y `BitacoraEntry` no lo tiene. Es un hueco genérico del módulo nuevo de permisos (afecta a cualquier modelo `allow_null_obra` sin `tenant_id` denormalizado), no algo que haya quedado sin portar — nunca se cubrió.
- **N4-N9** y **§8.3-8.8** — verificados contra el archivo de hoy uno por uno (huérfanos de audio al borrar obra, sin rate limit en WhatsApp, sin paginación ni tiempo real en `BitacoraPage`, `reprocess` sin guard de estado y no-op silencioso si falta el audio, `edits` sin validar, AMR, procesamiento síncrono web, los dos bugs de estado del frontend en `SuggestionCard`): todos presentes, sin cambios, mismas líneas que en 11.2.

### 12.3 — Prioridad actualizada

1. **P0 sin cambios:** 9.1 (cuota WhatsApp) y 9.2 (URL firmada `TaskBitacoraOrigin`).
2. **Sumar a ese nivel:** N2 y N3 — son el mismo tipo de problema (mutación/lectura no autorizada entre obras/tenants), y a diferencia de N1 siguen 100% vigentes con el código de hoy. Arreglo de N2: que `apply_suggestion` valide `task.obra_id == entry.obra_id` antes de delegar a `TaskService`, o que pase por `require_task_obra_role` en vez de por el service crudo. Arreglo de N3: `get_scoped` en vez de `get_or_raise` en `apply_suggestion`/`dismiss_suggestion` como defensa adicional, y decidir a nivel de `obra_permissions.py` qué hacer con modelos `allow_null_obra` sin `tenant_id` (agregarle la columna a `BitacoraEntry`, o resolver el tenant vía `responsible_id`/`created_by` antes de comparar).
3. **Baja de prioridad:** N1 pasa de "crítico a arreglar" a "housekeeping" — no hay código a tocar en el módulo de permisos, solo decidir qué hacer con `create_admin.py` (borrar o arreglar).
4. Resto sin cambios: N4 (huérfanos de audio) → mismo nivel que el fix ya hecho para planos; N5-N9 → bajo esfuerzo, sin romper nada existente; §8.3-8.8 → sin cambios de prioridad.

### 12.4 — Arreglado (rama `fix/bitacora-audit-p0`)

- **9.1 (cuota de IA ignora WhatsApp) — RESUELTO.** `assert_within_ai_quota` ahora cuenta por `Obra.tenant_id` en vez de por `created_by`/`TenantMembership` (no depende de quién figura como autor). Se agregó el chequeo, que antes no existía en ningún punto del flujo de WhatsApp: en `_handle_bitacora_audio` (antes de crear la entrada, para el caso de una sola obra) y en `_handle_obra_selection` (antes de disparar el análisis, para el caso de varias obras — es ahí donde recién se sabe el tenant). Ambos responden con un mensaje claro por WhatsApp si se alcanzó el límite, sin crear/analizar la entrada.
- **9.2 (audio sin firma en `TaskBitacoraOrigin`) — RESUELTO.** Usa `e.audio_url ?? e.audio_path`, igual que `BitacoraPage.tsx`. Verificado en vivo contra el server corriendo: la tarea "Pilotes visibles" (origen bitácora #8) ahora pide `/uploads/...?exp=..&tid=..&sig=..` y responde `200`; antes pedía la ruta cruda y daba `403`.
- **N2 (sugerencia stale muta otra obra) — RESUELTO.** `apply_suggestion` valida `task.obra_id == entry.obra_id` antes de delegar a `TaskService` en las ramas `reschedule_task`/`update_status`; si no coincide, `422` con mensaje de que la sugerencia quedó desactualizada.
- **N3 (dismiss cruza tenant en notas sin obra) — RESUELTO.** `BitacoraEntry` ahora tiene `tenant_id` propio (migración `0060`, backfill desde `Obra`/`User`/`Responsible` según corresponda; se setea en `create_entry` y se refresca en `assign_obra`/`_handle_obra_selection`). Con la columna presente, el chequeo de tenant que ya existía en `obra_permissions.py::_resolve_and_assert` deja de saltearse — no hizo falta tocar ese módulo.
- **N5 (edits inválidos → 500) — RESUELTO.** `date.fromisoformat`/`TaskStatus(...)` ahora van envueltos (`_parse_edit_date`/`_parse_edit_status`) y devuelven `422` con el mensaje de qué campo está mal.
- **N4 (huérfanos de audio al borrar obra) — RESUELTO.** `ObraService.delete()` ahora también corre `_cleanup_bitacora_files` (mismo patrón que `_cleanup_plano_files`).

Suite completa: 286 passed (incluye 6 tests nuevos para estos 6 fixes en `test_bitacora.py`), 1 failed preexistente y no relacionado (`test_webhook_missing_account_sid_returns_200_with_twiml`, depende de firma de Twilio contra una URL de ngrok vieja en el entorno local — falla igual en `main` sin estos cambios).

**Pendiente para una próxima pasada:** N6, N7, N8, N9 y §8.3-8.8 (rate limit WhatsApp, paginación, tiempo real, AMR, procesamiento síncrono web, los dos bugs de frontend en `SuggestionCard`).
