# Diseño del estado global de la cartera — Portfolio

> **Estado:** diseño propuesto para implementar. **Este documento no implementa nada**: define qué indicadores muestra la pantalla de portfolio, con qué fórmula exacta, de qué campo salen, qué pasa cuando el dato no alcanza y cómo se ven.
> **Fase:** Dashboard Avanzado (Gantt) — 29/09 a 23/10.
> **Documento hermano:** [`dashboard-indicadores-obra.md`](dashboard-indicadores-obra.md), ya implementado (I-01 a I-16). Este documento **hereda sus definiciones** y no las repite: universo de tareas (§3.1), peso (§3.2), avance (§3.3) y avance planificado (§3.4) son los mismos. Si un número de acá se contradijera con el detalle de obra, el error está acá.
> **Regla de oro (heredada):** ningún indicador usa un modelo de lenguaje. Todo sale de SQL/Python y es verificable a mano.

---

## 1. Qué decide este documento

El dashboard de obra contesta *"¿cómo va esta obra?"* y lo contesta completo: 16 indicadores, de avance ponderado a curva S. **La pregunta del nivel cartera es otra**, y hoy no la contesta nadie:

> Tengo ocho obras. Es lunes a la mañana. **¿Cuál abro primero?**

Hoy `PortfolioPage` tiene cuatro contadores —Total obras, En progreso, Planificadas, Completadas ([`PortfolioPage.tsx:524-558`](../../frontend/src/pages/PortfolioPage.tsx#L524))— que son un censo, no un diagnóstico: dicen *cuántas* obras hay en cada estado, nunca *cuál está en problemas*. Las tarjetas muestran el avance real ponderado (ya corregido por D-02), pero un 42% no dice si va bien: falta el denominador, que es exactamente el principio P1 del documento hermano.

El resultado es que **para saber cuál obra está en rojo hay que entrar a las ocho**. El sistema ya sabe la respuesta —calcula SPI, desvío y alertas críticas por obra— y obliga a la persona a recolectarla a mano, una pantalla por vez.

Este diseño hace una sola cosa: **subir un nivel lo que ya se calcula por obra**, y ordenarlo por urgencia.

### Las tres preguntas del nivel cartera

Si un número no contesta una de estas, no entra a la pantalla. Son distintas de las cinco del documento hermano a propósito: acá no se gestiona una obra, se decide **dónde poner la atención**.

1. **¿Cuál miro primero?** → semáforo de obras ordenado por atraso, alertas críticas, obras fuera de fecha
2. **¿Cómo venimos en conjunto?** → avance de cartera vs. plan, SPI de cartera, tendencia
3. **¿Qué se viene?** → compromisos de los próximos 30 días, peor cuello de botella, obras que no se pueden medir

---

## 2. Principios

Se heredan **P1 a P5** del documento hermano (§2) sin cambios: ningún número sin denominador, lo no calculable se dice en vez de inventarse, en vivo lo que cambia hoy y batch lo que necesita muestra, ponderar por duración, y todo indicador en rojo lleva a su causa.

Se agregan dos que solo aparecen cuando hay más de una obra:

**P6 — Ranking antes que promedio.** El promedio de la cartera esconde justamente lo que se busca: seis obras impecables y dos incendiadas promedian "bien". El agregado va, porque contesta la pregunta 2, pero **el orden de la pantalla lo manda el ranking**: primero cuál está peor, después cómo va el conjunto. Un promedio arriba de todo invita a no mirar.

**P7 — Nunca comparar obras entre sí por desempeño.** El semáforo ordena por **riesgo de incumplir su propio plan**, no por cuál obra es "mejor". Una remodelación de 12 tareas y una torre de 300 no son comparables, y un ranking que las mezcle como si compitieran termina usándose para evaluar gente. Es la misma razón por la que el documento hermano descartó productividad por responsable (§8), aplicada un nivel más arriba.

---

## 3. Definiciones comunes

### 3.1 Universo de obras

El universo son las **obras visibles para quien mira, con `status ∉ {completada, cancelada}`**.

Las dos exclusiones tienen motivos distintos y conviene no confundirlos: las completadas y canceladas se van porque **no hay nada que decidir sobre ellas** (una obra terminada con SPI 0.7 se entregó tarde, y eso es historia, no una alerta); las pausadas **se quedan**, porque una obra pausada sigue teniendo compromisos y fecha de entrega, y esconderla es cómo se llega tarde a reactivarla.

**"Visibles" es una restricción de seguridad, no de UI.** [`obras.py:32`](../../backend/app/api/routes/obras.py#L32) ya distingue admin (ve todo el tenant) de no-admin (solo obras con fila en `ObraUserRole`, vía [`visible_obra_ids`](../../backend/app/core/obra_permissions.py#L96)). **El agregado se calcula sobre el conjunto visible, no sobre el tenant y después se filtra.** Si un colaborador asignado a una obra recibiera el SPI de la cartera entera, estaría infiriendo el estado de obras que no tiene permitido ver — un número agregado también es información. Con una sola obra visible, el "agregado" es esa obra, y está bien: la pantalla sigue siendo correcta, solo deja de ser interesante.

### 3.2 Peso de una obra

```
peso(obra) = Σ peso(t)   para t en el universo de tareas de la obra (§3.2 del doc hermano)
```

Es decir: **la suma de días laborables planificados de sus tareas**, no el conteo de tareas ni "una obra, un voto". Una obra de 300 tareas y una de 4 no pueden pesar igual en el avance de la cartera; y entre dos obras de 20 tareas, la de tareas largas pesa más, que es lo correcto.

Es la extensión natural de P4: si dentro de la obra se pondera por duración, entre obras también.

### 3.3 Estado de una obra (semáforo)

```
estado(obra) = sin_datos     si SPI no calculable (§I-03: sin fechas, o planificado == 0)
             = atrasada      si SPI < 0.85
             = atencion      si 0.85 <= SPI < 0.95
             = en_fecha      si SPI >= 0.95
```

**Los umbrales son los mismos del I-03**, deliberadamente: si el detalle de obra dice "Atención" y el portfolio la pinta roja, se pierde la confianza en los dos. Cuando esos umbrales cambien, cambian en un solo lugar.

`sin_datos` **no es un cuarto nivel de gravedad**: es la ausencia de medición y se muestra aparte (§I-P01), nunca al fondo del ranking mezclada con las sanas. Una obra que no se puede medir no es una obra que anda bien.

---

## 4. Los indicadores

Nomenclatura **P-xx** para no pisar los **I-xx** del documento hermano. **P0** = imprescindible; **P1** = alto valor; **P2** = deseable.

---

### P-01 · Semáforo de obras — **P0** — 🆕 nuevo

**Pregunta:** ¿cuál miro primero?

Es **el indicador central de esta pantalla**; todo lo demás es contexto. Una fila por obra del universo, ordenada por urgencia:

```
orden = (alertas_criticas > 0, estado == atrasada, -spi, -dias_atraso)
```

Por obra se muestra: nombre, estado (§3.3), avance real vs. planificado, SPI, días de atraso (`(planificado − real)/100 × duración_total_planificada`, igual que I-03), alertas críticas sin resolver y fin proyectado vs. comprometido.

**Fuente:** todo sale de [`dashboard_calc.py`](../../backend/app/services/dashboard_calc.py) —`weighted_real_progress`, `weighted_planned_progress`, `planned_span`— más un conteo de alertas agrupado. **Ninguna fórmula nueva.**

**Casos borde:**
- Obras `sin_datos` → **bloque propio al final**, con el motivo por obra (`no_tasks` / `no_dates`) y link a arreglarlo. No entran al ranking.
- Universo vacío (usuario sin obras asignadas) → estado vacío distinto del de "sin obras cargadas": *"Todavía no estás asignado a ninguna obra"*. Un no-admin sin asignaciones no está ante un sistema vacío, está ante un permiso pendiente, y decirle "creá tu primera obra" es mandarlo a un botón que no le corresponde.
- Una sola obra → se muestra igual. Es una tabla de una fila, no un error.

**Visual:** tabla densa, una fila por obra, con la barra de avance mostrando real y planificado superpuestos (la marca de planificado ya existe en `AvanceTile`). Fila entera clickeable → detalle de la obra. Convive con las tarjetas actuales como **vista alternativa** (toggle tarjetas/tabla): las tarjetas son buenas para reconocer una obra, malas para comparar ocho.

---

### P-02 · Avance de la cartera — **P0** — 🆕 nuevo

**Pregunta:** ¿cuánto llevamos hecho entre todas, y cuánto deberíamos llevar?

```
avance_cartera_real       = Σ(peso(obra) × avance_real(obra))       / Σ peso(obra)
avance_cartera_planificado = Σ(peso(obra) × avance_planificado(obra)) / Σ peso(obra)
```

Ponderado por peso de obra (§3.2). **No es el promedio de los porcentajes**: ese promedio le da a una obra de 4 tareas el mismo voto que a una de 300, y es exactamente el error que D-02 corrigió un nivel más abajo.

**Casos borde:**
- Obras `sin_datos` → **quedan fuera del numerador y del denominador**, y se declara cuántas: *"sobre 6 de 8 obras"*. Meterlas con avance 0 hundiría el número de la cartera por un problema de carga de datos, no de obra.
- Ninguna obra medible → `null` con el motivo, nunca 0.

**Visual:** el anillo de progreso que ya existe, con la marca de planificado y la leyenda de cobertura debajo.

---

### P-03 · SPI de cartera — **P0** — 🆕 nuevo

```
spi_cartera = avance_cartera_real / avance_cartera_planificado
```

Mismos umbrales, colores y reglas de confianza que I-03 (incluido `planificado < 5%` → baja confianza sin color de alarma, y `planificado == 0` → `null`, no infinito).

**Se calcula sobre el agregado ponderado, no como promedio de los SPI de cada obra.** Son cosas distintas y la segunda miente: una obra chica con SPI 0.4 movería el promedio como una grande con SPI 0.4.

**Visual:** KPI tile con el número, la etiqueta de estado y la traducción humana (*"la cartera va 9 días atrás de lo planificado"*).

---

### P-04 · Obras fuera de fecha — **P0** — 🆕 nuevo

**Pregunta:** ¿cuántas entregas están comprometidas?

```
vencidas   = count(obra : expected_end_date < hoy)                          # ya pasó la fecha
proyectadas = count(obra : fin_proyectado > expected_end_date)              # todavía no, pero va camino
```

**Son dos números separados a propósito.** Una obra vencida es un hecho consumado; una proyectada a vencer es una donde todavía se puede hacer algo, y es la única de las dos sobre la que se puede actuar hoy. Mostrarlas sumadas convierte información accionable en un titular.

**Fuente:** `expected_end_date` + el fin proyectado de I-04 (`planned_span` + SPI, ya implementado).

**Casos borde:**
- Obras con SPI de baja confianza → **no cuentan en `proyectadas`**, misma regla que I-04: una proyección sobre un SPI inestable no se muestra. Se declaran aparte como no proyectables.
- Obra sin `expected_end_date` → no cuenta en ninguno de los dos y suma a calidad de datos (P-09).

**Visual:** tile con los dos números y su etiqueta. Clickeable → semáforo filtrado.

---

### P-05 · Alertas críticas de la cartera — **P0** — ♻️ existente, hoy solo por obra

**Pregunta:** ¿qué necesita atención ahora, en toda la empresa?

I-09 ya resuelve esto por obra. Acá es cross-obra:

```
por severidad:            count(alerts : !is_read) sobre las obras visibles
criticas_por_obra:        top 3 obras por alertas críticas sin resolver
antiguedad_max_critica:   max(hoy − created_at) sobre las críticas sin resolver
```

**Sobre `is_read`:** en este sistema es la marca de resolución, no un estado de lectura por usuario — la alerta es de la obra, no de la persona, y `resolved_at` solo guarda el cuándo (ver el comentario en [`alert.py:107`](../../backend/app/models/alert.py#L107)). Es el mismo criterio que ya usa `_build_alerts` para I-09, y usar otro haría que el portfolio y el detalle de obra contaran distinto.

`antiguedad_max_critica` es el que importa, por la misma razón que en I-09: una alerta crítica de hace seis días no es un pendiente, es un proceso roto. A nivel cartera es peor, porque significa que **ninguna** de las personas con acceso la miró.

**Nota de reuso:** la campanita ([`useGlobalAlerts.ts`](../../frontend/src/hooks/useGlobalAlerts.ts)) ya trae alertas no leídas y las nombra por obra, y es tentador contar sobre ese array. **No hay que hacerlo.** Es una caché de UI que se llena por WebSocket y por un fetch inicial acotado, pensada para mostrar las últimas cinco en un dropdown; contar ahí daría un número que depende de hace cuánto está abierta la pestaña. El indicador se calcula en el backend con un `GROUP BY` sobre las obras visibles, igual que I-09 pero cross-obra.

**Visual:** tile con las críticas en rojo y el desglose por obra. Clickeable → alertas filtradas.

---

### P-06 · Compromisos de los próximos 30 días — **P1** — 🆕 rollup nuevo sobre I-08

**Pregunta:** ¿qué prometimos para las próximas semanas?

Los hitos de todas las obras visibles con `due_date` dentro de 30 días, más los ya vencidos sin completar, ordenados por fecha. Estado por hito con las reglas de I-08, ya implementadas.

**Por qué 30 días y no "todos":** un horizonte largo devuelve una lista que nadie lee. Treinta días es el horizonte donde todavía se puede reasignar gente o adelantar una compra.

**Casos borde:** ninguna obra usa hitos → no se muestra la sección (muchas obras chicas no los usan; no es un error).

**Visual:** línea de tiempo horizontal con el mismo rombo `◆` de `TaskTable` y `HitosSection`, agrupada por obra. Es lo más presentable de la pantalla para una reunión de dirección.

---

### P-07 · Peor cuello de botella de la empresa — **P1** — ♻️ ya existe, hoy solo por WhatsApp

**Pregunta:** ¿cuál es la única tarea que más conviene destrabar hoy?

[`staff_digest_service.py:311`](../../backend/app/services/staff_digest_service.py#L311) **ya calcula exactamente esto**: toma el cuello de botella de cada obra y elige el peor global por cantidad de tareas frenadas. Se manda en el digest semanal y no se ve en ninguna pantalla. Es reuso puro.

**Casos borde:** sin tareas bloqueadas ni vencidas en ninguna obra → no se muestra. Es una buena noticia, no un estado vacío que llenar.

**Visual:** banner arriba de todo, mismo tratamiento que `BottleneckBanner` en el detalle de obra, con el nombre de la obra adelante: *"«Hormigonado de losa» (Torre Sur) está frenando 7 tareas"*.

---

### P-08 · Tendencia de la cartera — **P1** — 🆕 sobre tabla existente

**Pregunta:** ¿la brecha se está agrandando o achicando?

**No necesita esquema nuevo.** [`obra_progress_daily`](../../backend/app/models/obra_progress_daily.py) —creada para la curva S (migración `0074`)— ya guarda por obra y por día `progress_real`, `progress_planned`, `spi`, `tasks_total` y `tenant_id`. Agregando por fecha sobre las obras visibles sale la curva de la cartera con las filas que el job ya viene escribiendo desde que se desplegó.

**Un problema honesto que hay que resolver antes de implementarlo:** la fila guarda porcentajes por obra, **no el peso de la obra**, así que agregar hacia atrás con §3.2 no se puede — el peso de hoy no es el que tenía esa obra en agosto. Ver decisión **D-P01**.

**Casos borde:** menos de 3 puntos → no se dibuja, con la leyenda *"El seguimiento empieza el DD/MM"*. **No se backfillea**, misma regla que I-05: inventar historia es peor que no tenerla.

**Visual:** sparkline chico al lado del SPI de cartera, no un gráfico grande. La curva S grande vive en el detalle de obra; acá alcanza con la dirección.

---

### P-09 · Calidad de datos de la cartera — **P1** — 🆕 rollup nuevo

**Pregunta:** ¿qué parte de mi cartera no puedo medir, y por qué?

```
obras_sin_tareas, obras_sin_fechas, obras_sin_baseline,
obras_sin_dependencias, obras_sin_fecha_comprometida
```

Es el complemento obligatorio de todo lo demás: **cada obra que no se puede medir es un agujero en los cinco indicadores de arriba**, y sin esto el usuario ve "cartera al 68%" sin saber que se calculó sobre 6 de 8 obras.

**Fuente:** el bloque `data_quality` que `GET /obras/{id}/dashboard` ya devuelve por obra, agregado.

**Visual:** tira discreta bajo los tiles, cada ítem clickeable a la obra que lo causa. Engancha con `ObraCompletenessChecklist`, que ya existe y resuelve lo mismo a nivel obra.

---

### P-10 · Carga de trabajo por responsable — **P2** — 🆕 nuevo, solo admin

**Pregunta:** ¿alguien está asignado a más de lo que puede?

```
por responsable (cross-obra): tareas activas asignadas, obras en las que participa,
                              tareas vencidas a cargo
```

**Esto no contradice el descarte de "productividad por responsable" (§8 del documento hermano), y la diferencia hay que escribirla en la pantalla, no solo acá.** Productividad mide *qué tan bien* trabaja alguien y castiga reportar problemas. Carga mide *cuánto* tiene asignado, que es un dato de coordinación: quien lo mira actúa sobre la asignación, no sobre la persona.

Para que la distinción no se erosione en la primera iteración: **el indicador no muestra tareas completadas, ni porcentaje de cumplimiento, ni ordena por "peor"**. Si en algún momento alguien agrega esas columnas, esto se convirtió en lo que descartamos.

**Visibilidad:** solo `admin`, filtrado **en el backend** — misma regla y mismo fundamento que D-01.

**Visual:** lista simple en un acordeón colapsado, ordenada por cantidad de tareas activas.

---

### Resumen

| # | Indicador | Estado | Prioridad |
|---|---|---|---|
| P-01 | Semáforo de obras | 🆕 | **P0** |
| P-02 | Avance de cartera | 🆕 | **P0** |
| P-03 | SPI de cartera | 🆕 | **P0** |
| P-04 | Obras fuera de fecha | 🆕 | **P0** |
| P-05 | Alertas críticas de la cartera | ♻️ cross-obra | **P0** |
| P-06 | Compromisos a 30 días | 🆕 rollup de I-08 | P1 |
| P-07 | Peor cuello de botella | ♻️ ya existe en el digest | P1 |
| P-08 | Tendencia de la cartera | 🆕 sobre tabla existente | P1 |
| P-09 | Calidad de datos | 🆕 rollup | P1 |
| P-10 | Carga por responsable | 🆕 admin | P2 |

**Ningún indicador necesita tabla nueva ni fórmula nueva.** Los cinco P0 son agregaciones de `dashboard_calc.py`, que ya está implementado y testeado.

---

## 5. Rendimiento: la única decisión de ingeniería seria

Todo lo demás de este documento es aritmética sobre datos existentes. Esto no, y hacerlo mal arruina la pantalla de entrada.

**Lo que NO hay que hacer:** llamar `ObraDashboardService.get_dashboard(obra_id)` en un `for` sobre las obras. Cada llamada hace CPM, línea base, materiales, alertas y cuello de botella —del orden de 6 a 8 queries— y el portfolio es **la primera pantalla después del login**. Con 8 obras son ~60 queries; con 30, más de 200.

**Lo que hay que hacer:** un servicio propio (`PortfolioDashboardService`) con **un número constante de queries, independiente de la cantidad de obras**:

1. Obras visibles del universo (§3.1) — 1 query
2. Tareas de todas esas obras — 1 query, `WHERE obra_id IN (...)`
3. Calendarios de esas obras — 1 query. **Hoy [`obra_service.py:70`](../../backend/app/services/obra_service.py#L70) hace `get_for_obra` dentro del loop**: es un N+1 que ya existe en producción y que este trabajo debería arreglar de paso, porque el agregado lo hereda.
4. Alertas sin resolver agrupadas por obra y severidad — 1 query con `GROUP BY`
5. Hitos a 30 días (P-06) y filas de `obra_progress_daily` (P-08) — 1 query cada uno

El cálculo por obra corre **en Python sobre las tareas ya traídas**, con las funciones puras de `dashboard_calc.py`. Son funciones sin acceso a DB justamente para esto.

**Lo que queda afuera del agregado a propósito:** CPM y línea base por obra (I-06, I-07) no se agregan. El CPM es el cálculo más caro del sistema y correrlo para toda la cartera en cada carga del portfolio no se justifica para un número que nadie pidió. Si alguna vez hace falta, el lugar correcto es la fila diaria de `obra_progress_daily`, que ya guarda `critical_task_count` y `median_float_days` por obra: el dato de ayer sirve, y sale gratis.

**Presupuesto:** que la respuesta esté por debajo de ~300 ms con 30 obras y ~2000 tareas. Si no se llega, el paso siguiente **no es cachear**: es servir P-02/P-03/P-08 desde la fila de `obra_progress_daily` del día anterior y dejar en vivo solo el semáforo. Un caché con TTL sobre una pantalla que la gente refresca para ver si cambió algo genera un bug de confianza mucho peor que 400 ms.

---

## 6. Contrato de API

### `GET /portfolio/dashboard`

Una sola llamada, calculada sobre las obras **visibles para el usuario autenticado** (§3.1). Sin parámetro de tenant: sale del token, nunca del cliente.

```jsonc
{
  "computed_at": "2026-09-10T14:03:00Z",
  "as_of": "2026-09-10",

  "portfolio": {
    "real_percent": 61.4,
    "planned_percent": 68.9,
    "spi": 0.89,
    "spi_confidence": "high",           // high | low | null
    "days_behind": 9,
    "obras_total": 8,                   // universo (§3.1)
    "obras_measured": 6,                // las que entraron al cálculo
    "available": true,
    "reason": null                      // no_obras | no_measurable_obras
  },

  "obras": [                            // P-01, ya ordenado por el backend
    { "obra_id": 12, "name": "Torre Sur", "status": "en_progreso",
      "state": "atrasada",              // en_fecha | atencion | atrasada | sin_datos
      "real_percent": 42.7, "planned_percent": 55.1,
      "spi": 0.77, "spi_confidence": "high", "days_behind": 14,
      "expected_end_date": "2026-11-09", "projected_end_date": "2026-12-04",
      "critical_alerts": 2, "reason": null }
  ],

  "unmeasurable": [                     // P-01, bloque aparte — nunca mezclado arriba
    { "obra_id": 19, "name": "Depósito Norte", "reason": "no_dates" }
  ],

  "deadlines": {                        // P-04
    "overdue": 2,
    "projected_overdue": 3,
    "not_projectable": 1,
    "no_committed_date": 1
  },

  "alerts": {                           // P-05
    "critica": 4, "alta": 11, "media": 6, "baja": 2,
    "oldest_critical_age_days": 6,
    "by_obra": [ { "obra_id": 12, "name": "Torre Sur", "critica": 3 } ]
  },

  "bottleneck": {                       // P-07
    "available": true,
    "obra_id": 12, "obra_name": "Torre Sur",
    "task_id": 41, "title": "Hormigonado de losa",
    "blocked_task_count": 7
  },

  "data_quality": {                     // P-09
    "obras_sin_tareas": 1, "obras_sin_fechas": 1, "obras_sin_baseline": 4,
    "obras_sin_dependencias": 2, "obras_sin_fecha_comprometida": 1
  }
}
```

**Reglas del contrato** — las mismas tres del documento hermano (§6), que no se renegocian:

1. **Cada bloque tiene `available` + `reason`** con códigos estables (`no_obras`, `no_measurable_obras`, `no_tasks`, `no_dates`, `spi_unreliable`, `no_milestones`). El frontend nunca decide si un dato es válido.
2. **Nunca 0 en lugar de "no calculable".**
3. **`data_quality` viaja siempre**, aunque todo lo demás esté disponible.

Y una cuarta, propia del nivel cartera:

4. **El orden de `obras` lo define el backend** (§P-01). Es parte del indicador, no una preferencia de presentación: si el frontend reordena, dos clientes muestran prioridades distintas sobre los mismos datos.

### Endpoints aparte

- `GET /portfolio/milestones?days=30` — P-06. Es una lista, se pide bajo demanda y no debe encarecer la carga del panel.
- `GET /portfolio/trend?weeks=12` — P-08. Serie desde `obra_progress_daily`.
- `GET /portfolio/workload` — P-10. Solo admin (403 para el resto, no lista vacía: son cosas distintas y confundirlas esconde un bug de permisos).

---

## 7. Layout

Reemplaza la banda de KPIs de `PortfolioPage`. **Las tarjetas de obra no se tocan**: siguen siendo la forma natural de reconocer y entrar a una obra. Lo que se agrega es la vista de tabla como alternativa (P-01).

```
┌───────────────────────────────────────────────────────────────────────┐
│ ⚠  «Hormigonado de losa» (Torre Sur) está frenando 7 tareas   [Ver →] │  P-07
├───────────────────────────────────────────────────────────────────────┤
│ ╭─ Avance cartera ─╮ ╭─ SPI ────────╮ ╭─ Fuera de fecha ╮ ╭─ Alertas ╮│
│ │   ◍  61.4%       │ │   0.89  ▁▂▃  │ │  2 vencidas     │ │    4     ││  P-02..P-05
│ │  plan: 68.9%     │ │  Atención    │ │  3 proyectadas  │ │ críticas ││
│ │  sobre 6 de 8    │ │  9 días atrás│ │                 │ │ +19 más  ││
│ ╰──────────────────╯ ╰──────────────╯ ╰─────────────────╯ ╰──────────╯│
├───────────────────────────────────────────────────────────────────────┤
│ 1 obra sin fechas · 4 sin línea base · 2 sin dependencias             │  P-09
├───────────────────────────────────────────────────────────────────────┤
│ Estado de las obras                          [tarjetas | tabla]       │  P-01
│ ● Torre Sur      42.7% / 55.1%   SPI 0.77  −14d  ⚠2   → 04 dic       │
│ ● Casa Belgrano  71.0% / 73.2%   SPI 0.97   −1d        → 18 oct       │
│ ○ Depósito Norte  sin fechas cargadas                    [Cargar →]   │
├───────────────────────────────────────────────────────────────────────┤
│ Próximos 30 días  ◆──◆────◆──────◇                                    │  P-06
├───────────────────────────────────────────────────────────────────────┤
│ ▸ Carga del equipo (solo admin)                          [colapsado]  │  P-10
└───────────────────────────────────────────────────────────────────────┘
```

**Por qué este orden:** cuello de botella arriba porque es lo accionable hoy; después el conjunto; después el ranking, que es donde la persona va a pasar el tiempo; abajo lo que se planifica y lo que se delega. La calidad de datos va **arriba del ranking, no al pie**, porque condiciona la lectura de todo lo que sigue: enterarse al final de que el 68% se calculó sobre 6 de 8 obras es enterarse tarde.

**Estilos:** inline, `'Plus Jakarta Sans'`, paleta existente (`#FF6B35` acción, `#1F8A5B` ok, `#D97706` atención, `#D03A3A` alarma, `#1A2329` texto). Se reusan `kpiTileStyle`, `ProgressRing`, `BottleneckBanner` y la línea de hitos que ya están en `ResumenTab.tsx`. **Conviene extraerlos a un módulo compartido en vez de duplicarlos** — son literalmente los mismos tiles un nivel más arriba, y duplicados se van a desincronizar en el primer ajuste de color. **Ninguna librería de gráficos nueva**: el sparkline de P-08 es un `<path>` SVG, igual que `CurvaSChart`.

**Responsive:** 4 tiles → 2×2 bajo 900px → 1 columna en mobile. La tabla del semáforo scrollea horizontal manteniendo fija la columna de nombre; en mobile cae a las tarjetas y el toggle se oculta (una tabla de 8 columnas en un teléfono no se lee).

---

## 8. Qué queda afuera, y por qué

**Índice de salud compuesto de la cartera** (un 0-100 de "cómo va la empresa"). Mismo argumento que el documento hermano rechazó a nivel obra, y más fuerte acá: los pesos son arbitrarios, y cuando marca 62 nadie sabe qué hacer. El semáforo con cuatro estados y una obra por fila dice más y lleva a algún lado.

**Costo agregado de la cartera.** Se descarta por lo mismo que CPI en §8 del documento hermano: hay materiales por tarea, sin mano de obra ni subcontratos. Sumar ocho presupuestos incompletos no da el costo de la empresa, da un número con nombre serio y contenido falso. La ejecución de materiales sigue viviendo en el detalle de obra, con su alcance declarado.

**Comparación de obras entre sí** ("Torre Sur rinde mejor que Casa Belgrano"). P7. El semáforo mide a cada obra contra su propio plan y nada más.

**Predicción de qué obra se va a atrasar, con IA.** Regla de oro. La tendencia de P-08 muestra la dirección del dato real; extrapolarla con un modelo agrega confianza, no información.

**Vista multi-tenant / consolidado entre empresas.** Fuera de alcance del producto: el aislamiento por tenant es una garantía de seguridad y este documento no la toca ni por excepción.

---

## 9. Decisiones

### Cerradas

**D-P01 · La tendencia de cartera (P-08) se agrega ponderando por `tasks_total`, no por peso de obra.** La fila de `obra_progress_daily` guarda porcentajes y `tasks_total`, pero no el peso en días laborables, y recalcular el peso histórico exigiría el estado completo de las tareas de cada día — que es exactamente el replay que §5 del documento hermano descartó. Se pondera por `tasks_total`, que sí está guardado, y **la aproximación se declara en el tooltip**: la tendencia usa conteo de tareas y el número grande de hoy (P-02) usa duración, así que pueden diferir en un punto o dos. La alternativa —agregar `total_weight` a la tabla— es una migración chica y correcta, pero solo mejora los datos **hacia adelante**: la serie vieja quedaría igual de aproximada. Si igual se agrega la columna en algún momento, este documento pasa a usarla y la nota del tooltip se saca.

**D-P02 · El agregado se calcula sobre las obras visibles, nunca sobre el tenant.** Fundamento en §3.1: un agregado también filtra información. Se implementa pasando el conjunto visible al servicio, no filtrando el resultado.

**D-P03 · El semáforo convive con las tarjetas; no las reemplaza.** Las tarjetas ganan para reconocer una obra (imagen, comitente, pin) y pierden para comparar ocho. Toggle con preferencia en `localStorage`, igual que el estado de colapso del Gantt. Reemplazarlas sería tirar una pantalla que funciona para el caso de uso más frecuente: entrar a la obra de siempre.

### Abiertas

**A-P01 · Umbral del horizonte de compromisos (P-06).** 30 días es una decisión de producto, no técnica. Si en el uso real resulta corto para obras largas, es un parámetro, no un rediseño.

**A-P02 · Regla de riesgo por SPI de cartera.** El documento hermano ya dejó anotada la regla de riesgo por SPI de obra como fuera de alcance (A-02); una alerta cuando la cartera entera cae sostenidamente sería el escalón siguiente. **No se propone acá tampoco**, por la misma razón: toca `risk_service.py` y `SystemSettings`, y es alcance de otro ticket.

---

## 10. Plan de implementación sugerido

Mismo criterio que el documento hermano: cada paso deja algo usable en pantalla.

| Paso | Alcance | Deja usable |
|---|---|---|
| 1 | `PortfolioDashboardService` con queries en bloque (§5) + arreglo del N+1 de `obra_service.py:70` + tests con fixture de 3 obras verificado a mano | nada visible; es la base y el presupuesto de performance |
| 2 | `GET /portfolio/dashboard` con `portfolio`, `obras`, `unmeasurable`, `deadlines`, `alerts`, `data_quality` | los 5 P0 servidos |
| 3 | Frontend: banda de KPIs + tabla del semáforo + toggle (D-P03) + estados vacíos + P-07, extrayendo los tiles compartidos de `ResumenTab` | pantalla P0 completa |
| 4 | `GET /portfolio/milestones` + línea de compromisos (P-06) y tira de calidad de datos (P-09) | P-06, P-09 |
| 5 | `GET /portfolio/trend` + sparkline (P-08), con el tooltip de D-P01 | P-08 |
| 6 | `GET /portfolio/workload` + acordeón admin (P-10) | P-10 |

**Sobre los tests:** los casos borde de cada ficha son la lista de tests, igual que en el documento hermano. Mínimo: cartera vacía, usuario sin obras asignadas, obra sin fechas excluida del agregado pero listada en `unmeasurable`, obra pausada incluida, obra completada excluida, SPI de baja confianza fuera de `projected_overdue`, y **un test de aislamiento**: dos tenants con obras, el agregado de cada uno ignora al otro (D-P02). Ese último no es un test de indicador, es un test de seguridad.
