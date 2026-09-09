# Implementación — El responsable informa por qué, no solo qué

**Fecha:** 2026-09-09
**Rama:** `feature/sugerencias-primera-clase`
**Migraciones:** `0073`

---

## 1. El problema

CONSTRUCTA tiene dos canales de WhatsApp con forma deliberadamente distinta, y esa asimetría es una decisión de producto, no una carencia:

- **El jefe de obra** manda **notas de voz**. Está caminando la obra, tiene contexto de todo y va a sentarse después a ordenar: voz libre, sin estructura, IA que le pre-digiere el material.
- **El responsable** usa un **menú numérico**. Está trabajando, con una mano libre: cero ambigüedad, nada que interpretar, un tap.

El canal del responsable cumplía la mitad de lo que promete. Sabía registrar **qué** pasó —"la tarea quedó bloqueada"— y nunca **por qué**. El motivo se guardaba como la cadena fija `"Demorada vía WhatsApp"`, y la alerta que le llegaba al jefe decía:

> *La tarea 'Hormigonado losa 3' fue bloqueada.*

Con eso, el jefe tenía que **levantar el teléfono** para averiguar si faltaba material, faltaba gente o había llovido. Que es exactamente la comunicación informal que el producto existe para eliminar. Y es el dato que decide la acción: si falta material se compra, si falta personal se reasigna, si es clima se reprograma.

## 2. La solución, dentro del mismo modelo

No hace falta texto libre ni IA para capturar la causa. Alcanza con **una pregunta numerada más**, que es el lenguaje que el responsable ya usa:

```
✅ Listo Martín, «Hormigonado losa 3» quedó bloqueada.

¿Por qué?

1️⃣ Falta material
2️⃣ Falta personal
3️⃣ Clima
4️⃣ Espera otra tarea
5️⃣ Otro motivo

Escribí el número. Si preferís no aclarar, escribí X.
```

## 3. La decisión de diseño: primero se bloquea, después se pregunta

La alternativa era pedir el motivo **antes** de aplicar el bloqueo, y así la alerta nacería ya con la causa. Se descartó: si la persona abandona la conversación —se le acaba la batería, lo llaman, se distrae— el reporte de campo se pierde entero. Eso contradice la promesa central del sistema, que es que lo que pasa en obra llegue al plan.

Así que el orden es: **bloquear, avisar, y después enriquecer.**

1. El bloqueo se aplica y la alerta sale, como siempre.
2. Se pregunta el motivo.
3. Cuando llega, se escribe en el historial de la obra **y se suma al mensaje de la alerta abierta**, para que el jefe lo vea donde ya estaba mirando: *"La tarea 'Hormigonado losa 3' fue bloqueada: falta material."*

`AlertRepository.append_reason_to_open_alert` es idempotente: si el motivo ya está en el mensaje, no lo repite. Y si el jefe ya marcó la alerta como leída, devuelve `False` sin romper nada — el historial sigue teniendo el registro.

**"X" no cancela.** En este paso la tarea ya está bloqueada, así que el mensaje genérico de cancelación ("Conversación cancelada") daría a entender que el reporte no se registró, que es lo contrario de lo que pasó. Por eso el paso se enruta **antes** del cancel global y responde con su propio mensaje: *"«X» queda bloqueada sin motivo cargado."*

## 4. Cambios

- **Migración 0073** — valor `await_block_reason` en el enum nativo `conversation_step`. Se usa `ALTER TYPE ... ADD VALUE` con `COMMIT` explícito (no corre dentro de transacción en PostgreSQL < 12). El `downgrade` no lo quita: PostgreSQL no lo permite, y reconstruir el tipo para revertir un paso de conversación efímero cuesta más de lo que vale.
- `BLOCK_REASONS` y tres plantillas nuevas en `message_templates.py`.
- `ConversationService._handle_block_reason` y el cambio en `_apply_demorada`.
- `AlertRepository.append_reason_to_open_alert`.

## 5. El otro arreglo: el audio del responsable ya no es un callejón

Si un responsable mandaba una nota de voz —y lo van a hacer— la respuesta era:

> *La bitácora por audio es solo para el equipo administrativo. Si necesitás dejar constancia de una novedad, avisale a tu jefe de obra.*

El gate está bien y no se tocó: la bitácora es la libreta del jefe. Pero mandarlo con su jefe lo deja sin salida y pierde el reporte. Ahora la misma respuesta trae **el menú que sí puede usar**, así que el intento equivocado termina en un reporte estructurado en vez de en nada.

## 6. Pruebas

Siete pruebas nuevas en `test_motivo_bloqueo.py`, sobre lo que define el diseño:

- Bloquear pregunta el motivo y deja la conversación en el paso correcto.
- **El bloqueo se aplica antes de preguntar** — la garantía de que el reporte no se pierde.
- El motivo llega al historial *y* a la alerta.
- Saltear con "X" deja el bloqueo hecho y **no** dice "cancelada".
- Una respuesta inválida vuelve a preguntar sin perder el paso.
- El motivo no se duplica en el mensaje de la alerta.
- El audio de un responsable devuelve el menú.

Dos pruebas existentes de `test_whatsapp_identity_permissions.py` se ajustaron: verificaban la frase exacta del rechazo; ahora verifican el comportamiento (el gate sigue vigente, y la respuesta ya no es un callejón).

**Suite completa: 559 pruebas en verde** una vez fusionado con `main` (que sumó en paralelo el fix de aislamiento de proveedores). Migración 0073 probada de ida y de vuelta contra PostgreSQL.
