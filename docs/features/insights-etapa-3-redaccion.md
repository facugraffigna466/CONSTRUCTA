# Motor de insights — Etapa 3: redacción de conclusiones con IA

> **Estado:** implementado (rama `feat/insights-etapa-2-estadisticas`).
> **Alcance:** consume el `ObraStatsSnapshot` de la [etapa 2](insights-etapa-2-estadisticas.md) y produce conclusiones narrativas guardadas en `obra_insights`, con ciclo de vida propio. **No** incluye la plantilla de email ni el envío — eso es la etapa 4.
> **Regla de oro:** la IA **redacta, no calcula**. Su único input es el snapshot ya computado; nunca ve las tablas crudas de tareas, alertas ni bitácoras.

---

## 1. Arquitectura

| Pieza | Archivo |
|---|---|
| Servicio de redacción | `backend/app/services/obra_insight_service.py` → `ObraInsightService` |
| Modelo / tabla | `backend/app/models/obra_insight.py` → `ObraInsight`, `InsightStatus` |
| Migración | `backend/alembic/versions/0063_obra_insights.py` |
| Enganche al job mensual | `backend/app/core/scheduler.py` → `_job_obra_stats_snapshots` |
| Tests | `backend/tests/test_obra_insights.py` (15 tests) |

La integración con Claude reusa el patrón que ya usa `bitacora_service.py`: `anthropic.AsyncAnthropic` + `output_config={"format": {"type": "json_schema", ...}}` con `settings.CLAUDE_MODEL`. No se introdujo ningún mecanismo nuevo.

El job mensual encadena las dos etapas, **en transacciones separadas**: si la IA falla, las estadísticas —que son el dato duro— ya quedaron guardadas.

```python
async with _db() as db:   # etapa 2: números
    snapshots = await ObraStatsService(db).snapshot_all_active(period)
async with _db() as db:   # etapa 3: redacción
    insights = await ObraInsightService(db).generate_for_all_active(period)
```

Disparo manual, sin endpoint HTTP:

```bash
python -c "import asyncio; from app.services.obra_insight_service import run_obra_insights; \
           print(asyncio.run(run_obra_insights(5, '2026-09')))"
```

---

## 2. El prompt exacto

### System prompt

Es la constante `SYSTEM_PROMPT` de `obra_insight_service.py`, reproducida acá tal cual:

```text
Sos el analista de obra de CONSTRUCTA, una app de gestión de obras de construcción. Recibís
un informe de estadísticas YA CALCULADO de una obra y escribís las conclusiones para el jefe
de obra.

REGLA MÁS IMPORTANTE: vos redactás, NO calculás. Cada número que escribas tiene que estar
literalmente en el JSON que te paso. No estimes, no promedies, no redondees a ojo, no
infieras cifras que no estén. Un número inventado invalida la conclusión entera y se
descarta automáticamente.

Sobre qué concluir — recorré estas cinco métricas y generá una conclusión por cada una que
tenga algo relevante que decir:
1. estimation_accuracy — precisión de la estimación, si alguna disciplina tiene un desvío
   significativo respecto de lo planificado.
2. bitacora_themes — temas que se repiten en la bitácora y su correlación con retrasos.
   OJO: es correlación temporal, NO causalidad. Escribí "en X de las Y veces que se mencionó
   Z hubo un retraso en los días siguientes", nunca "Z causó los retrasos".
3. schedule_deviation — la cadena de hechos detrás del mayor desvío de cronograma. Acá SÍ
   armás la historia: usá el paquete de evidencia (historial, bitácoras, alertas, cascada)
   de top_deviations para explicar qué pasó y en qué orden.
4. risk_concentration — si el atraso está concentrado en pocas tareas o pocos responsables.
5. alert_reaction — si hay algo destacable en cuánto se tarda en reaccionar a las alertas.

Si una métrica no tiene nada relevante ese mes, NO generes una conclusión sobre ella. Mejor
tres conclusiones que importen que cinco rellenadas con paja. Si el snapshot no tiene datos
suficientes para ninguna, devolvé la lista vacía.

Antes de concluir, mirá `data_quality`: si hay muchas tareas excluidas del cálculo, las
métricas hablan de una parte de la obra y tu redacción tiene que matizarlo, no afirmar sobre
el total.

Para cada conclusión:
- `title`: corto y concreto, sin punto final.
- `description`: 2 a 4 líneas, español rioplatense, tono profesional y directo. Nada de
  relleno tipo "es importante destacar que".
- `evidence`: los datos exactos del snapshot que la sustentan, cada uno con su ruta con
  puntos y el valor tal cual figura ahí. Citá el dato preciso, no una paráfrasis vaga.
- `recommendation`: cuando aplique, una acción concreta con mirada hacia adelante — no
  "esto pasó" sino "esto pasó, y para tu próxima obra convendría…". Es una lección aprendida
  que tiene que servir más allá de esta obra. Si no hay nada accionable, null.
- `subject`: el sujeto concreto del patrón, para poder seguirlo mes a mes — el nombre de la
  disciplina, la categoría de bitácora, "task_<id>" para un desvío puntual, "by_task" o
  "by_responsible" para concentración, o el tipo de alerta.
```

### User message

Un único mensaje con el snapshot completo serializado. **No se le pasa nada más** — ni tareas, ni alertas, ni bitácoras crudas:

```python
"Este es el informe de estadísticas ya calculado de la obra. Es tu única fuente: "
"todo número que escribas tiene que salir de acá.\n\n"
f"{json.dumps(metrics, ensure_ascii=False, indent=2)}"
```

### Schema de salida (structured output)

```jsonc
{ "conclusions": [ {
    "metric":  "estimation_accuracy|bitacora_themes|schedule_deviation|risk_concentration|alert_reaction",
    "subject": "electricidad | falta_material | task_36 | by_task | task_overdue",
    "title":   "…",
    "description": "…",
    "evidence": [ { "path": "risk_concentration.by_task.concentration_percent", "value": "34.8" } ],
    "recommendation": "… | null"
} ] }
```

---

## 3. Validación anti-alucinación (código, no otra llamada a IA)

Corre en `_validate()` sobre cada conclusión antes de guardarla. **Dos capas:**

**Capa 1 — la evidencia tiene que resolver contra el snapshot.** Cada ítem trae una ruta y el valor que la IA dice que hay ahí. Se resuelve la ruta en el JSON real y se compara el valor. Los ítems que no resuelven o cuyo valor no coincide **se podan** (con log); si no queda ninguno válido, se descarta la conclusión entera.

**Capa 2 — todo número del texto tiene que existir en el snapshot.** Se recolectan recursivamente todos los números del snapshot, se extraen los del `title` + `description` y se verifica cada uno. Si aparece uno que no se deriva de ningún número del snapshot, la conclusión se descarta.

Dos detalles que evitan falsos positivos y están deliberadamente permitidos:

- **Redondeo legítimo:** escribir "35 %" para un `34.8` del snapshot es redacción, no invención. Se acepta el valor exacto o ese mismo número redondeado a 0 o 1 decimales.
- **Dígitos que no son cifras citadas:** antes de extraer números se recortan del texto los strings literales del snapshot (fechas, títulos de tarea, nombres). Sin esto, el "2026" de una fecha o el "2" de "Losa 2° piso" se contarían como cifras inventadas.

### Un ajuste que salió de correrlo contra la IA real

La primera corrida real descartó 3 de 5 conclusiones, 2 de ellas **por culpa del validador, no del modelo**: la IA cita rutas con notación de corchetes (`top_deviations.items[0].task.deviation_days`, que es la notación estándar de JSON path) y el resolvedor original solo aceptaba puntos (`items.0.task`). Estaba matando evidencia perfectamente válida y correctamente citada.

`resolve_path()` ahora normaliza `[n]` → `.n` y acepta las dos notaciones. Hay un test de regresión (`test_evidencia_con_notacion_de_corchetes_resuelve`) que documenta el caso. **Esto no se hubiera detectado con tests mockeados solamente** — apareció al ejecutar contra el modelo real.

---

## 4. Ciclo de vida

La clave es `topic_key`, calculada **en código** (no la elige la IA) como `"<metric>:<subject normalizado>"` — por ejemplo `bitacora_themes:falta_material` o `schedule_deviation:task_36`. Es lo que decide si una conclusión nueva es "la misma" que una ya existente.

| Situación | Qué pasa |
|---|---|
| El `topic_key` no existe para esa obra | Fila nueva, estado `nueva`, `reinforcement_count = 0` |
| Ya existe y está **activa** (`nueva`/`vista`/`aplicada`) | **Se refuerza, no se duplica**: `reinforcement_count += 1`, se actualizan título, descripción, evidencia y `last_period` con lo más reciente. `first_period` se conserva |
| Ya existe pero está **descartada** | Solo resurge si la evidencia se duplicó (ver abajo). Si resurge, nace una **fila nueva** con `resurfaced_from_insight_id` apuntando a la descartada, que queda intacta |
| El patrón **no apareció** este ciclo | La fila no se toca: ni se borra, ni cambia de estado, ni se le suma refuerzo |

### Criterio de "evidencia notablemente más fuerte"

**Definición: la magnitud del patrón tiene que ser al menos el DOBLE que cuando el usuario lo descartó** (`RESURFACE_STRENGTH_FACTOR = 2.0`).

El razonamiento: si el jefe descartó "falta de material" cuando había 3 menciones, que este mes haya 4 es ruido y reabrirlo le hace perder la confianza en la herramienta. Que haya 6 es una señal cualitativamente distinta y merece volver a molestarlo.

La magnitud (`strength`) se mide con la unidad propia de cada métrica — no son comparables entre sí, pero sí contra el mismo `topic_key` de otro mes, que es lo único que hace falta:

| Métrica | `strength` |
|---|---|
| `bitacora_themes` | cantidad de menciones de la categoría |
| `estimation_accuracy` | `abs(avg_deviation_percent)` de la disciplina |
| `schedule_deviation` | `abs(deviation_days)` de la tarea |
| `risk_concentration` | `concentration_percent` del bloque correspondiente |
| `alert_reaction` | `avg_hours` de ese tipo de alerta |

Si no se puede calcular la magnitud (`strength is None`), la conclusión descartada **no resurge**: ante la duda, se respeta la decisión del usuario.

---

## 5. Manejo de errores

Ningún fallo de una obra corta el job:

- **Sin snapshot** para ese período → se loguea y se saltea (no hay nada que redactar).
- **Sin `ANTHROPIC_API_KEY`** → se loguea un warning y se devuelve lista vacía, sin romper.
- **El modelo corta** por `refusal` o `max_tokens` → warning, no se guarda nada.
- **La llamada explota** (API caída, timeout) → `generate_for_all_active` captura por obra, loguea con traza y **sigue con la siguiente**.
- **Nada pasa la validación** → no se guarda nada para esa obra ese mes; los descartes quedan logueados con el motivo y el título.

---

## 6. Ejemplo real generado

Ejecutado contra la obra **#5 "Vivienda Unifamiliar — Barrio Jardín"**, período `2026-09`, con el snapshot real de la etapa 2 (9 tareas, 7 con retraso, 210 días acumulados, 11 alertas, 0 bitácoras cargadas).

**Resultado: 5 conclusiones generadas, 4 guardadas, 1 descartada por la validación.**

### Conclusión 1 — `schedule_deviation:task_36`

> **'Estructura y losa' acumula 39 días de retraso y arrastra al resto de la obra**
>
> La tarea 'Estructura y losa' (task 36) venció el 22/08 y al cierre del período sigue en progreso, acumulando 39 días de retraso medidos contra el 30/09. El sistema generó dos alertas el 24/08 — dos días después del vencimiento — pero ninguna fue resuelta. Su único dependiente directo es la tarea 37 ('Mampostería'), que a su vez es predecesora de 'Instalaciones sanitarias' (task 39) e 'Instalaciones eléctricas' (task 40), ambas también vencidas. El bloqueo en la estructura es el punto de origen visible de una cadena de tareas sin avance.
>
> **Recomendación:** Cuando una tarea de estructura se vence y no avanza en 48 horas, conviene escalar inmediatamente a una reunión de obra con foco en destrabar el cuello de botella, antes de que el retraso se propague a toda la cadena de dependencias.

Evidencia citada: `top_deviations.items[0].task.deviation_days = 39`, `.due_date = 2026-08-22`, `.status = en_progreso`, `.alerts[0].created_at`, `.cascade_impact.direct_dependent_count = 1`.

Es exactamente el caso de uso de la métrica 3: la IA **armó la cadena causal** con el paquete de evidencia que le dio la etapa 2, que era el punto de dejarlo estructurado y no narrado desde el vamos.

### Conclusión 2 — `schedule_deviation:task_39`

> **'Instalaciones sanitarias' y 'Instalaciones eléctricas' vencidas por 34 días, bloqueadas por Mampostería**
>
> Las tareas 39 y 40 vencieron el 27/08 y acumulan cada una 34 días de retraso al 30/09. Ambas tienen como predecesora la tarea 37 ('Mampostería'), que figura vencida desde el 30/08 según las alertas generadas el 02/09. […]
>
> **Recomendación:** Para obras con instalaciones paralelas dependientes de mampostería, incorporar un hito intermedio de verificación al terminar mampostería permite detectar el bloqueo antes de que impacte en dos frentes simultáneos.

### Conclusión 3 — `risk_concentration:by_responsible`

> **Carlos Méndez concentra el 39% del retraso total asignado**
>
> De los 3 responsables con retraso, Carlos Méndez (responsible_id 13) acumula 73 días de delay en 2 tareas, representando el 39% del total de 187 días asignados a responsables. Juan Pérez suma 65 días en 2 tareas y Ana López 49 días en 2 tareas. El retraso está distribuido entre todos los responsables, pero Méndez encabeza con una diferencia apreciable respecto del segundo.
>
> **Recomendación:** Cuando un responsable concentra más de un tercio del retraso total, vale revisar si tiene sobrecarga de tareas simultáneas o si sus asignaciones están trabadas por factores externos, y redistribuir o reforzar antes de que el desvío siga creciendo.

### Conclusión 4 — `risk_concentration:by_task`

> **7 de 7 tareas con retraso: toda la obra activa está demorada**
>
> El universo de tareas con desvío incluye las 7 tareas consideradas, todas con delay mayor a cero. El total acumulado es de 210 días de retraso. Las 2 tareas del top 20% ('Estructura y losa' con 39 días e 'Instalaciones sanitarias' con 34 días) concentran el 34,8% de ese total. **Cabe notar que 2 tareas completadas quedaron excluidas del cálculo por falta de fecha de completado**, por lo que las métricas reflejan las 7 tareas restantes.
>
> **Recomendación:** Registrar la fecha de completado en el momento exacto en que se cierra cada tarea es clave para que las métricas de concentración y precisión de estimación reflejen la obra completa, no solo las tareas abiertas.

Esta conclusión confirma que la instrucción sobre `data_quality` funciona: el modelo leyó el bloque, matizó el alcance en vez de afirmar sobre el total de la obra, y hasta convirtió el hueco de datos en una recomendación accionable.

### La conclusión descartada

> *"7 de 11 alertas sin resolver y sin métricas de reacción disponibles"* — **descartada: el texto cita 62, que no está en el snapshot.**

El modelo calculó por su cuenta un porcentaje (7/11 ≈ 62 %) que no figura en ningún lado del JSON. Es exactamente el comportamiento que la validación tiene que atajar: un número que *suena* razonable y es aritméticamente derivable, pero que el sistema nunca calculó. Se descartó y quedó logueado.

### Ciclo de vida verificado en real

Segunda corrida sobre el mismo período:

```
total filas: 5
  id=3 topic=schedule_deviation:task_36        refuerzos=1
  id=4 topic=schedule_deviation:task_39        refuerzos=1
  id=5 topic=risk_concentration:by_responsible refuerzos=1
  id=6 topic=risk_concentration:by_task        refuerzos=0   ← no apareció en la 2ª corrida, quedó intacta
  id=7 topic=alert_reaction:delay_risk         refuerzos=0   ← tema nuevo de la 2ª corrida
```

Tres temas se reforzaron **sin duplicar filas**, uno nuevo se creó, y el que no volvió a aparecer quedó exactamente como estaba.

---

## 7. Pruebas

### 7.1 Tests automatizados — `backend/tests/test_obra_insights.py` (15 tests, todos verdes)

La llamada al modelo se mockea (`_call_model`) para que sean determinísticos y no necesiten API key: lo que se prueba es **código nuestro** (validación y ciclo de vida), no la IA.

| Test | Qué verifica |
|---|---|
| `test_conclusion_nueva_se_crea` | Fila nueva con estado, topic_key, períodos, tenant y `strength` correctos; la narrativa se guarda **tal cual la escribió la IA** |
| `test_conclusiones_de_varias_metricas_conviven` | Dos métricas distintas → dos topic_keys distintos |
| `test_conclusion_repetida_refuerza_y_no_duplica` | Segundo ciclo: `reinforcement_count = 1`, `last_period` actualizado, `first_period` conservado, **una sola fila** |
| `test_conclusion_no_reforzada_queda_intacta` | Un patrón que no aparece este ciclo no cambia de estado ni suma refuerzo |
| `test_descartada_no_resurge_con_evidencia_debil` | Descartada con 3 menciones, ahora 5 → no llega al doble, **no resurge** |
| `test_descartada_resurge_con_evidencia_fuerte` | Descartada con 2, ahora 5 → supera el doble, **fila nueva** con `resurfaced_from_insight_id` |
| `test_numero_inventado_se_descarta` | Anti-alucinación: cita un 87 % inexistente → descartada |
| `test_evidencia_con_ruta_inexistente_se_descarta` | Ningún ítem resuelve → descartada |
| `test_evidencia_con_valor_que_no_coincide_se_descarta` | La ruta existe pero el valor citado es otro → descartada |
| `test_evidencia_invalida_se_poda_pero_la_conclusion_sobrevive` | Un ítem malo se poda, la conclusión vive si queda otro bueno |
| `test_evidencia_con_notacion_de_corchetes_resuelve` | Regresión del bug encontrado con la IA real (`items[0]` vs `items.0`) |
| `test_redondeo_legitimo_no_se_descarta` | "35 %" para un 34.8 del snapshot es redacción válida |
| `test_fechas_del_snapshot_no_cuentan_como_numeros_inventados` | Los dígitos de fechas y títulos no se leen como cifras citadas |
| `test_sin_snapshot_no_guarda_nada` | Obra sin snapshot del mes → se saltea sin romper |
| `test_fallo_de_la_ia_no_tumba_el_job` | La IA explota → 0 conclusiones, job sigue |

Se verificó además que la protección anti-alucinación **rechaza por el motivo correcto** y no por casualidad:

```
numeros del snapshot: [0.8, 1.0, 3.0, 4.0, 5.0, 7.0, 9.0, 25.0, 34.8, 36.0, 39.0, 210.0]
numeros extraidos del texto mentiroso: [87.0]
MOTIVO DE DESCARTE: el texto cita 87, que no está en el snapshot
conclusion legitima -> None
```

```
$ python -m pytest tests/test_obra_insights.py -q
15 passed

$ python -m pytest -q          # suite completa, sin regresiones
343 passed
```

### 7.2 Migración

`0063` verificada contra Postgres local en ciclo `upgrade → downgrade → upgrade`, **comprobando el estado real de la base** (tabla y tipo enum), no solo el código de salida de alembic.

Un detalle que esa verificación destapó: la primera versión de la migración fallaba con *"type insight_status already exists"* porque creaba el enum con `checkfirst=True` y después `create_table` intentaba crearlo otra vez. Alembic devolvía exit 0 igual, así que el "OK" del comando era engañoso — la base había quedado en 0062 sin tabla. Se corrigió usando `postgresql.ENUM(..., create_type=False)` en la columna. **Los tests corren sobre SQLite con `create_all`, así que no cubren la migración**: esta verificación contra Postgres es la única que la valida.

---

## 8. Lo que NO está en esta etapa

- Plantilla de email y envío (etapa 4 y 5).
- Endpoint HTTP para listar o cambiar el estado de las conclusiones.
- Pantalla en el frontend (`/obras/{id}/insights`).
- Transiciones de estado por acción del usuario: hoy todas nacen `nueva`. Los estados `vista`, `aplicada` y `descartada` están en el modelo y el ciclo de vida ya los respeta, pero **falta la API que los cambie** — es dependencia de la pantalla, no de esta etapa.
