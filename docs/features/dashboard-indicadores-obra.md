# Diseño de indicadores de obra — Dashboard Avanzado

> **Estado:** **implementado y mergeado a `main`** (I-01 a I-16, backend y frontend, migración `0074` incluida). Nació como documento de diseño previo a la implementación y hoy es **la especificación de lo que corre en producción**: define qué indicadores muestra el dashboard de obra, con qué fórmula exacta, de qué campo salen, qué pasa cuando el dato no alcanza y cómo se ven. Si el código y este documento se contradicen, es un bug de alguno de los dos — no un plan pendiente.
> **Fase:** Dashboard Avanzado (Gantt) — 29/09 a 23/10.
> **Regla de oro:** ningún indicador de este documento usa un modelo de lenguaje. Todos salen de SQL/Python y son verificables a mano con los datos de una obra.
> **Formato:** pendiente de confirmar contra la plantilla que define Facundo. La estructura de acá sigue la de los demás `docs/features/*.md` del repo.
> **Extensión 2026-09-10 — "Visualización de desvíos y problemas":** se agregan I-14 a I-16 en la sección 4-bis. Mismo estado que el resto del documento: implementados, paso 7 del plan (sección 10).

---

## 1. Qué decide este documento

CONSTRUCTA ya calcula bastante. El problema no es la falta de números: es que **están repartidos en tres lugares que no se hablan** y que el único indicador que el usuario ve en pantalla es el más pobre de todos.

1. **En el cliente** (`ResumenTab.tsx`) hay 8 contadores derivados del array de tareas. Son inmediatos pero superficiales, y el "% de avance" es un conteo de tareas terminadas que ignora el tamaño de cada tarea.
2. **En el backend** (`obra_stats_service.py`) hay 5 métricas serias, bien documentadas y con manejo explícito de calidad de dato — pero corren una vez por mes, se guardan en `obra_stats_snapshots` y **no las ve nadie**: alimentan el informe mensual con IA.
3. **On-demand** hay CPM (`/critical-path`), baseline por tarea y totales de materiales, que se usan para pintar el Gantt pero no producen ningún indicador agregado.

Este diseño hace tres cosas: **corrige** el indicador de avance, **expone** lo que ya se calcula y estaba escondido, y **agrega** los seis indicadores que faltan para que el panel responda las preguntas que un jefe de obra hace de verdad.

### Las cinco preguntas que el dashboard tiene que contestar

Todo indicador de este documento existe para responder una de estas. Si un número no contesta ninguna, no entra al panel.

1. **¿Cuánto llevamos hecho, de verdad?** → avance real ponderado
2. **¿Vamos bien o vamos tarde?** → avance planificado, SPI, curva S
3. **¿Cuándo vamos a terminar?** → fecha de fin proyectada, desvío vs. línea base
4. **¿Qué me va a explotar primero?** → holgura, hitos en riesgo, alertas críticas, cuello de botella
5. **¿Dónde se me va la plata y el tiempo?** → ejecución de materiales, concentración 80/20, precisión de estimación

---

## 2. Principios de diseño

**P1 — Ningún número sin denominador visible.** "68% de avance" no dice nada solo. Al lado va siempre contra qué se compara: *68% real vs. 74% planificado*. Un KPI aislado es decoración.

**P2 — Un indicador que no se puede calcular se dice, no se inventa.** Si la obra no tiene línea base guardada, el desvío vs. baseline **no muestra 0%**: muestra un estado vacío con la acción que lo destraba ("Guardá la línea base para medir el desvío"). Cada ficha de la sección 4 define su condición de no-calculable. Esto no es un detalle de UI: es la diferencia entre un panel confiable y uno que miente cuando faltan datos, que es la mitad del tiempo en una obra real.

**P3 — En vivo lo que cambia hoy; batch lo que necesita muestra.** Avance, SPI y holgura se recalculan en cada carga del panel: cambian con cada tarea que se toca. Precisión de estimación o correlación de bitácora necesitan meses de datos y siguen viniendo del snapshot mensual, **mostrando la fecha del snapshot**. Mezclar las dos cadencias sin decirlo es cómo se pierde la confianza en un dashboard.

**P4 — Ponderar por duración, no por conteo.** Excavación de 20 días y "colocar cartelería" de 1 día no valen lo mismo. Todo agregado de avance pondera por días laborables planificados (sección 3).

**P5 — El panel muestra el problema y el camino al problema.** Cada indicador en rojo es clickeable y lleva a la tarea, el responsable o el tab que lo causa. Un número rojo sin destino obliga a buscar a mano lo que el sistema ya sabe.

---

## 3. Definiciones comunes

Antes de las fichas hay que fijar cuatro definiciones que casi todos los indicadores usan. **Están acá una sola vez a propósito**: si cada indicador define "avance" a su manera, el panel se contradice a sí mismo.

### 3.1 Universo de tareas

Salvo que la ficha diga otra cosa, el universo es **las tareas de la obra con `status != cancelada`**. Las canceladas no cuentan ni en el numerador ni en el denominador (si contaran en el denominador, cancelar tareas bajaría el % de avance, que es exactamente al revés de lo que pasa en la realidad).

Los **hitos** (`is_milestone = true`) tienen duración cero: **se excluyen de todo cálculo ponderado** y se miden aparte (ficha I-08). Incluirlos con peso 1 los haría contar como una tarea de un día que no lo son.

### 3.2 Peso de una tarea

```
peso(t) = max(1, días_laborables(t.start_date, t.due_date))
```

Días laborables según el calendario de la obra (`WorkingCalendar`), no días corridos: una tarea de lunes a lunes son 6 días de trabajo, no 8.

- Si la tarea **no tiene ambas fechas**, `peso = 1` y la tarea se marca en `data_quality.tasks_without_dates`. No se la excluye: excluirla escondería trabajo real del avance. Se la cuenta con el peso mínimo y se avisa que el número es parcial.
- El `max(1, ...)` evita que una tarea de un solo día (donde inicio == fin) pese 0 y desaparezca del promedio.

> **Nota de implementación:** `calendar_service.py` tiene `is_working_day`, `next_working_day` y `add_working_days`, pero **no** `working_days_between`. Hay que agregarlo — es el único helper nuevo que necesita el cálculo, y conviene que salga de ahí para que respete feriados y días no laborables igual que el Gantt.

### 3.3 Avance de una tarea

```
avance(t) = 100                      si status == completada
          = 0                        si status == pendiente
          = t.estimated_progress     si status ∈ {en_progreso, bloqueada}
```

Una tarea **bloqueada conserva el avance que tenía**: estaba al 60% cuando se frenó, sigue al 60%. Ponerla en 0 castigaría dos veces el mismo problema (ya se ve en alertas y en holgura).

Esto es **el cambio más importante del diseño**: hoy `ResumenTab.tsx:108` calcula `completadas / no_canceladas`, así que una tarea al 95% aporta lo mismo que una sin empezar. El campo `estimated_progress` (0–100) existe en el modelo `Task` desde siempre y **no alimenta ningún agregado**. Empezar a usarlo va a hacer que el % de avance de todas las obras **cambie el día que esto se despliegue** — casi siempre para arriba, y sin aviso se lee como un bug.

**Decisión (D-03):** se comunica con un **tooltip permanente en el indicador**, no con una nota de release ni un aviso por única vez. El anillo explica siempre cómo se calcula ("ponderado por la duración de cada tarea"), lo que resuelve el momento del despliegue *y* toda duda posterior de cualquier usuario nuevo, sin construir un mecanismo de "visto una vez". El texto exacto está en I-01.

### 3.4 Avance planificado de una tarea a una fecha

```
planificado(t, D) = 0                                              si D < t.start_date
                  = 100                                            si D >= t.due_date
                  = 100 × días_laborables(start, D) / peso(t)      en el medio
```

Asume **avance lineal dentro de la tarea**, que es la convención estándar y la única defendible sin curvas de carga por tarea (que CONSTRUCTA no modela). Vale decirlo en el tooltip: es una aproximación, no una promesa.

---

## 4. Los indicadores

Cada ficha define: qué pregunta responde, la fórmula, de dónde sale el dato, qué pasa cuando no alcanza, y cómo se ve. **P0** = imprescindible para que el panel tenga sentido; **P1** = alto valor; **P2** = deseable.

---

### I-01 · Avance real ponderado — **P0** — 🆕 nuevo

**Pregunta:** ¿cuánto de la obra está hecho, de verdad?

```
avance_real = Σ(peso(t) × avance(t)) / Σ(peso(t))     para t en el universo (3.1)
```

**Fuente:** `tasks.status`, `tasks.estimated_progress`, `start_date`, `due_date`, calendario de la obra.

**Casos borde:**
- Obra sin tareas → `null`, estado vacío "Todavía no hay tareas cargadas" con link a crear.
- Todas las tareas sin fechas → se calcula igual (todas pesan 1, equivale al promedio simple) y se muestra la advertencia de dato parcial.

**Visual:** el anillo de progreso que ya existe en `ResumenTab`, **reusando el componente actual**. Debajo, en texto chico: `X de Y tareas completas · ponderado por duración`. Al lado, el valor planificado de I-02, que es lo que le da sentido (P1).

**Tooltip (obligatorio, D-03):** al hover sobre el anillo —

> *"Avance ponderado por la duración planificada de cada tarea: una tarea de 20 días pesa 20 veces más que una de 1 día. Incluye el avance parcial de las tareas en curso."*

No es un adorno: es lo que evita que el cambio de fórmula se lea como un error el día del despliegue (3.3), y lo que le explica a cualquier usuario nuevo por qué este número no coincide con "12 de 34 tareas".

**Cambio respecto de hoy:** reemplaza el conteo de `ResumenTab.tsx:108`. El conteo simple **no se tira**: pasa a ser la línea secundaria ("12 de 30 tareas"), que sigue siendo información útil y es la que la gente ya conoce.

---

### I-02 · Avance planificado a la fecha — **P0** — 🆕 nuevo

**Pregunta:** ¿cuánto *debería* estar hecho hoy, según el plan?

```
avance_planificado = Σ(peso(t) × planificado(t, hoy)) / Σ(peso(t))
```

**Fuente:** las mismas fechas de las tareas. **No usa la línea base** a propósito: mide contra el plan *vigente*. El plan original se compara aparte en I-06, y son dos preguntas distintas ("¿voy según lo que dije que iba a hacer?" vs. "¿cuánto se movió lo que dije?").

**Casos borde:**
- Ninguna tarea con fechas → `null`. Sin fechas no hay plan contra el cual comparar, y todo lo que dependa de esto (I-03, I-04, I-05) también queda en `null`. Un solo estado vacío para el bloque entero: *"Cargá fechas en las tareas para ver el seguimiento del cronograma"*, con link al tab Tareas filtrado por tareas sin fecha.

**Visual:** no tiene tile propio. Aparece como marca de referencia sobre el anillo de I-01 y como la línea planificada de la curva S (I-05).

---

### I-03 · SPI — Índice de desempeño del cronograma — **P0** — 🆕 nuevo

**Pregunta:** ¿vamos adelantados o atrasados, y por cuánto?

```
SPI = avance_real / avance_planificado
```

- `SPI = 1.0` → en fecha
- `SPI < 1.0` → atrasado (0.85 = se hizo el 85% de lo que tocaba)
- `SPI > 1.0` → adelantado

**Umbrales de color** (los mismos que usan las reglas de riesgo, para que el panel y las alertas no se contradigan):

| SPI | Estado | Color |
|---|---|---|
| ≥ 0.95 | En fecha | `#1F8A5B` |
| 0.85 – 0.95 | Atención | `#D97706` |
| < 0.85 | Atrasado | `#D03A3A` |

**Casos borde — importantes:**
- `avance_planificado == 0` (la obra todavía no arrancó según el plan) → **`null`, no infinito**. Se muestra "La obra aún no arrancó según el plan".
- `avance_planificado` muy chico (< 5%) → el cociente es inestable: 2% real vs. 1% planificado da SPI 2.0 y no significa nada. Se calcula pero se muestra **con una marca de baja confianza** y sin color de alarma.
- Obra completada → SPI se congela al valor del día de cierre.

**Visual:** KPI tile con el número grande a dos decimales, la etiqueta de estado y, debajo, la traducción a lenguaje humano — que es lo que la gente realmente lee: *"Vas 6 días atrás de lo planificado"*, calculado como `(planificado − real)/100 × duración_total_planificada_en_días`.

---

### I-04 · Fecha de fin proyectada — **P0** — 🆕 nuevo

**Pregunta:** si seguimos a este ritmo, ¿cuándo terminamos?

```
duración_planificada = días_laborables(min(start_date), max(due_date))
duración_proyectada  = duración_planificada / SPI
fin_proyectado       = min(start_date) + duración_proyectada  (en días laborables)
desvío_dias          = días_laborables(expected_end_date, fin_proyectado)
```

**Fuente:** fechas de tareas + SPI (I-03) + calendario laboral.

**Casos borde — este indicador es el más fácil de arruinar:**
- `SPI == null` o SPI de baja confianza → **no se muestra**. Una proyección basada en un SPI inestable es peor que ninguna proyección, porque la gente toma decisiones con ella.
- `SPI < 0.5` → la fórmula proyecta fechas absurdas (el doble de la obra). Se **acota**: se muestra *"más de X meses de desvío"* en vez de una fecha falsamente precisa.
- Obra con < 10% de avance real → baja confianza, se muestra con la marca correspondiente.

**Alternativa considerada y descartada:** proyectar por CPM (recorrer la ruta crítica con las fechas reales y ver dónde cae el último fin). Es más preciso *cuando el grafo de dependencias está completo*, y en la práctica está lleno de tareas sueltas sin predecesoras, con lo cual la ruta crítica cubre una fracción de la obra y la proyección sale corta. Se usa el método por SPI como titular. **Cuando la obra tiene ruta crítica completa** (todas las tareas con fechas y sin islas) se puede mostrar la fecha CPM como segunda opinión — queda como P2.

**Visual:** KPI tile con la fecha (`23 nov 2026`) y, debajo, el desvío contra `expected_end_date` en verde/rojo: *"+14 días vs. lo previsto"*. Tooltip con el método y su supuesto.

---

### I-05 · Curva S — avance planificado vs. real en el tiempo — **P1** — 🆕 nuevo

**Pregunta:** ¿desde cuándo nos empezamos a atrasar, y se está agrandando o achicando la brecha?

Es el gráfico que convierte cuatro números en una historia: la brecha entre las dos líneas *es* el atraso, y su pendiente dice si se agranda o se recupera.

**Serie planificada:** determinística y **calculable hacia atrás y hacia adelante** para cualquier fecha, aplicando 3.4 semana a semana desde el inicio hasta el fin de obra. No necesita historia guardada.

**Serie real:** acá está el problema. `avance(t)` es el estado *de hoy*: el sistema **no guarda cuál era el avance de la obra el 15 de agosto**. Reconstruirlo desde `historial_eventos` es posible pero frágil (habría que reproducir cada `task_updated` y los eventos viejos no siempre traen el payload completo), y sería un motor de replay entero para alimentar un gráfico.

**Decisión: historizar hacia adelante.** Una tabla nueva, un job diario, y la serie real arranca vacía y se llena desde el día que se despliega. Ver sección 5.

**Casos borde:**
- Menos de 3 puntos históricos → no se dibuja la línea real todavía; se muestra solo la planificada con la leyenda *"El seguimiento real empieza a registrarse desde el DD/MM"*. Honesto y no bloquea el resto del panel.
- Obra que arrancó antes del despliegue → mismo tratamiento. **No se backfillea la serie real**: inventar historia es peor que no tenerla.

**Visual:** gráfico de área, planificada en gris punteado, real en naranja `#FF6B35`, línea vertical en "hoy". Eje X en semanas. Es el único gráfico grande del panel — el resto son tiles.

---

### I-06 · Desvío vs. línea base — **P1** — 🆕 rollup nuevo sobre dato existente

**Pregunta:** ¿cuánto se movió el plan respecto de lo que se prometió al empezar?

I-02/I-03 miden contra el plan *actual*, que se reprograma. Este mide contra el plan *original*, y es el que le importa al comitente.

```
desvío_fin_obra    = días_laborables(max(baseline_finish), max(due_date))
tareas_desviadas   = count(t : due_date > baseline_finish)
desvío_promedio    = avg(due_date − baseline_finish)  sobre las desviadas
```

**Fuente:** tabla `task_baselines` (`baseline_start`, `baseline_finish`, `saved_at`) — ya existe y se dibuja en el Gantt, pero **sin ningún agregado a nivel obra**.

**Casos borde:**
- Sin línea base guardada → estado vacío **con acción**: *"Guardá la línea base para medir el desvío del plan"* + botón. No mostrar 0.
- Tareas creadas *después* de la línea base (no tienen fila en `task_baselines`) → se excluyen del promedio y se cuentan aparte: *"8 tareas agregadas después de la línea base"*. Es información valiosa por sí misma — alcance que creció.

**Visual:** tile con el desvío del fin de obra en días y, abajo, `N de M tareas desviadas`. Clickeable → tab Tareas ordenado por desvío.

---

### I-07 · Salud de la ruta crítica y holgura — **P1** — 🆕 agregado nuevo sobre CPM existente

**Pregunta:** ¿cuánto colchón nos queda antes de que un problema empuje la fecha de entrega?

`GET /obras/{id}/critical-path` ya devuelve `critical_task_ids`, `float_by_task` y `tasks_without_dates`. Hoy solo se usa para pintar barras. Los agregados:

```
tareas_criticas     = count(float == 0)
tareas_en_riesgo    = count(0 < float <= 3)      # 3 días ≈ media semana laboral
holgura_mediana     = mediana(float) de las no críticas
cobertura_cpm       = tareas_con_fechas / tareas_totales
```

Se usa **mediana y no promedio**: una sola tarea suelta con 200 días de holgura arrastra el promedio y hace parecer holgada una obra que está al límite.

**Casos borde:**
- `cobertura_cpm < 70%` → se muestra el número **con advertencia explícita** de que la ruta crítica es parcial. El endpoint ya devuelve `tasks_without_dates` justo para esto.
- Sin dependencias cargadas → toda tarea es "crítica" por definición del CPM y el indicador no significa nada. Si el grafo de dependencias está vacío, **no se muestra**: *"Cargá dependencias entre tareas para ver la ruta crítica"*.

**Visual:** tile con `N tareas críticas` y una barra de tres segmentos (críticas / en riesgo / holgadas). Clickeable → Gantt con `highlightCritical` activado, que ya existe.

**P2 — erosión de la holgura:** con el histórico de la sección 5, un sparkline de cómo se consumió el colchón en las últimas semanas. Es el indicador que anticipa problemas antes de que haya una sola tarea vencida, y es el que más se parece a lo que un jefe de obra experimentado ve "a ojo".

---

### I-08 · Hitos — **P1** — 🆕 nuevo

**Pregunta:** ¿llegamos a las fechas que nos comprometimos?

Los hitos (`is_milestone`) están excluidos de los cálculos ponderados (3.1), así que necesitan su propio indicador — y son lo que se le muestra al comitente.

```
por cada hito:  cumplido      si status == completada y completed_date <= due_date
                tarde         si status == completada y completed_date >  due_date
                en_riesgo     si no completada y (due_date < hoy o float <= 3)
                pendiente     resto
```

**Casos borde:** obra sin hitos → no se muestra la sección (no es un error, muchas obras chicas no usan hitos).

**Visual:** línea de tiempo horizontal compacta con un rombo naranja por hito (el mismo `◆` que ya usa `TaskTable`), coloreado por estado. Es lo más presentable del panel para mostrarle al cliente.

---

### I-09 · Alertas abiertas por severidad — **P0** — ♻️ existente, reformulado

**Pregunta:** ¿qué necesita mi atención ahora?

Hoy `ResumenTab` cuenta `alerts.filter(!is_read)` — un número plano donde una alerta crítica pesa igual que una informativa. El sistema ya tiene **4 niveles de severidad** (`critica`/`alta`/`media`/`baja`) y **17 tipos de alerta**, todo desperdiciado en un contador único.

```
por severidad: count(alerts : !resolved)
antigüedad_max_critica = max(hoy − created_at) sobre las críticas sin resolver
```

`antigüedad_max_critica` es el que de verdad importa: una alerta crítica de hace 6 días es un proceso roto, no un pendiente.

**Visual:** tile con las críticas grandes en rojo y las demás en línea secundaria. Si hay críticas de más de 48 h, badge *"la más vieja: hace N días"*. Clickeable → tab Alertas filtrado.

---

### I-10 · Cuello de botella — **P1** — ♻️ existente, hoy invisible en la UI

**Pregunta:** ¿qué tarea está frenando a más tareas?

`staff_digest_service.py:203` ya calcula exactamente esto para el WhatsApp semanal: la tarea bloqueada o vencida que **más tareas dependientes frena**. Se manda por mensaje y no se ve en pantalla — es reusar código, no escribir uno nuevo.

```
cuello = argmax(count(dependientes transitivas))  sobre tareas bloqueadas o vencidas
```

**Casos borde:** sin tareas bloqueadas/vencidas → no se muestra (es una buena noticia, no un estado vacío que haya que llenar).

**Visual:** banner naranja destacado arriba del panel: *"«Hormigonado de losa» está frenando 7 tareas"* + botón a la tarea. Sale primero que los tiles: si hay un cuello de botella, es lo más importante de la pantalla.

---

### I-11 · Ejecución de materiales — **P1** — ♻️ existente, hoy solo en el tab Presupuesto

**Pregunta:** ¿cuánto del presupuesto de materiales está comprometido y recibido?

`GET /obras/{id}/presupuesto` ya devuelve `total_estimado`, `total_pedido` y `total_recibido` (`purchase_orders.py:97`).

```
% comprometido = total_pedido   / total_estimado
% recibido     = total_recibido / total_estimado
alineación     = % recibido − avance_real     # I-01
```

**`alineación` es el indicador real** y no existe hoy en ninguna forma. Si llegó el 80% de los materiales y la obra va por el 40%, hay capital inmovilizado en el obrador; al revés, hay riesgo de frenar por falta de material. Es la única lectura cruzada costo/avance que los datos de CONSTRUCTA soportan honestamente.

**Limitación que hay que escribir en el tooltip, no esconder:** esto cubre **solo materiales cargados por tarea**. No hay mano de obra, ni subcontratos, ni equipos. **No es el costo de la obra** y no se debe rotular como tal. Por la misma razón este diseño **no propone CPI ni Earned Value de costo** (ver sección 8).

**Casos borde:** obra sin materiales cargados → no se muestra la sección.

**Visual:** barra apilada de tres segmentos con los montos, más el delta de alineación en texto.

---

### I-12 · Concentración 80/20 del retraso — **P2** — ♻️ existente en snapshot mensual

**Pregunta:** ¿el atraso está concentrado en pocas tareas/responsables o es parejo?

`obra_stats_service._risk_concentration()` ya lo calcula por tarea **y por responsable**, con `concentration_percent`, ranking y días sin asignar.

**Cadencia:** viene del **snapshot mensual**, no se recalcula en vivo (P3). Se muestra con la fecha del snapshot bien visible.

**Casos borde:** sin snapshot todavía (obra nueva, o el job aún no corrió) → *"Disponible a partir del DD/MM"*.

**Visual:** en un acordeón "Análisis del período" junto a I-13, colapsado por defecto. Es material de reunión mensual, no de control diario, y meterlo entre los tiles en vivo confunde las dos cadencias.

**Decisión de visibilidad (D-01): el ranking por responsable se muestra solo al rol `admin`.** El ranking por tarea lo ve cualquiera con acceso a la obra.

El dato es genuinamente útil para quien gestiona, pero es el mismo riesgo por el que se descartó "productividad por responsable" (sección 8): si el capataz sospecha que reportar un bloqueo lo sube en un ranking visible para todos, deja de reportar bloqueos. Restringirlo a admin conserva el valor de gestión y saca el efecto scoreboard.

**Implicancia técnica:** el bloque `by_responsible` del snapshot **se filtra en el backend, no se oculta en el frontend** — un usuario no-admin no debe recibir los nombres en el JSON aunque no los muestre en pantalla. El bloque `by_task` viaja siempre.

---

### I-13 · Precisión de estimación por disciplina — **P2** — ♻️ existente en snapshot mensual

**Pregunta:** ¿en qué rubros estimamos sistemáticamente mal?

`obra_stats_service._estimation_accuracy()` ya da `avg_deviation_percent`, `avg_planned_days` y `avg_actual_days` por disciplina. Es el indicador con más valor a largo plazo: mejora la planificación de la *próxima* obra.

**Limitación heredada:** la disciplina se detecta por **keywords**, no semánticamente (`params.discipline_source = "keyword_proxy"`). El propio motor lo declara y el panel tiene que repetirlo — con `tasks_excluded` visible.

**Visual:** en el mismo acordeón mensual que I-12. Barras horizontales por disciplina, desvío % con signo.

---

## 4-bis. Visualización de desvíos y problemas (extensión 2026-09-10)

Los tres indicadores que siguen no son cálculo nuevo: `obra_stats_service.py` ya los produce dentro del mismo snapshot mensual que alimenta I-12/I-13 (`_top_deviations`, `_bitacora_themes`, `_alert_reaction`). Hoy ese JSON llega hasta el informe mensual con IA (`insights.py`) y ahí muere — nunca llegó a una pantalla de la app. Es exactamente el mismo movimiento que ya hizo este documento con I-09/I-10/I-11: **exponer lo que ya se calcula y estaba escondido**, no inventar una métrica.

Van en el mismo acordeón "Análisis del período" que I-12/I-13 (mismo endpoint, misma cadencia mensual, mismo criterio de "se muestra la fecha del snapshot").

---

### I-14 · Evidencia de desvíos (problemas) — **P1** — 🆕 expone `top_deviations`, ya calculado

**Pregunta:** de las tareas que más se desviaron el mes pasado, ¿qué pasó exactamente — qué se dijo en bitácora, qué alertas saltaron, a cuántas tareas arrastró?

**Fuente:** `ObraStatsService._top_deviations()` ya arma, para las `TOP_DEVIATIONS_COUNT` (3) tareas con mayor `abs(deviation_days)`, un paquete completo: menciones de bitácora en la ventana previa al vencimiento, alertas propias y de predecesoras, últimos eventos de historial (hasta 30, con `payload` crudo y `triggered_by`) y el impacto en cascada (`cascade_impact`).

**Qué se muestra y qué no (D-04):** el paquete completo es insumo para que un modelo redacte un informe, no para pegar tal cual en una tarjeta. El panel muestra un **resumen curado** por tarea: título, desvío en días, hasta 3 menciones de bitácora (resumen + categoría matcheada), cantidad de alertas asociadas, y `len(cascade_impact.tasks_pushed_by_cascade)` si es > 0 ("empujó a N tareas") — no `direct_dependent_count`, que cuenta dependencias estructurales del grafo aunque nunca haya disparado una cascada real. **No se muestra `responsible_id`** — esto es evidencia sobre una *tarea*, no un ranking de quién la causó; es el mismo criterio que en la sección 8 descartó "productividad por responsable". Tampoco se muestran los eventos de historial crudos ni `triggered_by`, pero **por ruido, no por privacidad**: `triggered_by` es el canal por el que entró el evento (`user` | `chatbot` | `system`, ver `models/historial.py`), no quién lo hizo, y confundirlo con un dato de persona haría creer que la tarjeta protege algo que no protege. El JSON completo sigue disponible en el snapshot para quien lo consulte por API; la UI no lo despliega.

**Casos borde:**
- `top_deviations.count == 0` (ninguna tarea con `deviation_days != 0` ese período) → no se muestra la sección. Es buena noticia, no un estado vacío que llenar.
- Tarea con desvío pero sin ninguna mención de bitácora ni alerta asociada → la tarjeta se muestra igual, solo con título y días: el desvío es el dato duro, y que no haya evidencia adicional también es información (nadie documentó por qué).

**Visual:** dentro del acordeón, reemplaza a la lista actual "Tareas con mayor desvío" (que hoy es solo texto + días — esta ficha es un superset del mismo ranking, con contexto). Tarjetas apiladas, una por tarea: título + badge de días en rojo y, si existen, chips de categoría de bitácora (`falta_material`, `clima`, ...) con su resumen en texto chico, y "→ empujó N tareas" cuando aplica. Clickeable a la tarea.

---

### I-15 · Temas recurrentes de bitácora (patrones de problema) — **P1** — 🆕 expone `bitacora_themes`, ya calculado

**Pregunta:** ¿qué tipo de problema se repite en el campo, y cuánto de eso realmente termina en un retraso medible?

**Fuente:** `ObraStatsService._bitacora_themes()` categoriza cada bitácora por palabras clave (`BITACORA_THEME_SYNONYMS`: falta_material, clima, ausencia_personal, proveedor, problema_tecnico, equipos_maquinaria, seguridad) y calcula `correlation_rate` = menciones seguidas de una señal de retraso (bloqueo, vencimiento, alerta, reprogramación en cascada) dentro de `CORRELATION_WINDOW_DAYS` (5 días) sobre el total de menciones de esa categoría.

**Casos borde:**
- Ninguna bitácora matcheó alguna categoría → no se muestra la sección.
- **Muestra chica engañosa:** con 1 mención y 1 retraso, `correlation_rate` da 100% y es ruido, no un patrón. El porcentaje se muestra **solo si `mentions >= 3`**; por debajo, se muestra el conteo crudo sin porcentaje ("2 menciones, 1 con retraso después") para no insinuar una tasa que no es estadísticamente nada.
- El propio método ya declara en `bitacora_themes.note` que es "correlación temporal, NO causalidad" — ese texto va como tooltip fijo de la sección, mismo criterio que D-03 con el tooltip de I-01.

**Visual:** sección nueva "Problemas recurrentes en bitácora" en el mismo acordeón. Barras horizontales por categoría (orden `mentions_followed_by_delay` desc, ya viene así del backend), con label en español fijo (`falta_material`→"Falta de material", `clima`→"Clima", `ausencia_personal`→"Ausencia de personal", `proveedor`→"Proveedores", `problema_tecnico`→"Problema técnico", `equipos_maquinaria`→"Equipos y maquinaria", `seguridad`→"Seguridad"). Largo de barra = `mentions`, segmento interno más oscuro = `mentions_followed_by_delay`.

---

### I-16 · Velocidad de reacción a alertas — **P2** — ♻️ expone `alert_reaction`, ya calculado

**Pregunta:** ¿cuánto tardamos, en promedio, en resolver una alerta una vez que salta?

**Fuente:** `ObraStatsService._alert_reaction()` — horas entre `created_at` y `resolved_at` por tipo de alerta, más el conteo de alertas sin resolver por tipo (`alerts_unresolved_by_type`).

**Casos borde:**
- `alerts_measured == 0` (obra nueva o sin alertas resueltas con timestamp) → no se muestra.
- `alerts_resolved_without_timestamp > 0` (alertas resueltas antes de la migración 0062, sin `resolved_at`) → nota chica debajo de la tabla; no altera el promedio.

**Visual:** tabla compacta en el acordeón, un tipo de alerta por fila, ordenada por `avg_hours` descendente (la que peor se atiende arriba). `avg_hours` se muestra en horas o en días si supera 48h, con badge si `unresolved` > 0 para ese tipo.

---

### Resumen

| # | Indicador | Estado | Cadencia | Prioridad |
|---|---|---|---|---|
| I-01 | Avance real ponderado | 🆕 corrige el actual | vivo | **P0** |
| I-02 | Avance planificado | 🆕 | vivo | **P0** |
| I-03 | SPI | 🆕 | vivo | **P0** |
| I-04 | Fin proyectado | 🆕 | vivo | **P0** |
| I-09 | Alertas por severidad | ♻️ reformulado | vivo | **P0** |
| I-05 | Curva S | 🆕 + tabla nueva | diario | P1 |
| I-06 | Desvío vs. línea base | 🆕 rollup | vivo | P1 |
| I-07 | Holgura y ruta crítica | 🆕 agregado | vivo | P1 |
| I-08 | Hitos | 🆕 | vivo | P1 |
| I-10 | Cuello de botella | ♻️ ya existe en digest | vivo | P1 |
| I-11 | Ejecución de materiales | ♻️ ya existe en API | vivo | P1 |
| I-12 | Concentración 80/20 | ♻️ snapshot | mensual | P2 |
| I-13 | Precisión de estimación | ♻️ snapshot | mensual | P2 |
| I-14 | Evidencia de desvíos (problemas) | 🆕 expone snapshot | mensual | P1 |
| I-15 | Temas recurrentes de bitácora | 🆕 expone snapshot | mensual | P1 |
| I-16 | Velocidad de reacción a alertas | ♻️ expone snapshot | mensual | P2 |

**5 P0 son todos nuevos y ninguno necesita esquema nuevo** — salen de campos que ya existen. La única tabla nueva es para la curva S (P1).

---

## 5. Cambio de esquema: histórico de avance diario

Lo necesitan I-05 (curva S) y el sparkline P2 de I-07. **Ningún P0 depende de esto** — se puede diferir sin bloquear el panel.

```sql
CREATE TABLE obra_progress_daily (
  id             SERIAL PRIMARY KEY,
  obra_id        INT NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  tenant_id      INT NOT NULL REFERENCES tenants(id),
  date           DATE NOT NULL,
  progress_real       NUMERIC(5,2),   -- I-01 ese día
  progress_planned    NUMERIC(5,2),   -- I-02 ese día
  spi                 NUMERIC(5,3),
  tasks_total         INT,
  tasks_completed     INT,
  critical_task_count INT,
  median_float_days   NUMERIC(6,2),
  UNIQUE (obra_id, date)
);
CREATE INDEX ix_obra_progress_daily_obra_date ON obra_progress_daily (obra_id, date);
```

**Job:** se suma al `AsyncIOScheduler` que ya corre alertas, recordatorios y snapshots mensuales. **No se introduce un scheduler nuevo.**

```python
CronTrigger(hour=2, minute=30)      # todos los días, 2:30 AM
id="obra_progress_daily"
misfire_grace_time=6*3600
```

Procesa las obras activas con el mismo criterio que el job mensual (`status ∉ {completada, cancelada}`), y una obra que falla no tumba el job.

**Decisiones:**
- **`UNIQUE (obra_id, date)` + upsert:** correr el job dos veces el mismo día pisa la fila, no la duplica. Hace el job idempotente y re-ejecutable a mano.
- **Se guarda el resultado, no los insumos:** la fila es un valor ya calculado. Si la fórmula de avance cambia en el futuro, la historia vieja queda con la fórmula vieja. Es el precio de no tener replay, y es aceptable: la alternativa (recalcular todo el histórico en cada cambio de fórmula) exige guardar el estado completo de todas las tareas cada día.
- **No se backfillea.** Ver I-05.
- **Volumen:** una fila por obra por día. 50 obras activas = 18k filas/año. No es un problema.

---

## 6. Contrato de API

### `GET /obras/{obra_id}/dashboard`

Todo lo que se calcula en vivo, en **una sola llamada**. El panel no debe hacer 6 requests para pintarse.

Permiso: `require_obra_role(SOLO_LECTURA)` — el mismo que `/critical-path`.

```jsonc
{
  "computed_at": "2026-10-02T14:03:00Z",
  "as_of": "2026-10-02",

  "progress": {
    "real_percent": 42.7,
    "planned_percent": 51.3,
    "spi": 0.83,
    "spi_confidence": "high",          // high | low | null
    "days_behind": 6,                   // negativo = adelantado
    "tasks_total": 34,
    "tasks_completed": 12,
    "available": true
  },

  "forecast": {
    "projected_end_date": "2026-11-23",
    "expected_end_date": "2026-11-09",
    "deviation_working_days": 14,
    "method": "spi",
    "available": true,
    "reason": null                      // p.ej. "spi_unreliable" cuando available=false
  },

  "baseline": {
    "available": true,
    "saved_at": "2026-08-01",
    "end_deviation_days": 11,
    "tasks_deviated": 9,
    "tasks_total_in_baseline": 28,
    "tasks_added_after_baseline": 6,
    "avg_deviation_days": 4.2
  },

  "critical_path": {
    "available": true,
    "critical_task_count": 7,
    "at_risk_task_count": 4,            // 0 < float <= 3
    "slack_task_count": 18,
    "median_float_days": 9.0,
    "coverage_percent": 82.4,
    "partial": true                     // coverage < 100
  },

  "milestones": {
    "available": true,
    "items": [
      { "task_id": 88, "title": "Fin de estructura", "due_date": "2026-10-15",
        "completed_date": null, "state": "en_riesgo", "float_days": 1 }
    ]
  },

  "alerts": {
    "critica": 2, "alta": 5, "media": 3, "baja": 1,
    "oldest_critical_age_days": 6
  },

  "bottleneck": {
    "available": true,
    "task_id": 41, "title": "Hormigonado de losa",
    "blocked_task_count": 7, "status": "bloqueada", "overdue_since": "2026-09-28"
  },

  "materials": {
    "available": true,
    "total_estimado": 4820000.0, "total_pedido": 3100000.0, "total_recibido": 1950000.0,
    "percent_committed": 64.3, "percent_received": 40.5,
    "alignment_delta": -2.2             // % recibido − avance real
  },

  "data_quality": {
    "tasks_without_dates": 5,
    "tasks_without_responsible": 3,
    "tasks_without_dependencies": 12,
    "milestones_without_dates": 0
  }
}
```

**Reglas del contrato — no negociables para que el panel sea honesto:**

1. **Cada bloque tiene `available`.** El frontend nunca decide si un dato es válido: lo dice el backend. Si `available: false`, el bloque trae `reason` con un código estable (`no_tasks`, `no_dates`, `no_baseline`, `no_dependencies`, `spi_unreliable`, `no_materials`) que el front mapea a su estado vacío.
2. **Nunca se manda 0 en lugar de "no calculable".** Un 0 real y un "no sé" se ven igual en pantalla y significan lo opuesto.
3. **`data_quality` viaja siempre**, aunque todo esté disponible: es lo que alimenta las advertencias de dato parcial y engancha con `ObraCompletenessChecklist`, que ya existe.

### `GET /obras/{obra_id}/dashboard/curva-s?from=&to=&granularity=week`

Endpoint aparte porque es una serie, se pide bajo demanda y no debe encarecer la carga del panel.

```jsonc
{
  "granularity": "week",
  "tracking_since": "2026-09-15",       // primer punto real disponible
  "points": [
    { "date": "2026-09-15", "planned": 22.0, "real": 19.4 },
    { "date": "2026-09-22", "planned": 28.5, "real": 23.1 },
    { "date": "2026-09-29", "planned": 35.0, "real": null }   // null = sin dato ese día
  ]
}
```

`planned` se calcula al vuelo para todo el rango (es determinístico); `real` sale de `obra_progress_daily` y es `null` antes de `tracking_since`. **`null` ≠ 0**: el gráfico corta la línea, no la manda al piso.

### Lo mensual sigue por su camino

I-12 e I-13 se leen del último `ObraStatsSnapshot` vía los endpoints de insights que ya existen. **No se recalculan en vivo** y se muestran con su `period` y `computed_at` visibles.

**Extensión I-14/I-15/I-16:** mismo endpoint (`GET /obras/{obra_id}/dashboard/monthly-insights`), mismo snapshot, tres claves nuevas en la respuesta — no hay endpoint nuevo:

```jsonc
{
  "available": true,
  "period": "2026-08",
  "computed_at": "2026-09-01T02:35:00Z",
  "risk_concentration": { /* ya existe, sin cambios */ },
  "estimation_accuracy": { /* ya existe, sin cambios */ },

  "top_deviations": {
    // Tal cual devuelve _top_deviations() — items completos (bitácora, alertas,
    // historial, cascade_impact). El front consume solo el subset curado (I-14);
    // el resto queda disponible para quien pegue directo a la API.
    "count": 3,
    "items": [ /* ... */ ]
  },
  "bitacora_themes": {
    // Tal cual devuelve _bitacora_themes().
    "categories": [ /* ... */ ]
  },
  "alert_reaction": {
    // Tal cual devuelve _alert_reaction().
    "by_type": [ /* ... */ ]
  }
}
```

Sin filtro de rol nuevo: a diferencia de `risk_concentration.by_responsible` (D-01), estas tres claves no traen ranking por persona — `top_deviations` es evidencia por tarea sin `responsible_id` expuesto en el subset que consume el front (D-04), y `bitacora_themes`/`alert_reaction` son agregados por categoría/tipo, no por persona. Viajan igual para todos los roles.

---

## 7. Layout

Reemplaza el contenido actual del tab **Resumen** de `ObraDetailPage`. No es un tab nuevo: el Resumen es exactamente el lugar donde esto va, y hoy está subutilizado.

```
┌───────────────────────────────────────────────────────────────────┐
│ ⚠  «Hormigonado de losa» está frenando 7 tareas        [Ver →]    │  I-10 (si aplica)
├───────────────────────────────────────────────────────────────────┤
│  ╭─ Avance ─────╮  ╭─ SPI ────────╮  ╭─ Fin previsto ╮  ╭─ Alertas╮│
│  │   ◍  42.7%   │  │    0.83      │  │  23 nov 2026  │  │   2     ││  I-01..I-04, I-09
│  │  plan: 51.3% │  │  Atrasado    │  │  +14 días     │  │ críticas││
│  │  12 de 34    │  │  6 días atrás│  │               │  │ +9 más  ││
│  ╰──────────────╯  ╰──────────────╯  ╰───────────────╯  ╰─────────╯│
├───────────────────────────────────────────────────────────────────┤
│  Curva de avance                              [semana|mes]         │  I-05
│  ▁▂▃▄▅▆▇ planificado (gris)  ▁▂▃▄▅ real (naranja)   │hoy           │
├───────────────────────────────────────────────────────────────────┤
│  ╭─ Ruta crítica ──────────╮  ╭─ Línea base ────────────────────╮ │  I-07, I-06
│  │ 7 críticas · 4 en riesgo│  │ +11 días · 9 de 28 desviadas    │ │
│  │ ▓▓▓░░░░░░  hol. med. 9d │  │ 6 tareas nuevas post-baseline   │ │
│  ╰─────────────────────────╯  ╰─────────────────────────────────╯ │
├───────────────────────────────────────────────────────────────────┤
│  Hitos   ◆────◆────◆────◇────◇                                    │  I-08
├───────────────────────────────────────────────────────────────────┤
│  Materiales  ▓▓▓▓▓▓░░░░  64% comprometido · 40% recibido          │  I-11
├───────────────────────────────────────────────────────────────────┤
│  ▸ Análisis del período (snapshot 2026-09)              [colapsado]│  I-12..I-16
│      Tareas con mayor desvío (con evidencia)                       │  I-14
│      Por responsable                                               │  I-12
│      Problemas recurrentes en bitácora                             │  I-15
│      Precisión de estimación por disciplina                        │  I-13
│      Velocidad de reacción a alertas                                │  I-16
└───────────────────────────────────────────────────────────────────┘
```

**Por qué este orden:** de arriba abajo va de *"qué hago ahora"* a *"qué aprendo para la próxima"*. El cuello de botella arriba de todo porque es accionable hoy; el análisis mensual colapsado abajo porque es material de reunión.

**Estilos:** inline, `'Plus Jakarta Sans'`, paleta existente (`#FF6B35` acción, `#1F8A5B` ok, `#D97706` atención, `#D03A3A` alarma, `#1A2329` texto). Los tiles reusan `kpiTileStyle`/`kpiLabelStyle` de `ResumenTab.tsx:149`. El anillo de progreso reusa el SVG de `ResumenTab.tsx:21`. **No se introduce ninguna librería de gráficos nueva**: la curva S es un `<path>` SVG con dos polilíneas, la barra apilada ya tiene precedente en la distribución por estado, y la línea de hitos son rombos posicionados. Meter Recharts por dos gráficos no se justifica.

**Responsive:** los 4 tiles pasan a 2×2 por debajo de 900px y a 1 columna en mobile. La curva S mantiene alto fijo y scrollea horizontal si hace falta.

---

## 8. Qué queda afuera, y por qué

Decidir qué **no** mostrar es la mitad de este documento. Cada uno de estos parece obvio y tiene una razón concreta para no estar:

**CPI y Earned Value de costo.** El estándar pide CPI junto al SPI, pero CONSTRUCTA **no tiene costo real**: tiene materiales cargados por tarea con precio unitario, sin mano de obra, subcontratos ni equipos — que en una obra son la mayor parte del costo. Un CPI calculado sobre eso sería un número con nombre serio y contenido falso, y la gente tomaría decisiones de plata con él. En su lugar va I-11 con su alcance declarado. **Si en el futuro se cargan certificaciones o costos de mano de obra, este es el primer indicador a agregar.**

**Productividad por responsable.** Técnicamente sale (tareas completadas / días asignados). Se descarta por dos razones: es fácil de malinterpretar (a quien le tocan las tareas difíciles le da mal) y convierte una herramienta de coordinación en una de evaluación de desempeño, que cambia cómo la gente reporta. El día que el capataz sospecha que reportar un bloqueo le baja el puntaje, deja de reportar bloqueos — y ahí se muere el producto entero.

**Predicción de retraso con IA.** Hay tentación de mandarle el snapshot a un modelo y pedirle una predicción. Va contra la regla de oro: el panel es determinístico y verificable a mano. La IA ya tiene su lugar en el informe mensual, que es narración sobre datos calculados, no cálculo.

**Índice de riesgo compuesto** (un solo número 0-100 que resuma la salud). Suena bien y es humo: los pesos son arbitrarios, y cuando marca 62 nadie sabe qué hacer. Cinco indicadores con nombre propio y acción asociada son más útiles que uno que promedia todo.

**Clima.** Las bitácoras ya se categorizan por clima (I-13 lo usa) pero no hay integración meteorológica ni días de lluvia registrados como tales. Sin ese dato, "días perdidos por clima" sería una estimación por keywords sobre otra estimación.

---

## 9. Decisiones tomadas y lo que queda abierto

### Decisiones cerradas

**D-01 · El ranking de retraso por responsable (I-12) se muestra solo a `admin`.** El ranking por tarea queda visible para todos. Se filtra en el backend, no en el frontend. Fundamento y detalle en la ficha I-12.

**D-02 · El fix del portfolio entra en la misma entrega que I-01.** `PortfolioPage.tsx:538` promedia hoy `completed_tasks/total_tasks`; al cambiar la definición de avance quedaría mostrando 35% donde el detalle de obra muestra 42% para la misma obra. Se resuelve exponiendo `real_percent` en `ObraService.list_all` (que hoy solo manda `completed_tasks`/`total_tasks`) y usándolo en la tarjeta y en el promedio del portfolio. Es chico, pero **no puede quedar para después**: un producto que muestra dos avances distintos para la misma obra en dos pantallas pierde la confianza en las dos. Dejó de ser el paso 7 del plan y pasó a ser parte del paso 3.

**D-03 · El cambio del % de avance se comunica con un tooltip permanente en el indicador**, no con una nota de release ni con un aviso por única vez. Resuelve el día del despliegue y también al usuario que entra por primera vez seis meses después, sin construir infraestructura de "visto una vez". Texto exacto en la ficha I-01.

**D-04 · La evidencia de desvíos (I-14) no expone `responsible_id` ni `triggered_by` en la tarjeta.** El paquete crudo de `_top_deviations()` los trae, pero la UI muestra evidencia sobre una *tarea* (bitácora, alertas, cascada), no un señalamiento de quién la causó. Es el mismo argumento que ya cerró D-01 y la exclusión de "productividad por responsable" en la sección 8: la evidencia completa sigue disponible por API para quien la necesite (el informe mensual con IA, por ejemplo), pero el panel que ve el equipo de obra no la convierte en un scoreboard personal.

### Lo que sigue abierto

**A-01 · Formato del documento.** El ticket dice "formato definido por Facundo" y no lo tuvimos al escribir. Esta estructura sigue la de los demás `docs/features/*.md` del repo. Si hay plantilla propia, reformatear es barato — pero conviene confirmarlo antes de darlo por entregado.

**A-02 · Regla de riesgo por SPI — fuera de alcance, a propósito.** El motor de riesgos tiene 11 reglas y ninguna mira el SPI; una obra con SPI < 0.85 sostenido durante días es exactamente lo que una alerta debería avisar. **No se propone acá**: toca `risk_service.py`, `SystemSettings` y una migración de configuración, y es alcance de otro ticket. Queda anotado como pendiente identificado, que es lo correcto para un hallazgo que aparece mientras se diseña otra cosa.

## 10. Plan de implementación sugerido

Orden pensado para que cada paso deje algo usable en pantalla, no para que todo aterrice al final.

| Paso | Alcance | Deja usable |
|---|---|---|
| 1 | `working_days_between` en `calendar_service` + módulo de cálculo (3.2–3.4) + tests con obra de ejemplo verificada a mano | nada visible, pero es la base de todo |
| 2 | `GET /obras/{id}/dashboard` con `progress`, `forecast`, `alerts`, `data_quality` | los 5 P0 |
| 3 | Frontend: banda de KPIs + tooltip de I-01 (D-03) + estados vacíos + I-10, **y `real_percent` en el listado del portfolio (D-02)** | panel P0 completo y consistente con el portfolio |
| 4 | `baseline`, `critical_path`, `milestones`, `materials` en el mismo endpoint + su UI | I-06 a I-08, I-11 |
| 5 | Tabla `obra_progress_daily` + job diario + endpoint curva-s + gráfico | I-05 |
| 6 | Acordeón mensual leyendo el snapshot, con `by_responsible` filtrado por rol (D-01) | I-12, I-13 |
| 7 | Extender `get_monthly_insights` con `top_deviations`, `bitacora_themes`, `alert_reaction` (mismo snapshot, sin migración) + tarjetas de evidencia, barras de temas y tabla de reacción en el acordeón (D-04) | I-14, I-15, I-16 |

**Sobre los tests:** cada indicador de la sección 4 tiene fórmula cerrada y casos borde explícitos — se pueden testear con una obra fixture de ~6 tareas donde los números se verifican a mano, igual que hizo `test_obra_stats.py` con las 5 métricas mensuales. Los casos borde de cada ficha **son la lista de tests**, no una aclaración al margen: obra sin tareas, sin fechas, sin baseline, sin dependencias, SPI con planificado en cero, y tarea bloqueada conservando su avance.
