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
