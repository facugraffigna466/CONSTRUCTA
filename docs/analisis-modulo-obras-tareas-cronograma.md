# Análisis: Obras · Tareas · Cronograma (Núcleo operativo)

> Módulo auditado: el corazón del producto — gestión de obras, tareas, dependencias, ruta crítica, cronograma (Gantt), planilla, calendario laboral e historial.
> Fecha: 2026-07-02 | Rama: `main`

---

## TL;DR

El **motor algorítmico es de nivel profesional**: transiciones de estado validadas en servidor, prevención de ciclos por DFS, ruta crítica (CPM) con orden topológico de Kahn más recorridos forward/backward y holgura, reprogramación en cascada con vista previa, ajuste automático a día laboral e historial append-only real. Eso está bien hecho y es difícil de encontrar tan prolijo en proyectos de este tamaño.

El problema no está en los algoritmos sino en la **capa de autorización**: el chequeo de acceso a las tareas es un *no-op* (solo verifica que la obra exista, no el tenant ni el manager), la edición/borrado de obra exige ser el creador (rompe el modelo multi-empresa que sí respeta la lectura), y el historial de una obra se puede leer sin filtrar por tenant. Son fugas cross-tenant reales. A nivel producto faltan cosas de escala (paginación) y consistencia entre vistas (el reorden del Gantt no se persiste; el de la planilla sí).

---

## 1. Gestión de Obras

### Qué funciona

| Aspecto | Estado |
|---------|--------|
| CRUD de obra (`POST/GET/PATCH/DELETE /obras`) | ✅ |
| Alta con asistente de 4 pasos (datos, comitente, responsables, tareas) | ✅ |
| Validación `expected_end_date >= start_date` (create y update) | ✅ |
| Aislamiento multi-tenant en **listar** (`list_all(tenant_id)`) y **leer** (`get_or_raise(obra_id, tenant_id)` → 404 si es de otro tenant) | ✅ |
| Límite de plan al crear (`check_plan_limit(..., "obras")` → 402) | ✅ |
| Datos del comitente (`client_name/email/phone`) | ✅ |
| Estado de obra híbrido: automático por avance de tareas + manual (pausar/reactivar), terminales solo eliminables | ✅ (nuevo) |
| Borrado con cascada: todas las FK a `obras.id` son CASCADE (tareas, baseline, calendario, bitácora, equipo, planos, órdenes, cotizaciones) o SET NULL (alertas, presupuestos, historial) → el borrado nunca falla por FK | ✅ |
| Historial append-only por obra (`obra_created`, `obra_updated`) | ✅ |

### Gaps detectados y cómo resolverlos

---

#### Gap 1 — Editar/borrar obra exige ser el *manager* creador (rompe el modelo multi-empresa)

**Impacto:** Alto

La lectura de obras es **por-tenant** (todos los de la empresa ven todas las obras), pero `update` y `delete` pasan por `get_for_manager()`, que hace:

```python
# obra_service.py
async def get_for_manager(self, obra_id: int, manager_id: int) -> Obra:
    obra = await self.get_or_raise(obra_id)
    if obra.manager_id != manager_id:
        raise ForbiddenError("You are not the manager of this obra")
    return obra
```

Es decir: si el Admin A crea una obra, el Admin B (misma empresa) la **ve** pero recibe **403** al intentar editarla, borrarla o **cambiarle el estado** (la pastilla que agregamos usa `PATCH /obras/{id}` → `update` → `get_for_manager`). Un colaborador, lo mismo. Esto contradice el diseño multi-tenant donde las obras son de la empresa, no de una persona.

**Solución profesional — autorización por tenant + rol, no por creador:**

```python
# Reemplazar get_for_manager por una verificación de tenant (+ rol si aplica):
async def _assert_can_write(self, obra: Obra, user: User) -> None:
    if obra.tenant_id is not None and obra.tenant_id != user.tenant_id:
        raise NotFoundError("Obra", obra.id)      # otro tenant → 404
    # opcional: si se decide que solo admin puede editar/borrar obras:
    # if user.role != "admin":
    #     raise ForbiddenError("Solo un administrador puede modificar obras")
```

El `manager_id` sirve para saber **quién** creó la obra (auditoría, avatar), no para gatear el acceso. El acceso debe ser por `tenant_id`.

**Esfuerzo estimado:** 2-3h (tocar `update`, `delete` y revisar todos los llamados a `get_for_manager`)

---

#### Gap 2 — `GET /obras/{id}/historial` no filtra por tenant (fuga cross-tenant)

**Impacto:** Alto — seguridad

El endpoint de historial llama a `get_or_raise` **sin** `tenant_id`:

```python
# routes/obras.py
@router.get("/{obra_id}/historial", ...)
async def get_obra_historial(obra_id, db, _: CurrentUserId, limit=50):
    await ObraService(db).get_or_raise(obra_id)          # ← falta tenant_id
    return await HistorialRepository(db).list_by_obra_limited(obra_id, limit)
```

Con `tenant_id=None`, `get_or_raise` **saltea** el chequeo de tenant. Un usuario de la empresa A puede pedir `GET /obras/{id_de_empresa_B}/historial` y leer el historial de otra empresa (IDOR).

**Solución profesional:**

```python
async def get_obra_historial(obra_id, db, current_user: CurrentUser, limit=50):
    await ObraService(db).get_or_raise(obra_id, tenant_id=current_user.tenant_id)
    ...
```

**Esfuerzo estimado:** 15 min. **Recomendación:** auditar de una todos los usos de `get_or_raise` / `_get_obra_and_assert_access` que reciben `CurrentUserId` en vez de `CurrentUser` — son los candidatos a fuga (ver Gap del módulo Tareas).

---

#### Gap 3 — Crear/eliminar obra está disponible para colaboradores

**Impacto:** Medio (según intención de producto)

`create_obra` y `delete_obra` usan `CurrentUser`/`CurrentUserId` (cualquier autenticado). Un colaborador puede crear obras (si el plan lo permite) y borrar las que él creó. En un SaaS B2B de construcción, dar de alta/baja obras suele ser una acción de **administrador/jefe de obra**, no de cualquier colaborador.

**Solución profesional:** gatear con la dependency `AdminUser` (ya existe) los endpoints de alta y baja de obra, o al menos el borrado:

```python
@router.delete("/{obra_id}", ...)
async def delete_obra(obra_id: int, db: DbSession, current_user: AdminUser):
    await ObraService(db).delete(obra_id, current_user)
```

**Esfuerzo estimado:** 30 min

---

#### Gap 4 — El borrado deja huérfanos (presupuestos y alertas con `obra_id=NULL`)

**Impacto:** Bajo-Medio

Al borrar una obra, `budgets` y `alerts` hacen `SET NULL` (no cascade). Quedan filas con `obra_id=NULL` que ensucian las vistas de presupuestos/alertas y ya no se pueden asociar a nada. El historial también es SET NULL, pero ahí es intencional (append-only, se preserva la traza).

**Solución profesional:** decidir por tabla:
- **Presupuestos:** cascade (borrar con la obra) o mover a un tenant-level "sin obra". Hoy SET NULL los deja colgados.
- **Alertas:** cascade (una alerta de una obra borrada no tiene sentido).
- **Historial:** dejar SET NULL (correcto para auditoría), pero filtrar `obra_id IS NOT NULL` en las vistas.

**Esfuerzo estimado:** 1-2h (migración de FKs + limpieza de huérfanos existentes)

---

#### Gap 5 — Fechas de la obra desacopladas de las fechas de las tareas

**Impacto:** Bajo

`expected_end_date` de la obra no se valida contra las fechas de las tareas: una obra puede "terminar" el 01/06 con tareas que van hasta el 30/07 (caso real visible en las capturas). No hay recálculo del `expected_end_date` a partir de la última tarea, ni aviso de inconsistencia.

**Solución profesional:** al reprogramar tareas, ofrecer (no imponer) actualizar la fecha fin de la obra al máximo `due_date` de sus tareas, o mostrar un aviso "El cronograma excede la fecha fin de la obra". Es el mismo patrón que el ajuste a día laboral: sugerir, no romper.

**Esfuerzo estimado:** 2-3h

---

#### Gap 6 — Borrado permanente sin papelera

**Impacto:** Bajo-Medio

El borrado de obra es **hard delete** con cascada: se lleva tareas, historial, presupuestos, cotizaciones. No hay `is_active`/soft-delete ni "deshacer". Para una obra real con meses de datos, un borrado accidental es irreversible.

**Solución profesional:** soft-delete (`is_active=False` / `deleted_at`) + filtro en las listas + una vista "Archivadas" para restaurar. El hard delete queda solo para un admin desde el panel (o un job de purga a los N días).

**Esfuerzo estimado:** 3-4h

---

## 2. Gestión de Tareas

### Qué funciona

| Aspecto | Estado |
|---------|--------|
| CRUD de tareas + `reorder` (persistido en `order_index`) | ✅ |
| Transiciones de estado **validadas en servidor** (`VALID_TRANSITIONS`) | ✅ |
| Dependencias en 4 tipos (FS/SS/FF/SF) + desfase (`lag_days`), M2M | ✅ |
| **Prevención de ciclos** al agregar dependencia (DFS, `_check_no_cycle`) | ✅ |
| Validaciones: no auto-dependencia, dependencia de la misma obra, padre de la misma obra, no auto-padre | ✅ |
| Ajuste automático de fechas a día laboral (`_snap_working_dates`) con aviso | ✅ |
| Reprogramación en cascada con vista previa (`cascade-preview`) y un único evento de historial | ✅ |
| Materiales por tarea + rollup (cantidad/costo/pendientes) en `TaskRead` | ✅ |

### Gaps detectados y cómo resolverlos

---

#### Gap 1 — El chequeo de acceso a tareas es un *no-op* (IDOR cross-tenant)

**Impacto:** Alto — seguridad (el gap más serio del módulo)

Todas las mutaciones de tarea llaman a `_get_obra_and_assert_access(obra_id, manager_id)`, pero la función **no usa `manager_id` ni valida el tenant**:

```python
# task_service.py
async def _get_obra_and_assert_access(self, obra_id: int, manager_id: int) -> None:
    obra = await self.obra_repo.get(obra_id)
    if not obra:
        raise NotFoundError("Obra", obra_id)
    # ← no chequea obra.tenant_id, no chequea manager_id. Solo existencia.
```

Consecuencia: cualquier usuario autenticado puede **crear, editar, cambiar de estado, reordenar o borrar tareas de una obra de OTRA empresa** con solo conocer (o adivinar) el `obra_id`. Es un IDOR (Insecure Direct Object Reference) que rompe el aislamiento multi-tenant que sí se respeta en obras.

**Solución profesional — que el "assert" realmente asserte:**

```python
async def _get_obra_and_assert_access(self, obra_id: int, user: User) -> Obra:
    obra = await self.obra_repo.get(obra_id)
    if not obra:
        raise NotFoundError("Obra", obra_id)
    if obra.tenant_id is not None and obra.tenant_id != user.tenant_id:
        raise NotFoundError("Obra", obra_id)   # otro tenant → 404 (no filtrar ids)
    return obra
```

Esto obliga a pasar el `User` completo (con `tenant_id`) en vez de solo el id: hay que cambiar las rutas de tareas de `CurrentUserId` a `CurrentUser` y propagar el `tenant_id` al service. Es el fix más importante de todo el núcleo operativo.

**Esfuerzo estimado:** 3-4h (tocar el service + todas las rutas de `tasks.py` que hoy usan `CurrentUserId`)

---

#### Gap 2 — El frontend ofrece transiciones de estado que el backend rechaza

**Impacto:** Medio — es la fuente de los "errores al cambiar una tarea completada"

`VALID_TRANSITIONS` deja los estados terminales sin salida:

```python
VALID_TRANSITIONS = {
    PENDIENTE:   {EN_PROGRESO, CANCELADA},
    EN_PROGRESO: {BLOQUEADA, COMPLETADA, CANCELADA},
    BLOQUEADA:   {EN_PROGRESO, CANCELADA},
    COMPLETADA:  set(),   # ← terminal
    CANCELADA:   set(),   # ← terminal
}
```

Pero el desplegable de Estado en la planilla y el Gantt ofrece **todas** las opciones siempre. Si sobre una tarea `completada` se elige otro estado, el backend responde `422 UnprocessableError` y la UI muestra un error genérico. También: `pendiente → completada` directo no está permitido (hay que pasar por en progreso), y eso tampoco se refleja en la UI.

**Solución profesional:** exponer las transiciones válidas al frontend y que el desplegable solo muestre las permitidas para el estado actual:

```typescript
// Espejo de VALID_TRANSITIONS en el front (o traído de un endpoint /meta):
const NEXT_STATES: Record<TaskStatus, TaskStatus[]> = { ... };
// En el <select> de Estado, iterar NEXT_STATES[task.status] en vez de todos.
```

Decisión de producto adicional: ¿una tarea completada debería poder **reabrirse**? Hoy no se puede (terminal). Muchos gestores lo permiten (`completada → en_progreso`). Si se quiere, agregar esa transición; si no, al menos que la UI no la ofrezca.

**Esfuerzo estimado:** 2h (UI) + decisión de producto sobre reabrir

---

#### Gap 3 — Sin paginación en el listado de tareas

**Impacto:** Medio (escala)

`GET /tasks/obra/{id}` devuelve **todas** las tareas de la obra de una, y además evalúa riesgos/alertas en cada listado (`evaluate_task_risks_for_obra`). Con obras de cientos de tareas, el payload y el cómputo crecen sin techo. La planilla y el Gantt cargan todo en memoria.

**Solución profesional:** el cronograma necesita todas las tareas juntas (para el Gantt/CPM), así que la paginación clásica no aplica bien; pero conviene:
- Separar la evaluación de alertas del `GET` (moverla a un job / al cambio de estado), para que listar no dispare cómputo.
- Considerar virtualización en el front (ya se hace parcialmente) y un límite duro con aviso para obras patológicas.

**Esfuerzo estimado:** 2-3h

---

#### Gap 4 — Duplicación de la evaluación de alertas en cada `GET`

**Impacto:** Bajo-Medio

`list_tasks_for_obra` corre `AlertService.evaluate_task_risks_for_obra` en **cada** request de listado. Es trabajo (queries + posible creación de alertas) atado a una operación de lectura, que además puede emitir side-effects en un `GET` (anti-patrón REST).

**Solución profesional:** disparar la evaluación de riesgos desde el cambio de fecha/estado de tarea (donde el riesgo realmente cambia) y desde el scheduler periódico, no desde el listado.

**Esfuerzo estimado:** 1-2h

---

## 3. Cronograma — Gantt

### Qué funciona

| Aspecto | Estado |
|---------|--------|
| Barras con drag y resize (px↔día vía `dayW`) | ✅ |
| Vistas semana/mes/trimestre + **zoom continuo** (pinch/Ctrl+rueda) | ✅ |
| Flechas de dependencia (4 tipos) con tooltip y detección de violación | ✅ |
| Chip "depende de" en la columna de tareas (oculto si es la propia padre) | ✅ |
| Agrupamiento de subtareas bajo la padre (WBS) + colapso persistido | ✅ |
| Ruta crítica (toggle) y línea base (toggle) superpuestas | ✅ |
| Cascade automático al mover una tarea con sucesoras (dialog de confirmación) | ✅ |
| Header de fechas sticky + columna izquierda sticky | ✅ |

### Gaps detectados y cómo resolverlos

---

#### Gap 1 — El reorden de filas del Gantt no se persiste (solo `localStorage`)

**Impacto:** Medio — inconsistencia con la planilla

El Gantt guarda el orden de filas en `localStorage` (`gantt_order_${obraId}`): es **por navegador**, no se comparte entre usuarios ni dispositivos, y **diverge del orden de la planilla**, que sí se persiste en la base (`order_index`, vía el endpoint `POST /tasks/obra/{id}/reorder` que agregamos). Resultado: el mismo cronograma puede verse en distinto orden en el Gantt, en la planilla y para otro usuario.

**Solución profesional:** que el Gantt use el mismo `order_index` de backend que la planilla (leerlo del `Task.order_index` y persistir el reorden con `reorderTasks`, ya existente). Eliminar el orden local o dejarlo solo como override temporal.

**Esfuerzo estimado:** 3-4h (unificar el modelo de orden entre Gantt y planilla)

---

#### Gap 2 — La lógica de drag es sensible y sin tests

**Impacto:** Medio

El drag/resize de barras se maneja con eventos de mouse a mano (a propósito, no es una librería) y toda la matemática deriva de `dayW`. Funciona, pero es frágil: cualquier cambio visual que toque `dayW`, el zoom o el sticky puede romper el arrastre, y no hay tests automatizados que lo cubran. Hoy la única red de seguridad es la prueba manual.

**Solución profesional:** tests de interacción (Playwright) sobre el Gantt: mover una barra N días y verificar el `PATCH` resultante; resize; cascade dialog; drag después de zoom. Es el componente más complejo y más caro de romper.

**Esfuerzo estimado:** 1 día (setup de Playwright + casos del Gantt)

---

#### Gap 3 — El cambio de fechas por drag no valida contra el calendario en el front

**Impacto:** Bajo

El backend ajusta las fechas a día laboral (`_snap_working_dates`) y devuelve el aviso, pero el Gantt deja soltar la barra en cualquier día (incluido finde/feriado) y recién el backend la "acomoda". El usuario ve la barra saltar después de guardar.

**Solución profesional:** pintar los días no laborales como zona "magnética" (snap visual al soltar) usando el mismo calendario de la obra que ya se carga en el `GanttSettingsDrawer`.

**Esfuerzo estimado:** 2-3h

---

## 4. Planilla (edición tipo hoja de cálculo)

### Qué funciona

| Aspecto | Estado |
|---------|--------|
| Grilla tipo Google Sheets: celdas vacías extendidas, scroll infinito, líneas alineadas (alto medido del DOM) | ✅ |
| Zoom continuo persistido por obra | ✅ |
| Escribir directo en celda vacía crea la tarea (sin botón "Agregar fila") | ✅ |
| Insertar arriba/abajo por clic derecho, persistido (`reorder`) | ✅ |
| Selección de rango, relleno por arrastre con encadenado de fechas, copiar/pegar, deshacer | ✅ |
| Mostrar/ocultar columnas + columnas opcionales (Hito, Depende de, Costo/Materiales) | ✅ |
| Importar Excel/CSV/MS Project + exportar Excel + plantilla | ✅ |

### Gaps detectados y cómo resolverlos

---

#### Gap 1 — No se pueden reordenar columnas (modelo de selección atado al índice)

**Impacto:** Bajo

La selección/relleno/copiar estilo Excel está atada a la **posición** de cada columna (`GRID_FIELDS[gc]`), así que reordenar columnas rompería ese modelo. Por eso solo hay mostrar/ocultar, no reordenar. Es una limitación consciente pero es una expectativa natural de "hoja de cálculo".

**Solución profesional:** desacoplar el índice de selección del orden visual (mapear `gc → field` por un array reordenable y traducir en la capa de selección). Es un refactor del modelo de selección, no trivial.

**Esfuerzo estimado:** 1-2 días

---

#### Gap 2 — La columna "Costo/Materiales" abre el modal pero es un ida y vuelta

**Impacto:** Bajo

Clic en Costo abre el modal de la tarea para editar materiales. Funciona, pero para cargar costos a muchas tareas es un modal por tarea. No hay edición inline de materiales en la planilla (correcto: son 1-a-muchos), pero tampoco una vista masiva de "carga de materiales".

**Solución profesional (opcional):** una vista de presupuesto ya existe (`PresupuestoTab`); enlazar la columna Costo a esa vista filtrada por la tarea, para carga masiva.

**Esfuerzo estimado:** 2-3h

---

## 5. Dependencias y Ruta Crítica (CPM)

### Qué funciona

| Aspecto | Estado |
|---------|--------|
| 4 tipos de relación (FS/SS/FF/SF) + `lag_days` (rango −365..365) | ✅ |
| Prevención de ciclos por DFS al agregar dependencia | ✅ |
| CPM real: orden topológico de Kahn, forward pass (ES/EF), backward pass (LS/LF), holgura; tareas con holgura 0 = ruta crítica | ✅ |
| Fallback si se detecta ciclo (no rompe) | ✅ |
| Cálculo de duración por tarea a partir de fechas | ✅ |

### Gaps detectados y cómo resolverlos

---

#### Gap 1 — Las tareas sin fechas quedan fuera del cálculo sin aviso claro

**Impacto:** Bajo-Medio

El CPM y el Gantt trabajan sobre tareas con fechas. Las tareas sin fechas (que existen: la planilla permite crearlas) no participan del cálculo. Hay un contador "tareas sin fechas" en la UI, pero el impacto en la ruta crítica (una dependencia hacia una tarea sin fechas) no se explica.

**Solución profesional:** al calcular la ruta crítica, listar explícitamente las tareas excluidas por falta de fechas y advertir "la ruta crítica ignora N tareas sin fechas".

**Esfuerzo estimado:** 1-2h

---

#### Gap 2 — La ruta crítica se recalcula en el front bajo demanda, no se cachea

**Impacto:** Bajo

El endpoint `GET /obras/{id}/critical-path` recomputa todo en cada llamada. Para obras grandes con recálculos frecuentes (cada toggle), es trabajo repetido.

**Solución profesional:** cachear el resultado por obra e invalidar al cambiar fechas/dependencias. Con obras chicas no se nota; es optimización para escala.

**Esfuerzo estimado:** 2-3h

---

## 6. Calendario laboral

### Qué funciona

| Aspecto | Estado |
|---------|--------|
| Calendario por obra (días laborales + feriados), FK CASCADE | ✅ |
| `is_working_day` / `next_working_day` usados para snapping de fechas | ✅ |
| Configuración desde `GanttSettingsDrawer` | ✅ |

### Gaps detectados

- **Gap 1 (Bajo):** el snapping siempre empuja hacia adelante al día laboral siguiente; no hay opción de "día laboral anterior" ni de elegir la política por obra. Suficiente para MVP, pero es una decisión hardcodeada.
- **Gap 2 (Bajo):** no hay feriados nacionales precargados (Argentina); cada obra los carga a mano. Precargar el feriario del país sería un quick win de UX.

---

## 7. Historial

### Qué funciona

| Aspecto | Estado |
|---------|--------|
| **Append-only real**: el repositorio solo expone `log` + lecturas, no hay `update`/`delete` | ✅ |
| Un evento por acción (create/update/status/cascade), con actor y payload JSON | ✅ |
| La cascada registra **un solo** evento ("Se reprogramaron N tareas"), no uno por tarea | ✅ |
| FK SET NULL → el historial sobrevive al borrado de la obra/tarea (auditoría) | ✅ |

### Gaps detectados y cómo resolverlos

- **Gap 1 (Alto, seguridad):** el endpoint de historial por obra no filtra por tenant (ver Sección 1, Gap 2). Mismo problema potencial en el historial por tarea si se expone.
- **Gap 2 (Bajo):** el historial es append-only pero no hay retención/particionado; en obras muy activas crece indefinidamente. No urgente.

---

## 8. Importación / Exportación

### Qué funciona

| Aspecto | Estado |
|---------|--------|
| Parser Excel (openpyxl), CSV (stdlib) y MS Project XML (ElementTree) | ✅ |
| Mapeo de columnas por header, fechas, predecesores; WBS por OutlineLevel | ✅ |
| Carga masiva en una transacción, un evento de historial (`bulk_create`) | ✅ |
| Exportación a Excel + plantilla descargable | ✅ |

### Gaps detectados y cómo resolverlos

---

#### Gap 1 — Robustez ante archivos malformados

**Impacto:** Medio

Conviene verificar que un `.xlsx` corrupto, un XML de MS Project inválido o un CSV con encoding raro devuelvan un **400 con mensaje claro** ("No se pudo leer el archivo: ...") y no un 500. El parser tiene `try/except` puntuales (fechas, predecesores), pero un archivo que no abre debería fallar limpio a nivel del endpoint.

**Solución profesional:** envolver la apertura del archivo en un try/except que traduzca a `UnprocessableError`/400 con detalle, y validar tamaño/extensión antes de parsear.

**Esfuerzo estimado:** 1-2h

---

#### Gap 2 — El import no valida dependencias/ciclos del archivo

**Impacto:** Bajo

Al importar de MS Project, los `PredecessorLink` se mapean, pero si el archivo trae un ciclo (o una dependencia a una tarea fuera del lote), conviene que el `bulk_create` corra la misma validación de ciclos que la creación manual, o rechace con detalle.

**Esfuerzo estimado:** 2-3h

---

## 9. Resumen: Fortalezas vs Debilidades

### Fortalezas

1. **Motor de cronograma serio.** CPM con orden topológico + holgura, cascade con vista previa, snapping a día laboral, 4 tipos de dependencia con lag. Es paridad real con MS Project a nivel algoritmo.
2. **Prevención de ciclos por DFS** antes de persistir una dependencia. Muchos proyectos ni lo intentan.
3. **Transiciones de estado validadas en servidor.** El estado no lo maneja el usuario libremente.
4. **Historial append-only de verdad** (por ausencia de métodos de mutación, no por convención).
5. **Aislamiento multi-tenant correcto en obras** (listar/leer por `tenant_id`, 404 cross-tenant).
6. **Planilla tipo Sheets** con orden persistido, inserción en cualquier posición, columnas conectadas.

### Debilidades (ordenadas por impacto)

| # | Debilidad | Categoría |
|---|-----------|-----------|
| 1 | `_get_obra_and_assert_access` es un no-op → IDOR cross-tenant en TODAS las mutaciones de tarea | Seguridad |
| 2 | `GET /obras/{id}/historial` no filtra por tenant → fuga cross-tenant | Seguridad |
| 3 | Editar/borrar/cambiar-estado de obra exige ser el manager creador → rompe multi-empresa | Autorización |
| 4 | El desplegable de estado de tarea ofrece transiciones que el backend rechaza (errores) | UX / consistencia |
| 5 | Reorden del Gantt en localStorage, desalineado con la planilla (que sí persiste) | Consistencia |
| 6 | Alta/baja de obra disponible para colaboradores (sin gate admin) | Autorización |
| 7 | Sin paginación + evaluación de alertas en cada `GET /tasks` | Escala |
| 8 | Borrado permanente sin papelera + huérfanos (presupuestos/alertas SET NULL) | Datos |
| 9 | Import sin manejo robusto de archivos malformados | Robustez |
| 10 | Fechas de obra desacopladas de las tareas; sin tests del Gantt | Calidad |

---

## 10. Prioridad de correcciones

### P0 — Bloqueantes / seguridad

| Tarea | Qué cambiar | Esfuerzo |
|-------|-------------|---------|
| Scope por tenant en mutaciones de tarea (`_get_obra_and_assert_access`) | `task_service.py`, rutas `tasks.py` (`CurrentUserId`→`CurrentUser`) | 3-4h |
| Filtrar historial por tenant | `routes/obras.py` (`get_or_raise` con `tenant_id`) | 15 min |
| Acceso de escritura a obra por tenant, no por manager | `obra_service.py` (`update`/`delete`) | 2-3h |

### P1 — Consistencia y UX

| Tarea | Qué cambiar | Esfuerzo |
|-------|-------------|---------|
| Estado de tarea: la UI solo ofrece transiciones válidas | planilla + Gantt (espejo de `VALID_TRANSITIONS`) | 2h |
| Unificar orden de filas Gantt ↔ planilla (usar `order_index`) | `GanttTimeline.tsx` (leer/persistir orden) | 3-4h |
| Gate admin en alta/baja de obra | `routes/obras.py` (`AdminUser`) | 30 min |
| Sacar la evaluación de alertas del `GET /tasks` | `routes/tasks.py`, `alert_service.py` | 1-2h |
| Import: 400 claro ante archivo inválido | `import_service.py` | 1-2h |

### P2 — Escala y robustez

| Tarea | Qué cambiar | Esfuerzo |
|-------|-------------|---------|
| Soft-delete de obra + papelera | `models/obra.py`, `obra_service.py`, `PortfolioPage.tsx` | 3-4h |
| Cascade/limpieza de huérfanos (presupuestos/alertas) | migración de FKs | 1-2h |
| Snap visual a día laboral en el Gantt | `GanttTimeline.tsx` | 2-3h |
| Tests de interacción del Gantt (Playwright) | nuevo `e2e/gantt.spec.ts` | 1 día |
| Cache de ruta crítica | `task_service.py`, invalidación | 2-3h |
| Fecha fin de obra sugerida desde las tareas | `task_service.py`, aviso en UI | 2-3h |

---

## 11. Archivos clave por corrección

| Corrección | Backend | Frontend |
|-----------|---------|----------|
| Tenant scope en tareas (IDOR) | `services/task_service.py` (`_get_obra_and_assert_access`), `api/routes/tasks.py` | — |
| Historial por tenant | `api/routes/obras.py` | — |
| Escritura de obra por tenant | `services/obra_service.py` (`get_for_manager`→tenant) | — |
| Transiciones válidas en UI | — | `TaskSheetView.tsx`, `GanttTimeline.tsx` |
| Orden unificado Gantt/planilla | `api/routes/tasks.py` (reorder ya existe) | `GanttTimeline.tsx` |
| Gate admin alta/baja obra | `api/routes/obras.py` (`AdminUser`) | — |
| Alertas fuera del GET | `api/routes/tasks.py`, `services/alert_service.py` | — |
| Soft-delete de obra | `models/obra.py`, `services/obra_service.py`, `repositories/obra.py` | `PortfolioPage.tsx` |
| Import robusto | `services/import_service.py` | `ImportModal.tsx` |
| Tests Gantt | — | `e2e/gantt.spec.ts` (Playwright) |
