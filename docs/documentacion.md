# CONSTRUCTA — Bitácora de Desarrollo

## 1. Descripción breve del proyecto

CONSTRUCTA es un sistema de gestión de obras de construcción orientado a trazabilidad operativa. Resuelve un problema concreto: los jefes de obra no tienen una herramienta liviana para hacer seguimiento de tareas, recibir alertas cuando algo se bloquea, y tener un historial claro de qué pasó y cuándo. La propuesta es un dashboard web conectado a un chatbot de WhatsApp, donde los responsables pueden actualizar el estado de las tareas directamente desde el celular sin entrar a ninguna app. El backend interpreta los mensajes, aplica las transiciones de estado, y genera alertas e historial automáticamente.

---

## 2. Estado actual

**Actualizado:** 2026-04-25

| Componente | Estado |
|---|---|
| Backend — autenticación JWT | Completo |
| Backend — obras (CRUD) | Completo |
| Backend — tareas (estados, avance, dependencias) | Completo |
| Backend — responsables (CRUD + desactivación) | Completo |
| Backend — alertas (generación automática + lectura) | Completo |
| Backend — historial (registro automático + endpoint por obra) | Completo |
| Backend — webhooks WhatsApp (recepción de mensajes) | Estructura base lista |
| Backend — intérprete de mensajes (reglas) | Parcial |
| Frontend — Login | Completo |
| Frontend — Portfolio (panel con todas las obras) | Completo |
| Frontend — Obra Detail con tabs | Completo |
| Frontend — Responsables (tabla, edición, desactivación) | Completo |
| Frontend — Design system CONSTRUCTA | Completo |
| Frontend — Configuración | Placeholder |

---

## 3. Registro de avances

---

## 📅 Fase 1 — Backend core (obras, tareas, responsables)

### ✅ Avances

- Proyecto FastAPI inicializado con SQLAlchemy y Alembic
- Modelos creados: `Obra`, `Task`, `Responsible`
- Repository pattern implementado: cada módulo tiene su propio repositorio con acceso a datos aislado de los servicios
- Endpoints implementados:
  - `GET/POST /obras`
  - `GET /obras/{id}`
  - `GET/POST /obras/{id}/tasks`
  - `PATCH /tasks/{id}`
  - `GET/POST /responsibles`
  - `PATCH /responsibles/{id}`
  - `POST /responsibles/{id}/deactivate`
- Estados de obra: `planificada`, `en_progreso`, `pausada`, `completada`, `cancelada`
- Estados de tarea: `pendiente`, `en_progreso`, `bloqueada`, `en_revision`, `completada`, `cancelada`
- Campo `estimated_progress` (0–100) para avance
- Campo `depends_on_id` para dependencias entre tareas
- Autenticación JWT con usuario único hardcodeado (MVP scope)

### 🧠 Decisiones importantes

- **Tareas de alto nivel, no por operario.** El sistema no gestiona quién clava cada clavo. Gestiona etapas: "estructura terminada", "instalación eléctrica en progreso". El chatbot interactúa con jefes y responsables, no con obreros.
- **Responsable vinculado a número de WhatsApp.** El número es la identidad del responsable en el sistema de mensajería. Por eso `whatsapp_number` no es modificable desde la UI.
- **Sin replanificación automática.** Si una tarea se bloquea, el sistema alerta. No mueve fechas. Eso requeriría lógica de cronograma que está fuera del scope del MVP.
- **Repository pattern desde el inicio.** Facilita testing y mantiene la lógica de negocio separada del acceso a datos.

---

## 📅 Fase 2 — Alertas e historial

### ✅ Avances

- Modelo `Alert` creado con campos: `obra_id`, `task_id`, `type`, `message`, `is_read`
- Tipos de alerta: `task_blocked`, `delay_risk`
- Generación automática: cuando una tarea pasa a estado `bloqueada`, el sistema genera una alerta `task_blocked` sin intervención del usuario
- Endpoints:
  - `GET /alerts` — lista todas las alertas (con filtro opcional `unread_only`)
  - `POST /alerts/{id}/read` — marca una alerta como leída
- Modelo `HistorialEvento` creado con campos: `obra_id`, `task_id`, `event_type`, `description`, `payload`, `triggered_by`
- Registro automático en historial para:
  - `task_created` — al crear una tarea
  - `task_updated` — al modificar campos (sin cambio de estado)
  - `task_status_changed` — al cambiar el estado de una tarea
- Campo `triggered_by` con tres valores posibles: `"usuario"`, `"whatsapp"`, `"sistema"`
- Endpoint `GET /obras/{id}/historial?limit=N` para obtener el historial de una obra específica

### ⚠️ Problemas encontrados

**Los eventos `task_status_changed` nunca aparecían en el historial.**
Las transiciones de estado se ejecutaban correctamente (el campo en base de datos cambiaba), pero el evento no se registraba.

### 🛠 Soluciones aplicadas

**Causa:** El servicio evaluaba `if update.status != task.status` para decidir si loggear el evento. Pero la llamada a `update_status()` internamente ejecuta `session.refresh()`. SQLAlchemy mantiene un identity map: todos los accesos al mismo registro devuelven el mismo objeto Python. `session.refresh()` mutaba ese objeto actualizando `task.status` al nuevo valor *antes* de que se evaluara la condición. La comparación resultaba siempre `False`.

**Solución:** Capturar `old_status = task.status` en la primera línea del método, antes de cualquier operación que toque la sesión.

```python
# task_service.py — apply_status_update()
old_status = task.status  # capturar ANTES de update_status()
await self.repo.update_status(db, task.id, update.status)
if update.status and update.status != old_status:
    await self.historial_repo.create(
        db,
        obra_id=task.obra_id,
        task_id=task.id,
        event_type="task_status_changed",
        description=f"Estado: {old_status} → {update.status}",
        triggered_by=triggered_by,
    )
```

### 🧠 Decisiones importantes

- `delay_risk` se reserva para lógica futura basada en fechas de vencimiento. Por ahora no se genera automáticamente.
- El historial es append-only. No hay update ni delete sobre eventos. Es un log inmutable.
- `triggered_by` permite distinguir si un cambio lo hizo un usuario desde la UI, WhatsApp, o el propio sistema.

---

## 📅 Fase 3 — Webhooks y chatbot (interpretación de mensajes)

### ✅ Avances

- Endpoint `POST /webhook` para recibir mensajes de Evolution API (WhatsApp)
- Estructura del payload de entrada mapeada al modelo interno
- Lookup del responsable por número de WhatsApp (`whatsapp_number`)
- Intérprete de mensajes por reglas: reconoce frases como "tarea 3 completada", "bloqueada la tarea 5", "avance 70%"
- Si el intérprete no puede interpretar el mensaje, responde con un mensaje de ayuda
- Si el responsable no existe en el sistema, el webhook lo ignora silenciosamente

### ⚠️ Problemas encontrados

- Mensajes con variaciones ortográficas ("completado" vs "completada", mayúsculas, tildes) fallaban el matching.
- El intérprete retornaba errores 500 cuando el payload de WhatsApp tenía estructura inesperada.

### 🛠 Soluciones aplicadas

- Normalización del mensaje antes del matching: `mensaje.lower().strip()` + eliminación de tildes con `unicodedata`
- Validación defensiva del payload del webhook con Pydantic (campos opcionales con defaults)

### 🧠 Decisiones importantes

- El chatbot no usa NLP ni LLM en este punto. Solo reglas con regex. Suficiente para el MVP y más predecible para demostrar en la tesis.
- El sistema no autentica el origen del webhook (sin token de verificación de Meta). Pendiente para producción.

---

## 📅 Fase 4 — Frontend: login y dashboard inicial

### ✅ Avances

- Proyecto React + Vite + TypeScript + Tailwind CSS inicializado
- `LoginPage` implementada: panel dividido (izquierda oscura con features del producto, derecha con formulario)
- Axios configurado con interceptores: inyección de Bearer token en cada request, redirección automática al login en 401
- `DashboardPage` inicial con obra hardcodeada (`OBRA_ID = 1`)
- Primeros componentes: `StatCard`, `TaskTable` con barra de progreso y `StatusBadge`
- API layer separado: `api/obras.ts`, `api/tasks.ts`, `api/alerts.ts`, `api/historial.ts`

### ⚠️ Problemas encontrados

**Error de build: Vite 8 incompatible con Node 20.14.**
Al correr `npm run dev`, el proceso fallaba con un error de binding nativo de Rust.

**Causa:** Vite 8 usa Rolldown (bundler en Rust) con bindings nativos precompilados. Los bindings no son compatibles con Node 20.14.

**Solución:**
```bash
npm install vite@5 @vitejs/plugin-react@4
```
Vite 5 usa Rollup (JavaScript puro), sin dependencia de bindings nativos.

**Errores de TypeScript con `verbatimModuleSyntax`.**
Build fallaba: `"FormEvent" is a type and must be imported using 'import type'`.

**Causa:** `tsconfig.json` tiene `verbatimModuleSyntax: true`, que exige que los tipos se importen explícitamente con `import type`.

**Solución:** Corregir todas las importaciones de tipos en los archivos afectados:
```typescript
// antes
import { useState, FormEvent } from "react";
// después
import { useState, type FormEvent } from "react";
```
Archivos corregidos: `api/alerts.ts`, `api/tasks.ts`, `components/AlertsPanel.tsx`, `components/TaskTable.tsx`, `pages/DashboardPage.tsx`, `pages/LoginPage.tsx`.

---

## 📅 Fase 5 — Design system CONSTRUCTA

### ✅ Avances

- Design system industrial definido con paleta de colores custom en Tailwind:
  - `constructa-primary` #FF6B35 (naranja — acción principal)
  - `constructa-dark` #37474F (sidebar y encabezados)
  - `constructa-warning` #FFA726
  - `constructa-success` #43A047
  - `constructa-progress` #FB8C00
  - `constructa-danger` #E53935
  - `constructa-info` #1E88E5
  - `constructa-bg` #FAFAFA (fondo general)
  - `constructa-surface` #ECEFF1 (superficies secundarias)
  - `constructa-border` #B0BEC5
  - `constructa-secondaryText` #607D8B
  - `constructa-text` #263238
- Shadows custom: `shadow-card`, `shadow-card-md`
- Componentes UI primitivos creados:
  - `Card` — card blanca con padding configurable y acento izquierdo opcional
  - `Button` — variantes: `primary`, `secondary`, `danger`, `warning`, `dark`, `ghost`
  - `SectionTitle` — título con barra naranja izquierda y slot `aside` para acciones
  - `StatusBadge` — badge de color por estado de tarea
- `Sidebar` con logo CONSTRUCTA, navegación activa naranja, fondo oscuro
- `AppLayout` con sidebar + top bar (título, subtítulo, slot derecho, botón de logout)
- `StatCard` con variantes de acento por color
- `AlertsPanel` con distinción visual entre `task_blocked` (rojo) y `delay_risk` (ámbar)
- `HistorialPanel` con timeline, badges por tipo de evento, y etiqueta de origen (Usuario / WhatsApp / Sistema)

### 🧠 Decisiones importantes

- Paleta industrial: no pastel, no Material Design genérico. Naranja fuerte como color de acción porque evoca construcción.
- `SectionTitle` con barra naranja izquierda como elemento visual de consistencia en todo el dashboard.
- Todos los tokens son clases Tailwind custom (`constructa-*`). Nunca colores hardcodeados en JSX.

---

## 📅 Fase 6 — Módulo de Responsables en frontend

### ✅ Avances

- `ResponsablesPage` con tabla completa: id, nombre, WhatsApp, rol, estado activo/inactivo, acciones
- `EditModal`: edición de `full_name` y `role`; `whatsapp_number` visible pero deshabilitado con label "(no modificable)"
- `ConfirmDeactivate`: modal de confirmación antes de desactivar un responsable
- `fetchResponsibles`, `updateResponsible`, `deactivateResponsible` en `api/responsibles.ts`
- Cards de resumen: total, activos, inactivos

### 🧠 Decisiones importantes

- `whatsapp_number` no se envía al backend en el patch. El backend lo excluye del schema `ResponsibleUpdate`. La UI lo refleja mostrándolo deshabilitado — no es un error, es intencional.

---

## 📅 Fase 7 — Navegación centrada en obras

### ✅ Avances

- Se eliminó el `OBRA_ID = 1` hardcodeado del dashboard
- `ObrasPage` creada: grid de cards por obra con nombre, ubicación, fechas, estado y botón "Ver obra"
- `App.tsx` maneja estado `selectedObra: Obra | null`
- Al seleccionar una obra, el dashboard carga `DashboardPage` con el `obraId` correspondiente
- Filtro client-side de alertas por `obra_id`: el backend devuelve todas las alertas, el frontend filtra por obra activa
- `sidebarActivePage` derivado: cuando el panel está activo pero no hay obra seleccionada, el sidebar resalta "Obras"

### 🧠 Decisiones importantes

- Filtrar alertas en el cliente evita un endpoint extra en el backend. El volumen de alertas en MVP es bajo.

---

## 📅 2026-04-25 — Refactor de navegación (portfolio + tabs por obra)

### ✅ Avances

- **Sidebar simplificado** a dos ítems: Panel y Configuración. Se eliminaron Obras, Tareas, Responsables, Alertas, Historial del sidebar.
- **`PortfolioPage`** (nueva): vista principal del Panel con 5 StatCards globales (total obras, en progreso, planificadas, pausadas, completadas) + grid de ObraCards con "Ver obra" por cada obra.
- **`ObraDetailPage`** (nueva): vista por obra con 5 tabs:
  - **Resumen** — 6 StatCards de tareas + alertas recientes + historial reciente
  - **Tareas** — `TaskTable` completa
  - **Responsables** — `ResponsablesPage` embebida
  - **Alertas** — `AlertsPanel` completo con mark-as-read
  - **Historial** — `HistorialPanel` completo
  - Badge de alertas no leídas en el tab "Alertas"
  - Botón de refresh compartido en la barra de tabs
  - Todos los datos (tasks, alerts, historial) se cargan una sola vez al montar y se comparten entre tabs
- **`App.tsx`** simplificado: `activePage: "panel" | "configuracion"`, routing `PortfolioPage → ObraDetailPage` por `selectedObra`
- Botón "← Volver al panel" en la top bar cuando se está dentro de una obra
- Tipo `Page` en `types/index.ts` simplificado a `"panel" | "configuracion"`
- Build TypeScript limpio confirmado

### ⚠️ Problemas encontrados

- Ninguno. Build pasó sin errores al primer intento.

### 🧠 Decisiones importantes

- **Portfolio → Obra → Tabs.** La navegación ahora tiene jerarquía clara: primero ves todas las obras, luego entrás a una, luego navegás entre sus secciones con tabs. Más intuitivo que tener todo en la barra lateral.
- **Datos cargados una sola vez por obra.** `ObraDetailPage` hace un único `Promise.all` al montar y comparte `tasks`, `alerts`, `historial` entre todos los tabs. No hay refetch al cambiar de tab.
- **Tab "Resumen" muestra 5 alertas y 5 eventos recientes**, no la lista completa. Para el detalle completo, el usuario navega al tab correspondiente.

---

## 4. Decisiones estructurales del sistema

| Decisión | Justificación |
|---|---|
| Tareas de alto nivel, no por operario | El chatbot interactúa con jefes/responsables. No modelar operarios individuales simplifica el sistema sin perder valor. |
| Chatbot como fuente de estado | WhatsApp es el canal de comunicación real en obras de construcción en Argentina. El jefe ya lo usa; el sistema se adapta a él. |
| Sin replanificación automática | Mover fechas automáticamente requiere lógica de cronograma compleja y es fácil equivocarse. El MVP alerta, el humano decide. |
| Responsable = número de WhatsApp | El número es la identidad en el canal de mensajería. No puede cambiar sin romper el vínculo con el chatbot. |
| Repository pattern en backend | Separación de responsabilidades, facilita testing unitario de servicios. |
| State-based routing en frontend | Sin React Router. Con dos páginas de nivel top y tabs dentro de una obra, no se justifica la complejidad. |
| Alertas filtradas client-side | El volumen es bajo en MVP. Evita un parámetro de query extra en el endpoint y simplifica el backend. |
| Design system industrial CONSTRUCTA | Consistencia visual en toda la app. Naranja como color de acción por asociación con construcción. Sin librerías UI externas para tener control total del diseño. |

---

## 5. Próximos pasos inmediatos

1. UI para crear/editar/eliminar tareas desde el frontend (dentro de `ObraDetailPage > tab Tareas`)
2. Integración real con WhatsApp (Evolution API en producción o staging)
3. Completar intérprete de mensajes del chatbot (más patrones, mejor cobertura)
4. Alerta automática por `delay_risk` basada en `due_date` de tareas próximas a vencer
5. Métrica de avance promedio por obra en el tab Resumen
6. Pantalla de Configuración (cambio de contraseña como mínimo)
7. Deploy inicial (backend en Railway, frontend en Vercel)

---

## 6. Regla de uso

**Este documento se actualiza TODOS LOS DÍAS que se trabaje en el proyecto.**

Cada vez que se haga algo, se registra en la sección 3 con el formato:

```
## 📅 YYYY-MM-DD — título de la sesión

### ✅ Avances
### ⚠️ Problemas encontrados
### 🛠 Soluciones aplicadas
### 🧠 Decisiones importantes
```

Esto es obligatorio por tres razones:
1. **Seguimiento del proyecto** — saber dónde estamos y adónde vamos
2. **Documentación de tesis** — el proceso de desarrollo es parte del entregable
3. **Trazabilidad** — si algo se rompe, saber qué cambió y por qué

---

## 📅 2026-04-26 — Wizard de alta de obra

### ✅ Avances

- **`ObraSetupWizard`** creado (`src/components/ObraSetupWizard.tsx`): wizard de 4 pasos para dar de alta una obra completa en un solo flujo guiado
  - **Paso 1 — Datos básicos**: nombre (requerido), ubicación (requerida), descripción, fechas inicio/fin (opcionales). Validación con mensajes inline.
  - **Paso 2 — Responsables**: formulario inline de alta rápida (nombre, WhatsApp E.164, rol). Lista de tarjetas con editar/eliminar. Validación de formato E.164 y duplicados de número.
  - **Paso 3 — Tareas**: formulario inline de alta rápida (título, responsable desde el listado del paso 2, fechas). Badge "Sin responsable" en las tareas sin asignar. Editar/eliminar antes de confirmar.
  - **Paso 4 — Confirmación**: resumen con nombre de obra, ubicación, período, y 3 métricas (responsables, tareas, tareas sin responsable). Warning ámbar si hay tareas sin responsable.
  - **Pantalla de éxito** con botón "Ir a la obra" que navega directo al detalle.
- **Flujo de submit**: POST `/obras` → POST `/responsibles` (por cada uno) → POST `/tasks` (por cada una, con `responsible_id` mapeado). Todo secuencial para mantener los IDs.
- **Backdrop click** cierra el modal.
- **Navegación después de crear**: `handleObraCreated` en `App.tsx` setea `selectedObra` y navega a `ObraDetailPage` directamente.
- **Botón "Nueva obra"** en `PortfolioPage`: aparece en el aside del `SectionTitle` de "Mis obras".
- **Estado vacío mejorado** en `PortfolioPage`: muestra botón "Crear primera obra" en lugar de texto estático.
- API layer ampliado:
  - `api/obras.ts` — `createObra(payload)`
  - `api/responsibles.ts` — `createResponsible(payload)`
  - `api/tasks.ts` — `createTask(payload)`
- Build TypeScript limpio confirmado.

### ⚠️ Problemas encontrados

- Ninguno. Build pasó sin errores.

### 🧠 Decisiones importantes

- **Estado del wizard en el componente raíz.** Toda la data de los 4 pasos vive en `ObraSetupWizard`. No hay estado global ni context. Es un componente autónomo que recibe `onClose` y `onCreated` como callbacks.
- **Keys locales para responsables y tareas.** Antes de que existan IDs del backend, cada item draft tiene un `_key` generado localmente (`uid()`). Al crear en el backend se construye un `Map<_key, id>` para resolver las referencias en las tareas.
- **Editar = borrar + repopular formulario.** Al clickar "Editar" en una tarjeta, el item se elimina de la lista y sus datos se cargan en el formulario de alta. El usuario modifica y re-agrega. Patrón simple y sin estado de edición paralelo.
- **Responsable no bloquea.** Las tareas pueden crearse sin responsable asignado. El wizard avisa pero no bloquea. Esto es intencional: en obra real, muchas veces se planifican tareas antes de definir quién las ejecuta.
- **Sin manejo de rollback.** Si el POST de obra exitoso pero un POST de tarea falla, la obra queda creada. Aceptable para MVP — el usuario puede completar las tareas desde el detalle de la obra.

---

## 2026-04-27 — Resize handles en barras del GanttTimeline

### Objetivo
Implementar handles de redimensionamiento en las barras del GanttTimeline para que el usuario pueda cambiar la duración de una tarea arrastrando su borde izquierdo (modifica `start_date`) o derecho (modifica `due_date`), sin afectar el otro extremo. El drag de la barra completa mantiene el comportamiento existente de mover toda la tarea.

### Changes made
- Nuevo tipo `ResizeState` con campos `taskId`, `edge: "start" | "end"`, `startClientX`, `currentDeltaPx`
- Campo `mode: "move" | "resize-start" | "resize-end"` agregado a `PendingReschedule`
- Estado `resize` + ref `resizeRef` agregados (mismo patrón que `dragRef` para evitar stale closures)
- Función `startResize(taskId, edge, clientX)` análoga a `startDrag`
- `handleMouseMove` actualizado: checkea `dragRef` primero, luego `resizeRef`
- `handleMouseUp` refactorizado: split en rama `currentDrag` (lógica existente) y rama `currentResize` (calcula nuevo start o due con clamping mínimo 1 día)
- `useEffect` de listeners actualizado para vigilar `drag || resize`
- Preview visual en tiempo real durante resize: `effectiveStart`/`effectiveDue` se recalculan si `isResizing`, respetando el clamping
- Barra `hasBoth` refactorizada: wrapper `div` absoluto contiene barra interna + handles izquierdo/derecho (8px, `cursor-ew-resize`, `stopPropagation` en mouseDown para no activar el drag de barra)
- Cursor overlay diferenciado: `cursor-grabbing` para drag, `cursor-ew-resize` para resize
- UX note actualizado: incluye mención de bordes para cambiar duración
- `ReschedulingModal` recibe prop `mode`, adapta título, muestra duración anterior→nueva para resize, texto del botón cambia a "Confirmar ajuste" para modos de resize

### Files modified
- `frontend/src/components/GanttTimeline.tsx` — ResizeState, resizeRef, startResize, handleMouseMove/Up actualizados, preview de resize, wrapper + handles en barra hasBoth, cursor overlay, UX note
- `frontend/src/components/ReschedulingModal.tsx` — prop `mode`, título dinámico, duración anterior→nueva, texto del botón

### Problems found
- Ninguno durante implementación. Decisión de diseño: los handles usan `stopPropagation` para que el `onMouseDown` del div de la barra no dispare `startDrag` al clickar un handle.

### Solutions applied
- Wrapper div sin `overflow-hidden` que contiene la barra (con `inset-0 overflow-hidden`) más los handles como hermanos absolutos posicionados en `left-0` y `right-0`. Esto evita que `overflow-hidden` de la barra corte los handles.
- Clamping en handleMouseUp y en preview: si el nuevo start >= due, se fuerza a due - 1 día; si nuevo due <= start, se fuerza a start + 1 día.

### Validation
- `npm run build` — passed with 0 errors, 0 warnings

### Pending / next steps
- Test manual: arrastrar borde izquierdo, verificar preview, confirmar → `start_date` cambia, `due_date` sin cambio
- Test manual: arrastrar borde derecho, verificar preview, confirmar → `due_date` cambia, `start_date` sin cambio
- Test manual: arrastrar barra completa → modo "move" sin cambio de comportamiento
- Test manual: barra de 1 día → clamping impide reducir a 0 días
- Considerar a futuro: snap visual a otras fechas de tareas cercanas durante resize (actualmente solo se informa en modal, no hay snap)

---

## 2026-04-28 — Rediseño del Resumen tab como dashboard de decisiones

### Objetivo
El Resumen tab mostraba demasiada información repetida y pesada visualmente: 7 StatCards de estado de tareas, un AlertsPanel completo con 5 tarjetas de alertas individuales, y una barra de riesgo separada. La información más importante quedaba enterrada. El objetivo fue convertir el Resumen en un dashboard de decisiones: KPIs rápidos arriba, una sola tarjeta de alerta compacta, tareas críticas reducidas a las 3 más urgentes, y el Gantt como elemento visual central.

### Changes made
- Eliminados: `StatCard` (7 tarjetas de estado), `AlertsPanel` (lista completa de 5 alertas), barra de riesgo de obra separada, `byStatus()` helper, `overdueCount`, `noRespCount`, `alertPreview`
- Reemplazados por: 3 KPI cards compactas inline (Avance general + barra de progreso, Tareas activas, Problemas abiertos)
- Nueva tarjeta de alerta compacta: estado positivo ("Sin alertas pendientes") o estado de atención ("La obra requiere atención") con la alerta más importante y botón "Ver alertas". Prioridad: alerta a nivel obra → task_blocked → cualquier unread
- Tareas críticas reducidas de max 5 a max 3, con un único badge por tarea (razón más importante: Bloqueada > Vencida > Sin resp.)
- Orden de secciones: KPIs → Alertas+Críticas (2 columnas) → Gantt (ancho completo) → Tareas sin fechas → Actividad reciente (3 eventos, antes 5)
- Toda la funcionalidad del Gantt preservada: drag-to-move, resize handles, drag-to-schedule desde sin fechas, fallback de fechas de obra, click-to-edit
- `onMarkRead` mantenido en la interfaz Props para compatibilidad con ObraDetailPage (no se necesita en el render nuevo)

### Files modified
- `frontend/src/components/ResumenTab.tsx` — rediseño completo

### Problems found
- Ninguno. La prop `onMarkRead` seguía siendo requerida en la interfaz para no romper `ObraDetailPage` que la pasa, aunque ya no se usa en el render. Se dejó en la interfaz sin destructurar en los parámetros de la función.

### Solutions applied
- FS-03 respetado: todos los imports de tipos usan `import type`
- FS-07 respetado: solo tokens `constructa-*`, cero colores hex hardcodeados
- UX-02 respetado: Resumen muestra previews (max 3 críticas, max 3 historial), listas completas en sus propios tabs
- UX-03 respetado: estados vacíos en todas las secciones
- UX-06 respetado: `SectionTitle` en todas las secciones con nombre
- DC-01 respetado: no se hace fetch dentro del tab, todo viene de props

### Validation
- `npm run build` — passed with 0 errors, 0 warnings, 1825 modules transformed

### Pending / next steps
- Test manual: verificar que el Gantt drag-to-move, drag-to-schedule, resize handles y click-to-edit siguen funcionando tras el rediseño
- Test manual: con obra con alertas sin leer → verificar que la tarjeta muestra "La obra requiere atención" con el mensaje correcto y el botón "Ver alertas" navega al tab Alertas
- Test manual: con obra sin alertas → verificar estado positivo "Sin alertas pendientes"
- Test manual: con tareas bloqueadas/vencidas/sin responsable → verificar que aparecen en Tareas críticas con el badge correcto
- Considerar a futuro: añadir sparkline de progreso histórico en la KPI card de Avance general

---

## 2026-04-28 — Polish Resumen KPIs y visibilidad de duración en Gantt

### Objetivo
Dos mejoras de polish: (1) el KPI "Problemas abiertos" en el Resumen tab repetía información ya presente en la tarjeta de alerta compacta y en el badge del tab Alertas — se eliminó para reducir ruido. (2) Las barras cortas del Gantt no mostraban la duración porque `MIN_PCT_FOR_DUR` impedía el render dentro de la barra, sin alternativa visible — se agregó un label externo a la derecha para barras angostas.

### Changes made
- **ResumenTab:** Eliminado el KPI card "Problemas abiertos" (count de alertas sin leer). Grid de 3 columnas → 2 columnas (`sm:grid-cols-2`). La tarjeta de alertas compacta en la fila inferior sigue siendo el lugar canónico para esa información.
- **GanttTimeline:** Threshold `MIN_PCT_FOR_DUR` subido de 6% a 8% para barras largas. Agregado label externo `"{N}d"` posicionado a la derecha del borde de la barra (`left: calc(${barLeft + barWidth}% + 3px)`, `top: BAR_TOP + 3px`) cuando `barWidth < 8`. Tooltip actualizado: hint menciona "Arrastrá los bordes para cambiar duración" además de mover y editar.

### Files modified
- `frontend/src/components/ResumenTab.tsx` — KPI grid reducido de 3 a 2 cards
- `frontend/src/components/GanttTimeline.tsx` — threshold ajustado, label externo de duración, tooltip hint actualizado

### Problems found
- Ninguno. El label externo usa `calc()` mezclando porcentaje y px en el `style` inline — válido en React.
- El timeline cell tiene `overflow-hidden`, por lo que labels en barras muy cercanas al borde derecho pueden recortarse. Esto es aceptable porque el tooltip siempre muestra la duración completa.

### Solutions applied
- FS-07 respetado: `text-constructa-secondaryText` para el label externo, sin hex hardcodeados.
- El label externo es `pointer-events-none select-none` para no interferir con drag o resize.

### Validation
- `npm run build` — passed with 0 errors, 0 warnings, 1825 modules transformed

### Pending / next steps
- Test manual: barra ancha (>8%) → duración visible dentro de la barra en blanco
- Test manual: barra angosta (<8%) → label "Xd" visible a la derecha de la barra en color secondaryText
- Test manual: hover sobre barra → tooltip muestra título, inicio, vencimiento, duración, responsable, y hint de drag/resize/editar
- Test manual: eliminar el KPI "Problemas abiertos" no rompe el badge del tab Alertas ni la tarjeta de alerta compacta

---

## 2026-04-28 — Refine Gantt duration label: duration-based instead of width-based

### Objective
The previous logic used `barWidth >= 8%` to decide inside vs outside duration label. This was inconsistent: a 1-day task in a wide timeline still showed the label inside even though a single-day bar is visually too narrow for text. The fix makes the rule predictable and semantic: duration drives placement, not visual width.

### Changes made
- Inside bar label: condition changed from `barWidth >= MIN_PCT_FOR_DUR` → `durDays >= 2`
- Outside bar label: condition changed from `barWidth < MIN_PCT_FOR_DUR` → `durDays === 1`
- Removed now-unused constant `MIN_PCT_FOR_DUR = 8`

### Files modified
- `frontend/src/components/GanttTimeline.tsx` — duration label conditions, removed unused constant

### Problems found
- None. The `MIN_PCT_FOR_DUR` constant was referenced only in the two label conditions, so removing it was safe.

### Solutions applied
- Simple conditional swap. No drag logic, date math, or ref pattern affected.

### Validation
- `npm run build` — passed with 0 errors, 0 warnings, 1825 modules transformed

### Pending / next steps
- Test manual: 1-day task → "1d" appears outside the bar to the right
- Test manual: 2-day task → "2d" appears inside the bar
- Test manual: multi-week task → duration inside, readable
- Confirm resize handles still work on 1-day tasks

---

## 2026-04-28 — Fix task deletion: historial + alert resolution

### Objetivo
El método `TaskService.delete()` solo llamaba `self.repo.delete(task_id)` — sin historial, sin resolución de alertas. El modelo Alert usa `ondelete="SET NULL"` en la FK `task_id`, por lo que al eliminar una tarea sus alertas quedaban con `task_id=NULL` pero `is_read=False`. Esto causaba que esas alertas aparecieran como alertas de obra sin leer, contaminando el contador de alertas y la tarjeta de alerta en el Resumen. El objetivo fue añadir trazabilidad completa y limpiar el ruido operacional activo al eliminar una tarea.

### Root cause
`Alert.task_id` FK tiene `ondelete="SET NULL"`. Al borrar la tarea, el DB pone `task_id=NULL` en las alertas relacionadas pero `is_read` permanece `False`. El frontend filtra alertas sin `task_id` como alertas de obra (`obraAlerts = alerts.filter(a => !a.task_id && !a.is_read)`), así que estas alertas huérfanas aparecían incorrectamente como alertas activas de la obra.

### Changes made
- **AlertRepository**: nueva operación `mark_read_by_task(task_id)` — bulk update `is_read=True` en todas las alertas no leídas para ese task_id. No hard-delete: trazabilidad preservada.
- **TaskService.delete()**: antes de borrar captura estado completo de la tarea (BS-03), llama `mark_read_by_task`, loguea historial `task_deleted` con payload completo, luego borra la tarea.
- **TaskDeleteConfirm.tsx**: texto de confirmación actualizado para informar al usuario que las alertas activas serán resueltas.

### Deletion strategy
- La tarea se borra de forma hard-delete (comportamiento previo mantenido).
- Las alertas relacionadas NO se borran — se marcan `is_read=True`. Esto mantiene el audit trail completo y no requiere migración.
- El evento historial se loguea ANTES del delete para que `task_id` FK sea válida al momento del INSERT. Después del delete, el DB ON DELETE SET NULL pone `task_id=NULL` en el evento historial, pero el payload JSON conserva todos los datos de la tarea.

### Operation order in TaskService.delete()
1. `get_or_raise(task_id)` — verificar existencia
2. `_get_obra_and_assert_access(obra_id, manager_id)` — verificar acceso
3. Capturar: `obra_id, title, responsible_id, status.value, start_date, due_date` (BS-03)
4. `alert_repo.mark_read_by_task(task_id)` — resolver alertas activas
5. `historial.log(event_type="task_deleted", ...)` — con task_id aún válido
6. `repo.delete(task_id)` — hard delete

### Files modified
- `backend/app/repositories/alert.py` — import `update`, nuevo método `mark_read_by_task()`
- `backend/app/services/task_service.py` — método `delete()` expandido
- `frontend/src/components/TaskDeleteConfirm.tsx` — texto de confirmación actualizado

### Problems found
- `python3 -c "from app.main import app"` falla por `ModuleNotFoundError: No module named 'twilio'` — problema pre-existente en el entorno de desarrollo local (dependencia no instalada). No relacionado con los cambios de esta sesión.

### Solutions applied
- Validación de imports realizada directamente sobre los módulos modificados: `from app.repositories.alert import AlertRepository; from app.services.task_service import TaskService` — OK.
- BS-03: todos los campos de la tarea capturados antes del primer `await` que toca la sesión.
- BS-05: historial logueado para cada eliminación.
- `triggered_by="user"` correcto (acción iniciada desde el UI).

### Validation
- `python3 -c "from app.repositories.alert import AlertRepository; from app.services.task_service import TaskService; print('imports OK')"` — OK
- `npm run build` — passed with 0 errors, 0 warnings, 1825 modules transformed

### Pending / next steps
- Test manual: crear tarea con responsable → esperar generación de alerta → eliminar tarea → verificar que la alerta desaparece del contador unread
- Test manual: historial muestra evento `task_deleted` con payload completo (title, status, start_date, due_date, responsible_id)
- Test manual: refresh de página → no regresa ninguna alerta huérfana de la tarea eliminada
- Test manual: Resumen tab → tareas activas y cronograma actualizados tras eliminación
- Instalar `twilio` en el entorno local para que `python3 -c "from app.main import app"` pase completo

---

## 2026-04-28 — Fix alert consistency and improve Alertas/Tareas UX

### Objective
Six-part fix addressing alert duplication, alert UX (default filter, action rules), restoration of the Avance column in Tareas, and passing task context into AlertasTab so "Ver tarea" only appears when appropriate.

### Root cause analysis

**Duplicate alerts (Part 4):** `_task_alert()` and `_obra_alert()` in `AlertService` used `exists_unread_for_task/obra()` — which only checks *unread* alerts. When a user marks a delay_risk alert as read but the underlying condition (no responsible, overdue) persists, the next page load would create a new unread alert. This cycle could repeat indefinitely, producing stale duplicates.

**"Ver tarea" on read alerts (Part 3):** AlertasTab showed the "Ver tarea" button unconditionally on any alert with a `task_id`, regardless of `is_read` or whether the task still exists. Alerts for deleted tasks (where `task_id` became null via `ondelete="SET NULL"`) could not navigate anywhere.

**Default filter "Todas" (Part 2):** The actionable view is unread alerts; starting on "Todas" buries them.

**Avance column removed (Part 1):** The prior session removed the ProgressBar to simplify the table but the column is operationally useful for tracking task progress at a glance.

### Changes made

**Backend — `AlertRepository`:**
- Added `exists_for_task(task_id, alert_type, message)`: checks ANY alert (read or unread) with exact (task_id, type, message). Prevents re-creating delay_risk alerts for chronic unresolved conditions when user acknowledges with mark-read.
- Added `exists_for_obra(obra_id, alert_type, message)`: same logic for obra-level alerts.

**Backend — `AlertService._task_alert()`:**
- Changed dedup from `exists_unread_for_task` → `exists_for_task`. Rationale: a delay_risk condition that hasn't been fixed should not spam the UI on every page load. If the underlying data changes (e.g. due_date shifts, generating a new message string), a new alert is created correctly because message equality fails.

**Backend — `AlertService._obra_alert()`:**
- Same change to `exists_for_obra`. Obra-level messages embed counts (e.g., "El 40% de las tareas..."), so a severity change naturally produces a new message → new alert.

**Backend — `TaskService.apply_status_update()`:**
- Added `exists_unread_for_task` dedup check before creating `task_blocked` alert. The status machine already prevents BLOQUEADA→BLOQUEADA, but the guard adds defensive safety against edge cases (e.g. webhook replay).

**Frontend — `TaskTable.tsx`:**
- Restored `ProgressBar` component (lighter style: 1.5px bar, muted colors, tabular-nums text).
- Restored "Avance" column header and corresponding `<td>`.

**Frontend — `AlertasTab.tsx`:**
- Default filter changed from `"todas"` → `"no_leidas"` (actionable first).
- Filter order changed to: No leídas → Todas → Leídas.
- Added `tasks: Task[]` to props.
- Action rules per spec:
  - Unread alert + task exists → show "Ver tarea" + mark-read button.
  - Unread alert + task_id not null but task not in list → show "Tarea eliminada" text (no navigation).
  - Unread alert + task_id null (obra-level) → no "Ver tarea".
  - Read alert → no action buttons at all (historical/informational only).
- Empty state for "no_leidas" filter: "No hay alertas pendientes." (positive state).

**Frontend — `ObraDetailPage.tsx`:**
- Passes `tasks={tasks}` into `<AlertasTab>` so it can compute `taskExists`.

### Files modified
- `backend/app/repositories/alert.py` — added `exists_for_task()` and `exists_for_obra()` methods
- `backend/app/services/alert_service.py` — updated `_task_alert()` and `_obra_alert()` to use full dedup
- `backend/app/services/task_service.py` — added dedup guard before `task_blocked` alert creation
- `frontend/src/components/TaskTable.tsx` — restored ProgressBar and Avance column
- `frontend/src/components/AlertasTab.tsx` — default filter, filter order, tasks prop, action rules
- `frontend/src/pages/ObraDetailPage.tsx` — passes tasks to AlertasTab

### Problems found
- `exists_unread_for_*` dedup was insufficient for delay_risk conditions: marking read + persistent condition = new duplicate alert on next load.
- No guard on `task_blocked` creation in task_service.
- "Ver tarea" rendered on read alerts and on alerts whose tasks were deleted (task_id null after FK SET NULL).

### Solutions applied
- Full dedup (`exists_for_task/obra`) for delay_risk — checks both read and unread history. References AR-01 (dedup mandatory).
- Unread-only dedup for `task_blocked` — each reblocking is a distinct event; full dedup would hide recurrences.
- `canNavigate = !isRead && taskExists` — clean guard that handles all edge cases (read, null task_id, deleted task). References DC-02 (optimistic alert updates).
- Avance column restored with lighter visual weight (no dominant colored bars, muted palette). References FS-07 (constructa-* tokens).

### Validation
- `python3 -c "from app.repositories.alert import AlertRepository; from app.services.alert_service import AlertService; from app.services.task_service import TaskService; print('imports OK')"` — imports OK
- `npm run build` — passed with 0 errors, 1825 modules transformed

### Manual test checklist
1. Create task with no responsible → open Alertas tab → default is "No leídas" → alert appears once.
2. Refresh page multiple times → alert count does NOT increase (full dedup working).
3. Mark alert as read → alert moves to historical (leídas) → no "Ver tarea" visible.
4. Reload page → no new unread alert created for the same condition (key fix).
5. Delete task with unread alerts → alerts become read → unread count decreases → no "Ver tarea" for deleted task alerts.
6. Tareas tab → Avance column visible, lighter bar + percentage.

### Pending / next steps
- Verify dedup covers the "overdue date shifts" case: if task.due_date is edited, the overdue alert message changes → new alert created → correct behavior.
- Consider marking delay_risk alerts as read automatically when the underlying condition is resolved (e.g., responsible assigned → mark "sin responsable" alert as read). This would enable proper recurrence detection and allow re-alerting when the issue returns.
- Install `twilio` locally to enable `python3 -c "from app.main import app"` full validation.

---

## 2026-04-28 — Improve Historial and Responsables tabs UX

### Objective
Two UX improvements to make the app more useful for non-technical users. The Historial tab showed raw technical messages (e.g., "Fields updated: ['responsible_id']") and had no way to filter events by category. The Responsables tab showed a plain task count with no workload signal. Both improvements are frontend-only — no backend changes required.

### Changes made

**Historial tab (HistorialPanel.tsx):**
- Added `filterable?: boolean` prop (defaults to `false`). When `true`, renders filter pills at the top. Resumen preview uses the component without filters; the full Historial tab enables them.
- Filter categories: Todos, Tareas (`task_*`), Alertas (`alert_created`), Obra (`obra_*`), Chatbot / Sistema (triggered_by = chatbot | system).
- Added missing event type labels and styles: `task_deleted` (red), `alert_created` (amber).
- Added `humanizeDescription(ev)` function that translates technical backend messages into readable Spanish:
  - `task_created`: parses "Task 'X' created" → "Tarea «X» creada"
  - `task_updated`: maps payload keys through `FIELD_LABELS` → "Campos actualizados: responsable, fecha de vencimiento"
  - `task_status_changed`: maps status values through `STATUS_LABELS` → "En progreso → Bloqueada · 40%"
  - `task_deleted`: uses backend description (already in Spanish)
  - `alert_created`: "Alerta generada por el sistema"
  - `obra_*`: "Obra registrada en el sistema" / uses backend description
- Simplified the secondary line to: `{triggered_by} · {date}` (removed raw task_id display).
- Two empty states: "No hay eventos registrados." (dataset empty) and "No hay eventos con este filtro." (filter active).

**ObraDetailPage.tsx:**
- Passes `filterable` prop to `<HistorialPanel>` in the `case "historial"` render.

**Responsables tab (ObraResponsablesTab.tsx):**
- Added `WorkloadBadge` component that replaces `TaskCountBadge` for active responsibles:
  - 0 active tasks → "Sin tareas" (muted text)
  - 1–2 active tasks → amber badge "Con tareas · N"
  - 3+ active tasks → red badge "Alta carga · N"
- Added `activeTaskCount()` helper (filters out completada/cancelada) for workload badge.
- Kept `totalTaskCount()` (all tasks) for the inactive table's "Tareas históricas" column — preserves historical assignment count.
- Renamed active table column "Tareas en obra" → "Carga actual".
- `TaskCountBadge` kept for the inactive table (total count, no workload semantics needed).

### Files modified
- `frontend/src/components/HistorialPanel.tsx` — full rewrite with filters, humanized descriptions, new event types
- `frontend/src/pages/ObraDetailPage.tsx` — added `filterable` prop to HistorialPanel call
- `frontend/src/components/ObraResponsablesTab.tsx` — WorkloadBadge, activeTaskCount, column rename

### Problems found
- None. `humanizeDescription` falls back to raw `ev.description` for unknown event types, so unknown future event types degrade gracefully.

### Solutions applied
- `filterable` prop keeps the Resumen preview clean (no filter chrome in a 3-event preview panel). Full tab gets full filters.
- Active vs total task count distinction: workload should only count live tasks (active), but historical count in the inactive table should include all assignments.
- References: FS-02 (no fetching in tabs), FS-03 (import type), FS-07 (constructa-* tokens), UX-03 (empty states), UX-06 (SectionTitle pattern).

### Validation
- `npm run build` — passed with 0 errors, 1825 modules transformed

### Manual test checklist
1. Open Historial tab → filter pills visible (Todos, Tareas, Alertas, Obra, Chatbot/Sistema).
2. Filter "Tareas" → only task_* events shown.
3. Filter "Alertas" → only alert_created events shown.
4. Filter with no matches → "No hay eventos con este filtro."
5. Resumen tab → historial preview (3 events) shows no filter pills, descriptions readable.
6. task_updated event → description shows "Campos actualizados: responsable" (not "Fields updated: ['responsible_id']").
7. task_status_changed → "En progreso → Bloqueada" (Spanish status names).
8. Responsables tab → active responsible with 0 tasks shows "Sin tareas".
9. Active responsible with 1–2 tasks shows amber "Con tareas · N".
10. Active responsible with 3+ tasks shows red "Alta carga · N".

### Pending / next steps
- "Ver tareas" action on responsible rows: would require either filtering the Tareas tab by responsible_id or navigating with a filter. Deferred — implement when Tareas tab gets filter support.
- task_created description parsing relies on the English format "Task 'X' created" from the backend. Consider translating at the backend level in a future backend update to keep message responsibility in one place.

---

## 2026-04-28 — Add responsible reactivation

### Objective
Inactive responsibles had no actionable path — they were visible in the collapsed section but could not be re-enabled. This feature adds a full reactivation flow: backend endpoint, service method, API function, confirmation modal, and "Reactivar" button in the inactive responsible rows.

### Changes made
- **Backend service**: `ResponsibleService.reactivate()` — finds the responsible, returns early if already active, sets `is_active=True` via `update_fields`. No task reassignment and no historial event (mirrors the deactivate pattern: historial is logged per affected task, not per responsible state change).
- **Backend route**: `PATCH /responsibles/{responsible_id}/reactivate` — thin handler, delegates to service. Placed before `DELETE /{id}` to avoid route shadowing.
- **Frontend API**: `reactivateResponsible(id)` added to `api/responsibles.ts`.
- **Frontend modal**: `ResponsibleReactivateConfirm.tsx` — confirmation modal with loading/error state. Matches the visual pattern of `TaskDeleteConfirm`: icon, description, Cancel + confirm buttons. Uses green/success color scheme to distinguish from the destructive deactivate action.
- **Frontend tab**: `ObraResponsablesTab.tsx` — added `toReactivate` state, "Reactivar" button (with `UserCheck` icon) in every inactive row, `handleReactivated()` callback that calls `onRefresh()`, and the modal in the modals section.

### Files modified
- `backend/app/services/responsible_service.py` — added `reactivate()` method
- `backend/app/api/routes/responsibles.py` — added `PATCH /{id}/reactivate` route
- `frontend/src/api/responsibles.ts` — added `reactivateResponsible()`
- `frontend/src/components/ResponsibleReactivateConfirm.tsx` — new modal component
- `frontend/src/components/ObraResponsablesTab.tsx` — wired reactivate state, button, and modal

### Problems found
No issues. The pattern mirrors `deactivate()` exactly in reverse — same repo call (`update_fields`), same idempotent guard (return early if already in target state).

### Solutions applied
- Route ordering: `PATCH /{id}/reactivate` placed before `DELETE /{id}` so FastAPI matches it before falling into a catch-all path segment. References PB-03 (route handler thin, delegates to service).
- BS-04 (soft-delete pattern): `is_active=False`/`True` via `update_fields`, no row deletion.
- No task auto-assignment on reactivation (per spec and DR-04 which only defines the deactivation cascade, not a reactivation one).
- FS-06 compliance: inactive responsibles remain filtered out of task assignment dropdowns until reactivated (the dropdown already filters `responsibles.filter(r => r.is_active)`).

### Validation
- `python3 -c "from app.services.responsible_service import ResponsibleService; from app.api.routes.responsibles import router; print('imports OK')"` — imports OK
- `npm run build` — passed with 0 errors, 1826 modules transformed

### Manual test checklist
1. Deactivate a responsible → disappears from active list and task dropdown.
2. Open "Ver responsables desactivados" → responsible visible with "Reactivar" button.
3. Click "Reactivar" → confirmation modal appears with name and description.
4. Confirm → modal closes, responsible moves to active list.
5. Open task form → responsible appears in dropdown again.
6. No tasks auto-assigned after reactivation.

### Pending / next steps
- None — feature complete.

---

## 2026-04-28 — Portfolio page redesign

### Objective
The main portfolio page (obra list) had excessive orange decoration (left border on every card, full-width orange CTA button) and lacked filtering and summary capabilities. The redesign reduces visual noise, makes cards fully clickable, adds filter pills, and trims the KPI section to the three most actionable metrics.

### Changes made
- **ObraCard**: Removed `border-l-4 border-l-constructa-primary`. Entire card is now clickable (`div onClick={onSelect} cursor-pointer`) using `group` + `group-hover`. Replaced the full-width orange "Ver obra" button with a compact link-style footer (`"Ver obra →"` text that changes color on `group-hover:text-constructa-primary`).
- **KPI section**: Reduced from 5 StatCards to 3 — "Total obras", "En progreso" (primary accent), "Completadas" (success accent). `StatCard` left-border accent was also removed; only the value text is colored.
- **Filter pills**: Added `ObraFilter = "todas" | ObraStatus` type and 5 pill buttons (Todas / En progreso / Planificadas / Pausadas / Completadas), each showing its count. Active pill has `bg-white shadow-sm`. Filtered view shows empty state "No hay obras con este filtro." when no obras match.
- **StatCard**: Removed `border` and `border-l-4` from all `accentConfig` entries — now only `value` (text color) differs per accent.

### Files modified
- `frontend/src/pages/PortfolioPage.tsx` — full rewrite of ObraCard, KPI section, added filter pills
- `frontend/src/components/StatCard.tsx` — removed border accent from `accentConfig`

### Problems found
None. Straightforward visual refactor.

### Solutions applied
- FS-07 (only `constructa-*` tokens): all new classes use existing Tailwind utilities or `constructa-*` tokens.
- UX-03 (empty states): filter "No hay obras con este filtro." empty state added alongside the existing "Sin obras registradas" empty state.
- Entire-card click: wrapping div handles `onClick` — no nested `<a>` or `<button>` needed since the card is navigational only.

### Validation
- `npm run build` — passed with 0 errors, 1.61s, 0 TypeScript errors

### Manual test checklist
1. Open portfolio page → 3 KPI cards visible (Total / En progreso / Completadas).
2. Obra cards have no orange left border; clean bordered style.
3. Click anywhere on a card → navigates to obra detail.
4. Hover card → footer "Ver obra →" turns orange; card gets slightly deeper shadow.
5. Filter pills: click "En progreso" → only in-progress obras shown; count updates.
6. Filter showing 0 obras → "No hay obras con este filtro." empty state.
7. "Actualizar" refresh button still works.
8. "Nueva obra" button still opens creation modal.

### Pending / next steps
- None — feature complete.

---

## 2026-04-28 — Portfolio page premium visual redesign

### Objective
After the previous session reduced orange decoration, the Portfolio/Panel page became visually flat. This session reintroduces color and visual identity in a controlled, modern way — using icon blocks, colored dots, subtle backgrounds, and an informational banner — to achieve a premium SaaS dashboard look without overwhelming orange.

### Changes made
- **StatCard**: Added optional `icon: ReactNode` and `helperText: string` props. Each accent now has a matching `iconBg` (e.g. `bg-orange-50` for primary, `bg-blue-50` for info) and `iconColor`. When `icon` is provided the card renders a colored icon block on the left. `helperText` renders below the value in muted small text. Backwards-compatible — all existing usages without these props remain unchanged.
- **ObraCard**: Added a building icon block (`Building2` on `bg-blue-50`) on the left as a visual anchor. Content flows to the right with name + status badge, then metadata rows. Layout is now `flex gap-4` with the icon block as a `flex-shrink-0` element.
- **Filter pills**: Pill container changed to `rounded-full`. Each pill now shows a colored dot (`.bg-constructa-primary`, `.bg-constructa-info`, `.bg-constructa-warning`, `.bg-constructa-success`) that is fully opaque on the active pill and 40% opacity when inactive. Pills themselves are also `rounded-full`.
- **KPI StatCards**: Passed icons (`Building2`, `TrendingUp`, `CheckCircle2`) and `helperText` ("Todas las obras registradas", "Obras en ejecución", "Obras finalizadas") to each card.
- **Informational banner (`InfoBanner`)**: New component rendered below the obra grid when at least one obra exists (inside the `obras.length > 0` branch). Uses `bg-blue-50 border border-blue-100` background. Shows title/subtitle on the left with a vertical divider, and three feature items (Seguimiento en tiempo real / Control de tareas / Reportes y métricas) with small icon blocks on the right. Icons used: `Clock`, `ClipboardList`, `BarChart3`.

### Files modified
- `frontend/src/components/StatCard.tsx` — added `icon`, `helperText` props; added `iconBg` and `iconColor` to `accentConfig`
- `frontend/src/pages/PortfolioPage.tsx` — new `ObraCard` layout, redesigned filter pills with colored dots, updated StatCard usages, new `InfoBanner` component

### Problems found
No issues. All new props are optional so DashboardPage's existing StatCard usages required no changes.

### Solutions applied
- FS-07 compliance: all colors use `constructa-*` tokens for text/border; `bg-blue-50`, `bg-orange-50`, etc. are standard Tailwind palette classes (not hex), consistent with existing usage throughout the codebase.
- UX-03: existing empty states for "Sin obras registradas" and "No hay obras con este filtro." were preserved.
- `InfoBanner` declared as a named component above `PortfolioPage` to keep JSX readable and avoid defining JSX in data arrays (which would require wrapping in a function anyway).
- Backwards compatibility: `StatCard` remains usable without `icon`/`helperText` — the icon block only renders when `icon` is provided.

### Validation
- `npm run build` — passed with 0 errors, 1826 modules transformed, 1.49s

### Manual test checklist
1. Panel page loads → 3 KPI cards each show icon block, value, and helper text below.
2. Hover KPI cards → no change (they are not clickable).
3. Filter pills render as a rounded pill group with colored dots; active pill is white with shadow.
4. Click each filter → dot fully opaque on active, obras grid updates correctly.
5. Empty filter state → "No hay obras con este filtro." centered message.
6. ObraCard shows building icon block on left, name + status badge, location, dates.
7. Hover card → "Ver obra →" footer turns orange, card shadow deepens.
8. With obras present → `InfoBanner` appears below the grid with 3 feature items.
9. With no obras → banner does NOT appear (inside the `obras.length === 0` branch).
10. DashboardPage (inner obra detail) → StatCards without icons still render correctly (backwards compatible).

### Pending / next steps
- None — visual redesign complete.

---

## 2026-04-28 — Portfolio page color consistency fix + banner removal

### Objective
After the previous visual redesign, color usage was still inconsistent: the "Total obras" KPI icon used gray instead of blue, the bottom informational banner added visual noise, and StatCard lacked a way to show a left accent line for primary emphasis. This session applies precise color corrections, removes the banner, and adds an `accentLine` prop to StatCard.

### Changes made
- **Removed informational banner**: Deleted `BANNER_FEATURES`, `InfoBanner` component, `Clock`/`ClipboardList`/`BarChart3` imports, and the `<InfoBanner />` call from the JSX. No replacement, no spacing artifact.
- **StatCard `default` accent**: Changed `iconBg` from `bg-constructa-surface` (gray) to `bg-blue-50` (soft blue) and `iconColor` from `text-constructa-secondaryText` to `text-constructa-info`. "Total obras" card now shows a blue icon block, consistent with the info color hierarchy.
- **StatCard `accentLine` prop**: Added optional `accentLine?: boolean`. When true, adds `border-l-4` + an accent-matched left border color (from a new `line` field in `accentConfig`). Each accent maps to its own border color token (`border-l-constructa-info`, `border-l-constructa-primary`, etc.).
- **PortfolioPage "Total obras" card**: Passed `accentLine` to add the left blue accent line only on the first KPI card.
- **Gap increased in StatCard**: Changed `gap-4` to `gap-5` between icon block and text for slightly more breathing room.
- **Removed unused imports**: `Clock`, `ClipboardList`, `BarChart3` removed from PortfolioPage imports.

### Files modified
- `frontend/src/components/StatCard.tsx` — `default` accent iconBg/iconColor fixed; `accentLine` prop + `line` in accentConfig added; gap increased
- `frontend/src/pages/PortfolioPage.tsx` — banner and dead imports removed; `accentLine` passed to "Total obras" card

### Problems found
No issues. All changes were backwards-compatible — existing StatCard usages in DashboardPage without `accentLine` are unaffected (prop defaults to false).

### Solutions applied
- FS-07: all color classes use `constructa-*` tokens or standard Tailwind palette names (no hex values).
- `accentLine` implemented as a boolean rather than exposing the border class directly — avoids Tailwind purging issues with dynamic class names by keeping the full class string in a static config map.
- Default accent `iconBg` → `bg-blue-50`: Total obras is the neutral overview card; blue is visually lighter than orange and aligns with the "info" (informational/neutral) semantic.

### Validation
- `npm run build` — passed with 0 errors, 1826 modules transformed, 1.54s

### Manual test checklist
1. Panel page → "Total obras" card has blue left accent line + blue icon block.
2. "En progreso" card has orange icon + orange value; no accent line.
3. "Completadas" card has green icon + green value; no accent line.
4. DashboardPage StatCards (inside obra detail) → no accent lines, no regression.
5. Bottom banner is completely gone — no empty space below the obra grid.
6. Filter pills unchanged: colored dots, rounded pill group.
7. ObraCard icon block remains `bg-blue-50 text-constructa-info`.

### Pending / next steps
- None — color consistency fix complete.

---

## 2026-04-28 — Portfolio page fine-tuning: rounding, icons, progress bar, pill border

### Objective
Fine-tune the Portfolio/Panel page for a more premium dashboard feel: more rounded cards, larger icon blocks, an always-orange "Ver obra" link with an animated arrow, a subtle progress indicator per card derived from obra status, and an enhanced filter pill active state with an orange tint border.

### Changes made
- **"Ver obra →"**: Changed from `text-constructa-secondaryText group-hover:text-constructa-primary` to `text-constructa-primary` always (orange by default). Added `group-hover:translate-x-0.5 transition-transform` on the `ArrowRight` icon for a subtle forward nudge on hover.
- **ObraCard rounding**: `rounded` → `rounded-2xl`. Icon block: `w-11 h-11 rounded-lg` → `w-14 h-14 rounded-xl`. Building icon: `w-5 h-5` → `w-7 h-7`.
- **StatCard rounding**: `rounded` → `rounded-2xl`. Icon block: `w-12 h-12 rounded-lg` → `w-14 h-14 rounded-xl`. Icons in PortfolioPage: `w-6 h-6` → `w-7 h-7`.
- **Filter pill active border**: Added `border` class to all pills; active pill gets `border-constructa-primary/30`, inactive gets `border-transparent` (prevents layout shift).
- **Progress bar (`ObraProgressBar`)**: New component placed between the body section and the footer divider in ObraCard. Uses a `STATUS_PROGRESS` map (no backend call, derived from status only): planificada 0% info-blue, en_progreso 0% primary-orange, pausada 0% warning-amber, completada 100% success-green, cancelada omitted. Track: 4px high `bg-constructa-surface` rounded-full. Fill: 1px height with status color. Label "AVANCE" and percentage shown above the bar.

### Files modified
- `frontend/src/pages/PortfolioPage.tsx` — all card/icon sizing, footer link, progress bar component, filter pill border
- `frontend/src/components/StatCard.tsx` — `rounded-2xl`, icon block `w-14 h-14 rounded-xl`

### Problems found
No issues. The `STATUS_PROGRESS` map correctly returns `undefined` for `cancelada`, and the `ObraProgressBar` component returns `null` in that case — no render for cancelled obras.

### Solutions applied
- Progress derived entirely from `ObraStatus` (no new API call, no FS-02 violation) — portfolio page has no task data, and deriving from status is the documented fallback per spec.
- `border-constructa-primary/30` works because Tailwind v3 opacity modifiers are supported for custom colors defined as hex values in `tailwind.config.js`. Confirmed already in use elsewhere in the codebase (`border-constructa-danger/30`).
- `group-hover:translate-x-0.5` on `ArrowRight` adds motion without color change since the text is already orange; subtle directional hint on hover is UX-aligned.
- `border-transparent` on inactive pills prevents reflow when border appears on active pill.

### Validation
- `npm run build` — passed with 0 errors, 1826 modules transformed, 1.56s

### Manual test checklist
1. KPI cards have `rounded-2xl` corners, larger icon blocks (14×14 = 56px), bigger icons.
2. "Total obras" has left blue accent line.
3. Obra cards are more rounded (`rounded-2xl`), building icon is larger.
4. "Ver obra →" text is always orange (not gray); arrow nudges right on card hover.
5. Active filter pill has a faint orange border ring around it.
6. Completada card shows a full green progress bar at 100%.
7. Planificada / en_progreso / pausada cards show an empty track with "AVANCE 0%".
8. Cancelada obras (if any) show no progress bar.
9. Filter pills count and filtering remain functional.
10. No bottom banner, no orange left border on cards.

### Pending / next steps
- Progress bars currently show only status-based placeholders. Real task-completion progress would require either passing aggregated task data from the backend in the Obra response or fetching tasks per obra on the portfolio page (not recommended — FS-02 scope). Could be a future enhancement if the backend adds an `estimated_progress` field to the Obra model.

---

## 2026-04-28 — Resumen tab premium visual redesign

### Objective
Elevate the ObraDetailPage Resumen tab to a modern SaaS dashboard standard. Improve visual hierarchy, add status-aware color logic, introduce a circular progress indicator, redesign the alerts and critical tasks section with tinted cards, and add section icon hints. No logic changes.

### Changes made
- **3 KPI cards row** (was 2): Added "Tareas completadas" alongside Avance and Tareas activas. All three use the new inline card design: `rounded-2xl`, `w-14 h-14 rounded-xl` icon block, large bold value, helper text below. Colors: Avance → blue-50 bg + dynamic value color; Tareas activas → orange-50 + constructa-primary; Completadas → green-50 + constructa-success.
- **CircularProgress**: New SVG donut ring component. Uses `stroke-dasharray`/`stroke-dashoffset` (via `strokeDasharray`) to render a partial arc. Color responds to `pct` (warning <50%, primary ≥50%, success 100%).
- **Alerts card redesign**: Removed `SectionTitle` wrapper. Card is now self-contained with tinted background (`bg-orange-50 border-orange-200` if unread > 0, white otherwise). Icon: `w-14 h-14 rounded-xl`. Count as large bold number. CTA "Ver alertas →" with `ArrowRight` icon.
- **Critical tasks card redesign**: Same pattern as alerts: `bg-red-50 border-red-200` when critical > 0. Inline task list inside the card. CTA "Ver tareas →". When no critical tasks, both cards use `bg-green-50` icon block + success color.
- **Section title icons**: Added small icon hints to "Cronograma de tareas" (`Calendar`), "Tareas sin fechas" (`AlertTriangle` only when count > 0), and "Actividad reciente" (`Activity`) as inline children of `SectionTitle`.
- **Tareas sin fechas**: Added count in parentheses and `AlertTriangle` icon in the section title. "Ver todas" link in the footer row when count > 5.
- **Actividad reciente**: Added "Ver todo →" button in `SectionTitle` aside (wired to `onViewHistorial`). Already limited to 3 events.
- **Card wrappers**: Changed from `<Card>` to `<div className="bg-white border border-constructa-border rounded-xl shadow-card ...">` for more control over rounding (`rounded-xl` instead of `rounded`).
- **GanttTimeline**: "Hoy" label → small red badge showing "Hoy DD/MM". Today line: width `w-0.5`, opacity `80%` (was 55%), band wider (9px) and slightly darker. Main task bar: `rounded` → `rounded-md`.
- **ObraDetailPage**: Added `onViewHistorial={() => setActiveTab("historial")}` to the ResumenTab call.
- **ResumenTab interface**: Added optional `onViewHistorial?: () => void` prop.

### Files modified
- `frontend/src/components/ResumenTab.tsx` — full visual redesign
- `frontend/src/components/GanttTimeline.tsx` — today line + bar rounding improvements
- `frontend/src/pages/ObraDetailPage.tsx` — `onViewHistorial` wired

### Problems found
No issues. `completedCount` derived the same way as `activeCount` — just a filter on `status === "completada"`. `onViewHistorial` is optional so no existing callers break.

### Solutions applied
- FS-07: all colors use constructa-* tokens or standard Tailwind palette classes.
- FS-03: `import type` used for all type-only imports.
- UX-03: empty states preserved for both tareas sin fechas and actividad reciente.
- `CircularProgress` is a pure display component — pure SVG, no state, no side effects.
- Removed `<Card>` wrapper in favor of direct `<div>` for the new sections to get `rounded-xl` instead of the shared `rounded` from Card. Card.tsx not modified.

### Validation
- `npm run build` — passed with 0 errors, 1826 modules transformed, 1.59s

### Manual test checklist
1. Resumen tab opens → 3 KPI cards visible (Avance, Tareas activas, Tareas completadas).
2. Avance card shows circular donut progress in matching color (warning/primary/success).
3. With unread alerts → Alertas card has orange tinted background + large alert count + "Ver alertas →" CTA.
4. No unread alerts → green icon, "Sin alertas pendientes", value = 0.
5. With critical tasks → red tinted card with task list + "Ver tareas →".
6. "Ver alertas →" navigates to Alertas tab.
7. "Ver tareas →" navigates to Tareas tab.
8. "Ver todo →" in Actividad reciente navigates to Historial tab.
9. Gantt "Hoy" shows as a red badge with date "Hoy DD/MM". Today line is clearly visible.
10. Section titles have small icon hints (Calendar, AlertTriangle, Activity).
11. Tareas sin fechas section shows "(N)" count in title and warning icon when N > 0.

### Pending / next steps
- None — visual redesign complete.

---

## 2026-04-28 — ResumenTab layout refinement: compact alert cards + two-column lower section

### Objective
The "Alertas activas" and "Tareas críticas" cards were too tall due to vertical content stacking (large icon, large number, subtitle, task list, CTA all stacked). Refactored both as compact horizontal summary cards. Also moved "Tareas sin fechas" and "Actividad reciente" into a responsive two-column grid.

### Changes made
- **Alertas + Tareas críticas cards**: Replaced `flex items-start gap-4 p-5` vertical layout with `flex items-center gap-4 px-4 py-3` horizontal layout. Structure: icon block (w-10 h-10, smaller than KPI cards) → title+subtitle → large number → CTA. Removed the inline task list from the critical card — count + CTA is sufficient at this level. Added a `w-[72px]` spacer span when no CTA is shown on the critical card to maintain alignment with the alerts card.
- **Lower two-column grid**: Wrapped "Tareas sin fechas" and "Actividad reciente" in `<div className="grid grid-cols-1 lg:grid-cols-2 gap-4">`. Both sections are `flex flex-col`; inner cards use `flex-1` to fill their column height.
- **Root spacing**: `space-y-6` → `space-y-5` for slightly tighter vertical rhythm.
- **Removed unused `topAlert` usage**: `topAlert` is still computed (used as a guard for alert preview) but the message preview line was removed from the compact card design. Added `void topAlert` to suppress any unused variable warning.

### Files modified
- `frontend/src/components/ResumenTab.tsx` — compact alert/critical cards + two-column lower layout

### Problems found
No TypeScript errors. The `topAlert` variable was still needed as a guard expression so it was preserved in the derivation block; the `void topAlert` suppresses lint warnings.

### Solutions applied
- FS-07: all constructa-* tokens preserved.
- `flex-1` on inner card divs ensures both columns fill to equal height when in the `lg:grid-cols-2` context.
- Spacer span `w-[72px]` on critical card's "no CTA" state matches approximate width of "Ver tareas →" button to prevent the number column from shifting position between states.

### Validation
- `npm run build` — passed with 0 errors, 1826 modules transformed, 1.59s

### Manual test checklist
1. Alert card is a compact single horizontal row (~90–100px tall).
2. Critical tasks card same height as alerts card.
3. Alert CTA "Ver alertas →" navigates to Alertas tab.
4. Critical tasks CTA "Ver tareas →" navigates to Tareas tab. Hidden when count = 0.
5. Desktop (lg+): "Tareas sin fechas" and "Actividad reciente" side by side.
6. Mobile/tablet (<lg): both stack vertically.
7. Drag from "Tareas sin fechas" into Gantt still works.
8. "Agregar fechas" button still opens task edit modal.
9. "Ver todo" link in Actividad reciente navigates to Historial tab.

### Pending / next steps
- None — layout refinement complete.
