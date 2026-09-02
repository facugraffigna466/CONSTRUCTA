# Motor de insights — Etapas 1 y 2: disparo mensual + estadísticas determinísticas

> **Estado:** implementado (rama `feat/insights-etapa-2-estadisticas`).
> **Alcance de este documento:** el job mensual y el cálculo de las 5 métricas. **No** incluye la etapa 3 (redacción con IA), la plantilla de email ni el envío — eso se construye después y **consume el JSON documentado acá**.
> **Regla de oro de estas dos etapas:** ninguna métrica usa un modelo de lenguaje. Todo sale de SQL/Python y es verificable a mano.

---

## 1. Arquitectura

| Pieza | Archivo |
|---|---|
| Job mensual (APScheduler ya existente) | `backend/app/core/scheduler.py` → `_job_obra_stats_snapshots` |
| Motor de cálculo | `backend/app/services/obra_stats_service.py` → `ObraStatsService` |
| Modelo / tabla de salida | `backend/app/models/obra_stats_snapshot.py` → `ObraStatsSnapshot` |
| Migración | `backend/alembic/versions/0062_obra_stats_snapshots.py` |
| Tests | `backend/tests/test_obra_stats.py` (13 tests) |

### Etapa 1 — Disparo

**Programado:** se agregó un job al scheduler que ya usa el sistema para alertas y recordatorios (APScheduler, `AsyncIOScheduler`, timezone `America/Argentina/Buenos_Aires`). No se introdujo ningún scheduler nuevo.

```python
CronTrigger(day=1, hour=4, minute=0)   # día 1 de cada mes, 4 AM
id="obra_stats_snapshots"
misfire_grace_time=6*3600              # si el server estuvo caído, corre igual dentro de 6 h
```

Procesa **todas las obras activas**, definidas como *toda obra cuyo status no sea `completada` ni `cancelada`* (es decir: `planificada`, `en_progreso` y `pausada`). Una obra que falla no tumba el job: el error se loguea y sigue con la siguiente.

**Manual:** dos funciones invocables directo, sin endpoint HTTP, que abren su propia sesión de DB:

```python
# Una obra puntual
python -c "import asyncio; from app.services.obra_stats_service import run_obra_snapshot; \
           print(asyncio.run(run_obra_snapshot(5, '2026-09')))"

# Todas las obras activas
python -c "import asyncio; from app.services.obra_stats_service import run_all_active_snapshots; \
           print(asyncio.run(run_all_active_snapshots('2026-09')))"
```

Desde un test o con una sesión ya abierta, se usa el servicio directo: `await ObraStatsService(db).snapshot(obra_id, "2026-09")`, o `.compute(...)` si se quieren los números sin persistir nada.

### Alcance temporal — decisión importante

Cada snapshot cubre un mes (`period`, `"YYYY-MM"`), pero **las métricas se calculan acumuladas hasta el fin de ese mes**, no solo con los datos del mes. Un desvío de cronograma o una concentración 80/20 no son magnitudes mensuales: con 4 bitácoras de un mes no hay muestra para hablar de correlación.

Consecuencia útil: la etapa de IA puede derivar la variación mes a mes **comparando dos snapshots consecutivos** (`2026-08` vs `2026-09`), que es más informativo que un cálculo mensual aislado.

Además, los snapshots son **reproducibles**: una tarea completada *después* del fin del período se trata como abierta a esa fecha (el snapshot de junio no puede "saber" que la tarea cerró en julio). Recalcular un mes viejo devuelve siempre lo mismo.

---

## 2. Cambio de esquema necesario: `alerts.resolved_at`

La métrica 5 pide el tiempo entre creación y resolución de una alerta. **Ese dato no existía**: `alerts` solo tenía `is_read` (booleano), que dice *si* se resolvió pero no *cuándo*.

La migración `0062` agrega `alerts.resolved_at` (nullable) y el código lo setea en **todos** los caminos que marcan una alerta como leída:

| Camino | Archivo |
|---|---|
| `AlertService.mark_read` (marcar leída desde la app) | `services/alert_service.py` |
| `mark_read_by_task_and_type` (auto-resolve por tipo) | `repositories/alert.py` |
| `mark_read_by_task_and_fragment` (auto-resolve dirigido) | `repositories/alert.py` |
| `mark_read_by_task` (antes de borrar una tarea) | `repositories/alert.py` |
| `mark_all_read` (marcar todas) | `repositories/alert.py` |

**Las alertas resueltas antes de esta migración quedan con `resolved_at = NULL`** y se excluyen del promedio. El snapshot reporta cuántas fueron en `alert_reaction.alerts_resolved_without_timestamp` — así la etapa de IA sabe sobre cuánto *no* está hablando. La métrica se vuelve significativa a medida que se acumulan alertas resueltas después de la migración.

---

## 3. Decisiones tomadas donde el prompt pedía elegir criterio

| Decisión | Valor elegido | Por qué | Dónde se ajusta |
|---|---|---|---|
| **Ventana de correlación** (métrica 2) | **5 días** | Una semana laboral: si el material que faltaba el lunes frena algo, se nota dentro de esa semana. Subirlo infla artificialmente la correlación (más chances de encontrar *cualquier* retraso); bajarlo la vuelve ciega a efectos diferidos. | `CORRELATION_WINDOW_DAYS` |
| **Top N de concentración** (métrica 4) | **20 %**, redondeo hacia arriba, mínimo 1 | Es el Pareto clásico y es el número que la gente reconoce ("el 20 % de las tareas explica el X % del atraso"). | `CONCENTRATION_TOP_PERCENT` |
| **Universo del 80/20** | Solo tareas **con retraso > 0** | Incluir las que cerraron en fecha diluye el percentil: "el top 20 %" pasaría a ser en realidad "casi todas las atrasadas". Se reportan igual `tasks_considered` y `tasks_with_delay` para que el dato sea auditable. | — |
| **Cantidad de desvíos documentados** (métrica 3) | **3** | El prompt pedía 2-3; con 3 hay material para un informe sin inflar el JSON. | `TOP_DEVIATIONS_COUNT` |
| **Categorías de bitácora** | 7 (ver abajo) | — | `BITACORA_THEME_SYNONYMS` |
| **Disciplina de una tarea** | Proxy por palabras clave sobre el título | `Task` **no tiene** campo de disciplina (verificado en el modelo). Se reusa `DISCIPLINE_SYNONYMS` de `plano_service.py`, como pedía el prompt. | — |

### Categorías de bitácora elegidas

Siguen el patrón de `DISCIPLINE_SYNONYMS`: matcheo por **palabra/frase completa** (`\b`) sobre texto normalizado (minúsculas sin acentos), buscando en `transcript` + `summary` + `key_points`.

| Categoría | Qué captura |
|---|---|
| `falta_material` | "falta material", "sin stock", "no llegó el material", faltantes por insumo (hormigón, hierro, cemento, ladrillos…) |
| `clima` | lluvia, tormenta, temporal, viento, granizo, helada, barro, anegado |
| `ausencia_personal` | "no vino", "faltó personal", "sin cuadrilla", licencia, enfermo, paro general, huelga |
| `proveedor` | proveedor, corralón, "demora en la entrega", "no entregaron", remito, flete |
| `problema_tecnico` | rotura, falla, defecto, "hay que rehacer", filtración, fisura, grieta, desnivel, error de replanteo |
| `equipos_maquinaria` | máquina, grúa, hormigonera, andamios, bomba, compresor, "se cortó la luz", generador |
| `seguridad` | accidente, incidente, lesión, casco, arnés, "riesgo de caída", ART |

**Limitación conocida y asumida:** es matcheo por palabras clave, **no comprensión semántica**. Un audio que dice *"no vino el camión con el hierro"* no matchea `falta_material` salvo que use una de las frases listadas. Durante el desarrollo se detectó y corrigió un falso positivo real: la keyword `"paro"` matcheaba *"se **paró** el hormigonado"* como ausencia de personal — se reemplazó por `"paro general"`. Es la misma ambigüedad que el propio `plano_service` documenta para sinónimos genéricos de una palabra.

### Qué cuenta como "retraso" para la correlación (métrica 2)

Cuatro señales objetivas, todas con timestamp propio:

| Señal | De dónde sale |
|---|---|
| `task_blocked` | historial `task_status_changed` con `payload.to == "bloqueada"` |
| `due_date_pushed` | historial `task_updated` cuya `changes.due_date` mueve la fecha **hacia adelante** |
| `cascade_reschedule` | historial `task_cascade_rescheduled` |
| `alert_task_overdue` / `alert_delay_risk` / `alert_reschedule_requested` | tabla `alerts` |

Se comparan **timestamps completos**, no solo fechas: una nota a las 9 y un bloqueo a las 15 del mismo día cuentan como correlacionados. La ventana es `[momento de la nota, momento + 5 días]`.

> **Correlación, no causalidad.** La métrica dice que *después* de mencionar X hubo un retraso dentro de la ventana. No dice que X lo haya causado. El JSON lo declara explícitamente en `bitacora_themes.note`, y la etapa de IA **no debe** presentarlo como causa comprobada.

---

## 4. Contrato del JSON de salida

Guardado en `obra_stats_snapshots.metrics`. Versionado en `schema_version` (hoy `1`) — si cambia la forma, se sube el número y la etapa de IA puede ramificar.

### Estructura de primer nivel

```jsonc
{
  "schema_version": 1,
  "obra": { "id", "name", "status", "start_date", "expected_end_date",
            "task_count", "completed_task_count" },
  "period": "2026-09",              // mes que cubre
  "period_start": "2026-09-01",
  "period_end": "2026-09-30",
  "scope": "cumulative_to_period_end",
  "computed_at": "2026-09-02T17:17:38+00:00",
  "params": { "correlation_window_days": 5, "concentration_top_percent": 20,
              "top_deviations_count": 3, "discipline_source": "keyword_proxy" },
  "data_quality": { "note", "tasks_excluded_from_deviations": { "<motivo>": n } },

  "estimation_accuracy": { /* métrica 1 */ },
  "bitacora_themes":     { /* métrica 2 */ },
  "top_deviations":      { /* métrica 3 */ },
  "risk_concentration":  { /* métrica 4 */ },
  "alert_reaction":      { /* métrica 5 */ }
}
```

### Métrica 1 — `estimation_accuracy`

```jsonc
{
  "method": "keyword_proxy",
  "note": "…la disciplina se infiere del título, no es un dato explícito del modelo…",
  "tasks_considered": 4,
  "tasks_excluded": { "sin_completar": 1, "sin_fechas_planificadas": 0,
                      "completada_despues_del_periodo": 0,
                      "fechas_reales_inconsistentes": 0 },
  "by_discipline": [
    {
      "discipline": "electricidad",        // o "sin_disciplina" si el título no matchea
      "task_count": 3,
      "avg_deviation_percent": 25.0,       // ← el número principal. + = tardó más de lo estimado
      "total_planned_days": 19, "total_actual_days": 20,
      "avg_planned_days": 6.3, "avg_actual_days": 6.7,
      "tasks": [
        { "task_id": 12, "title": "…",
          "planned_days": 5, "actual_days": 10,
          "deviation_days": 5, "deviation_percent": 100.0,
          "actual_start": "2026-06-01",
          "actual_start_source": "historial_status_changed" }
      ]
    }
  ]
}
```

**Cómo se calcula (verificable a mano):**
- `planned_days = due_date - start_date + 1` (inclusive, igual que la barra del Gantt).
- `actual_days = completed_date - inicio_real + 1`.
- `inicio_real`: **no existe columna `actual_start_date`** en el modelo. Se reconstruye del primer evento de historial que puso la tarea en `en_progreso` (por la app o por el chatbot). Si nunca hubo ese evento, cae a `start_date` planificada — y lo declara en `actual_start_source` (`historial_status_changed` / `historial_task_updated` / `planned_start_date_fallback`).
- `avg_deviation_percent` = media simple de los porcentajes por tarea (no ponderada por duración).
- Ordenado de mayor a menor desvío.

### Métrica 2 — `bitacora_themes`

```jsonc
{
  "method": "keyword_proxy",
  "note": "Correlación temporal, NO causalidad…",
  "correlation_window_days": 5,
  "delay_signal_types": ["task_blocked", "due_date_pushed", "cascade_reschedule",
                         "alert_delay_risk", "alert_reschedule_requested", "alert_task_overdue"],
  "entries_analyzed": 12,
  "entries_with_any_category": 8,
  "delay_signals_total": 11,
  "categories": [
    {
      "category": "falta_material",
      "mentions": 5,                        // ← "se mencionó 5 veces…"
      "mentions_followed_by_delay": 4,      // ← "…y en 4 hubo un retraso dentro de 5 días"
      "correlation_rate": 0.8,
      "occurrences": [
        { "bitacora_id": 12, "at": "2026-06-01T09:00:00+00:00",
          "matched_keywords": ["falta material"],
          "summary": "…",
          "delay_signals": [ { "type": "task_blocked", "at": "…", "task_id": 5,
                               "historial_id": 88, "detail": "…" } ] }
      ]
    }
  ]
}
```

Ordenado por `mentions_followed_by_delay` y después por `mentions`.

### Métrica 3 — `top_deviations`

Paquete de **evidencia estructurada con IDs y fechas**. Acá no hay ninguna interpretación: la narración de "por qué pasó esto" es trabajo de la etapa de IA.

```jsonc
{
  "ranked_by": "abs(deviation_days)",
  "count": 3,
  "items": [
    {
      "task": { "task_id", "title", "status", "discipline", "responsible_id",
                "start_date", "due_date", "completed_date",
                "deviation_days": 15,            // + = terminó tarde
                "delay_days": 15,                // = max(0, deviation_days)
                "basis": "completed_vs_due",     // o "open_vs_period_end"
                "reference_date": "2026-06-25" },
      "predecessor_task_ids": [11, 12],
      "historial_events": [ { "historial_id", "event_type", "description",
                              "payload", "triggered_by", "created_at" } ],
      "bitacora_mentions": [ { "bitacora_id", "at", "categories",
                               "matched_keywords", "summary" } ],
      "alerts": [ { "alert_id", "type", "task_id", "message",
                    "created_at", "resolved_at",
                    "on_predecessor": true } ],
      "cascade_impact": { "direct_dependent_count": 1,
                          "direct_dependent_task_ids": [35],
                          "cascade_events": [ { "historial_id", "at",
                                                "affected_count", "affected_task_ids" } ],
                          "tasks_pushed_by_cascade": [35] }
    }
  ]
}
```

Detalles:
- Se rankea por **desvío absoluto**, pero se conserva el signo (una tarea que terminó *antes* también es un desvío; el informe puede ignorarla o celebrarla).
- Las tareas con desvío exactamente 0 no entran.
- `bitacora_mentions`: entradas de la obra en la ventana `[due_date - 5 días, fecha de referencia]` que mencionan alguna categoría de la métrica 2.
- `alerts`: alertas sobre la tarea **y sobre sus predecesoras** (M2M `task_dependencies` + `depends_on_id` heredado); `on_predecessor` distingue cuál es cuál.
- `historial_events`: los 30 más recientes de esa tarea, con `payload` completo.

### Métrica 4 — `risk_concentration`

```jsonc
{
  "top_percent": 20,
  "by_task": {
    "tasks_considered": 7,          // tareas medibles (con due_date, no canceladas)
    "tasks_with_delay": 7,          // universo del percentil
    "total_delay_days": 210,
    "top_task_count": 2,            // ceil(7 * 20 %) = 2
    "top_delay_days": 73,
    "concentration_percent": 34.8,  // ← "el 20 % de las tareas concentra el 34,8 % del atraso"
    "ranking": [ /* todas las atrasadas, desc, con la misma forma que top_deviations.task */ ]
  },
  "by_responsible": {
    "responsibles_with_delay": 3,
    "total_delay_days": 187,
    "top_responsible_count": 1,
    "top_delay_days": 73,
    "concentration_percent": 39.0,
    "unassigned_delay_days": 23,    // atraso de tareas sin responsable asignado
    "ranking": [ { "responsible_id": 13, "name": "Carlos Méndez",
                   "delay_days": 73, "task_count": 2 } ]
  }
}
```

`delay_days = max(0, deviation_days)` — adelantarse no compensa atraso ajeno.

### Métrica 5 — `alert_reaction`

```jsonc
{
  "note": "'Resuelta' = marcada como leída (manual o auto-resolve)…",
  "alerts_total": 11,
  "alerts_measured": 3,                          // con created_at y resolved_at
  "alerts_resolved_without_timestamp": 4,        // resueltas antes de la migración 0062
  "alerts_unresolved_by_type": { "task_overdue": 1, "delay_risk": 6 },
  "overall_avg_hours": 5.33,                     // null si no hay ninguna medible
  "by_type": [ { "type": "task_overdue", "resolved_count": 2,
                 "avg_hours": 3.0, "min_hours": 2.0, "max_hours": 4.0 } ]
}
```

Los tipos salen de los **valores reales** del enum `AlertType` presentes en los datos, no de una lista asumida: `task_blocked`, `delay_risk`, `task_overdue`, `no_response`, `reschedule_requested`, `order_received`.

### `data_quality` — sobre qué NO se está hablando

```jsonc
{ "tasks_excluded_from_deviations": {
    "completadas_sin_fecha_de_completado": 2,
    "sin_fecha_de_fin_planificada": 0,
    "canceladas": 0 } }
```

Existe por un hueco real del producto encontrado al correr el motor contra datos reales: **hoy solo el endpoint `/status` setea `completed_date`**; un `PATCH /tasks/{id}` genérico puede dejar una tarea en `completada` sin esa fecha. Medir esa tarea contra el fin del período inventaría un atraso enorme e inexistente (en la obra #5 daba 54 días), así que se excluye y se declara. **La etapa de IA debe leer este bloque**: si `completadas_sin_fecha_de_completado` es alto, las métricas 1, 3 y 4 están hablando de una fracción de la obra.

---

## 5. Tabla `obra_stats_snapshots`

| Columna | Tipo | Nota |
|---|---|---|
| `id` | serial PK | |
| `obra_id` | FK `obras.id` ON DELETE CASCADE, index | |
| `tenant_id` | FK `tenants.id`, index | denormalizado, igual que `tasks`/`alerts`/`historial` |
| `period` | `varchar(7)`, index | `"YYYY-MM"` |
| `computed_at` | timestamptz | cuándo se calculó (o recalculó) |
| `metrics` | JSON | el contrato de arriba |

`UNIQUE (obra_id, period)`: recalcular el mismo mes **pisa** la fila anterior en vez de duplicarla (`computed_at` deja constancia). Verificado en test.

---

## 6. Pruebas

### 6.1 Tests automatizados — `backend/tests/test_obra_stats.py` (13 tests, todos verdes)

Cada test arma los datos a propósito para que el resultado esperado sea calculable a mano, y el cálculo queda escrito en el docstring. Una obra distinta por test, para que los números de un caso no contaminen al otro.

| Test | Qué verifica | Cuenta a mano |
|---|---|---|
| `test_estimation_accuracy_por_disciplina` | Métrica 1 agrupa bien y promedia bien | 3 tareas de electricidad con +100 %, +25 % y −50 % → promedio **25.0 %**; 1 de sanitarios → **50.0 %**; 1 sin completar → excluida |
| `test_estimation_accuracy_sin_evento_usa_fecha_planificada` | Fallback del inicio real | Sin evento de historial → `planned_start_date_fallback`, plan 5 días vs real 7 → **+40 %** |
| `test_bitacora_themes_correlacion` | Métrica 2, ventana de 5 días | `falta_material` 2 menciones / 1 con retraso → **0.5**; `clima` 1/1 → **1.0** |
| `test_top_deviations_arma_paquete_de_evidencia` | Métrica 3 completa | Desvíos +15, +2, +1 y 0 → top 3 excluye el de 0; el peor trae sus 2 eventos de historial, la bitácora, la alerta y la cascada |
| `test_tarea_abierta_se_mide_contra_el_fin_del_periodo` | Base `open_vs_period_end` | 30/06 − 10/06 = **20 días** |
| `test_completada_despues_del_periodo_cuenta_como_abierta` | Reproducibilidad del snapshot | Cierre el 20/07 no cuenta en el snapshot de junio → **20 días**, base abierta |
| `test_completada_sin_fecha_no_inventa_atraso` | `data_quality` (caso real de la obra #5) | Completada sin `completed_date` → 0 desvíos, contador en `data_quality` |
| `test_risk_concentration_80_20` | Métrica 4, por tarea y por responsable | Atrasos 60/10/5/3/2 = **80**; top 20 % de 5 = 1 tarea = 60 → **75.0 %**; R1 60 vs R2 20 → **75.0 %** |
| `test_alert_reaction_por_tipo` | Métrica 5 | `task_overdue` 2 h y 4 h → **3.0**; `task_blocked` 10 h → **10.0**; general **5.33**; 1 sin resolver y 1 sin timestamp reportadas aparte |
| `test_marcar_alerta_leida_setea_resolved_at` | Regresión del campo nuevo | Sin `resolved_at` la métrica 5 no existe |
| `test_snapshot_se_guarda_y_es_idempotente_por_periodo` | Upsert por (obra, period) | Dos snapshots del mismo mes → **1 fila** |
| `test_snapshot_all_active_saltea_completadas_y_canceladas` | Alcance del job | Solo obras activas |
| `test_previous_period_es_el_mes_cerrado` | Cálculo del período | 02/09/2026 → `2026-08`; 01/01/2026 → `2025-12` (cruce de año) |

```
$ python -m pytest tests/test_obra_stats.py -q
13 passed

$ python -m pytest -q          # suite completa, sin regresiones
327 passed
```

### 6.2 Corrida con datos reales — obra #5, período `2026-09`

Ejecutado contra la base local (`run_obra_snapshot(5, '2026-09')`), obra *"Vivienda Unifamiliar — Barrio Jardín"*, 9 tareas, 2 completadas:

| Métrica | Resultado real | Lectura |
|---|---|---|
| **1 · Estimación** | 0 tareas medibles. Excluidas: 2 `sin_fecha_de_completado`, 7 `sin_completar` | Las 2 tareas cerradas no tienen `completed_date` → no hay nada que medir. **Es el hueco de producto descrito en §4**, no un bug del motor |
| **2 · Bitácora** | 0 entradas analizadas, 11 señales de retraso detectadas | Esta obra no tiene bitácoras cargadas; las señales existen pero no hay menciones con qué correlacionarlas |
| **3 · Desvíos** | 3 items: #36 *Estructura y losa* (39 d), #39 *Instalaciones sanitarias* (34 d), #40 *Instalaciones eléctricas* (34 d), todos `open_vs_period_end`. El peor trae 2 eventos de historial, 2 alertas y 1 dependiente directo | Evidencia lista para que la IA redacte |
| **4 · Concentración** | 7 tareas con atraso, **210 días** totales; top 20 % = 2 tareas = 73 días → **34.8 %**. Por responsable: Carlos Méndez 73 d, Juan Pérez 65 d, Ana López 49 d; top 1 de 3 → **39.0 %**; 23 días sin responsable | El atraso está repartido, no concentrado — dato accionable de por sí |
| **5 · Alertas** | 11 alertas: 0 medibles, 4 resueltas sin timestamp, 7 sin resolver (1 `task_overdue`, 6 `delay_risk`) | Esperable el día 1: las 4 ya resueltas son previas a la migración. Se vuelve significativa con las próximas |

Job completo (`run_all_active_snapshots('2026-09')`): **4 obras activas procesadas**, una fila por obra, JSON de ~3 a 13 KB cada uno. Migración `0062` verificada en ciclo `upgrade → downgrade → upgrade` contra Postgres local.

---

## 7. Lo que NO está en estas etapas

- Llamada a la IA para redactar conclusiones narrativas.
- Plantilla y envío del email.
- Endpoint HTTP para disparar o consultar snapshots (el disparo manual es por función).
- Pantalla en el frontend.

La etapa 3 arranca leyendo `obra_stats_snapshots.metrics` con el contrato de la §4.

### Notas para quien construya la etapa 3

1. **Leer `data_quality` antes que nada.** Si hay muchas tareas excluidas, hay que matizar el informe, no afirmar sobre el total de la obra.
2. **`bitacora_themes` es correlación, no causa.** Redactar "en 4 de las 5 veces que se mencionó falta de material hubo un retraso en los días siguientes", no "la falta de material causó los retrasos".
3. **`estimation_accuracy.method == "keyword_proxy"`**: la disciplina es inferida del título. Conviene decirlo en el informe si se nombran disciplinas.
4. **`alert_reaction` puede venir vacío** los primeros meses (`alerts_measured: 0`). Ese caso hay que omitirlo del informe, no reportar "0 horas de reacción".
5. **Comparar con el snapshot anterior** (`period` previo de la misma obra) es la forma de hablar de evolución mes a mes.
