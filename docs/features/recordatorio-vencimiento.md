# Recordatorio de WhatsApp por tarea próxima a vencer

> **Veredicto: estaba roto.** La lógica existía completa y enganchada al scheduler, pero **ningún responsable recibía el mensaje**. Dos bugs se combinaban para que el envío nunca ocurriera. Arreglado y cubierto con tests.

---

## 1. Diagnóstico — cómo estaba antes de tocar nada

### Lo que sí estaba bien

No era el caso de "campos de `SystemSettings` que nadie lee" que apareció en otras auditorías. `reminder_1day` y `reminder_3days` **sí** están leídos, en `NotificationService.send_reminders()`, junto con `auto_reminders`, `chatbot_enabled` y el horario laboral de la obra. El job periódico también existe:

```python
# scheduler.py — REMINDER_HOURS_AHEAD = "24,72" por defecto
for hours in hours_list:
    scheduler.add_job(_job_send_reminders, CronTrigger(minute=0), args=[hours], ...)
```

Corre **cada hora** para las ventanas de 24 h y 72 h. La auditoría 11 (§2) reportaba estos campos como conectados, y en cuanto al cableado tenía razón.

### Los dos bugs que impedían el envío

**Bug 1 — la ventana horaria se comparaba en UTC contra una franja local.**

`send_reminders()` llamaba `is_within_working_hours(cal, now)` con `now = datetime.now(timezone.utc)`. Los campos `hour_from`/`hour_to` del calendario son **hora argentina** (es lo que el admin configura en pantalla), y la función comparaba `dt.hour` directo. Argentina es UTC−3, así que la franja quedaba corrida 3 horas:

| Hora local | En UTC | ¿El sistema la dejaba pasar? | ¿Correspondía? |
|---|---|---|---|
| 05:00 | 08:00 | Sí | **No** — molestaba de madrugada |
| 08:00 | 11:00 | Sí | Sí |
| 16:00 | 19:00 | **No** | Sí — se perdía |
| 17:00 | 20:00 | **No** | Sí — se perdía |

Con el calendario por defecto (7 a 18), la franja efectiva era 04:00–15:00 local.

Detalle revelador: el helper correcto **ya existía** en el mismo archivo (`NotificationService._within_send_hours`, que sí convierte con `ZoneInfo`), pero el camino de recordatorios usaba el otro.

**Bug 2 — el que mataba la funcionalidad: las tareas sin hora de vencimiento.**

La consulta buscaba tareas cuyo vencimiento cayera en una ventana de **±30 minutos** alrededor de `ahora + N horas`, combinando `due_date + due_time`. Y `due_time` es opcional: cuando falta, la consulta la tomaba como **23:59 local**.

Consecuencia: para una tarea sin hora, el recordatorio de 24 h se disparaba a las ~23:59 del día anterior. Esa hora está fuera de cualquier horario laboral razonable → `continue` → y como la ventana es de ±30 min y el job corre por hora, **la oportunidad se perdía para siempre**. Lo mismo para el de 72 h.

**Qué tan grave era, medido en la base real:**

```
tareas totales: 28 · con fecha de vencimiento: 28 · con HORA de vencimiento: 0
```

**28 de 28.** Ninguna tarea del sistema tenía hora cargada, así que el recordatorio no se enviaba nunca, para ninguna. La funcionalidad estaba 100 % muerta en la práctica pese a estar completamente escrita.

---

## 2. Qué se arregló

### 2.1 La conversión de zona horaria, dentro de la función

`is_within_working_hours()` ahora convierte a hora argentina si el `datetime` viene con zona; si viene naive asume que ya es local.

Se arregló **adentro de la función** y no en el call site a propósito: los dos lugares que la llamaban tenían el mismo error, y poniéndolo adentro un call site nuevo no puede volver a equivocarse.

### 2.2 El recordatorio pasa a ser por día, no por hora exacta

Es el cambio de fondo. `send_reminders(hours_ahead)` ahora:

1. Redondea a días: 24 h → 1 día, 72 h → 3 días.
2. Busca las tareas activas cuyo `due_date` sea exactamente **hoy + N días** (fecha local argentina).
3. Manda en la **primera corrida horaria del día que caiga dentro del horario laboral** de la obra.
4. Deduplica para que las corridas siguientes del mismo día no repitan.

Así una tarea sin hora funciona igual que una con hora, y "recordatorio de 3 días" significa lo que el admin espera al leerlo en la pantalla de configuración. Si a las 5 AM todavía no es horario laboral, la corrida de las 8 lo manda — ya no se pierde.

Efecto colateral bienvenido: la consulta nueva (`TaskRepository.list_due_on_date`) es una comparación de fechas simple, sin `func.timezone(...)` de PostgreSQL, así que **el flujo ahora se puede testear en SQLite** — que es lo que corre la suite. Antes era intesteable, y por eso el bug había sobrevivido.

Se eliminó `list_due_in_window()`, que quedó sin uso, junto con los imports que solo ella necesitaba.

### 2.3 El envío quedó reusable (para el mensaje semanal de los lunes)

Dos piezas públicas nuevas en `NotificationService`, pensadas para que la funcionalidad siguiente no duplique nada:

| Método | Qué hace |
|---|---|
| `notify_responsible(responsible, body, *, task=None, notification_type="reminder", awaits_response=False)` | Punto único de salida: manda el WhatsApp por Twilio y persiste el saliente en `messages` con su SID. Funciona **sin tarea asociada** (`task_id` queda en NULL), que es lo que necesita un resumen semanal. No chequea configuración — eso lo decide quien llama. |
| `can_notify_obra(obra_id) -> (bool, motivo)` | Reúne los tres chequeos que comparten todas las notificaciones proactivas: `chatbot_enabled`, `auto_reminders` y horario laboral de la obra. Devuelve el motivo cuando da que no, para loguearlo. |

El `notification_type` viaja al campo `ai_interpretation` del mensaje, así que los envíos quedan distinguibles en la base (`reminder` vs. lo que use el flujo semanal).

---

## 3. Respuestas a las preguntas puntuales

**¿Respeta la ventana horaria y `chatbot_enabled`?**
Sí, y ahora de verdad. El orden de chequeos es: `chatbot_enabled` → `auto_reminders` → el flag específico (`reminder_1day` o `reminder_3days`) → horario laboral del calendario de la obra. Cualquiera en falso corta el envío para esa tarea. Todos con test.

Un matiz sobre **de dónde sale la configuración**: se resuelve con `settings_repo.get_for_obra(task.obra_id)`, que llega al `SystemSettings` del **tenant** de la obra. La auditoría 11 (§4) ya había señalado que este binding "por obra" es en realidad por tenant; no se tocó acá porque excede el alcance, pero conviene tenerlo presente: dos obras del mismo tenant no pueden tener horarios de recordatorio distintos.

**¿Qué pasa si la tarea se completa o se cancela antes?**
No se manda nada. La consulta excluye `COMPLETADA` y `CANCELADA` en el momento de correr, así que el recordatorio se evalúa contra el estado actual, no contra el de cuando se programó. No hay "envío agendado" que pueda quedar obsoleto: el job decide en el momento. Cubierto con dos tests.

**¿Y si la tarea no tiene responsable, o el responsable está inactivo?**
Se saltea en ambos casos. Con test.

---

## 4. El mensaje que le llega al responsable

Contenido exacto, capturado ejecutando el flujo arreglado contra la base real (con el envío mockeado):

```
CONSTRUCTA 🏗️

Hola Juan Pérez, recordatorio de tarea próxima a vencer.

Tarea: Pintura de frente (PRUEBA)
📍 Local Comercial — Nueva Córdoba
📅 09/09
Estado actual: 🔵 Pendiente

¿Cuál es el estado?

1️⃣ En progreso
2️⃣ Completada
3️⃣ Bloqueada
4️⃣ Demorada

Escribí el número.
Para cancelar escribí X.
```

Es el mismo mensaje para el recordatorio de 3 días y el de 1 día — no se distinguen en el texto (ver §7, punto abierto).

**No es un aviso pasivo: abre una conversación.** El mensaje lo arma `ConversationService.seed_for_task()`, que además deja la sesión del chatbot lista en `STATUS_MENU`. Si el responsable contesta "1", la tarea pasa a *En progreso* de verdad; si contesta "4", el bot le pide fecha y genera una alerta de reprogramación para el jefe. Ese es el corazón de la propuesta de valor del producto: el responsable reporta desde WhatsApp sin instalar nada.

---

## 5. Prueba de ejecución

### 5.1 Ensayo contra la base real (sin enviar)

Se creó una tarea a 3 días y otra a 1 día sobre la obra #6, asignadas a un responsable activo, con el reloj congelado en un martes 10:00 AR (día y hora laborable), Twilio mockeado y **rollback al final** (no quedó nada en la base).

Resultado: **ambos recordatorios se dispararon**, y además se dispararon los de **tareas reales preexistentes** que vencían en esas ventanas (por ejemplo "Instalación eléctrica" de *Edificio Norte* para Carlos Méndez). Es la confirmación de que el arreglo no solo destraba el caso de prueba: destraba los recordatorios reales que hoy no salían.

Antes del arreglo, ese mismo ensayo daba **0 mensajes**.

### 5.2 Envío real por el sandbox de Twilio — PENDIENTE

**No se ejecutó**, y es la única parte del pedido que queda abierta. Motivo: hace falta un número de WhatsApp real que esté unido al sandbox de Twilio, y los responsables cargados en la base tienen números que parecen de relleno (`+5493516000001`, `+5493516000003`). Mandar a un número equivocado sería escribirle a un desconocido, así que no se hizo por las suyas.

Para completarlo hace falta: un número unido al sandbox (mandarle `join <frase>` al `+1 415 523 8886` desde el teléfono), cargarlo en un `Responsible` activo, y correr el job apuntando a ese responsable. Con eso queda cerrado el punto 2 del pedido.

Lo que sí está verificado en vivo: el sandbox está configurado (`TWILIO_ACCOUNT_SID` presente, número `whatsapp:+14155238886`), y el envío real por esta misma vía ya fue confirmado en otra auditoría (`POST /settings/test-whatsapp`, SID `SMb1f8d98...` en la auditoría 11).

---

## 6. Tests agregados

`backend/tests/test_recordatorio_vencimiento.py` — **18 tests**. Twilio mockeado y reloj congelado en un martes 10:00 AR.

| Grupo | Casos |
|---|---|
| El caso que estaba roto | Tarea a 3 días dispara el recordatorio (sin `due_time`, que es el escenario real); tarea a 1 día dispara el suyo; el job de 3 días no toca una tarea que vence mañana |
| Qué no debe disparar | Tarea completada; cancelada; sin responsable; responsable inactivo |
| Configuración | `reminder_3days=false` no manda el de 3 días **y no afecta al de 1 día**; `reminder_1day=false` ídem; `auto_reminders=false` frena todo; `chatbot_enabled=false` frena todo |
| Horario | Fuera de horario no manda **pero la corrida siguiente sí** (no se pierde); domingo no manda; la franja se compara en hora argentina (regresión del bug 1) |
| Deduplicación | Dos corridas seguidas mandan un solo mensaje |
| Piezas reusables | `notify_responsible` manda y deja el registro con `task_id` NULL y su `notification_type`; `can_notify_obra` explica por qué dice que no |

**Se verificó que los tests atrapan el bug de verdad**: reintroduciendo la comparación en UTC, dos tests fallan (`test_fuera_de_horario_no_manda_pero_no_lo_pierde` y `test_la_franja_horaria_se_compara_en_hora_argentina`). Restaurado el arreglo, los 18 vuelven a pasar. Sin esa comprobación un test puede estar escrito de forma que pase igual y no proteja nada.

```
$ python -m pytest tests/test_recordatorio_vencimiento.py -q
18 passed

$ python -m pytest -q          # suite completa, sin regresiones
426 passed
```

---

## 7. Puntos abiertos

1. **El envío real por el sandbox** (§5.2) — falta un número unido al sandbox.
2. **Los dos recordatorios dicen exactamente lo mismo.** El de 3 días y el de 1 día son idénticos en el texto; el responsable no distingue si le queda una semana o si vence mañana. Cambiarlo es tocar `ConversationService.seed_for_task()` para que reciba la urgencia. No se hizo porque excede "arreglar el envío", pero es una mejora barata y visible.
3. **La configuración es por tenant, no por obra** (§3) — señalado en la auditoría 11, sin cambios acá.
4. **Si el responsable no contesta**, `mark_no_response()` levanta una alerta pasadas `max_response_hours`. Ese camino no se auditó en esta pasada.
