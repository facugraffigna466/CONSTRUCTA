# Implementación — Sugerencias de IA como funcionalidad de primera clase

**Fecha:** 2026-09-07
**Rama:** `feature/sugerencias-primera-clase`
**Base:** `main` (`57d3e10`)
**Insumo:** tarjeta «Agustín — Sugerencia asistida de tareas», fase *Interpretación de mensajes*
**Migraciones:** `0072`

---

## 1. Resumen ejecutivo

El módulo de bitácora ya sabía convertir una nota de voz en acciones concretas sobre el plan de obra: reprogramar una tarea, crear una nueva, cambiar un estado, dejar un acuerdo registrado. Lo que no sabía era **existir fuera de su propia pantalla**.

La causa no era de interfaz sino de modelo. Cada sugerencia era un objeto dentro de una columna JSON de la entrada de bitácora (`bitacora_entries.suggestions`) y se resolvía **por su posición en el arreglo**: `POST /bitacora/{id}/suggestions/{idx}/apply`. Sin identidad propia, una sugerencia no se puede consultar por tarea, no se puede contar en SQL, no se puede enlazar y no se puede resolver desde ninguna pantalla que no tenga la nota de origen a mano. El resultado práctico: el jefe de obra tenía que acordarse de que la Bitácora existía, entrar, encontrar la nota correcta y recién ahí decidir sobre un trabajo que estaba mirando en otra pantalla cinco segundos antes.

Este trabajo promueve la sugerencia a **entidad del dominio** —tabla propia, id estable, ciclo de vida propio— y la pone a trabajar donde importa: **dentro de la tarea que la sugerencia quiere modificar**.

El cambio de modelo no es un refactor cosmético: es lo que habilita todo lo demás. Con id estable, el contador de pendientes pasa de sumar objetos en memoria a ser un `COUNT`; la trazabilidad tarea → nota de voz pasa de filtrar blobs en Python a ser un join; y —lo más importante— cualquier pantalla futura que quiera mostrar propuestas de la IA ya no tiene que aprender nada sobre la bitácora.

**Estado:** implementado y verificado. 24 pruebas nuevas; la suite de backend queda en 545. Migración probada de ida y de vuelta contra PostgreSQL con datos reales del blob.

---

## 2. El problema, con precisión

Antes de este trabajo, una sugerencia era esto:

```json
{"type": "reschedule_task", "task_id": 7, "new_due_date": "2026-09-20",
 "reason": "se atrasa por lluvia", "applied": false, "dismissed": false}
```

…un objeto anónimo dentro de un arreglo JSON. Cuatro consecuencias concretas:

| Limitación | Dónde dolía |
|---|---|
| Sin id | La única forma de referirla era `(entry_id, índice)`. Un reanálisis reordenaba el arreglo y la referencia apuntaba a otra cosa. |
| No consultable | «¿Qué propuso la IA sobre esta tarea?» requería traer todas las entradas de la obra y filtrar en Python. |
| Contador en memoria | El badge del menú leía la columna JSON de cada entrada y sumaba objetos, en cada pedido. |
| Dos booleanos | `applied` y `dismissed` podían ser ambos verdaderos; nada lo impedía. Y no había registro de **quién** ni **cuándo** resolvió. |

Y una consecuencia de diseño más grande: la lógica de aplicar —que es la que efectivamente mueve fechas, crea tareas y corre dependientes en cascada— vivía en `BitacoraService`. Cualquier otra pantalla que quisiera aplicar una sugerencia tenía que pasar por el servicio de bitácora, o duplicar la lógica.

---

## 3. La tabla `suggestions` (migración 0072)

```
id, tenant_id, obra_id
source, source_entry_id, order_index      ← de dónde salió
type, task_id, task_title,                ← qué propone
  new_start_date, new_due_date, new_status,
  title, description, responsible_name, reason
status, result_task_id, result_note,      ← cómo se resolvió
  resolved_by, resolved_at
created_at
```

### 3.1 El origen es un atributo, no el dueño

`source` + `source_entry_id` describen de dónde salió la sugerencia. Hoy siempre es `"bitacora"`. Mañana puede ser un mensaje de texto de WhatsApp o un análisis de riesgo, y quien las consume —la tarea, un badge, una pantalla nueva— no se entera. Esa es la diferencia entre "las sugerencias de bitácora" y "las sugerencias".

### 3.2 `order_index` conserva el orden y la compatibilidad

Guarda la posición que la sugerencia tenía dentro de la nota. Sirve para dos cosas: mostrarlas en el orden en que la IA las propuso, y mantener vivas las rutas `/bitacora/{id}/suggestions/{idx}/...`, que ahora resuelven `(entry_id, order_index) → id` y delegan en el mismo servicio. Ninguna ruta se rompió.

### 3.3 Un estado, no dos booleanos

`status` es `pendiente | aplicada | descartada`. Los campos `applied` y `dismissed` que consumía la interfaz siguen existiendo en la respuesta de la API, derivados del estado — ninguna pantalla tuvo que aprender el enum, y el estado inconsistente dejó de ser representable.

Se sumó `resolved_by` / `resolved_at`: quién tomó la decisión y cuándo. El blob no lo guardaba.

### 3.4 `SET NULL`, no `CASCADE`, en las dos referencias a tareas

Si la tarea se borra, la sugerencia **no** desaparece: queda como registro de lo que se pidió. Por eso `task_title` guarda el título tal como lo vio la IA — la fila sigue siendo legible sin la tarea.

### 3.5 El backfill preserva lo que había y degrada lo roto

La migración lee cada blob y crea las filas equivalentes:

- `applied: true` → `aplicada`; `dismissed: true` → `descartada`; el resto, `pendiente`.
- Fechas que no parsean como ISO (la IA devolvía texto libre) quedan en NULL en vez de romper la migración.
- Tipos desconocidos —de una versión anterior del modelo, o dato corrupto— se registran como `note`, para no perder el texto del acuerdo.
- `resolved_by` queda en NULL a propósito: no existe el dato histórico y no se inventa.

Luego se elimina la columna JSON. No hay período de doble escritura: el backfill es total y la lectura pasa a la tabla en el mismo deploy.

El `downgrade` reconstruye el blob desde la tabla y vuelve a colgarlo de la entrada. Se probó el ciclo completo contra PostgreSQL con una entrada que incluía las tres situaciones (fecha inválida, tipo inventado, sugerencia ya aplicada): los tres casos sobreviven la ida y la vuelta.

---

## 4. `SuggestionService`: un solo dueño de la decisión

La lógica de aplicar se movió de `BitacoraService` a un servicio propio. La regla queda explícita: **la bitácora las genera; `SuggestionService` las resuelve.**

Lo que hace al aplicar no cambió —es la misma lógica probada, incluido el `cascade_dates=True` que corre las tareas dependientes, el match de responsable por nombre dentro del tenant, y el aviso de vuelta por WhatsApp a quien mandó la nota— pero ahora tiene un único punto de entrada, al que llegan tanto las rutas nuevas por id como las viejas por índice.

Se conservaron las tres guardas que dejó la auditoría 08 y se movieron con la lógica:

- **N2** — una sugerencia que quedó apuntando a una tarea de otra obra no se puede aplicar. El guard de la ruta valida el rol sobre la obra de la *sugerencia*, y `TaskService` solo valida tenant; sin este chequeo, alguien con acceso a una obra podría mutar una tarea de otra.
- **N5** — una fecha mal escrita en el ajuste del jefe da 422 con explicación, no un 500 opaco.
- **N6** — reprocesar una nota con sugerencias aplicadas se rechaza. Ahora, además, queda garantizado en el modelo: `_replace_pending_suggestions` reemplaza únicamente lo pendiente y **nunca borra lo ya decidido**, porque una sugerencia aplicada es el registro de un cambio real en la obra.

Se agregó una guarda nueva: **no se puede descartar algo ya aplicado**. Descartarlo no desharía el cambio en la obra — sería un botón que miente sobre lo que hace.

---

## 5. Rutas

| Método | Ruta | Para qué |
|---|---|---|
| GET | `/suggestions?obra_id=&status=` | Sugerencias de una obra |
| GET | `/suggestions/pending-count?obra_id=` | Contador para badges (`COUNT` real) |
| GET | `/tasks/{task_id}/suggestions?status=` | **Las que afectan a esta tarea** |
| POST | `/suggestions/{id}/apply` | Aplicar, con ajustes opcionales |
| POST | `/suggestions/{id}/dismiss` | Descartar |

`GET /tasks/{id}/suggestions` devuelve tanto las que quieren modificar la tarea (`task_id`) como las que la crearon al aplicarse (`result_task_id`): desde la tarea, las dos cosas son "lo que la IA propuso sobre esto".

Cada sugerencia viaja con su contexto de origen —`obra_name`, `entry_summary`, `reporter_name`— resuelto en dos consultas para toda la lista. **No es decoración.** Dentro de la bitácora ese contexto está en pantalla; dentro de una tarea no hay nada alrededor que diga de dónde salió la propuesta, y sin eso el jefe no tiene con qué decidir.

El permiso usa `require_suggestion_obra_role`, siguiendo el mismo patrón que los demás recursos indirectos: resuelve la obra dueña, valida tenant y rol, y trata una sugerencia de otra empresa como inexistente (404, no 403).

El endpoint viejo `/bitacora/pending-count` sigue existiendo como alias y hay una prueba que verifica que **cuenta exactamente lo mismo** que el nuevo: son la misma consulta, no dos fuentes de verdad.

### 5.1 El contador solo cuenta lo accionable

Una sugerencia sin obra —de una nota de WhatsApp que todavía no se asignó— no se puede aplicar. Antes contaba igual en el badge, prometiendo un pendiente que no se podía resolver desde ahí. Ahora se excluye.

---

## 6. Interfaz

### 6.1 La tarjeta salió de la pantalla de bitácora

`SuggestionCard` vivía dentro de `BitacoraPage`. Es ahora un componente propio que habla directo con la API por id y no sabe nada de la nota de origen. Cualquier pantalla que muestre una sugerencia la muestra —y la resuelve— igual: mismos tres botones, mismo editor por tipo, mismo colapso a una línea cuando ya está resuelta.

Se mantuvo el arreglo del hallazgo **N9**: el editor se resincroniza con la sugerencia cada vez que se abre, para que cancelar y volver a abrir no aplique valores viejos.

### 6.2 La sugerencia aparece dentro de la tarea

`TaskSuggestions` se monta en `TaskFormModal` en modo edición, arriba del bloque de origen que ya mostraba las notas de voz que habían modificado la tarea. La simetría es deliberada: **abajo, lo que ya pasó; arriba, lo que la IA propone que pase.**

Cada tarjeta va precedida de una línea de origen —«De la nota de voz de Martín — Se atrasa el hormigonado por lluvia»— que es el contexto del punto 5.

Si no hay sugerencias pendientes, el bloque no se renderiza. No hay estado vacío: una tarea sin propuestas es lo normal, no algo que haya que anunciar.

### 6.3 El marcador: sin esto, la funcionalidad no se encuentra

La primera versión puso la tarjeta dentro de la tarea y nada más. Al probarla con una obra real de 45 tareas apareció el agujero: **nada en la lista dice cuáles tienen una propuesta sin revisar**, así que había que abrirlas una por una. Una funcionalidad que solo se encuentra si ya sabías que estaba no está terminada.

`SuggestionMarker` es un distintivo naranja con el contador, y aparece junto al nombre de la tarea en las tres vistas donde se mira el plan: la tabla, la planilla y el Gantt. `ObraDetailPage` pide una sola vez por obra las sugerencias pendientes (`GET /suggestions?obra_id=&status=pendiente`), arma un `Map<taskId, cantidad>` y lo baja a las tres — un pedido, no uno por fila.

No es un botón, a propósito. Cada vista ya tiene su forma de abrir la tarea (el lápiz, el doble clic, la barra del Gantt); un objetivo clickeable más en la fila competiría con la edición en línea y con el arrastre del cronograma.

### 6.4 Aplicar desde la tarea cierra el formulario con la tarea fresca

Aplicar una reprogramación desde adentro del formulario abierto deja los campos del formulario desactualizados —y si la tarea tenía dependientes, también movió otras. En vez de dejar campos que ya no son los de la base, se vuelve a pedir la tarea al servidor y se cierra el modal con ella, lo que dispara la recarga de la obra entera.

Descartar, en cambio, no toca la obra: la tarjeta se colapsa y el formulario sigue abierto.

### 6.5 El badge se entera

El contador de pendientes del menú se refrescaba al cambiar de obra o al navegar. Desde que la sugerencia se puede resolver sin pasar por la Bitácora, eso ya no alcanza: resolver una desde una tarea dejaba el badge mintiendo. Se agregó un aviso explícito que sube desde `TaskSuggestions` hasta `App`, donde vive el contador. `ObraDetailPage` lo intercepta para recontar además sus propios marcadores: **aplicar** cierra el modal y dispara la recarga de la obra, pero **descartar** no —el formulario sigue abierto— y sin ese recuento los marcadores de la lista quedarían anunciando un pendiente que ya no existe.

---

## 7. Cambios de rendimiento (efecto lateral del modelo)

| Operación | Antes | Ahora |
|---|---|---|
| Contar pendientes de una obra | Traer las entradas de la obra y sumar objetos del blob en Python | `COUNT` con índice `(obra_id, status)` |
| Notas de voz que afectaron una tarea | Traer hasta 500 entradas y filtrar blobs | `SELECT` sobre `result_task_id` con índice |
| Sugerencias de una tarea | No existía | `SELECT` con índice `(task_id, status)` |

---

## 8. Pruebas

**12 pruebas nuevas** en `test_suggestions.py`, sobre lo que la promoción a tabla habilitó y antes no se podía probar:

- Listar las sugerencias de una tarea, con su contexto de origen.
- Filtrar por estado.
- Aplicar por id mueve la tarea de verdad; aplicar con ajustes usa el ajuste, no lo que propuso la IA.
- Aplicar dos veces es idempotente: el segundo intento no vuelve a mover la tarea aunque traiga otra fecha.
- Descartar registra quién; descartar algo aplicado se rechaza.
- El contador ignora resueltas y sin obra, y coincide con el endpoint viejo.
- Aislamiento: una sugerencia de otro tenant es 404; listar las de una obra ajena no pasa.
- Reprocesar conserva lo ya decidido y reemplaza solo lo pendiente.

Las pruebas existentes de `test_bitacora.py` se adaptaron al modelo nuevo y **siguen ejercitando las rutas por índice**: que los dos caminos terminen en el mismo servicio es parte de lo que se está probando.

Las fechas de prueba se calculan sobre días hábiles: el calendario de la obra corre al lunes cualquier fecha de fin de semana, y una fecha fija haría que la prueba pase o falle según el día en que se corra.

**Suite completa: 545 pruebas de backend en verde** (521 antes). Frontend: 49 pruebas en verde, `tsc` sin errores, ESLint sin hallazgos nuevos.

---

## 8.bis Un defecto encontrado al probar: la dirección del movimiento

Probando con datos reales apareció un error de interpretación del modelo, anterior a este trabajo. Ante la transcripción:

> *"la tarea que le sigue debemos mover la fecha dos días **para atrás** porque se retrasó el proveedor de los hierros"*

el análisis devolvía *"necesidad de **adelantar** la siguiente tarea dos días"* — la dirección opuesta. En esa nota no llegó a hacer daño porque terminó emitiendo una `note`; si hubiera emitido un `reschedule_task`, aplicarlo habría corrido la fecha para el lado equivocado.

**La causa raíz no es la ambigüedad del castellano rioplatense, sino que el prompt no daba ninguna regla para resolverla.** "Correr para atrás", "para adelante" y "patear" se usan de forma contradictoria según quién habla, y pedirle al modelo que las interprete literalmente es pedirle que adivine. Lo que sí es inequívoco es **la causa**: si el motivo es una demora —lluvia, material que no llegó, proveedor atrasado—, la fecha solo puede irse más tarde. Nunca más temprano.

Se agregaron tres reglas al prompt de `_analyze`:

1. **La dirección la fija la causa, no el verbo.** Una causa de demora mueve la fecha más tarde; una fecha anterior solo se propone si el audio dice explícitamente que algo se liberó o se terminó antes. Si la dirección no queda clara, `note` en vez de `reschedule_task`.
2. **El resumen y los puntos clave no usan los verbos ambiguos.** Describen el efecto sobre el cronograma ("se corre dos días más tarde", "pasa del X al Y") para que el texto no contradiga a la sugerencia — que era exactamente lo que pasaba.
3. **No proponer cambios que no cambian nada.** Marcar "completada" una tarea ya completada, o reprogramar una tarea completada o cancelada, ahora quedan como `note`.

**Verificado contra el modelo real**, con tres casos:

| Entrada | Antes | Ahora |
|---|---|---|
| "para atrás" + proveedor atrasado | "adelantar dos días" | "reprogramar dos días **más tarde**" |
| "para adelante" + material que no llegó | — | fecha **posterior** (07-06 → 07-08); el resumen dice "más tarde" |
| "adelantar" + frente liberado antes | — | fecha **anterior** (08-03 → 07-27) — la regla no sobrecorrige |

Sobre la transcripción original, el análisis ahora no inventa: deja dos notas explicando que la tarea 37 ya figura completada y que *"la tarea que le sigue"* no identifica ninguna tarea concreta. Prefiere pedir precisión antes que adivinar un `task_id`.

### La aritmética de días: sacarle la cuenta al modelo

La misma tanda de pruebas dejó ver un segundo problema: **"dos días" sobre un viernes daba tres días laborales después**. La causa es la misma de fondo — *el modelo estaba haciendo aritmética de calendario*, que es justamente lo que un modelo de lenguaje no hace bien: contar días hábiles salteando fines de semana y feriados es una operación determinística sobre datos que además el modelo no tiene (los feriados propios de la obra viven en la base, no en el prompt).

La corrección no fue enseñarle a contar, fue **sacarle la cuenta**. El esquema de análisis ahora acepta que la sugerencia exprese la *intención* en vez del resultado:

- `shift_working_days` — el corrimiento en días laborales, con signo.
- `shift_target` — qué fecha corre: `start`, `due` o `both`.

El modelo devuelve una fecha concreta **solo cuando el audio nombra una** ("el 20 de julio"). Para todo lo relativo devuelve el corrimiento, y `BitacoraService._resolve_dates` lo convierte en fecha con `calendar_service.add_working_days` contra el calendario real de la obra —feriados nacionales y excepciones propias incluidos— antes de guardar la fila. La tarjeta muestra la fecha concreta desde el primer momento: la persona ve lo que va a pasar, no una promesa relativa.

**El signo también lo fija la causa.** La primera versión de la regla no alcanzó: ante *"se nos van una semana para atrás, no llegó el hierro"* el modelo devolvió `-5` — leyó el "para atrás" literal y volvió a errar la dirección, ahora en el signo del campo nuevo. Hubo que decirlo explícitamente sobre `shift_working_days`, no solo sobre la fecha. Con la regla ajustada:

| Entrada | Resultado |
|---|---|
| "se atrasa dos días, no llegó el material" | `shift=+2`, sin fecha |
| "se nos van una semana para atrás, no llegó el hierro" | `shift=+5` — la causa gana sobre el "para atrás" |
| "podemos arrancar tres días antes, se liberó el frente" | `shift=-3` sobre `start` — no sobrecorrige |
| "lo movemos al 20 de julio" | sin shift, fecha `2026-07-20` |

Y ahora la cuenta **se puede probar**, que antes era imposible porque vivía dentro de una llamada al modelo: `tests/test_calendar_working_days.py` cubre el salto de fin de semana, el sentido inverso, los feriados propios de la obra y el caso que más sorprende — que el calendario por defecto de una obra incluye el **sábado**, así que "dos días" desde un viernes es el lunes y no el martes. El resultado depende del calendario, no del almanaque.

Lo que no cambia: la sugerencia sigue sin aplicarse sola, y "Editar" sigue estando. Que la cuenta ahora sea correcta no la convierte en una decisión del sistema.

### Qué fechas se tocan: solo las que el audio nombra

Aplicar una sugerencia que solo movía el vencimiento **le borraba a la tarea la fecha de inicio**. El defecto venía de `main` y se arrastró al mover la lógica: `TaskService.update` usa `exclude_unset`, así que construir `TaskUpdate(start_date=None, due_date=X)` no dice "dejá el inicio como está" sino "borralo" — la fecha viajaba explícitamente puesta en `None`.

La regla, que salió del uso real, es la que uno esperaría:

> Si el audio habla de correr la tarea, se mueven inicio y fin. Si nombra una sola fecha, se mueve esa; **la otra queda como estaba.**

Se corrigió en los dos extremos:

- **Al aplicar** (`SuggestionService.apply`): se arma el `TaskUpdate` solo con los campos que la sugerencia realmente trae. Una sugerencia sin ninguna fecha ahora se rechaza en vez de marcarse aplicada sin haber hecho nada.
- **Al generar** (el prompt): `shift_target` pasó de ser un enum sin criterio a tener una regla explícita — lo que decide es *qué punta nombra el audio*. `both` es el caso por defecto (la tarea se corre entera y conserva su duración); `start` y `due` solo cuando se nombra el arranque o la entrega, y ahí la otra fecha no se toca. Se le agregó el matiz de que usar `due` sola afirma que la tarea **dura más**, que es distinto de que se atrase.

Calibrar eso llevó tres iteraciones: al reforzar un caso el modelo desatendía otro (`both` se iba a `due`, después `start` se iba a `both`). Quedó estable en los cuatro escenarios de prueba, con `both` repetido tres veces para descartar variabilidad.

Las cuatro pruebas nuevas se verificaron **revirtiendo el arreglo**: tres fallan con el código anterior y las cuatro pasan con el actual. Una prueba que no se vio fallar no prueba nada.

---

## 8.ter Batería de casos contra el modelo real

Se ejercitaron 16 transcripciones contra la obra de prueba, con las tareas y el calendario reales. El calendario de esa obra es lunes a viernes, y las fechas concretas salen del backend, no del modelo.

| # | Entrada | Salida |
|---|---|---|
| 1 | "el revoque se atrasa dos días, no llegó el material" | `reschedule +2 both` → fin 20/07 (lun) → **22/07** (mié) |
| 2 | "los pilotes se nos van una semana **para atrás**, no llegó el hierro" | `+5 both` → inicio 03/08 → 10/08; fin 10/08 → **18/08** (saltea el feriado del 17) |
| 3 | "los podemos arrancar tres días antes, se liberó el frente" | `-3 start` → inicio 03/08 → **29/07**; el fin no se toca |
| 4 | "arranca cuando estaba previsto pero lo entregamos dos días más tarde" | `+2 due` → el inicio no se toca |
| 5 | "lo movemos al 20 de julio" | sin shift, fin **2026-07-20** |
| 6 | "los pilotes quedaron bloqueados" (ya estaban bloqueados) | `note` — no propone un cambio que no cambia nada |
| 7 | "arrancamos pintura de fachada, la hace Juan Perez" | `create_task` con responsable e inicio |
| 8 | "la tarea prueba ya está terminada" | `update_status → completada` |
| 9 | "la tarea que le sigue al revoque hay que correrla" | `note` — no inventa un `task_id` |
| 10 | "pasé por la obra, estaba todo tranquilo" | sin sugerencias |
| 11 | "lo vamos a terminar el sábado 19 de diciembre" | fin **18/12 (viernes)** — el sábado no es laboral en esa obra |
| 12 | tres cosas en un mismo audio | las tres separadas: reschedule + note + create_task |
| 13 | "confirmamos la entrega para el 15 de diciembre, **no se mueve**" | sin sugerencias |
| 14 | "se atrasa dos días… no, pará, se adelanta, se resolvió lo del material" | `-2 both` — toma la corrección, no la primera frase |
| 15 | "hay que **correr** la tarea de ascensores" (no existe) | `note` |
| 16 | "hay que **sumar** una tarea de ascensores" (no existe) | `create_task` |

Dos aprendizajes de la corrida:

**El caso 2 justifica todo el rediseño.** El fin cae en 18/08 y no en 17/08 porque el 17 de agosto es feriado nacional, y la duración en días hábiles de la tarea se conserva. Esa cuenta el modelo no podía hacerla: los feriados no están en el prompt, están en la base.

**Los casos 15 y 16 corrigieron una regla mal escrita.** El prompt decía "si una tarea mencionada no matchea ninguna de la lista, usá create_task". El modelo, ante "hay que *correr* la tarea de ascensores", devolvió una nota en vez de crear la tarea — hizo lo correcto contra lo que el prompt le pedía. La regla valía para un trabajo nuevo, no para una tarea que el audio da por existente: pedir que se corra algo y que el sistema lo cree es inventar. Se separaron las dos ramas explícitamente.

### Un botón que prometía de más

Aplicar una sugerencia de tipo `note` no toca el plan: escribe un evento en el historial de la obra y le confirma por WhatsApp a quien mandó el audio. Llamar a eso **"Aplicar"** promete un cambio en la obra que no va a ocurrir. Para las notas el botón dice ahora **"Registrar"**, y el estado resuelto, "registrada".

---

## 9. Lo que no se hizo, y por qué

**No se extendió la IA a los mensajes de texto de WhatsApp.** Hoy solo los audios generan sugerencias; el texto de un responsable va a la máquina de conversación por reglas. Es un alcance mayor, toca `message_service`, y no era lo pedido.

**No se agregaron otras superficies.** El Gantt, la campanita del encabezado y el resumen de obra podrían mostrar sugerencias y ahora *pueden* hacerlo sin trabajo de modelo —es justamente lo que este cambio habilita—, pero la superficie definida para esta etapa fue la tarea.

**No se actualizó `docs/referencia/database.md`.** Ese documento describe 8 tablas de las ~60 que tiene el esquema hoy; sumarle una sin poner el resto al día lo haría más engañoso, no menos.
