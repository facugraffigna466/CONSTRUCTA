# Resumen semanal para quien maneja obras (arquitecto / administrador)

> WhatsApp de los lunes a la mañana con la foto de sus obras, redactado por IA sobre números calculados por código. **Los responsables no lo reciben**: el suyo es [otro](digest-semanal-responsables.md).

---

## 1. Por qué es un mensaje distinto

Al responsable le importa *"mis tareas de esta semana"*. A quien maneja la obra le importa *"cómo vienen mis obras"* — qué está trabado, qué se atrasó y dónde meter mano primero. Es otro contenido, no el mismo con otro destinatario.

| | Resumen de staff | Resumen de responsables |
|---|---|---|
| Destinatario | El `manager_id` de cada obra | Cada `Responsible` activo |
| Contenido | Estado de sus obras + qué priorizar | Sus tareas de la semana |
| Alcance | Todas sus obras en un solo mensaje | Sus tareas, sin distinguir obra |
| Redacción | IA sobre números calculados | Plantilla de código |

---

## 2. A quién le llega

**Al `manager_id` de cada obra activa**, y solo si tiene `whatsapp_number` cargado. Cada persona recibe **un único mensaje** con todas las obras que maneja.

Decisiones tomadas y sus tests:

- **No le llega a todo el que tenga rol admin** — solo a quien efectivamente maneja obras (`test_un_admin_que_no_maneja_obras_no_recibe`).
- **No le llega a los responsables** (`test_el_responsable_no_recibe_este_mensaje`). Son tablas distintas: `User` vs `Responsible`, así que no puede pasar ni por error.
- Una obra sin nada para reportar no se menciona; si ninguna tiene nada, no sale mensaje.

---

## 3. Qué mira, y quién calcula qué

**Los números los calcula el código.** Por cada obra activa del manager:

| Dato | Cómo se cuenta |
|---|---|
| Trabadas | tareas en estado `bloqueada` |
| Vencidas | `due_date` anterior a hoy **y no bloqueadas** — una tarea trabada que además venció cuenta en un solo lado, si no se infla el número |
| Vencen esta semana | `due_date` entre hoy y el domingo |
| Alertas sin resolver | alertas de la obra con `is_read = false` |
| Cuello de botella | entre las trabadas y vencidas, la que **más tareas dependientes frena** (por la tabla de dependencias). Una tarea atrasada que bloquea a tres importa mucho más que una aislada con el mismo atraso |

**La IA solo redacta.** Recibe ese resumen ya computado —nunca la base— y escribe el WhatsApp. Es la misma regla del motor de insights, y acá pesa todavía más: esto sale al teléfono de alguien sin que nadie lo revise antes.

Después de que responde, **cada número de su texto se valida** contra los datos que se le dieron. Si cita una cifra que no existe, el texto se descarta.

---

## 4. Si la IA falla, el mensaje sale igual

Hay una versión armada por código que se usa cuando:

- no hay `ANTHROPIC_API_KEY`;
- la llamada al modelo falla o corta;
- el texto supera los 900 caracteres (es un WhatsApp, no un informe);
- **el texto cita un número inventado**.

Un lunes sin mensaje es peor que un mensaje sin adornos. Los cuatro casos tienen test; el de la alucinación simula una IA que dice *"47 tareas trabadas"* y verifica que ese texto **no salga** y que en su lugar vaya el de código.

---

## 5. Cuándo sale

```python
CronTrigger(day_of_week="mon", hour="6-12", minute=20)
```

Cada hora los lunes, no una sola vez a las 8 — mismo criterio que los otros envíos: la ventana horaria es configurable por tenant, y un job atado a las 8 en punto nunca llegaría a una empresa que arranca a las 9. Envía en la primera corrida dentro de la ventana y marca `users.last_weekly_digest_at` (migración `0067`) para no repetir.

Corre a `minute=20`, diez minutos después del de responsables, para no disparar todo junto.

Lo frena: `chatbot_enabled = false`, estar fuera de la ventana horaria, no tener número cargado, el usuario inactivo, o que el de esta semana ya haya salido.

---

## 6. Ejemplo real

Enviado de verdad por Twilio al número del administrador, con las 4 obras reales de la base (una queda afuera por no tener tareas):

```
👋 ¡Buen lunes, Facundo!

⏰ Edificio Norte (Córdoba Centro): 1 tarea vencida, 3 alertas abiertas.
La estructura de hormigón armado venció el 30/08 y frena 1 tarea.

⏰ Vivienda Unifamiliar (Barrio Jardín): 4 vencidas, 2 vencen esta semana,
7 alertas. La mampostería (pendiente, venció el 30/08) frena 4 tareas.

⏰ Local Comercial (Nueva Córdoba): 6 vencidas, 12 alertas. Obra civil y
tabiques parada desde el 16/08, frena 3 tareas.

🔑 Arrancá por el Local Comercial: es la que más tareas vencidas acumula y
el cuello de botella lleva más tiempo sin moverse.
```

La última línea es lo que justifica usar IA acá: cruzó las tres obras y **priorizó**. Eso no sale de una plantilla.

Para comparar, así queda el mismo caso con el texto de respaldo (sin IA):

```
👋 ¡Buen lunes, Facundo!

Edificio Norte — Córdoba Centro: ⏰ 1 vencida/s
Vivienda Unifamiliar — Barrio Jardín: ⏰ 4 vencida/s · 📅 2 vence/n esta semana
Local Comercial — Nueva Córdoba: ⏰ 6 vencida/s

Lo más urgente: «Mampostería» frena 4 tarea/s.
```

Sirve, pero es una lista. Con IA es un consejo.

---

## 7. Prueba en vivo

Ejecutado contra la base real con Twilio real: **1 resumen enviado** al `+549351…877`, SID `SM8f4b86fe0d3d9400…`, con las 3 obras que tenían algo para reportar. El mensaje de §6 es el texto exacto que llegó.

Lo único simulado fue **el reloj**: la corrida se hizo a las 21hs, fuera de la ventana de envío, así que se fijó una hora hábil para que el chequeo pasara. El mensaje, el destinatario, la llamada a la IA y el envío por Twilio fueron reales.

Para probarlo:

```bash
python -c "import asyncio; from app.services.staff_digest_service import run_staff_weekly_digest; \
           print(asyncio.run(run_staff_weekly_digest()))"
```

Devuelve 0 si ya salió el de esta semana o si es fuera de la ventana horaria — ambas cosas son el comportamiento correcto, no un fallo.

---

## 8. Qué se reusó

| Pieza | De dónde |
|---|---|
| `is_within_send_window()` | Del arreglo de recordatorios, con la corrección de zona horaria ya incorporada |
| `collect_numbers` / `_numbers_in_text` / `_number_is_supported` | De la validación anti-alucinación del motor de insights |
| El patrón de job horario los lunes + marca de "ya salió" | Del resumen de responsables |

Nuevo: `NotificationService.notify_staff()`, gemelo de `notify_responsible` pero para `User`. Va aparte porque `messages.responsible_id` no puede apuntar a un usuario — el saliente se guarda con `responsible_id = NULL` y el `user_id` queda en el JSON de `ai_interpretation` para poder rastrearlo. **Es una limitación conocida del modelo de mensajes**: si en el futuro hay más comunicaciones hacia staff, conviene agregarle un `user_id` propio a `messages`.

---

## 9. Tests

`backend/tests/test_digest_staff.py` — **18 tests**.

| Grupo | Casos |
|---|---|
| Destinatarios | El manager recibe; el responsable no; un admin sin obras no; sin número no; varias obras van en un solo mensaje |
| Contenido | Sin nada que reportar no manda; una obra completada no entra; cuenta bien trabadas/vencidas/de la semana; una trabada no se cuenta además como vencida; marca el cuello de botella |
| Configuración | `chatbot_enabled=false` no manda; fuera de la ventana espera a la corrida siguiente; no repite en la misma semana |
| IA | Usa su texto cuando es válido; **descarta un número inventado**; si explota igual manda; un texto larguísimo se descarta; sin API key usa el de código |

```
$ python -m pytest tests/test_digest_staff.py -q
18 passed

$ python -m pytest -q          # suite completa
464 passed
```

---

## 10. Puntos abiertos

1. **Si el mismo número está cargado como `Responsible` y como `User`**, al responder por WhatsApp gana el responsable (`is_staff = responsible is None and staff is not None`). Para los envíos no importa, pero una persona que sea las dos cosas no puede usar el flujo de staff del bot. Apareció al preparar esta prueba.
2. **`messages` no puede atribuir un saliente a un `User`** (§8).
3. **No hay forma de darse de baja** de este mensaje sin apagar el chatbot de todo el tenant.
4. **El costo de IA crece con la cantidad de managers**: una llamada por persona, por semana. Con pocos tenants es despreciable; conviene mirarlo si escala.
