# Implementación — Detección de riesgo

**Fecha:** 2026-09-03
**Rama:** `feature/deteccion-riesgos`
**Base:** `main` (`94640f0`)
**Insumo:** [`docs/propuesta-reglas-riesgo.md`](propuesta-reglas-riesgo.md) — definición de reglas (Martina, 2026-08-31, PR #104)
**Migraciones:** `0062` → `0064`

---

## 1. Resumen ejecutivo

La propuesta de reglas de riesgo identificaba un desperdicio concreto: el sistema **ya calculaba o guardaba** ruta crítica, línea base, estado de materiales y órdenes de compra, calendario laboral con feriados e historial de eventos, pero **ninguno de esos datos se usaba para generar alertas**. Las seis reglas existentes miraban únicamente fechas de vencimiento y respuestas del chatbot.

Este trabajo implementa **las once reglas propuestas**, sin excepciones ni recortes de alcance. El sistema pasa de 6 a 17 tipos de alerta.

El aporte no es solo la cantidad de reglas. Es que **el sistema pasa de avisar que algo ya salió mal a avisar que va a salir mal**: la ruta crítica avisa antes del vencimiento, el material faltante avisa antes de que la tarea se bloquee, el hito avisa mientras todavía hay margen para reaccionar. Esa diferencia es la que separa un registro de un instrumento de gestión.

Se agregaron dos piezas transversales que la propuesta marcaba como bloqueantes: **severidad** por alerta (`critica`/`alta`/`media`/`baja`) y **configuración por empresa** (un interruptor por regla más su umbral). Ninguna regla requirió fuentes de información nuevas; solo dos necesitaron persistir estado propio, y por el mismo motivo: comparan el presente contra el pasado.

**Estado:** implementado y verificado. 39 pruebas automatizadas nuevas; la suite completa pasa de 317 a 356.

---

## 2. Las once reglas

| # | Tipo | Condición de disparo | Nivel | Severidad | Cadencia |
|---|---|---|---|---|---|
| §1.1 | `critical_task_delayed` | Tarea con holgura cero vencida o por vencer dentro del horizonte de aviso | Tarea | Crítica / Alta | 4 h |
| §1.2 | `float_shrinking` | La holgura cayó por debajo del umbral **y** bajó respecto de la corrida anterior | Tarea | Media | Diaria |
| §2.1 | `baseline_deviation` | El fin actual se corrió N días o más respecto del fin de la línea base | Tarea | Alta / Crítica | 4 h |
| §3.1 | `material_pending_too_long` | Material en `pendiente` sin pasar a `pedido` hace más de N días | Tarea | Media | 4 h |
| §3.2 | `order_sent_no_confirmation` | Pedido en `enviado` hace más de N días sin recepción confirmada | **Obra** | Media | 4 h |
| §3.3 | `material_blocking_task` | Tarea que arranca dentro de N días con materiales sin recibir | Tarea | Alta | 4 h |
| §4.1 | `progress_stalled` | Tarea en progreso sin mover el avance hace N días | Tarea | Media | Diaria |
| §5.1 | `deadline_conflicts_holiday` | Vencimiento futuro que cae en día no laborable de la obra | Tarea | Baja | 4 h |
| §6.1 | `recurring_blocker` | La misma tarea entró a `bloqueada` N veces o más | Tarea | Alta | Semanal |
| §6.2 | `chronic_no_response` | Un responsable acumula N alertas `no_response` en la ventana | **Obra** | Alta | Semanal |
| §7.1 | `milestone_at_risk` | Hito próximo con tareas predecesoras sin completar | Tarea | Crítica | 4 h |

Todas quedan **habilitadas por defecto** con los umbrales sugeridos por la propuesta. Apagarlas de entrada habría dejado la funcionalidad invisible hasta que alguien entrara a Configuración.

---

## 3. Arquitectura

### 3.1 Por qué un servicio separado

Las reglas viven en `services/risk_service.py` y no dentro de `AlertService`, que ya tenía un motor de evaluación. El motivo es el costo: `evaluate_task_risks_for_obra()` corre **en cada carga del dashboard** de una obra y solo compara fechas en memoria. Las reglas nuevas recalculan el CPM y leen línea base, materiales, órdenes, calendario e historial. Meterlas ahí habría hecho que abrir una obra dispare media docena de consultas pesadas.

### 3.2 Contexto por obra, carga perezosa

`RiskContext` carga una vez por obra lo que las reglas comparten, y **bajo demanda**: si la empresa apagó las reglas que usan el CPM, el CPM no se calcula. Cachea tareas, ruta crítica, línea base, calendario, materiales, órdenes y grafo de dependencias.

### 3.3 Registro de reglas

```python
RULES: list[RiskRule] = [
    RiskRule("risk_critical_task_delayed", "_rule_critical_task_delayed", FREQUENT),
    RiskRule("risk_float_shrinking",       "_rule_float_shrinking",       DAILY),
    RiskRule("risk_recurring_blocker",     "_rule_recurring_blocker",     WEEKLY),
    ...
]
```

Cada entrada declara el campo de configuración que la habilita, el método que la evalúa y su cadencia. **Agregar una regla es escribir el método y sumar una línea.** Una prueba recorre la tabla y falla si una regla apunta a un campo de configuración inexistente (quedaría apagada para siempre en silencio) o a una cadencia mal escrita (no la correría ningún job).

### 3.4 Emisión única

Todas las reglas emiten por `AlertService.emit()`, que centraliza las dos invariantes que la propuesta pedía sostener:

- **Deduplicación** por `(tarea u obra, tipo, mensaje)` contra alertas **no leídas**.
- **Exactamente un evento de historial** por alerta creada.

Los ayudantes anteriores (`_task_alert` / `_obra_alert`) pasaron a delegar en él, de modo que las seis reglas viejas y las once nuevas comparten el mismo camino.

### 3.5 Cadencias

Tres trabajos programados en lugar de uno:

| Cadencia | Momento | Reglas |
|---|---|---|
| Frecuente | Cada 4 h, a los :45 | Las 7 que miran el estado de hoy |
| Diaria | 06:15 | `progress_stalled`, `float_shrinking` |
| Semanal | Lunes 06:45 | `recurring_blocker`, `chronic_no_response` |

No es una preferencia estética: una regla que compara contra el snapshot de ayer **no cambia de resultado** entre las 8 y las 12 del mismo día, y correrla cada 4 horas solo gasta cómputo. Las reglas de patrón recorren meses de historial. El horario de la corrida frecuente (:45) está desfasado del trabajo de `delay_risk` (:30) para no solaparse.

---

## 4. Cambios en el modelo de datos

| Migración | Cambio | Motivo |
|---|---|---|
| `0062` | 11 valores nuevos en el enum `alert_type` | Un tipo por regla |
| `0062` | `alerts.severity` (VARCHAR + índice) con relleno de los tipos previos | Pieza transversal que la propuesta marcaba como bloqueante |
| `0063` | 23 columnas en `system_settings` (11 interruptores + 12 umbrales) | Configuración por empresa |
| `0064` | `tasks.last_progress_at` | Insumo de `progress_stalled` |
| `0064` | Tabla `task_risk_snapshots` | Insumo de `float_shrinking` |

**`severity` es VARCHAR y no un enum de PostgreSQL.** La propuesta anticipa más reglas; un VARCHAR evita pagar un `ALTER TYPE` por cada nivel nuevo. La severidad por defecto de cada tipo vive en `DEFAULT_SEVERITY` (`models/alert.py`); solo las reglas que la calculan dinámicamente la pasan explícitamente.

**`task_risk_snapshots` es una tabla y no columnas en `tasks`.** La holgura es un dato derivado y volátil que se pisa en cada corrida, no parte de la definición de una tarea. Una fila por tarea.

**`last_progress_at` se sella en `TaskRepository.update_fields()`**, un único punto de paso que cubre las tres vías por las que cambia el avance (edición manual, cambio de estado, chatbot). Solo se sella **si el valor cambió de verdad**: reguardar una tarea con el mismo 40 % no debe reiniciar el reloj de `progress_stalled`, o la regla nunca dispararía en una tarea que se edita seguido por otros motivos.

---

## 5. Decisiones de diseño

### 5.1 Los mensajes no llevan contadores volátiles

La deduplicación es por mensaje exacto. Un texto del tipo *"vence en 3 días"* cambiaría todos los días y **cada corrida crearía una alerta nueva** en lugar de deduplicar. Por eso los mensajes citan fechas absolutas y no cuentas regresivas. Está documentado en `emit()` como regla para quien agregue reglas después.

La excepción es deliberada: `chronic_no_response` **sí** incluye la cuenta, porque pasar de 3 a 5 alertas es un escalamiento que merece volver a avisar. La cadencia semanal acota el ruido.

### 5.2 Agrupar por tarea en vez de una alerta por material

La propuesta plantea `material_pending_too_long` por material. Una tarea con veinte materiales cargados el mismo día habría producido veinte alertas idénticas en intención, y el destinatario tiene **una sola acción** para todas: armar el pedido. Se agrupa por tarea y el mensaje lista los materiales; si la lista cambia, es otra situación y corresponde una alerta nueva.

### 5.3 Dos reglas van a nivel obra

`order_sent_no_confirmation` y `chronic_no_response` se emiten sin tarea asociada. Un pedido agrupa materiales de varias tareas, y un responsable que no contesta lo hace en varias: colgar la alerta de una sola sería arbitrario, y el problema no se resuelve mirando esa una.

### 5.4 `baseline_deviation` solo alerta el atraso

La propuesta dice "desviado por más de N días". Adelantarse respecto de la línea base no es un riesgo. La severidad escala: al doble del umbral pasa de alta a crítica, porque un desvío de 30 días no es el mismo problema que uno de 5.

### 5.5 `material_blocking_task` incluye tareas que ya debían haber arrancado

La propuesta dice "inicio en ≤ X días". Una tarea que tenía que arrancar hace cuatro días y sigue sin material es un problema **peor**, no menor. El mensaje distingue los dos casos ("arranca el" / "tenía que arrancar el").

### 5.6 `float_shrinking` guarda el snapshot siempre

Se actualiza haya o no alerta. Si solo se guardara al alertar, la corrida siguiente compararía contra un valor viejo y volvería a alertar lo mismo indefinidamente. En la primera corrida de una obra no hay contra qué comparar: se guarda y no se alerta. Se excluye la holgura cero —esa tarea ya es crítica y la cubre `critical_task_delayed`, de modo que la misma situación no llega por dos alertas distintas— y el centinela `9999` que el CPM devuelve para tareas sin restricciones.

### 5.7 El filtro de `recurring_blocker` se hace en memoria

Contar entradas a `bloqueada` exige leer `payload`, una columna JSON. Consultarla desde SQL obligaría a ramificar entre el operador de PostgreSQL y el de SQLite (que es el motor de las pruebas). El universo ya viene acotado por `(obra_id, event_type)`, ambos indexados.

### 5.8 El CPM se expuso sin control de acceso, explícitamente

`compute_critical_path()` exigía un `manager_id` y validaba permisos, lo que lo hacía inusable desde un trabajo programado que corre sin usuario. Se extrajo `compute_critical_path_unchecked()`; el método original quedó como envoltorio que valida y delega. El punto de entrada HTTP sigue pasando por la versión que valida.

---

## 6. Interfaz

### 6.1 Un único origen de metadatos

`AlertasTab`, `AlertBell` y `CriticalAlertToast` tenían cada uno su propio mapa exhaustivo de tipos con colores y etiquetas repetidos. Con 6 tipos se podía convivir; con 17, cada agregado obligaba a tocar tres archivos y era cuestión de tiempo que se desincronizaran. Ahora todo sale de `lib/alertMeta.ts`.

### 6.2 El color lo manda la severidad, no el tipo

Diecisiete colores sin jerarquía entre sí no le dicen al lector **qué mirar primero**. La severidad sí ordena, y es justamente el dato que las reglas calculan. La etiqueta y el ícono siguen siendo por tipo; el color, el chip de severidad y la barra de acento son por severidad. El chip aparece solo en crítica y alta: marcarlas todas equivale a no marcar ninguna.

Consecuencia directa: **el aviso emergente dispara por severidad** (crítica o alta) en lugar de por una lista de tipos que había que ampliar a mano. Para los dos tipos que estaban en esa lista el resultado no cambia — ambos son de severidad alta.

### 6.3 Compatibilidad con alertas anteriores

`severityOf()` trata como `media` toda alerta sin severidad o con un valor desconocido, en lugar de romper el renderizado. Cubre las alertas anteriores a la migración `0062`.

### 6.4 Configuración

Sección **Detección de riesgo** en Configuración: las once reglas con su interruptor y sus umbrales editables. Las reglas se declaran como dato (`RISK_RULES`) y no como JSX repetido. Un umbral vacío o en cero se ignora en lugar de guardarse: haría que la regla dispare para todo.

---

## 7. Verificación

### 7.1 Pruebas automatizadas

39 pruebas nuevas en `tests/test_risk_rules.py`. Suite completa: **356 pasando** (desde 317).

Además del disparo de cada regla, se verifica explícitamente lo que la propuesta pedía sostener:

- La deduplicación no duplica entre corridas consecutivas.
- Una alerta marcada como leída **vuelve** a dispararse si la condición persiste (detección de recurrencia).
- Cada alerta deja exactamente un evento de historial.
- El interruptor de una regla la apaga sin afectar a las demás.
- Una regla que lanza una excepción se registra y **no frena** al resto de la corrida.
- La cadencia acota efectivamente qué reglas corren.
- Las constantes de cadencia del planificador y las del servicio coinciden.

### 7.2 Verificación contra PostgreSQL real

Las pruebas corren sobre SQLite. Se creó una base PostgreSQL aparte, se aplicaron las migraciones y se sembró una obra con condiciones de riesgo reales. Resultado: **8 alertas de 7 reglas distintas**, 8 eventos de historial (la invariante se sostiene) y snapshots de holgura para las 7 tareas.

**Esa verificación destapó un defecto que las pruebas no podían ver.** El relleno de la migración `0062` comparaba la columna enum `alert_type` contra parámetros de tipo varchar; PostgreSQL no define ese operador y `alembic upgrade head` fallaba con `UndefinedFunctionError`. En SQLite el enum es un VARCHAR, así que la suite pasaba igual. Corregido con un `type::text` explícito.

Es el mismo aprendizaje metodológico que ya había dejado la integración con la mensajería, en otro plano: **hay defectos que solo aparecen ejecutando contra el motor real**.

### 7.3 Frontend

Verificación de tipos y compilación de producción sin errores. El análisis estático no suma errores nuevos respecto de `main`.

**Pendiente:** la pasada visual en el navegador de la sección de Configuración y del listado de alertas con severidad.

---

## 8. Archivos

**Backend**
`models/alert.py` (11 tipos + `AlertSeverity` + `DEFAULT_SEVERITY`), `models/settings.py` (+23 campos), `models/task.py` (`last_progress_at`), `models/task_risk_snapshot.py` (nuevo), `repositories/alert.py` (`severity` en la creación), `repositories/settings.py` (defaults por introspección), `repositories/task.py` (sellado del avance), `services/risk_service.py` (**nuevo**, el motor y las 11 reglas), `services/alert_service.py` (`emit()`), `services/task_service.py` (CPM sin validación), `core/scheduler.py` (3 trabajos), `core/socket_manager.py` (severidad en el payload), `schemas/alert.py`, `schemas/settings.py`.

**Migraciones**
`0062_alert_severity_and_risk_types.py`, `0063_settings_risk_rules.py`, `0064_task_progress_and_risk_snapshots.py`.

**Frontend**
`lib/alertMeta.ts` (**nuevo**), `types/index.ts`, `api/settings.ts`, `components/AlertasTab.tsx`, `components/AlertBell.tsx`, `components/CriticalAlertToast.tsx`, `hooks/useGlobalAlerts.ts`, `hooks/useAlertSocket.ts`, `pages/ConfiguracionPage.tsx`, `App.tsx`.

**Pruebas**
`tests/test_risk_rules.py` (**nuevo**, 39 casos).

---

## 9. Pendientes

- **Verificación visual en navegador** de la sección de Configuración y del listado de alertas con severidad.
- **Calendario por defecto.** Cuando una obra no tiene calendario configurado, el repositorio devuelve uno de lunes a sábado. Eso hace que `deadline_conflicts_holiday` marque cualquier vencimiento en domingo, aun en obras que nunca tocaron el calendario. Se dejó así —es severidad baja y un vencimiento en domingo es una señal legítima—, pero si resulta ruidoso, se acota a que dispare solo con excepciones cargadas explícitamente.
- **Notificación por WhatsApp.** Las once reglas notifican dentro de la aplicación. Enviar las de severidad crítica por WhatsApp al jefe de obra es el paso natural siguiente y no estaba en el alcance de la propuesta.
- **Auto-resolución.** Las seis reglas anteriores marcan sus alertas como leídas cuando la condición desaparece (`TaskService.update()`). Las nuevas todavía no: dependen de la lectura manual o de que la deduplicación evite el duplicado. No es una regresión —el ciclo funciona—, pero cerrarlo mejoraría la señal.
