# Auditoría 02 — Panel de Resumen (Dashboard principal)

> **Fecha:** 2026-08-18
> **Auditor:** Claude Sonnet 4.6 (con supervisión de Facundo)
> **Alcance:** el panel que ve el usuario al loguearse (Portfolio de obras): KPI cards, tabs de filtro por estado, buscador, cards de obra, badge de alertas, presencia online. **No incluye** el "Dashboard Avanzado" futuro (indicadores nuevos, panel de decisiones) ni el detalle de obra (esa es otra auditoría).
> **Metodología:** lectura de código + ejecución local (backend `:8000`, frontend `:5173`) + pruebas con Playwright + curl al API + queries directas a Postgres para contrastar los números que muestra el panel con la realidad.

---

## 1. Resumen ejecutivo

El panel de resumen **funciona a nivel visual y los números básicos son correctos** (los conteos por estado, el % de avance, el badge de alertas). El backend calcula bien `completed_tasks` y `total_tasks` por obra, y el aislamiento por tenant en `GET /obras` está OK.

Pero **no está production-ready** por tres razones concretas que quedaron reproducidas:

1. **[CRÍTICO — Frescura de datos]** El panel **no reacciona a cambios en tiempo real**. Cambié el estado de la obra 17 a `pausada` desde otra sesión, la DB lo persistió, y el panel de la sesión abierta siguió mostrando "Planificadas 2 / Pausadas 0" hasta que hice reload. `PortfolioPage` solo se suscribe a eventos de alertas (`alert_created`, `alerts_resolved`); no hay ningún evento Socket.IO para obras (`obra_updated`, `obra_created`, `obra_deleted`).
2. **[ALTO — Filtro de alertas incorrecto]** El repository de alertas hace un **INNER JOIN con `Obra`** para filtrar por tenant, en vez de usar la columna `Alert.tenant_id` que ya está desnormalizada. Consecuencia: las alertas con `obra_id NULL` o cuya obra fue borrada **se pierden silenciosamente**. Reproducido: DB tiene 109 alertas unread para el tenant 2, pero `GET /alerts` devuelve 107.
3. **[ALTO — Presencia cross-tenant]** El endpoint `GET /presence/online` no filtra por tenant. `core/presence.py:24` devuelve **todos** los usuarios online del sistema, sin importar a qué tenant pertenecen. Cualquier usuario logueado ve las iniciales de los conectados de otros tenants.

Además hay dos comportamientos inesperados de segundo orden: (a) el `PATCH /obras/{id}` con `status=en_progreso` **no queda** — un recompute automático lo devuelve a `planificada` si no hay tareas activas, y el frontend expone el status como control sin advertir esto; (b) la leyenda "sin tareas cargadas" en el KPI "En progreso" es misleading cuando el tenant sí tiene tareas pero ninguna obra está en progreso.

---

## 2. Inventario de funcionalidad

| Elemento del panel | Implementado | Probado y funciona | Archivo(s) |
|---|---|---|---|
| Página `PortfolioPage` como landing al loguearse | Sí | Sí | `frontend/src/App.tsx:59-60,142-145`, `frontend/src/pages/PortfolioPage.tsx` |
| KPI card "Total obras" (con "N vigentes" = no canceladas) | Sí | Sí — DB=2, panel=02 | `PortfolioPage.tsx:465-476` |
| KPI card "En progreso" (count + avance medio %) | Sí | Sí conteo; leyenda confusa cuando 0 | `PortfolioPage.tsx:478-490` |
| KPI card "Planificadas" | Sí | Sí | `PortfolioPage.tsx:492-499` |
| KPI card "Completadas" (con delta "+N entregadas") | **Parcial** | Sí conteo; **delta no aparece cuando =0** | `PortfolioPage.tsx:501-507` |
| Buscador (frontend, sin debounce) | Sí | Sí — filtra sobre name/location/description | `PortfolioPage.tsx:398-407,427-449` |
| Botón "Nueva obra" (gated por `obra.create`) | Sí | Sí — no aparece para collaborators | `PortfolioPage.tsx:431-443`, `hooks/usePermission.ts` |
| Tabs de filtro por estado (Todas/Activas/Planificadas/Pausadas/Completadas) | Sí | Sí — 100% frontend, sin llamada backend | `PortfolioPage.tsx:532-574` |
| Card individual de obra (hero, nombre, ubicación, %, avatar, fecha) | Sí | Sí | `PortfolioPage.tsx:73-303,584-657` |
| Progress bar por obra (color por estado) | Sí | Sí — `completed/total * 100`, redondeado | `PortfolioPage.tsx:33-39,77` |
| Pin de obra en sidebar (localStorage) | Sí | No probado por UI en esta ronda | `PortfolioPage.tsx:147-166` |
| Cambiar estado desde el card (dropdown) | Sí | Sí que cambia; **pero recompute lo puede pisar** (ver 5.4) | `PortfolioPage.tsx:168-190,593-598` |
| Eliminar obra desde el card | Sí | Sí (con confirmación) | `PortfolioPage.tsx:599-615` |
| Ghost card "Crear nueva obra" al final del grid | Sí | Sí (solo si `filter=todas` y hay permiso) | `PortfolioPage.tsx:619-655` |
| Empty state "Sin obras registradas" | Sí | Sí — se muestra bien; **oculta KPIs y tabs también** (¿deseado?) | `PortfolioPage.tsx:510-529` |
| Estado sin resultados de búsqueda/filtro | Sí | Sí | `PortfolioPage.tsx:578-582` |
| Loader (`Spinner`) mientras carga | Sí | Sí | `PortfolioPage.tsx:459-461` |
| Error de carga | Sí | Sí (mensaje rojo con hint) | `PortfolioPage.tsx:452-457` |
| Badge de alertas globales "99+" en header | Sí | Sí — real=109 unread, badge=99+ | `AppLayout.tsx`, `components/AlertBell.tsx:76,172`, `hooks/useGlobalAlerts.ts` |
| Presencia online ("1 en línea") en header | Sí | Sí visible; **sin filtro de tenant** (bug — ver 5.3) | `hooks/useOnlineUsers.ts` (polling 10s), `core/presence.py` |
| Modal de onboarding "Bienvenida" al primer login | Sí | Sí — dispara sin `onboarding_done` en localStorage | `components/OnboardingModal.tsx` (o similar) |
| Suscripción del panel a `alert_created` / `alerts_resolved` (Socket.IO) | Sí | Sí — badge se actualiza cuando llega alerta nueva | `hooks/useGlobalAlerts.ts:35-67` |
| Suscripción del panel a cambios de obra (Socket.IO) | **NO** | **Bug reproducido: cambio en otra sesión no se refleja** | (no existe — ver 5.1) |
| Suscripción del panel a cambios de tareas (para recomputar KPIs) | **NO** | **No enterarte de tareas completadas en otra pestaña** | (no existe) |
| Multi-tenant: `GET /obras` filtra por `tenant_id` | Sí | Sí — user vacío ve `[]` | `app/api/routes/obras.py:27-28`, `app/services/obra_service.py:55-71` |
| Multi-tenant: `GET /alerts` filtra por tenant | Sí | Sí (pero mal: usa join a Obra en vez de Alert.tenant_id — bug 5.2) | `app/repositories/alert.py:157-176` |
| Multi-tenant: `GET /presence/online` filtra por tenant | **NO** | **Fuga cross-tenant reproducida** | `app/core/presence.py:24-30` |

---

## 3. Cómo se calculan los datos mostrados

### 3.1 KPIs (los cuatro cards de arriba)

Los cuatro números se calculan **en el frontend**, sobre el array `obras` que devuelve `GET /obras`:

| KPI | Fórmula (frontend) |
|---|---|
| Total obras | `obras.length` |
| Delta "N vigentes" | `obras.filter(o => o.status !== "cancelada").length` |
| En progreso | `obras.filter(o => o.status === "en_progreso").length` |
| Avance medio (delta del anterior) | `Math.round(Σ(completed/total) / N_conTareas × 100)` sobre obras `en_progreso` con `total_tasks > 0` |
| Planificadas | `obras.filter(o => o.status === "planificada").length` |
| Completadas | `obras.filter(o => o.status === "completada").length` |

**Nota importante:** `total_tasks` **excluye tareas canceladas** y `completed_tasks` **cuenta solo las completadas**. Es un cálculo hecho por el backend en `ObraService.list_all()` (`backend/app/services/obra_service.py:55-71`), usando `selectinload(Obra.tasks)`. Verificado contra la DB: la obra 16 tiene 26 tasks activas y el endpoint responde `total_tasks: 26`; la obra 17 tiene 23 y responde `total_tasks: 23`.

**Detalle sutil:** cuando el KPI de "En progreso" es 0, el card muestra la leyenda `"sin tareas cargadas"`. Es engañoso: el tenant sí tiene tareas cargadas (49 activas en las dos obras), lo que no hay es ninguna obra en estado `en_progreso`. El texto debería ser `"sin obras en progreso"`.

### 3.2 Progress bar por obra

En el frontend (`PortfolioPage.tsx:77`):

```
pct = obra.total_tasks === 0 ? 0 : Math.round((obra.completed_tasks / obra.total_tasks) * 100)
```

El color de la barra viene de `PROGRESS_COLOR[obra.status]`. Bien.

### 3.3 Badge global de alertas ("99+")

`useGlobalAlerts()` (`frontend/src/hooks/useGlobalAlerts.ts`) hace `GET /api/v1/alerts` al montar el componente, y después escucha los eventos Socket.IO `alert_created` y `alerts_resolved`. `unreadCount = alerts.filter(a => !a.is_read).length`. Si es > 99 muestra `"99+"`.

Backend: `AlertRepository.list_all(tenant_id=user.tenant_id)` en `app/repositories/alert.py:157-176`. **Aquí está uno de los bugs** (ver 5.2): usa `join(Obra, ...).where(Obra.tenant_id == tenant_id)` en vez de `where(Alert.tenant_id == tenant_id)`. Las alertas huérfanas (`obra_id NULL` o cuya obra fue borrada) desaparecen.

### 3.4 Presencia online

`useOnlineUsers()` hace **polling HTTP cada 10 segundos** a `GET /api/v1/presence/online`. No usa Socket.IO. El backend guarda un dict `{user_id: {name, initials, color, last_seen}}` en memoria del proceso (`_TIMEOUT_SECONDS = 90`). No filtra por tenant.

### 3.5 Filtros y búsqueda

Los **dos son 100% frontend**:

- El buscador (`search` state) filtra `obras` en cada tecla, sin debounce, comparando `name`, `location` y `description` (lowercase, `includes`).
- Los tabs (`filter` state) filtran por `status` exacto sobre el mismo array.

Composición: `filteredObras = obras.filter(tab).filter(search)`.

Escala: OK hasta ~200-500 obras. Un tenant enterprise con 5000 obras cargaría todo en el primer `GET /obras`, sin paginación, y filtraría en cliente. Sería un problema puntual pero no urgente hoy.

---

## 4. Qué tiene sentido como está

- **KPIs calculados en frontend sobre el array de obras.** Es una decisión razonable porque el mismo array alimenta también las cards del grid, así que un solo request (`GET /obras`) devuelve todo. Cambiar los KPIs a un endpoint aparte agregaría un roundtrip extra sin beneficio real mientras el número de obras esté acotado por el plan (básico 3, pro 20, enterprise ilimitado — pero incluso enterprise en la práctica va a ser N<200).

- **`total_tasks` y `completed_tasks` calculados en backend.** Bien. Evita traer 500 tareas al frontend solo para saber el %. El `selectinload(Obra.tasks)` puede sonar caro pero para N pequeño no importa. En un tenant con muchas obras y muchas tareas por obra habría que revisar (ver 6.4).

- **Filtros y búsqueda 100% en frontend.** Correcto para el volumen esperado. Un dashboard con 3-20 obras no necesita ir al backend por cada tecla.

- **Badge "99+" cap.** Buen UX — el número exacto arriba de 99 no aporta información útil.

- **Suscripción del badge a `alert_created` por Socket.IO.** Bien pensado. Cuando el backend genera una alerta nueva (por ejemplo, una tarea vencida), el badge sube sin recargar. Probado y funciona.

- **Empty state con CTA "Crear primera obra".** Correcto — es lo primero que ve un usuario nuevo y el mensaje es claro.

- **`ObraSummary` como schema separado de `ObraRead`.** Bien — el listado no necesita todos los campos (por ejemplo, descripción larga), y devolver solo lo que se muestra reduce payload.

- **Aislamiento tenant en `GET /obras`.** Reproducido: registré un usuario nuevo, el endpoint devolvió `[]`. `ObraRepository.list_all(tenant_id)` filtra correctamente.

- **`GET /admin/usage` con conteos por tenant.** Correcto — muestra `obras_count`, `users_count`, `tasks_count` filtrados por tenant, y los límites del plan actual. Verificado con el usuario nuevo (todo 0, plan básico auto-asignado).

---

## 5. Qué no tiene sentido, está a medias o no funciona

### 5.1 [CRÍTICO] El panel no se actualiza en tiempo real ante cambios en las obras

**Qué pasa:** `PortfolioPage` solo se suscribe a Socket.IO para alertas. No escucha ni `task_updated`, ni `task_created`, ni `task_deleted`, ni ningún evento relacionado con la entidad `Obra` (que además no existe — el backend no emite `obra_updated` cuando cambia el estado de una obra).

**Reproducido:** con la sesión de facundo (tenant 2) abierta en el navegador mostrando "Planificadas 2 / Pausadas 0", hice `PATCH /api/v1/obras/17 {"status":"pausada"}` desde curl (misma sesión de otro token). La DB lo persistió (`obra 17 = pausada`), pero el panel siguió mostrando "Planificadas 2 / Pausadas 0" durante varios segundos. Solo cambió al hacer reload (`Planificadas 1 / Pausadas 1`).

**Consecuencias prácticas:**
- Dos usuarios del mismo tenant editando obras simultáneamente ven datos distintos.
- Cuando un colaborador marca una tarea como completada (subiendo el `%` de la obra), el jefe con el panel abierto no ve el progreso hasta que recarga.
- El cliente que muestra el panel en una pantalla del pasillo de la oficina para "ver cómo van las obras" no se actualiza nunca.

**Contraste con la vista de detalle de obra:** `ObraDetailPage` **sí** usa `useTaskSocket({obraId})` (`hooks/useTaskSocket.ts`) y escucha `task_updated/created/deleted`. Toda la infraestructura Socket.IO ya está armada para tareas — solo falta llevar los mismos eventos al panel y agregar eventos de obra.

### 5.2 [ALTO] El filtro de alertas por tenant usa INNER JOIN con Obra en vez de la columna denormalizada

**Qué pasa:** el modelo `Alert` tiene `tenant_id` **como columna desnormalizada** (según el comentario del código: "guardado en modelo para evitar joins"). Pero el repository ignora esa columna y hace:

```python
# backend/app/repositories/alert.py:169-171
if tenant_id is not None:
    from app.models.obra import Obra
    stmt = stmt.join(Obra, Alert.obra_id == Obra.id).where(Obra.tenant_id == tenant_id)
```

El `INNER JOIN` excluye las alertas cuya obra no existe (borrada) o cuyo `obra_id` es NULL.

**Reproducido:** la DB tiene 109 alertas con `tenant_id=2` y `is_read=False`. El endpoint `GET /alerts?unread_only=true&limit=500` devuelve **107**. La diferencia son 2 alertas huérfanas (obra borrada probablemente durante la auditoría 01, o alertas de tipo global sin `obra_id`). Además hay **5 alertas con `tenant_id=NULL`** en toda la DB — datos zombie sin dueño que nunca aparecen en ningún listado.

**Consecuencias:**
- El badge muestra un número menor al real, así que el admin puede creer que todo está bajo control.
- Alertas globales de la obra (`task_id=None`) que se generan cuando se borra la obra padre desaparecen sin marcar como leídas.
- Si en el futuro se agregan alertas "de sistema" no ligadas a una obra (ej: "tu plan expira en 3 días"), no van a mostrarse nunca hasta que se corrija el filtro.

**Fix trivial:** cambiar el filtro a `where(Alert.tenant_id == tenant_id)` (usa el índice de la columna denormalizada). El join a Obra se puede eliminar completamente.

### 5.3 [ALTO] Fuga cross-tenant en el endpoint de presencia

**Qué pasa:** `core/presence.py:24-30` (`get_online()`) devuelve **todos** los usuarios que hicieron heartbeat en los últimos 90 segundos, sin filtrar por tenant. No recibe `tenant_id` como parámetro. Y el endpoint `GET /presence/online` (`app/api/routes/presence.py:9-12`) tampoco:

```python
async def presence_online(current_user: CurrentUser):
    heartbeat(current_user.id, current_user.full_name)
    return {"users": get_online()}
```

**Reproducido:** con facundo (tenant 2) y con Invitado Test (también tenant 2, pero el diseño no lo garantiza) ambos hicieron heartbeat. El endpoint devuelve los dos. Si mañana un user de tenant 8 hace heartbeat en la misma ventana de 90s, cualquier user de tenant 2 verá sus iniciales en el chip "N en línea" del header.

**Consecuencias:**
- **Fuga de información controlada:** aunque solo se expone `id`, `name`, `initials`, `color`, el `name` es el `full_name` real del usuario. Un competidor con acceso al sistema (usuario de otro tenant) puede ver quién está trabajando en qué momento.
- **Confusión operativa:** el chip "3 en línea" no refleja "3 miembros de tu empresa conectados", refleja "3 personas usando la app en este momento en todo el sistema".
- **Combinado con el bug 5.4 (rate limit del audit 01) y el estado in-memory:** con múltiples workers de uvicorn, cada worker tiene su propio `_store`, así que los resultados son además inconsistentes.

**Fix:** pasar `tenant_id` al `heartbeat` y al `get_online`, y guardar `tenant_id` en cada entry del `_store`. Filtrar en `get_online(tenant_id)`.

### 5.4 [MEDIO] Cambiar el estado de una obra a `en_progreso` no queda pegado si no hay tareas activas

**Qué pasa:** el frontend muestra un dropdown en el card para cambiar el estado de una obra manualmente. Cuando el user elige `en_progreso`, el frontend hace `PATCH /obras/{id} {status: "en_progreso"}`. El backend acepta (200) y en el response **devuelve `status: "planificada"`**, no `en_progreso`. La DB queda con `planificada`.

**Reproducido:** con obra 17 en `planificada`, hice PATCH a `en_progreso`. Response `status: planificada`. DB `planificada`. En cambio, el PATCH a `pausada` sí quedó pegado.

**Por qué:** `ObraService.update()` (`app/services/obra_service.py:73-102`) llama a `TaskService.recompute_obra_status(allow_complete=False)` después del update. Esa función recalcula el status de la obra basándose en las tareas: si no hay ninguna en `en_progreso`, devuelve `planificada`. El cambio manual se sobrescribe.

**Consecuencia UX:** el dropdown del card ofrece "Marcar en progreso" pero silenciosamente no funciona en obras sin tareas iniciadas. El usuario piensa que hizo click a algo roto. Peor: el frontend no muestra ningún mensaje (aunque el backend hasta le devolvió el status revertido en la respuesta), y el card queda visualmente igual.

**Fix:** o (a) que el frontend detecte cuando `response.status !== requested.status` y muestre un toast "No se puede marcar en progreso: primero iniciá alguna tarea"; o (b) que el backend rechace el intento con un 400 explícito en vez de aceptar silenciosamente y revertir; o (c) que si el user manualmente elige `en_progreso`, el recompute lo respete (el recompute pisa solo si la obra no fue tocada manualmente en la misma request).

### 5.5 [MEDIO] Los estados vacíos ocultan los KPIs y tabs

**Qué pasa:** cuando el user no tiene ninguna obra, el panel muestra solo el mensaje "Sin obras registradas" y el CTA. Los cuatro KPI cards y la barra de tabs no se renderizan.

**Comportamiento observado (empty user recién creado):**
- `Total obras`, `En progreso`, `Planificadas`, `Completadas` → no aparecen
- Tabs → no aparecen
- Solo se ve el empty state

**Es un problema menor** — si no hay obras, mostrar `00` en los 4 cards también sería medio raro. Pero es una decisión implícita: un nuevo user no ve la estructura del panel hasta que crea su primera obra. Puede ser confuso porque el onboarding modal habla de "crear obra desde el Portfolio, botón Nueva obra" pero al empty state llegás y el layout es distinto al que verás después.

**Alternativa:** mostrar los KPI cards en `00` y debajo el empty state con el CTA. Coherencia visual y previsibilidad.

### 5.6 [MEDIO] KPI "Completadas" no muestra la línea del delta cuando es 0

**Qué pasa:** los otros 3 KPIs muestran una línea de contexto abajo del número ("N vigentes", "avance medio Y%", "próximo inicio pendiente"). El card de "Completadas" muestra en el código el delta como `<strong>+X</strong> entregadas`, pero cuando `X=0` la línea no aparece en el DOM (queda un hueco).

**Impacto:** menor. Es una inconsistencia visual (los otros 3 KPIs tienen leyenda siempre, este no). Cuando el user completa su primera obra, la línea aparece. Fix trivial en el template del KpiCard.

### 5.7 [MEDIO] Leyenda misleading "sin tareas cargadas" en el KPI En progreso

**Qué pasa:** el card "En progreso" muestra el delta con "avance medio X%" cuando hay obras en progreso con tareas. Cuando no hay ninguna obra en progreso, la leyenda dice `"sin tareas cargadas"`.

**Reproducido:** el tenant 2 tiene 2 obras (planificadas) con 49 tareas activas. El card dice `"En progreso 00 / sin tareas cargadas"`. Un user razonable puede leer eso como "no cargamos ninguna tarea", cuando la realidad es "no hay ninguna obra en progreso, así que no puedo calcular avance medio".

**Fix trivial:** cambiar el texto a `"sin obras en progreso"`.

### 5.8 [BAJO] Búsqueda sin debounce

Cada tecla dispara un re-render con el nuevo filtro. Con 3 obras es imperceptible. Con 500 obras y filtros compuestos, se nota. `useDeferredValue` o un `useMemo` con debounce de 150 ms sería suficiente.

### 5.9 [BAJO] Filtros y buscador no reflejan en la URL

No hay estado compartible ("mandale este link con las obras completadas") ni deep-link a un filtro. Menor pero útil.

### 5.10 [BAJO] El polling de presencia cada 10 s desperdicia requests

`useOnlineUsers()` hace `GET /presence/online` cada 10 s **siempre**, incluso si el usuario tiene el tab inactivo. La API además responde muy rápido (dict en memoria), así que no es caro, pero es innecesario. Podría hacerse un `visibilitychange` handler para pausar el polling cuando el tab está en background.

### 5.11 [BAJO] Ghost card "Crear nueva obra" al final del grid

Cuando el usuario ya tiene obras (por ejemplo 20), al final del listado aparece siempre una card de "Crear nueva obra". Si el tenant está al límite del plan, ese CTA sigue apareciendo (no se disable ni advierte). Al clickear se abre el wizard, se llenan los 4 pasos, y al final se pega contra el 402 y salta el UpgradeModal (que probamos en la auditoría 01). Sería más gentil mostrar el CTA en gris con "Alcanzaste el límite — ver planes" cuando `obras_count >= max_obras`.

---

## 6. Mejoras propuestas

### 6.1 Emitir eventos Socket.IO de obras y suscribir el panel

- **Qué:** agregar en `backend/app/core/socket_manager.py` tres eventos: `obra_created`, `obra_updated`, `obra_deleted`. Emitirlos desde `ObraService.create/update/delete()`. En el frontend, crear un hook `useObraSocket({tenantId})` análogo a `useTaskSocket` y usarlo desde `PortfolioPage`. Adicionalmente, escuchar `task_updated` con obraId para invalidar el `completed_tasks/total_tasks` de la obra afectada y recalcular KPIs.
- **Por qué:** cierra el bug 5.1. Sin esto, el panel es una foto de cuando cargó.
- **Esfuerzo:** MEDIO. Backend: ~30 líneas para emitir. Frontend: ~50-80 líneas para el hook y wire-up.
- **Riesgo:** BAJO. La infraestructura de Socket.IO ya existe y `ObraDetailPage` es el ejemplo funcionando.
- **Toca:** backend + frontend.

### 6.2 Cambiar el filtro de alertas a `Alert.tenant_id` denormalizado

- **Qué:** en `backend/app/repositories/alert.py:169-171`, reemplazar el join a `Obra` por un filtro directo `where(Alert.tenant_id == tenant_id)`. Además, agregar una migración de limpieza que borre las 5 alertas con `tenant_id=NULL` (o setee el `tenant_id` desde la obra si existe).
- **Por qué:** cierra el bug 5.2. Además hace la query más rápida (un índice contra un join).
- **Esfuerzo:** BAJO (3 líneas de código + migración de limpieza).
- **Riesgo:** BAJO. Los tests que existen deberían seguir pasando (probablemente estén usando obras existentes que sí matchean por join).
- **Toca:** backend.

### 6.3 Aislar la presencia por tenant

- **Qué:** modificar `core/presence.py` para que `heartbeat` reciba `tenant_id`, lo guarde en el store, y `get_online(tenant_id)` filtre. Actualizar `app/api/routes/presence.py` para pasar `current_user.tenant_id`.
- **Por qué:** cierra el bug 5.3 (fuga cross-tenant).
- **Esfuerzo:** BAJO (15 líneas).
- **Riesgo:** BAJO. El único caller es el frontend y no cambia el contrato del response.
- **Bonus:** aprovechar el cambio para migrar el store de memoria a Redis, cerrando también el problema de múltiples workers.
- **Toca:** backend.

### 6.4 Fix del cambio de estado manual pisado por el recompute

- **Qué:** decidir semántica: (a) permitir override manual, o (b) rechazar cambios manuales incompatibles con el estado de las tareas. Recomiendo (b): si el frontend pide `en_progreso` y no hay tareas activas, devolver 400 con un mensaje `"Iniciá al menos una tarea para marcar la obra en progreso"`. El frontend muestra ese mensaje como toast.
- **Por qué:** cierra el bug 5.4. Hoy el cambio silenciosamente no queda pegado y el UX es opaco.
- **Esfuerzo:** BAJO (10-15 líneas en `ObraService.update()`).
- **Riesgo:** BAJO. Los otros estados (`pausada`, `completada`, `cancelada`) siguen funcionando igual.
- **Toca:** backend + frontend (mensaje de error).

### 6.5 Texto de leyenda del KPI "En progreso"

- **Qué:** cambiar `"sin tareas cargadas"` a `"sin obras en progreso"` cuando el conteo es 0. Y mostrar la línea del delta en "Completadas" incluso cuando es 0.
- **Por qué:** cierra 5.7 y 5.6. Coherencia visual y semántica correcta.
- **Esfuerzo:** TRIVIAL.
- **Riesgo:** NULO.
- **Toca:** frontend (`PortfolioPage.tsx:490,507`).

### 6.6 Mostrar KPI cards en 0 con empty state debajo

- **Qué:** eliminar el early-return del empty state; siempre renderizar KPIs + tabs; agregar el mensaje "Sin obras registradas" en el grid cuando `filteredObras.length === 0`.
- **Por qué:** cierra 5.5. Coherencia visual y el user ve la estructura del panel desde el primer día.
- **Esfuerzo:** BAJO.
- **Riesgo:** BAJO. Puede afectar el layout del CTA de "primera obra" — probar con el diseño.
- **Toca:** frontend.

### 6.7 Debounce del buscador + `useDeferredValue`

- **Qué:** envolver `search` en `useDeferredValue` (React 18+) o agregar un `setTimeout` de 150 ms.
- **Por qué:** cierra 5.8 preventivamente. Con volumen bajo no cambia nada; con 500 obras y filtros compuestos evita jank.
- **Esfuerzo:** TRIVIAL.
- **Riesgo:** NULO.
- **Toca:** frontend.

### 6.8 Disable del ghost card cuando el tenant está al límite del plan

- **Qué:** en `PortfolioPage.tsx:619-655`, si `admin_usage.obras_count >= admin_usage.obras_limit`, renderizar el ghost card en estado disable con el texto "Alcanzaste el límite — ver planes" y linkear a `/configuracion#plan` o abrir el `UpgradeModal` directo.
- **Por qué:** cierra 5.11. UX consistente con lo que pasa después (402 → modal).
- **Esfuerzo:** BAJO. Requiere agregar `admin_usage` al contexto del panel o llamar `GET /admin/usage`.
- **Riesgo:** BAJO. El endpoint `GET /admin/usage` es solo admin, así que para collaborators el ghost card sigue igual (o mejor: no aparece porque tampoco pueden crear).
- **Toca:** frontend.

### 6.9 Paginación de `GET /obras` para tenants con muchas obras

- **Qué:** agregar params opcionales `?limit=&offset=&status=` al endpoint, y hacer que el frontend haga scroll infinito o paginación cuando `obras.length > 50`.
- **Por qué:** hoy no es problema (plan básico=3, pro=20). Enterprise ilimitado — un tenant con 200 obras carga 200 objetos con `total_tasks/completed_tasks` calculados, y eso puede tardar segundos.
- **Esfuerzo:** MEDIO. Backend: params + query. Frontend: virtual scroll o "Cargar más".
- **Riesgo:** MEDIO. Si se hace mal, rompe los KPIs (que hoy asumen tener todas las obras cargadas). Solución: los KPIs pasan a un endpoint aparte `GET /obras/summary` que devuelve solo agregados por status.
- **Toca:** backend + frontend.

### 6.10 Tests del panel

- **Qué:** agregar en `tests/`:
  - `test_dashboard_socket_updates.py` — verifica que un `PATCH /obras/{id}` emite `obra_updated` por Socket.IO (cuando se implemente).
  - `test_alerts_include_orphan_or_null_obra.py` — verifica que `GET /alerts` devuelve las alertas con `obra_id=None` del propio tenant (cuando se fixee 5.2).
  - `test_presence_scopes_by_tenant.py` — verifica que dos usuarios en tenants distintos no se ven entre sí en `GET /presence/online` (cuando se fixee 5.3).
- **Por qué:** los tres bugs no tienen cobertura hoy. Regresión probable si se refactoriza sin tests.
- **Esfuerzo:** BAJO por test.
- **Riesgo:** NULO.
- **Toca:** backend.

---

## 7. Riesgos

Ordenados por severidad práctica en el sistema actual:

| # | Riesgo | Severidad | Vector | Estado |
|---|---|---|---|---|
| P1 | Fuga cross-tenant en presencia (nombres y horarios de conexión de otros tenants) | **Alta** operacional / privacidad | Usuario legítimo, mirar el chip "N en línea" del header | **Abierto** (5.3) |
| P2 | Panel desactualizado ante cambios en la DB — dos users ven cosas distintas del mismo tenant | **Alta** de consistencia | Concurrencia legítima entre miembros del mismo tenant | **Abierto** (5.1) |
| P3 | Badge de alertas subcuenta — el admin cree que hay menos alertas que las que hay | **Media-Alta** | Alertas huérfanas / obras borradas | **Abierto** (5.2) |
| P4 | Cambio manual de estado a `en_progreso` no se aplica — UX opaco, sin feedback | **Media** | Uso normal del dropdown | **Abierto** (5.4) |
| P5 | Filtros 100% frontend — no escala si el tenant crece a >500 obras | **Media** a futuro | Enterprise con muchos proyectos | **Latente** (5.8 + 6.9) |
| P6 | Presence store en memoria por proceso — inconsistente con >1 worker | **Media** en producción | Ya identificado también en la auditoría 01 | **Abierto** (5.3, mismo store) |
| P7 | Estado vacío oculta KPIs y tabs — UX inconsistente entre primer login y usos posteriores | **Baja** | Nuevos users | **Abierto** (5.5) |
| P8 | Ghost card "Crear obra" sin advertir del límite del plan | **Baja** | Usuarios en plan básico al llegar al 3° | **Abierto** (5.11) |
| P9 | Aislamiento tenant en `GET /obras`, `GET /alerts` | — | — | **Cerrado — funciona** (user vacío devuelve `[]`) |
| P10 | KPIs numéricos coinciden con la realidad de la DB | — | — | **Cerrado — coinciden** (obras=2, tasks=23/26, avance=0%) |

---

## Anexo A — Reproducciones concretas

### A.1 — Panel no reacciona a cambio de estado en tiempo real (5.1)

```bash
# En browser: logueado como facundo, panel abierto, muestra "Planificadas 2 / Pausadas 0"

# En terminal:
TOKEN=$(curl -sX POST http://localhost:8000/api/v1/auth/login -d '{...}' | jq -r .access_token)
curl -X PATCH http://localhost:8000/api/v1/obras/17 \
     -H "Authorization: Bearer $TOKEN" \
     -d '{"status":"pausada"}'
# → 200, response.status = pausada

# En DB:
SELECT status FROM obras WHERE id = 17; -- → pausada

# En browser (sin reload): panel sigue mostrando "Planificadas 2 / Pausadas 0"
# Reload manual → "Planificadas 1 / Pausadas 1"
```

### A.2 — Alertas huérfanas se pierden (5.2)

```bash
# En DB:
SELECT COUNT(*) FROM alerts WHERE tenant_id=2 AND is_read=false;
-- → 109

# En API:
curl "http://localhost:8000/api/v1/alerts?unread_only=true&limit=500" \
     -H "Authorization: Bearer $TOKEN" | jq 'length'
-- → 107

# Diferencia: 2 alertas huérfanas (obra borrada o obra_id NULL).
# Además: SELECT COUNT(*) FROM alerts WHERE tenant_id IS NULL; → 5 alertas zombie.
```

### A.3 — Fuga de presencia cross-tenant (5.3)

```bash
# En browser tab 1: login como user del tenant 2 → /presence/online devuelve usuarios activos.
# En browser tab 2 (o incógnito): login como user del tenant 8 → /presence/online.

# El endpoint devuelve la MISMA lista (todos los users online), sin importar el tenant.
# El chip "N en línea" del header muestra la unión de todos los tenants.

# Código: core/presence.py:24-30 — get_online() no recibe ni filtra por tenant_id.
```

### A.4 — Cambio manual a en_progreso se revierte (5.4)

```bash
# Con obra 17 en "planificada", sin ninguna tarea en "en_progreso":
curl -X PATCH http://localhost:8000/api/v1/obras/17 \
     -H "Authorization: Bearer $TOKEN" \
     -d '{"status":"en_progreso"}'
# → 200, response.status = "planificada" (no en_progreso)

# DB después:
SELECT status FROM obras WHERE id = 17; -- → planificada

# El frontend no advierte. El card sigue en gris.
```

---

## Anexo B — Datos del entorno al momento de la auditoría

- **Tenant 2 "Empresa de facundo"** (plan básico) — usado para las pruebas
  - 2 obras (16, 17) ambas planificadas
  - 49 tareas activas (23 + 26), 0 completadas
  - 109 alertas unread (82 delay_risk + 27 task_overdue) — badge mostraba "99+"
- **Otros tenants:** 1 (5 obras, 12 alertas), 4 (1 obra, 1 alerta), 8 (4 obras, 11 alertas)
- **5 alertas huérfanas con `tenant_id=NULL`** en toda la DB
- Backend `uvicorn app.main:app --host 0.0.0.0 --port 8000` (1 worker)
- Frontend Vite dev server `:5173`

---

## Anexo C — Archivos y líneas clave

**Frontend:**
- Panel principal: `frontend/src/pages/PortfolioPage.tsx`
  - KPI cards: `:465-507`
  - `KpiCard` helper: `:329-350`
  - Toolbar (search + Nueva obra): `:427-449`
  - Tabs de filtro: `:532-574`
  - Grid + card individual: `:73-303,584-657`
  - Empty state: `:510-529`
  - Ghost card: `:619-655`
- App layout / entrada: `frontend/src/App.tsx:59-60,142-145`
- Header + badge alertas: `frontend/src/components/AppLayout.tsx`, `frontend/src/components/AlertBell.tsx:76,172`
- Hooks:
  - `hooks/useGlobalAlerts.ts:26,35-67` — badge de alertas
  - `hooks/useOnlineUsers.ts` — polling presencia
  - `hooks/useTaskSocket.ts` — usado por ObraDetailPage, NO por el panel
- Permisos: `hooks/usePermission.ts`

**Backend:**
- Obras listing: `app/api/routes/obras.py:26-28`
- Obras update (con recompute): `app/api/routes/obras.py:36-46`, `app/services/obra_service.py:73-102`
- Cálculo `completed_tasks`/`total_tasks`: `app/services/obra_service.py:55-71`
- Alertas listing: `app/api/routes/alerts.py:12-27`, `app/services/alert_service.py:21-30`
- **Bug del join en alertas:** `app/repositories/alert.py:157-176` (líneas 169-171)
- Presencia: `app/api/routes/presence.py:9-12`, `app/core/presence.py:11,24`
- Socket.IO manager: `app/core/socket_manager.py:237-249` (emit `alert_created`)
- Schema `ObraSummary`: `app/schemas/obra.py:68-87`

**Tests:**
- No hay tests específicos del dashboard/panel hoy. Los tests de aislamiento `tests/test_tenant_isolation.py` cubren obras/tareas pero no el flujo del panel ni las alertas huérfanas ni la presencia.
