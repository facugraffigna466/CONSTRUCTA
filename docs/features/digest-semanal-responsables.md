# Resumen semanal por WhatsApp a los responsables

> Mensaje operativo que sale los **lunes a la mañana** a cada responsable activo con la foto de su semana. No usa IA: es una consulta directa al estado actual de sus tareas.

---

## 1. Qué es y qué no es

Es la **foto completa de la semana** de una persona: qué tiene que hacer, qué quedó colgado y qué ya arrancó. Distinto del [recordatorio de vencimiento](recordatorio-vencimiento.md), que es el aviso puntual de **una** tarea que vence en 1 o 3 días.

| | Resumen semanal | Recordatorio de vencimiento |
|---|---|---|
| Cuándo | Lunes a la mañana | 3 días y 1 día antes de cada vencimiento |
| Alcance | Todas las tareas relevantes de la persona | Una tarea puntual |
| Forma | Lista agrupada por urgencia | Ficha de la tarea + menú numerado de estados |
| Espera respuesta | No | Sí — deja la sesión del bot en `STATUS_MENU` |
| Cierre | "Cualquier cosa, escribime." | "Escribí el número." |

---

## 2. Qué tareas entran en el mensaje de cada persona

Se parte de las tareas **activas** asignadas a ese responsable (las `completada` y `cancelada` quedan afuera por definición) y se reparten en tres grupos. **Una tarea cae en un solo grupo**: sin eso, una tarea bloqueada que además vence el jueves aparecería dos veces en el mismo mensaje.

| Grupo | Criterio | Por qué |
|---|---|---|
| 🔴 **Necesita atención** | Está `bloqueada`, **o** su vencimiento ya pasó | Es lo que frena la obra. Va primero, sin importar la fecha |
| 📅 **Esta semana** | Vence entre el lunes y el domingo de la semana en curso | El plan de los próximos días |
| 🔧 **También en curso** | Está `en_progreso` y vence más adelante | Para que no se le escape algo que ya arrancó |

Dentro de cada grupo se ordena por fecha de vencimiento (lo que vence antes, arriba); las que no tienen fecha van al final.

**Si los tres grupos quedan vacíos, no se manda nada.** Un "esta semana no tenés nada" repetido cada lunes entrena a la persona a ignorar al bot, y después no lee el mensaje que sí importa.

Casos que quedan afuera a propósito:
- Una tarea `pendiente` sin fecha y sin arrancar: no es de esta semana ni está trabada.
- Una tarea que vence la semana que viene y todavía no arrancó: le va a llegar en el resumen del lunes siguiente, y además va a recibir el recordatorio de 3 días.

---

## 3. Cuándo sale

Job en el APScheduler que ya usa el sistema — no se agregó ningún scheduler nuevo:

```python
CronTrigger(day_of_week="mon", hour="6-12", minute=10)
```

**Corre cada hora los lunes entre las 6 y las 12, no una sola vez a las 8.** Es deliberado: la ventana horaria de envío es configurable por tenant (`send_hour_from`/`send_hour_to`), así que una empresa que arranca a las 9 nunca recibiría un envío agendado a las 8 en punto. El servicio manda en la primera corrida que caiga dentro de la ventana de cada tenant, y marca `Responsible.last_weekly_digest_at` para no repetir.

Esta decisión sale directo del bug que documenta [`recordatorio-vencimiento.md`](recordatorio-vencimiento.md): ahí un envío atado a un instante exacto caía fuera del horario laboral y **se perdía para siempre**. Acá se evitó el mismo patrón desde el arranque.

---

## 4. Qué lo frena

Los mismos chequeos que el resto de las comunicaciones automáticas, resueltos por **tenant** (un responsable puede estar en varias obras, pero la configuración es del tenant — ver `SettingsRepository.get_for_responsible`):

| Chequeo | Efecto |
|---|---|
| `chatbot_enabled = false` | No le llega nada |
| `auto_reminders = false` | Tampoco |
| Fuera de `[send_hour_from, send_hour_to)` | Espera a la corrida siguiente del mismo lunes |
| `Responsible.is_active = false` | Queda afuera |
| Sin `whatsapp_number` | Queda afuera |
| Ya salió el de esta semana | No se repite |

Sobre `auto_reminders`: el pedido mencionaba `chatbot_enabled` y la ventana horaria. Se sumó igual porque en la pantalla ese interruptor se lee como "recordatorios automáticos", y mandarle un WhatsApp automático semanal a alguien que los apagó sería contradecir lo que configuró. **Es una decisión de criterio, fácil de revertir** si se prefiere que el resumen sea independiente.

---

## 5. Cómo se evita duplicar contenido con el recordatorio individual

Si un lunes coinciden los dos (una tarea que vence el martes dispara el recordatorio de 1 día, y esa misma tarea aparece en el resumen), la persona recibe **dos mensajes con forma y propósito distintos**, no el mismo texto dos veces:

- El **recordatorio** abre con `CONSTRUCTA 🏗️`, muestra la ficha de la tarea (obra, fecha, estado actual) y despliega el menú numerado `1️⃣ En progreso / 2️⃣ Completada / …`, dejando la sesión del bot esperando una respuesta.
- El **resumen** abre con `👋 ¡Buen lunes, {nombre}!`, lista varias tareas en viñetas sin ficha ni menú, y **no toca la sesión de conversación**.

Hay un test que lo fija (`test_el_texto_no_se_pisa_con_el_recordatorio_individual`): compara los dos mensajes generados para la misma tarea y verifica que el menú numerado esté solo en el recordatorio y el saludo del lunes solo en el resumen.

El resumen no abre sesión a propósito: si la abriera, un "1" de respuesta se interpretaría como "poner en progreso" **la primera tarea de una lista de cinco**, sin que la persona sepa cuál. Al no abrirla, si contesta algo el bot arranca su flujo normal y le pregunta de qué tarea habla.

---

## 6. Ejemplo real

Generado corriendo el job contra la base real, con el reloj en el lunes 07/09/2026 a las 09:00 AR y el envío mockeado (con `rollback`, sin marcar nada como enviado). Salieron **3 resúmenes**:

```
👋 ¡Buen lunes, Carlos Méndez!

🔴 Necesita atención:
• Obra civil y tabiques — venció el 16/08
• Vidriera y frente — venció el 20/08
• Estructura y losa — venció el 22/08
• Instalaciones sanitarias — venció el 27/08
• Estructura de hormigón armado — venció el 30/08

📅 Esta semana:
• Instalación eléctrica — vence 09/09

Cualquier cosa, escribime.
```

```
👋 ¡Buen lunes, Ana López!

🔴 Necesita atención:
• Revestimientos y pisos — venció el 21/08
• Cubierta y techo — venció el 05/09
• Revoques y terminaciones — venció el 06/09

📅 Esta semana:
• Instalación sanitaria — vence 09/09

Cualquier cosa, escribime.
```

Se ve el orden funcionando: lo vencido arriba, ordenado de lo más viejo a lo más reciente, y después lo de la semana.

**Observación sobre los datos, no sobre el código:** en las tres personas la sección de vencidas es más larga que la de la semana. Con datos reales el resumen del lunes hoy se lee como una lista de deuda acumulada más que como un plan. No es un defecto del mensaje —refleja el estado de las obras de prueba—, pero si en producción pasara lo mismo convendría limitar cuántas vencidas se listan (por ejemplo las 3 más viejas y un "y N más") para que la sección de la semana no quede sepultada.

---

## 7. Prueba en vivo con el sandbox de Twilio — PENDIENTE

**No se ejecutó**, por el mismo motivo que quedó abierto en `recordatorio-vencimiento.md` §5.2: hace falta un número de WhatsApp real unido al sandbox, y los responsables cargados tienen números de relleno (`+5493516000001`, `+5493516000003`). Mandar a un número equivocado sería escribirle a un desconocido.

Para cerrarlo: unir un teléfono al sandbox (`join <frase>` al `+1 415 523 8886`), cargarlo en un `Responsible` activo con tareas de esta semana, y correr:

```python
await NotificationService(db).send_weekly_digest()
```

Lo que sí está verificado: el mensaje se arma correctamente con datos reales (§6), el envío pasa por `notify_responsible()` —el mismo camino que ya mandó WhatsApps reales por Twilio en el flujo de recordatorios— y queda registrado en `messages` con `notification_type="weekly_digest"`.

---

## 8. Qué se reusó

No se duplicó nada del envío. Del trabajo de `recordatorio-vencimiento.md`:

| Pieza | Para qué |
|---|---|
| `NotificationService.notify_responsible()` | Manda por Twilio y persiste el saliente. Funciona sin tarea asociada, que es justo lo que necesita un resumen de varias tareas |
| `is_within_send_window()` | Ventana horaria en hora argentina, con el arreglo de zona horaria ya incorporado |
| `SettingsRepository.get_for_responsible()` | Resuelve la configuración por tenant |
| `TaskRepository.list_by_responsible()` | Tareas activas de la persona, ya sin completadas ni canceladas |

Lo único nuevo del lado del envío es `Responsible.last_weekly_digest_at` (migración `0066`), necesario porque el job corre varias veces el mismo lunes.

---

## 9. Tests

`backend/tests/test_digest_semanal.py` — **18 tests**.

| Grupo | Casos |
|---|---|
| Caso principal | Recibe el resumen con las tareas correctas; sin tareas relevantes no recibe nada; una tarea de otra semana no entra; completadas y canceladas afuera; la tarea de otro responsable no se mezcla |
| Orden | Lo vencido y bloqueado va primero; una bloqueada que además vence esta semana aparece **una sola vez**; lo `en_progreso` que vence más adelante igual aparece; una pendiente sin fecha no ensucia |
| Configuración | `chatbot_enabled=false` no recibe; `auto_reminders=false` tampoco; responsable inactivo tampoco; fuera de la ventana horaria espera a la corrida siguiente |
| No repetir | Dos corridas el mismo lunes mandan un solo mensaje; la semana siguiente vuelve a mandar |
| Contra el recordatorio | Los dos textos no se pisan: el menú numerado solo en el recordatorio, el saludo del lunes solo en el resumen |
| Plantilla aislada | Omite las secciones vacías; distingue "está bloqueada" de "venció el …" |

```
$ python -m pytest tests/test_digest_semanal.py -q
18 passed

$ python -m pytest -q          # suite completa
446 passed
```

---

## 10. Puntos abiertos

1. **La prueba en vivo por el sandbox** (§7).
2. **Cuántas vencidas listar** (§6): hoy se listan todas. Con obras muy atrasadas la sección tapa el resto del mensaje.
3. **El resumen no distingue obras.** Si alguien trabaja en tres obras, ve una sola lista mezclada. Agrupar por obra sería más claro para ese caso, y ruido para quien está en una sola.
4. **No hay forma de que el responsable se dé de baja** de este mensaje desde WhatsApp. Hoy solo se apaga desde la configuración del tenant, y afecta a todos.
