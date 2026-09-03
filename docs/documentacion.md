# CONSTRUCTA — Bitácora de Desarrollo

## 1. Descripción breve del proyecto

CONSTRUCTA es un sistema de gestión de obras de construcción orientado a trazabilidad operativa. Resuelve un problema concreto: los jefes de obra no tienen una herramienta liviana para hacer seguimiento de tareas, recibir alertas cuando algo se bloquea, y tener un historial claro de qué pasó y cuándo. La propuesta es un dashboard web conectado a un chatbot de WhatsApp, donde los responsables pueden actualizar el estado de las tareas directamente desde el celular sin entrar a ninguna app. El backend interpreta los mensajes, aplica las transiciones de estado, y genera alertas e historial automáticamente.

---

## 2. Estado actual

**Actualizado:** 2026-08-26

> Nota: entre el 2026-04-25 y el 2026-07-24 esta tabla no se mantuvo al día durante el sprint de features (Gantt, presupuestos, compras, planes/monetización, bitácora IA); ver `CLAUDE.md` para el detalle módulo por módulo de esa etapa. Desde acá se retoma la actualización regular.

| Componente | Estado |
|---|---|
| Backend — autenticación JWT + refresh token con rotación | Completo |
| Backend — multi-tenant: identidad separada de membership (`TenantMembership`) | Completo — login/invite/switch-tenant reales, dedup de invitaciones a un email ya existente |
| Backend — obras (CRUD) + comitentes | Completo |
| Backend — tareas (estados, avance, dependencias FS/SS/FF/SF, WBS, ruta crítica CPM, baseline) | Completo |
| Backend — roles por obra y permisos granulares | Completo (2026-08-24) |
| Backend — responsables / equipo global + reenvío de invitación | Completo |
| Backend — alertas (generación automática, filtro server-side, lectura) | Completo |
| Backend — historial (registro automático + endpoint por obra) | Completo |
| Backend — planos (versionado explícito, guards de acceso) | Completo |
| Backend — presupuestos y módulo Compras (solicitudes de cotización, IA comparativa) | Completo |
| Backend — bitácora de obra con IA (audio por WhatsApp → transcripción → análisis, procesado en background) | Completo |
| Backend — webhooks WhatsApp (chatbot por reglas + desambiguación de tenant) | Completo |
| Backend — planes/tenants/límites (402 al tope de plan) | Completo |
| Backend — aislamiento cross-tenant (IDOR) | Cluster P0 cerrado (2026-07-18) + remediaciones P1 posteriores (ver sección 3); auditoría de seguimiento en curso |
| Frontend — Login + selección de empresa (multi-tenant) | Completo |
| Frontend — Portfolio (panel con todas las obras) | Completo |
| Frontend — Obra Detail con tabs (Resumen, Tareas, Responsables, Alertas, Historial, Presupuesto) | Completo |
| Frontend — Gantt (drag, resize, dependencias, ruta crítica, baseline, WBS) | Completo |
| Frontend — Responsables / Equipo (tabla, edición, desactivación) | Completo |
| Frontend — Switcher de empresa en el Sidebar | Completo (2026-08-26) |
| Frontend — Design system CONSTRUCTA | Completo |
| Frontend — Configuración (settings por tenant, proveedores) | Completo |

**Deuda técnica conocida y diferida a propósito:** limpieza de columnas vestigiales en `users` (`role`, `is_active`, `whatsapp_number`, etc. — Fase 5 del rediseño multi-tenant); ver memoria de sesión `project_multitenant_email` para el criterio de cuándo retomarla.

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

---

## 2026-06-11 — Etapa 2.1 (cierre): cascade automático al reprogramar tareas con dependientes

### Objective
Completar la Etapa 2.1 del roadmap (`feature/gantt-improvements`). La rama ya tenía sticky date header, subtareas colapsables y tooltips en flechas de dependencia. Faltaba el último ítem: cascade automático al cambiar fechas de una tarea con dependientes.

### Changes made
**Backend:**
- `schemas/task.py`: nuevos schemas `CascadePreviewRequest`, `CascadeAffectedTask`, `CascadePreviewResponse`.
- `services/task_service.py`: nueva función `_compute_cascade()` — recorre el grafo de dependencias en orden topológico (Kahn) y calcula el corrimiento de cada sucesora respetando tipo (FS/SS/FF/SF) + lag_days. Política **push-only** (como "Respect Links" de MS Project con tareas manuales): una sucesora solo se mueve hacia adelante si el cambio viola su dependencia; nunca se adelanta, preservando la holgura que el usuario dejó a propósito. Tareas completadas/canceladas no se mueven. Fechas resultantes se ajustan al próximo día laboral según el calendario de la obra (`next_working_day`). Semántica FS: la sucesora arranca el día siguiente al fin de la predecesora (consistente con el check de violación del Gantt).
- `services/task_service.py`: `update()` acepta `cascade_dates: bool` — al confirmar, aplica el corrimiento a todas las afectadas, emite `task_updated` por Socket.IO para cada una y registra **UN SOLO** evento de historial `task_cascade_rescheduled` con el detalle completo en el payload.
- `routes/tasks.py`: nuevo endpoint `POST /tasks/{id}/cascade-preview` (no modifica nada, devuelve las afectadas con fechas viejas y nuevas) + query param `cascade_dates` en `PATCH /tasks/{id}`.

**Frontend:**
- `api/tasks.ts`: `fetchCascadePreview()` + tipo `CascadeAffectedTask`. El payload `cascade_dates` ya existía en `updateTask` (quedó cableado de antes), ahora el backend lo entiende.
- `ReschedulingModal.tsx` (drag/resize en Gantt): al abrir consulta el preview; si hay dependientes afectadas muestra panel ámbar con la lista (tarea, fecha vieja → nueva) y los botones pasan a ser "No, solo esta tarea" / "Sí, reprogramar N dependientes".
- `TaskFormModal.tsx` (edición de fechas en formulario): al guardar con fechas cambiadas consulta el preview; si hay afectadas muestra overlay de confirmación con la misma lista y opciones [Volver] [No, solo esta tarea] [Sí, reprogramar N].
- `HistorialPanel.tsx`: render del evento `task_cascade_rescheduled` ("X reprogramó N tareas en cascada por el cambio de fechas en [Tarea]" + nombres de las primeras 3).

### Validation
- Test funcional del algoritmo con repos falsos: cadena FS transitiva con lag, SS, holgura preservada en push +1, pull -2 no mueve nada, completadas intactas, snap a día hábil con calendario Lun-Vie. Todos pasaron.
- `tsc --noEmit` — 0 errores. ESLint — 0 errores (1 warning preexistente).
- Import de `app.main` OK, ruta `POST /tasks/{task_id}/cascade-preview` registrada.

### Pending / next steps
- Merge de `feature/gantt-improvements` → Etapa 2.1 completa.
- Siguiente según plan: Etapa 1.5 (task-visualization-polish) o 2.2 (import MS Project XML — la rama remota `feature/ms-project-integration` quedó obsoleta, hay que rehacerla sobre main).
- Stash `plans-monetization pendiente` (stash@{0}) sigue guardado para la Fase 3. El stash@{1} "gantt WIP" quedó obsoleto (su contenido ya está commiteado) y se puede descartar.

---

## 2026-06-11 — Etapa 1.5: pulido visual de tareas + reparación del build

### Changes made
**TaskTable:** zebra striping, hover de fila con fondo suave, botones editar/eliminar visibles solo al hover, badge ámbar "Vence hoy / Por vencer" (≤3 días), conector visual └ en subtareas indentadas.
**TaskSheetView:** paleta de estados unificada con TaskTable/Gantt (pendiente azul, en progreso ámbar, etc.) + íconos lucide en pills; header sticky al scroll; resize manual de columnas (drag en borde del header, persistido en localStorage por obra); subtareas indentadas con conector; fila de totales (Σ tareas, días planificados, avance promedio); **fix funcional**: el estado editado en la planilla ahora se guarda vía POST /tasks/{id}/status (antes se mandaba en el PATCH y el backend lo ignoraba silenciosamente).
**TabSkeleton (nuevo):** skeleton loader con shimmer que reemplaza al Spinner en ObraDetailPage.
**Reparación del build (preexistente):** main no compilaba con TypeScript 6 (`tsc -b`). Fixes: baseUrl deprecado removido de tsconfig; `onTaskClick` indefinido en milestone del Gantt (bug real → onEditTask); AlertasTab sin estilo para reschedule_requested; payloads de socket sin los campos nuevos de Task; ObraCreatePayload sin campos de comitente; obraCounts sin responsibles; imports/variables muertas en 6 archivos.

### Validation
- `npm run build` — ✓ built (0 errores TS).
- ESLint — 0 errores nuevos en archivos tocados.

---

## 2026-06-11 — Etapa 2.2: import MS Project XML + plantilla Excel

### Changes made
**Backend:**
- `import_service.py`: `parse_msproject_xml()` con `xml.etree.ElementTree` — namespace-agnóstico, salta la fila-resumen del proyecto (UID 0), reconstruye WBS por ParentTaskUID o stack de OutlineLevel, mapea PredecessorLink (Type 0=FF/1=FS/2=SF/3=SS, LinkLag en décimas de minuto ÷4800 o Lag en minutos ÷480 → días), hitos (Milestone=1), y recursos vía Resources+Assignments. `parse_excel()` detecta XML por contenido o MIME y rutea automáticamente.
- `schemas/imports.py`: `ImportPreviewRow` extendido con `dependency_links` (tipadas con lag), `parent_row`, `is_milestone`; `ImportPreview.source` ("msproject"/"excel").
- `imports.py` (confirm): crea tareas con `parent_task_id`, `is_milestone` y `dependency_links` — **fix de bug preexistente**: el confirm mandaba `dependency_ids` (campo inexistente en TaskCreate) y las dependencias del Excel se descartaban en silencio.
- `exports.py`: `GET /exports/template-excel` — .xlsx con hoja "Tareas" (columnas esperadas + 3 filas de ejemplo en gris) y hoja "Instrucciones".

**Frontend:**
- `ImportModal.tsx`: acepta `.xml`, badge azul "MS Project — se importan subtareas, hitos y dependencias con lag" en el preview, botón "Descargar plantilla" en el paso 1.
- `api/imports.ts` tipos extendidos; `api/exports.ts` `downloadTemplateExcel()`.

### Validation
- Test del parser con XML realista (namespace, WBS 2 niveles, FS+lag 2d vía LinkLag, SS+lag 1d vía Lag, hito, recurso asignado, sin namespace) — todos pasaron.
- `npm run build` ✓ · import de app.main ✓.

---

## 2026-06-11 — Etapa 2.3: guía de completitud + onboarding

### Changes made
- **ObraCompletenessChecklist (nuevo):** banner colapsable en ObraDetailPage (entre header y tabs) con anillo de progreso. Evalúa 5 criterios: imagen, comitente, responsables, tareas, fechas (≥80% de tareas con fecha). Se oculta si el puntaje ≥80%. Cada ítem pendiente es clickeable y navega al tab correspondiente. Colapso persistido en localStorage por obra.
- **OnboardingModal (nuevo):** tour de bienvenida de 3 pasos (Creá tu obra → Sumá responsables → Cargá tareas con fechas) tras el primer login. Botones Siguiente/Saltar, dots de progreso. `localStorage("onboarding_done")`.
- App.tsx: muestra el onboarding post-auth si no está marcado como hecho.

### Validation
- `npm run build` ✓

---

## 2026-06-11 — Fase 3: planes, tenants y monetización

### Changes made
Se retomó el stash "plans-monetization pendiente" (WIP previo) y se completó:

**Del stash (integrado y resuelto contra main actual):**
- Migración 0022: tablas `plans` (seed: Básico 3/6/50 · Pro 20/30/∞ · Enterprise ∞) y `tenants` + `tenant_id` en users/obras + tenant "Empresa por defecto" (plan Pro) asignado a los datos existentes.
- Migración 0023: tablas `suppliers` y `task_materials` (adelanto de Fase 4) + modelos + rutas CRUD + schemas.
- `plan_limits.py`: `check_plan_limit()` → HTTP 402 con payload `{code, resource, current, limit, plan, message}`. Aplicado en POST /obras, POST /tasks y POST /users/invite.
- `GET /admin/usage`: métricas del tenant (obras/usuarios/tareas vs límites).
- Frontend: `AdminPage` (ruta "admin", solo admin, ítem "Panel Admin" en sidebar), sección "Tu plan" en ConfiguracionPage, APIs admin/suppliers/taskMaterials.

**Completado en esta sesión (faltaba en el stash):**
- Obras nuevas se crean con el `tenant_id` del usuario (antes quedaban huérfanas y escapaban del conteo).
- Usuarios invitados heredan el tenant del admin que invita.
- Registro nuevo → crea tenant propio "Empresa de X" con plan Básico automáticamente.
- `UpgradeModal` (nuevo): al recibir 402 en wizard de obra o creación de tarea, modal con plan actual, barra de uso al límite y CTA de upgrade por email. Helper `getPlanLimitError()`.

### Validation
- Migraciones ya aplicadas en BD local (alembic head = 0023); seed verificado por query directa.
- Import backend ✓ (ruta /admin/usage registrada) · `npm run build` ✓ · ESLint 0 errores.

---

## 2026-06-11 — Fase 4: materiales, presupuesto, compras y proveedores

### Changes made
**Del stash de Fase 3 ya venía:** tablas suppliers/task_materials (migración 0023), modelos, CRUD `/suppliers` y `/tasks/{id}/materials`, sección Proveedores en ConfiguracionPage, APIs frontend.

**Backend nuevo:**
- Migración 0024: `purchase_orders` + `purchase_order_items` (snapshot de nombre/cantidad/precio) + valor `order_received` en el enum alert_type.
- Modelos `PurchaseOrder`/`PurchaseOrderItem`, schemas, y router `purchase_orders.py`:
  - `GET /obras/{id}/presupuesto` — materiales por tarea + totales (estimado / comprometido / gasto real).
  - `POST /obras/{id}/purchase-orders` — crea pedido desde materiales pendientes (pasan a "pedido") + historial.
  - `POST /purchase-orders/{id}/send` — envía al proveedor por WhatsApp (Twilio) o email (Brevo, nueva función genérica `send_email`); si el canal no está configurado igual marca enviado y lo deja asentado en historial.
  - `POST /purchase-orders/{id}/receive` — pedido y materiales a "recibido" + alerta `order_received` + historial.
- `GET /exports/obras/{id}/presupuesto-excel` — Excel con desglose por tarea, estados coloreados y totales estimado vs real.

**Frontend nuevo:**
- Tab **Presupuesto** en la obra (ítem en sidebar con ícono billetes): 3 KPIs (estimado/comprometido/real), tabla agrupada por tarea con subtotales, botón Exportar Excel, modal "Generar pedido" (proveedor + selección de pendientes + notas), listado de pedidos con acciones WhatsApp/Email/Recibido según estado.
- `TaskMaterialsSection` en TaskFormModal (modo edición): tabla inline de materiales con alta rápida, proveedor, cambio de estado y eliminación.
- `api/purchaseOrders.ts`; tipo de alerta `order_received` en AlertBell/AlertasTab/AlertsPanel.

**CLAUDE.md actualizado:** estado del roadmap (todo implementado, tags) y corrección del venv (.venv es el válido).

### Validation
- Migración 0024 aplicada en BD local · import backend ✓ (5 rutas nuevas) · `npm run build` ✓ · ESLint sin errores nuevos bloqueantes.

---

## 2026-06-12 — Módulo Bitácora de obra (audios de WhatsApp + IA) y auditoría UX

### Bitácora de obra — qué hace
El jefe de obra graba un audio (desde WhatsApp en la obra, o desde la app con el micrófono) → la IA lo transcribe, lo resume, marca los puntos clave y **propone acciones sobre el plan**: mover fechas de tareas, crear tareas nuevas, cambiar estados. El usuario revisa cada sugerencia y la aplica con un click (la reprogramación usa el cascade de dependientes).

### Backend
- Migración 0026→0025: tabla `bitacora_entries` (obra, responsable, fuente whatsapp/web, audio, transcripción, resumen, key_points JSON, suggestions JSON, estado del pipeline).
- `bitacora_service.py`: transcripción vía **Whisper** (OpenAI API, opcional — `OPENAI_API_KEY`), análisis vía **Claude** (`claude-opus-4-8` con structured outputs → JSON garantizado contra schema; `ANTHROPIC_API_KEY` + `CLAUDE_MODEL` en .env). El prompt incluye el contexto real de la obra (tareas con ids/fechas/estados) y la fecha de hoy para resolver "la semana que viene". Degradación con gracia: sin keys, las entradas quedan pendientes con instrucciones claras y se puede cargar el texto a mano.
- `apply_suggestion`: reschedule_task → `TaskService.update` con `cascade_dates=True`; create_task → `TaskService.create` (matchea responsable por nombre); update_status → endpoint de estado; note → evento de historial. Todo queda en historial.
- Rutas: POST audio/texto por obra, GET lista, transcript manual, reprocess, asignar obra, apply/dismiss por sugerencia, delete.
- WhatsApp: en `message_service`, los audios entrantes van a la bitácora (no al chatbot): descarga el media de Twilio, infiere la obra (la de más tareas activas del responsable, o su única obra del equipo), procesa y responde con el resumen por WhatsApp.
- SDK `anthropic` instalado en `.venv`. Config nueva: `OPENAI_API_KEY`; `CLAUDE_MODEL` ahora default `claude-opus-4-8`.

### Frontend
- `BitacoraPage` real (reemplaza el "próximamente"): grabación con micrófono (MediaRecorder), subida de archivo de audio, entrada de texto; selector de obra; tarjetas por entrada con player de audio, resumen, puntos clave, transcripción colapsable y **tarjetas de sugerencia** con la cita que las justifica y botones Aplicar/Descartar; asignación de obra para audios de WhatsApp ambiguos; reintento de análisis.
- `api/bitacora.ts` con timeouts extendidos (transcripción+análisis tardan).

### Validación
- Migración 0025 aplicada · import backend OK (9 rutas) · `npm run build` ✓.
- E2E contra servidor de prueba: texto sin API key → degrada con mensaje claro; sugerencias simuladas → aplicar movió fechas de tarea real y creó tarea nueva; datos de prueba revertidos.

### Para activar la IA (pendiente del usuario)
En `backend/.env`: `ANTHROPIC_API_KEY=sk-ant-...` (análisis) y `OPENAI_API_KEY=sk-...` (transcripción de audio). Sin la segunda, los audios quedan guardados y el texto se puede cargar a mano.

### Auditoría UX/UI (agente paralelo)
Informe completo en `docs/auditoria-ux.md`: la vista Planilla ya es la grilla tipo Excel que pide el cliente pero está escondida (propuesta "Excel-first" con 13 cambios S/M/L), cero soporte mobile (P0), pérdida de datos al cerrar el wizard, inconsistencia de "duración" entre modal y planilla, datos fake en Portfolio/login, ~25 hallazgos P0-P2, 12 quick wins y roadmap de 5 sprints.

---

## 2026-06-12 — Sprint 1 UX "Excel-first" + 12 quick wins (de la auditoría)

### La planilla pasa a ser EL producto
- **Vista por defecto: Planilla** en el tab Tareas (preferencia persistida en localStorage por usuario).
- **Toggle con texto** "Planilla / Tabla" (segmented control con aria-pressed) en vez de iconitos de 14px.
- **Empty state que vende el paste**: "Cargá el plan de obra como en Excel" con dos CTAs — "Agregar primera fila" y "Pegar desde Excel" (lee el portapapeles vía `navigator.clipboard.readText()`, sin depender del foco).
- **Paste robusto**: ahora dispara aunque el foco esté en una celda, si el texto es tabular (tabs o ≥2 líneas); pegar una palabra en una celda sigue normal.
- **El paste aprovecha todo lo parseado**: matchea el responsable contra el equipo de la obra (exacto → parcial), lo muestra en el preview ("Juan Pérez" o "X (no está en el equipo)"), y crea las dependencias FS por número de fila en una segunda pasada. Contador de progreso "Importando… X/N", manejo de fallas parciales y de límite de plan (402 → UpgradeModal).
- **Borrar tarea desde la planilla**: basurita al hover de cada fila (usa la prop onTaskDeleted que estaba muerta).
- **402 → UpgradeModal** también al guardar fila individual.
- Hint permanente en el footer: "Tip: copiá filas en Excel y pegalas acá (Ctrl+V)".

### Quick wins
- **Duración unificada (inclusiva)** en TaskFormModal: lun→vie ahora es 5 días en todos lados (antes el modal decía 4 y la planilla 5).
- **Esc cierra TaskFormModal** (primero sub-diálogos, después el modal).
- **Wizard no pierde datos**: cerrar con backdrop o X con datos cargados pide confirmación detallando qué se descarta.
- **Portfolio sin datos fake**: "avance medio 50%" → calculado real desde completed_tasks/total_tasks; fuera "actualizado hace un momento" y la flechita de tendencia inventada.
- **CTA en empty state de TaskTable**: botones "Nueva tarea" e "Importar desde Excel/Project".
- **AlertBell con íconos lucide** (fuera emojis 🔴⏰⚠️).
- **Presupuesto**: `alert()` nativo → banner de error inline descartable; botón "Generar pedido" deshabilitado ahora gris estándar.

### Validación
`npm run build` ✓ · ESLint sin errores nuevos (solo patrones preexistentes del repo).

---

## 2026-06-12 — Sprint 2 UX: bulk, teclado Excel, paste en wizard, remapeo de columnas

### Changes made
- **Endpoint bulk** `POST /tasks/obra/{id}/bulk`: crea hasta 500 tareas en una transacción con UN evento de historial ("Se importaron N tareas desde Excel"); dependencias FS por índice de fila en segunda pasada; filas inválidas se reportan sin tumbar el lote; respeta límite de plan (402). La planilla ahora importa el paste con un solo request.
- **Teclado nivel Excel en la planilla**: Enter guarda y sigue editando la fila de abajo en la misma columna; Shift+Tab retrocede; ↑/↓ cambian de fila (en el título, para no pisar inputs de número/fecha); hint de la save bar actualizado.
- **Paste masivo en el wizard (paso 3)**: zona "¿Ya tenés el listado en Excel?" con botón "Pegar desde Excel" y Ctrl+V directo — llena la lista de tareas draft usando el mismo parser.
- **Remapeo manual de columnas en ImportModal**: chips ahora muestran "Campo ← Columna" (y "no detectada"); panel "Remapear columnas" con selects por campo que reprocesa el archivo con el mapeo elegido (`column_map` en el endpoint de preview; el preview devuelve los headers crudos).
- **🐛 Fix crítico preexistente**: FastAPI serializa con el validador core de Pydantic, que ignoraba el `model_validate` custom de TaskRead — `dependency_ids`/`dependency_links` llegaban **siempre vacíos por HTTP** (las flechas del Gantt y las dependencias del modal de edición no recibían datos). Las rutas ahora convierten explícitamente con `TaskRead.model_validate` antes de responder.

### Validation
- Bulk por API: 2 tareas + dependencia fila→fila verificada con links completos en el GET.
- `npm run build` ✓ · import backend ✓ · datos de prueba eliminados.

---

## 2026-06-12 — Sprint 3 UX: mobile mínimo viable

### Changes made
- **`useMediaQuery` hook (nuevo)**: `useIsMobile()` (<768px) y `useIsCompact()` (<1024px) — base para responsive con inline styles.
- **Sidebar como drawer**: en pantallas <1024px arranca cerrada, se abre con la hamburguesa como overlay con backdrop, y se cierra sola al navegar. El contenido ya no queda empujado por los 260px fijos.
- **Portfolio fluido**: KPIs `repeat(auto-fit, minmax(180px,1fr))` y cards de obras `repeat(auto-fill, minmax(280px,1fr))` — colapsan a 1 columna en el teléfono sin media queries.
- **TaskTable → cards en <768px**: cada tarea es una tarjeta con título, estado, fecha, badges de urgencia, responsable y botones de acción siempre visibles (sin hover, que no existe en touch).
- **Planilla con scroll horizontal honesto**: contenedor con `overflowX: auto` y ancho mínimo de 760px — en el teléfono se desplaza lateralmente en vez de romperse.
- **Touch en drag**: el Gantt (mover/estirar barras) y el resize de columnas de la planilla pasaron de mouse events a **Pointer Events** con `touchAction: none` — funcionan con el dedo en tablet/teléfono.

### Validation
`npm run build` ✓

---

## 2026-06-12 — Sprint 4 UX: confianza y modal adelgazado

### Changes made
- **Login honesto**: fuera las stats de marketing inventadas ("85%", "3x") → bullets de features reales del producto; debajo del submit, ayuda de acceso honesta ("pedile al administrador que restablezca tu acceso") en vez de un reset inexistente.
- **TaskFormModal adelgazado**: el modal arranca con 4-5 campos (título, responsable, fechas, duración) y un botón punteado "Opciones avanzadas" que despliega descripción, tarea padre (WBS), dependencias, hito y % avance. Al editar una tarea que ya usa esos campos, el acordeón arranca abierto.
- **Onboarding accionable**: el CTA final pasó de "¡Empezar!" (cerraba y nada) a "Crear mi primera obra" que abre el wizard directamente.

### Validation
`npm run build` ✓

---

## 2026-06-12 — Fix drag del Gantt + Sprint 5 UX (accesibilidad)

### Fix (reportado por el usuario)
La migración a pointer events del Sprint 3 rompió el arrastre de barras y el ajuste de fechas en el Gantt. **Revertido**: GanttTimeline restaurado a la versión funcional (mouse events) y el resize de columnas de la planilla al patrón original. Lección: el soporte touch del Gantt se hará aparte, de forma aditiva y probado en navegador.

### Sprint 5
- **Contraste de texto secundario en toda la app** (24 archivos): `#8E97A0`→`#6B7580`, `#94928D`→`#6B7580`, `#ADAAA4`→`#7D7973` (solo en `color:`, sin tocar bordes/fondos) — labels, hints y metadatos pasan de ~2.5–3.5:1 a ~4.6:1 (WCAG AA).
- **Esc cierra** ImportModal y ReschedulingModal (TaskFormModal ya lo tenía del Sprint 4).
- **Sticky header real en la planilla**: el contenedor ahora es su propio scrollport (`maxHeight: calc(100vh - 210px)` + `overflow: auto`) — el header de columnas queda fijo al scrollear, y el scroll horizontal de mobile se mantiene.

### Pendiente menor (P2, no bloqueante)
Nav de secciones en ConfiguracionPage (archivo de 1.500 líneas — mejor hacerlo en una pasada dedicada).

### Validation
`npm run build` ✓

---

## 2026-06-12 — Bitácora con IA activada + últimos P2 de la auditoría UX

### Bitácora (modelos económicos + primer uso real)
- Transcripción: `gpt-4o-mini-transcribe` (configurable vía `WHISPER_MODEL`, antes hardcodeado `whisper-1`). Análisis: `claude-haiku-4-5` (antes Sonnet). Costo ~USD 0.01 por audio de 2 min.
- Fix: el schema de structured outputs usaba `{type: [string,null], enum: [...]}` que la API de Anthropic rechaza con 400 — reemplazado por `anyOf`. Verificado end-to-end con la API key real: resumen + key points + sugerencias OK.
- Falta solo crédito en la cuenta OpenAI del usuario para activar transcripción (la key ya está en `.env`).

### Fix drag del Gantt (causa real)
El revert a mouse events no alcanzaba: el overlay SVG de flechas de dependencias (Etapa 2.1) cubría la grilla sin `pointerEvents: "none"` y tapaba las barras. Fix de 3 líneas + verificación en navegador (drag→modal, click→editor, tooltips OK).

### P2 de la auditoría (rama feature/ux-p2-polish)
- **ConfiguracionPage**: índice de secciones sticky (chips con anclas a las 9 secciones, una fila scrolleable, pegado bajo el header en top:56, `scrollMarginTop:112` en cada sección).
- **AppLayout**: removido `overflow-y-auto` inerte del `<main>` que rompía cualquier `position: sticky` de las páginas hijas (el scroll real es del documento).
- **Alertas**: `PATCH /alerts/mark-all-read?obra_id=` — "Marcar todas leídas" pasa de N requests a 1 (verificado: 53 alertas en una request, scope por obra respetado).
- **PresupuestoTab**: botones disabled con gris estándar (`#E6E7E5` + `#8E97A0`) en vez de naranja lavado.
- **Último tab por obra**: al re-entrar a una obra se restaura el último tab visitado (`localStorage obra_last_tab_{id}`); `focusAlert` sigue forzando "tareas".

### Validation
`tsc -b` ✓ · endpoint probado con curl ✓ · sticky/anclas/último-tab verificados en navegador (vite :5174) ✓

---

## 2026-06-12 — Alta de empresa self-service + fixes del flujo de creación

Salida de la auditoría del flujo de alta (`docs/auditoria-flujo-alta.md`). Rama `feature/alta-empresa-wizard-fixes`.

- **Registro self-service**: LoginPage modo "Crear cuenta" → `POST /auth/register` con `company_name`, rol `admin` siempre, tenant propio en plan Básico, login automático.
- **Aislamiento multi-tenant**: obras (list filtra, get 404 cross-tenant), responsables (migration 0026 `tenant_id` + backfill), alertas (join por obra), usuarios. Verificado e2e con usuario nuevo.
- `/users/me` devuelve `tenant_name`; sidebar muestra la empresa real (antes hardcodeada).
- Wizard vincula responsables al equipo de la obra; `ObraSummary` incluye comitente (checklist correcto).
- `utils/phone.ts`: normalización de celulares argentinos en wizard + tabs + modal.
- X tras crear obra navega a la obra. Bitácora como item real del sidebar.
- `VITE_API_URL` configurable (preparación deploy).

### Validation
tsc ✓ · migración 0026 ✓ · flujo registro→onboarding→wizard→obra verificado en navegador ✓ · datos de prueba limpiados ✓

---

## 2026-06-13 — Planilla con gestos de hoja de cálculo (Excel-grade)

La `TaskSheetView` pasó de "una fila en edición a la vez" a una **grilla de celdas estilo Excel**, manteniendo todo lo existente. Rama `feature/planilla-excel-grid`, mergeada a main (`af09e28`).

### Gestos nuevos
- **Selección** de celda y de rango: click, click+arrastrar (tracking por `elementFromPoint`, robusto al drag rápido), shift+click, shift+flechas. `data-gc` por celda.
- **Tipear para editar**: seleccionás y escribís directo; doble-click/Enter edita en sitio; click en otra celda confirma y se mueve (como Excel).
- **Fill handle**: arrastrar la esquinita rellena hacia abajo. Las **fechas se encadenan** (cada tarea arranca cuando termina la anterior, conservando duración); el resto de columnas copia el valor.
- **Ctrl+C / Ctrl+V / Ctrl+Z**: copia el rango (TSV), pega en celdas, deshace. Escriben al backend vía `updateTask`/`updateTaskStatus` (sin endpoints nuevos).
- **Backspace/Delete** limpia celdas (no toca título ni estado).

### Diseño / decisiones
- El **pegar-desde-Excel que crea filas nuevas queda intacto**: se distingue por la copia interna (`clipRef`). Copia interna → pega en celdas; pegar externo → preview de import.
- Enter al editar avanza a la fila de abajo y sigue editando (más rápido para cargar una columna).

### Bug de foco (reportado por el usuario, 2 rondas)
El combobox de Responsable se auto-enfocaba al montar siempre que la fila entraba en edición → al editar el Título el cursor saltaba a Responsable. Causa real: `autoFocus` dependía de `openDropdownFor`, que quedaba pegado al task. **Fix definitivo**: se eliminó `openDropdownFor` y `autoFocus` pasa a ser `editing.activeField === "responsible"` (la condición correcta).

### Validation
`tsc` ✓ · `npm run build` ✓ · verificado en navegador contra el backend real: encadenado de fechas persiste, copiar/pegar/deshacer OK, type-to-edit enfoca el campo correcto, edición Responsable intacta, import-desde-Excel sigue abriendo su preview.

---

## 2026-06-13 — Módulo de Gestión de Presupuestos (lectura IA + comparación)

El módulo "Gestión de Presupuestos" dejó de ser un placeholder "Próximamente" y pasó a estar **funcional**. Rama `feature/modulo-presupuestos`.

### Backend
- Modelo `Budget` (tabla `budgets`, migration 0027): presupuesto de proveedor con datos estructurados (JSON), inconsistencias (JSON), total, rubro, proveedor, aislado por tenant.
- `budget_service.py`: lee el documento con Claude (`CLAUDE_MODEL`) → structured output (proveedor, fecha, rubro, ítems con cantidad/unidad/precio/subtotal, subtotal, IVA, total, flete, plazo, condiciones de pago, validez, inconsistencias). Soporta **PDF e imágenes nativos** (document/image blocks de Anthropic), **Excel** (openpyxl) y **texto pegado**.
- Comparación: computa promedio, marca el más barato, calcula % vs promedio, flags (sin flete, IVA sin aclarar, sin validez, X% por encima del promedio) + recomendación generada por IA que pondera precio vs condiciones.
- Router `budgets.py`: `POST /budgets/upload`, `/budgets/text`, `GET /budgets`, `GET /budgets/{id}`, `DELETE`, `POST /budgets/compare`. Todo tenant-scoped.

### Frontend
- `PresupuestosPage.tsx` reescrita: zona de carga (drag&drop archivo + pegar texto + obra/proveedor opcional), lista de presupuestos (proveedor, rubro, total, nº de alertas), modal de detalle (tabla de ítems, totales, condiciones, inconsistencias por severidad), selección múltiple → modal de comparación con recomendación IA.
- `api/budgets.ts`, tipos en `types/index.ts`.

### Sidebar (fix pedido por el usuario)
- "Presupuestos" salió de la sección "Próximamente" (con badge PRONTO) y pasó a Workspace, al lado de Panel, sin badge. Se eliminó la sección Próximamente entera (resuelve el título duplicado: antes convivían el tab de obra "Presupuesto" y el global "Presupuestos" bajo Próximamente).
- Breadcrumbs "Próximamente" de Bitácora y Presupuestos corregidos (ambos ya son módulos reales).

### Validation
`tsc` ✓ · `npm run build` ✓ · migración 0027 aplicada ✓ · verificado e2e contra Claude real: extracción de un presupuesto (proveedor, ítems, IVA, "no incluye flete", inconsistencias) ✓, comparación de 3 con recomendación que pondera precio + condiciones ✓, detalle y modales OK. Datos de prueba eliminados.

### Pendiente (no bloqueante)
Generación de documentos (presupuesto formal para cliente, solicitud de cotización, orden de compra, informe de adjudicación) — la card del placeholder los listaba como objetivo; quedan como próxima etapa.

---

## 2026-06-13 — Módulo de Planos (versionado + consulta por chatbot de WhatsApp)

Nuevo módulo para cargar planos de obra de cualquier tipo, con versionado, y que los responsables los pidan por WhatsApp. Rama `feature/modulo-presupuestos` (continuación).

### Backend
- Modelo `Plano` (tabla `planos`, migration 0028): obra_id, disciplina, nombre, versión, is_latest, archivo (en /uploads), tenant-scoped.
- `plano_service.py`: carga con **versionado** (agrupa por obra+disciplina+nombre; cada carga incrementa la versión y deja la anterior no-vigente), borrado con promoción de la versión previa, y soporte para el chatbot: `match_discipline_in_text` (detecta "electricidad/eléctrico/luz", "sanitarios/plomería/agua", "gas", "estructura", "arquitectura", etc.), `find_latest_for_disciplines`, `obra_ids_for_responsible` (vía tareas).
- Router `planos.py`: `POST /obras/{id}/planos`, `GET /obras/{id}/planos`, `DELETE /planos/{id}`. Archivos servidos por `/uploads/{filename}` (URL pública del ngrok).
- **Chatbot**: `message_service._handle_plano_request` — si el mensaje contiene "plano", detecta la disciplina, busca la última versión vigente en las obras del responsable y la **adjunta por WhatsApp** (Twilio `media_url`, soporte agregado a `send_whatsapp_message`). Si no existe, lista las disponibles.

### Frontend
- `PlanosTab.tsx`: tab "Planos" en la obra (sidebar). Carga (disciplina + nombre + drag&drop), lista agrupada por disciplina con la versión vigente destacada y el historial colapsable, descarga, borrado. Hint de que se piden por WhatsApp.
- `api/planos.ts`, tipo `Plano`, `ObraTab` + `OBRA_TABS` extendidos.

### Validation
`tsc` ✓ · `npm run build` ✓ · migración 0028 aplicada ✓ · verificado e2e: subida con versionado (v2 vigente, v1 historial) ✓, lógica del chatbot (detección de disciplina, devuelve la última versión + media_url; "plano de gas" inexistente → lista disponibles) ✓, tab en navegador ✓. Datos de prueba eliminados.

---

## 2026-06-13 — Bitácora por WhatsApp para el staff (arquitecto/jefe/admin)

El audio de bitácora ya no es solo para responsables: el arquitecto/jefe/administrador puede mandarlo desde su WhatsApp. Rama `feature/bitacora-whatsapp-staff`.

### Base de identidad
- `users.whatsapp_number` (migration 0030, E.164). El staff lo carga en su perfil (UserProfileModal, con `normalizePhone`). El bot ahora resuelve al emisor en Responsables **y** en Usuarios.

### Chatbot
- Si el emisor es staff (usuario con WhatsApp cargado) y escribe texto → **menú**: "🎤 Bitácora de obra (mandá una nota de voz)" + "📐 Planos".
- Nota de voz de cualquier emisor reconocido (responsable o staff) → bitácora con IA. Obra: si tiene una sola, directo; si tiene varias, el bot **pregunta a cuál va** (lista numerada) y al responder el número se procesa.
- `_sender_obra_ids`: staff = obras que administra (manager), o todas las del tenant si es admin sin obras propias; responsable = obras de sus tareas. Orden estable para que el número elegido coincida.
- Planos también funcionan para staff (misma resolución de obras).
- Twilio: la ventana horaria / chatbot_enabled solo aplican a responsables (anti-spam de recordatorios); el staff inicia, no se filtra.

### Validation
`tsc` ✓ · `npm run build` ✓ · migración 0030 ✓ · verificado: identidad staff por número, obras del manager, menú, transcripción→pendiente_obra→elegir obra→análisis con IA (resumen + 2 acciones), campo de WhatsApp en el perfil persiste (PATCH/GET /users/me). Datos de prueba limpiados.

### Pendiente (charlado, no construido aún)
Feature B: avisar al jefe/manager cuando un responsable contesta un recordatorio. Queda para una próxima.

---

## 2026-06-24 — Bitácora: hardening, badge por obra y fechas a día laboral

Sesión de análisis del módulo de bitácora y tres tandas de mejoras. Tres ramas/PRs.

### A. Hardening de seguridad y robustez — rama `fix/bitacora-criticos` (PR #10, mergeado)
- **Aislamiento por tenant (fuga de datos / IDOR):** `GET /bitacora` filtraba sin `tenant_id` → un usuario veía bitácoras de otros tenants. Ahora `list_entries` filtra por tenant (LEFT JOIN a `obras`; las entradas sin obra solo las ve quien las creó). Nuevo `get_scoped()` cierra el mismo IDOR en todas las rutas por id (transcript/reprocess/obra/apply/dismiss/delete). Validación de obra por tenant al crear entradas (audio/texto).
- **I/O no bloqueante:** la transcripción (Whisper, `requests` síncrono, hasta 120 s) y la descarga de audio de Twilio corrían en el event loop → congelaban el worker. Movidas a `asyncio.to_thread`.
- **Limpieza:** `delete` borra el audio del disco (sin huérfanos); `BACKEND_URL` del front sale de `VITE_API_URL`; estado `pendiente_obra` agregado al front (antes mostraba badge "Error"); N+1 resuelto (`_to_read_bulk`), paginación en el listado y manejo de `stop_reason` (`refusal`/`max_tokens`) en el análisis.

### B. Badge de sugerencias por obra — rama `feature/bitacora-badge` (PR #13, mergeado)
- `GET /bitacora/pending-count?obra_id=`: cuenta sugerencias sin aplicar/descartar, scopeado por tenant y obra.
- Badge naranja en el ítem "Bitácora de obra" (contexto de obra), refrescado al cambiar de obra y al navegar.
- La página de bitácora, al entrar desde una obra, arranca filtrada en esa obra; encabezado "N sin revisar", orden pendientes-primero y filtro "Solo pendientes".

### C. Fechas a día laboral — rama `feature/fechas-laborales` (PR abierto)
Detectado al probar: al aplicar sugerencias de fecha, el sistema **bloqueaba** con error si la fecha caía en feriado o fin de semana (validación `_assert_dates_working` en create/update). Inconsistente: el cascade ya **ajustaba** con `next_working_day()`.
- **Snap en vez de bloqueo (sistémico):** nuevo `_snap_working_dates()` corre inicio/fin al próximo día laboral; aplicado en `create`, `update` y `bulk`. Ya nada se rechaza.
- **Aviso transitorio:** `TaskRead.date_adjustment` lleva el detalle de lo que se movió; en bitácora se guarda en `result_note` y se muestra en la tarjeta de la sugerencia.
- **IA mejor de entrada:** se pasa el calendario laboral (días hábiles + feriados próximos) a Claude; el prompt de `reschedule_task` ahora completa **solo la fecha discutida** (deja en `null` la que no se mencionó — antes inventaba un inicio).

### Validation
`py_compile` + `import app.main` ✓ · `tsc -b` ✓ (las 3 ramas) · query de tenant scoping compilada a SQL correcto ✓ · test de la lógica de snap con calendario en memoria (finde/feriado → próximo día laboral; `inicio ≤ fin` preservado) ✓. Verificado e2e por WhatsApp: nota de voz → transcripción → análisis → sugerencias con Sí/No (faltaba crédito en OpenAI; resuelto). Pruebas de browser e2e del snap quedan para correr con el stack levantado.

---

## 2026-06-25 — Bitácora por obra + asignación garantizada de la nota de voz (PR #15)

La bitácora pasó a ser estrictamente **un módulo de cada obra**, y se blindó el caso del audio de WhatsApp que queda sin obra (emisor con varias obras que no responde "¿para qué obra?").

### A. Página fija a la obra
- Se entra a la bitácora desde el menú de cada obra → la página queda **fija a esa obra**: se quitó el selector "Todas las obras" y se muestra el nombre de la obra como etiqueta. Carga y registra solo en esa obra.

### B. Recordatorio automático (no se pierde el audio)
- Nuevo job en el scheduler (`_job_remind_bitacora_obra`, cada 15 min) que llama a `MessageService.remind_pending_bitacora_obra()`.
- Si una nota quedó `pendiente_obra` (sin obra), le recuerda al **emisor** por WhatsApp **cada 30 min** que elija obra, **en horario laboral** (ventana del responsable; staff 8–20), hasta un **tope de 48 h**. Migración **0037**: columna `reminded_at` para la cadencia.
- Se amplió la ventana de match de `_pending_bitacora_obra` de 30 min a **7 días**: la respuesta tardía (tras los recordatorios) ahora **sí asigna** la obra (antes se perdía pasados 30 min).

### C. Red de seguridad — sección "Sin asignar" (asignación manual del jefe)
- Si el emisor nunca responde, la nota no queda huérfana: `GET /bitacora/unassigned` (scopeado por tenant vía `Responsible.tenant_id` o `User.tenant_id`) lista las notas sin obra del equipo, y la bitácora de cualquier obra las muestra arriba en una sección **"Sin asignar"** con selector de obra para que el **jefe** las asigne a mano.
- Se endureció `get_scoped`: las notas de responsables sin obra (`created_by` nulo) ahora también se aíslan por tenant vía `Responsible.tenant_id`.

### Validation
`py_compile` + `import app.main` ✓ · `tsc -b` ✓ · queries de recordatorio (cap 48h + cadencia 30min) y de `unassigned` (scoping por tenant) compiladas a SQL correcto ✓ · rebase limpio sobre main. Pruebas e2e por WhatsApp (recordatorio a los 30 min) y de la sección "Sin asignar" quedan para correr con el stack levantado y la migración 0037 aplicada.

---

## 2026-06-25 — Bitácora: feedback al emisor, editar sugerencia y aviso en vivo (PR #17)

Tres mejoras de uso real ("pensándolo como usuario") sobre el módulo de bitácora.

### A. Confirmación de vuelta al que reportó (cierra el loop)
- Al **aplicar** una sugerencia, el sistema le manda un WhatsApp a **quien mandó la nota** (responsable o staff, salvo que sea el propio jefe que aplica): *"✅ Pedro reprogramó «Estructura»: fin 25/07/2026 a partir de tu nota de voz."*. Mensaje específico por tipo (mover/crear/estado/nota). Si el envío falla, no rompe el flujo.
- `bitacora_service`: helpers `_confirmation_text()` y `_notify_reporter()`. Se notifica solo al aplicar (positivo), no al descartar.

### B. Editar la sugerencia antes de aplicar
- La IA propone, el jefe ajusta: botón **Editar** en la tarjeta con inputs según el tipo (fechas para mover/crear, título + responsable para crear, estado para cambiar).
- `POST /bitacora/{id}/suggestions/{idx}/apply` acepta un **body opcional** `BitacoraSuggestionEdit`; el servicio mergea los ajustes (`exclude_unset`) en la sugerencia antes de ejecutar y los persiste para reflejarlos en la tarjeta.

### C. Aviso en tiempo real al jefe (toast)
- Al procesarse una nota se emite `bitacora_created` a la sala `obra_{id}` (`socket_manager.emit_bitacora_created`). Como en `connect` el usuario se une a **todas** sus obras, el jefe ve el toast *"X mandó una nota de voz"* (con el resumen) esté donde esté en la app. Reusa el `ActivityToast`/`useActivityFeed` existentes; no se notifica a sí mismo si la cargó él desde la web (`actorId`).

### Validation
`py_compile` + `import app.main` ✓ · `emit_bitacora_created` / parámetro `edits` / schema presentes ✓ · `tsc -b` exit 0 ✓. Pruebas e2e en vivo (feedback por WhatsApp y toast en tiempo real) quedan pendientes de correr con el stack levantado.

---

## 2026-06-25 — Bitácora: vínculo tarea↔nota de voz y búsqueda/filtros (PR #19)

Dos mejoras de trazabilidad y usabilidad sobre el módulo de bitácora.

### A. Vínculo tarea ↔ nota de voz (trazabilidad navegable)
- `GET /tasks/{id}/bitacora` (`BitacoraService.list_for_task`): devuelve las notas cuyas sugerencias **aplicadas** originaron o modificaron esa tarea. Reusa el `result_task_id` que ya guarda cada sugerencia (filtra en Python sobre las entradas de la obra; sin tabla nueva), scopeado por tenant.
- Frontend: nuevo componente `TaskBitacoraOrigin.tsx` embebido en `TaskFormModal` (modo edición) → sección **"Origen — Bitácora"** que, por cada nota vinculada, muestra la acción (*"Reprogramada por nota de voz de Juan · fecha"*), el resumen, la cita del audio y el **audio reproducible**. La dirección tarea → audio queda completa; la inversa (nota → tarea navegable) se deja como follow-up.

### B. Búsqueda y filtros en la bitácora
- Barra de filtros (client-side sobre las entradas de la obra): **búsqueda** por texto (resumen, transcripción, puntos clave) o responsable; **filtro por tipo** de sugerencia (mover/crear/estado/nota); **filtro por fecha** (hoy / 7 / 30 días). Se combinan con el "solo pendientes" existente.

### Validation
`py_compile` + `import app.main` ✓ · `list_for_task` presente ✓ · `tsc -b` exit 0 ✓. Prueba e2e en vivo (sección "Origen" en una tarea con audio, filtros con volumen real) queda pendiente con el stack levantado.

---

## 2026-06-25 — Fix: crear tarea desde sugerencia con responsable (PR #21)

Detectado en la **prueba e2e en vivo** (audio real de obra). Al aplicar una sugerencia de tipo `create_task` que mencionaba un responsable ("Equipo de Pereira"), el `Aplicar` fallaba con *"No se pudo aplicar la sugerencia."*.

**Causa:** `Responsible` dejó de tener `obra_id` cuando se pasó al equipo global por tenant (Etapa 1.4), pero el matcheo del responsable en `apply_suggestion` (rama `create_task`) seguía filtrando por `Responsible.obra_id == entry.obra_id` → `AttributeError` que tumbaba todo el apply. Bug latente: solo se disparaba cuando la sugerencia traía `responsible_name` (las de estado/fecha/nota no lo tocan, por eso funcionaban).

**Fix:** se matchea el responsable por **nombre dentro del tenant de la obra** (`Responsible.tenant_id`, que sí existe) y activo; si no hay match, la tarea se crea **sin responsable** (deja de ser un error). Única referencia rota en el código (verificado con grep).

### Validation
`py_compile` + `import app.main` ✓ · query de matcheo (sin `obra_id`) compilada a SQL correcto ✓. La prueba en vivo que destapó el bug confirmó, además, que el resto del pipeline interpreta bien: el audio matcheó "loza del segundo piso" → tarea «Losa 2» y «Estructura» por id, y generó las 4 acciones (estado/fecha/crear/nota) correctamente.

---

## 2026-06-26 — Módulo Compras: Solicitudes de Cotización (rama `feature/compras-cotizaciones`)

Implementación completa del flujo de solicitudes de cotización dentro del módulo Compras: desde la selección de materiales hasta la confirmación del proveedor con generación de orden de compra, pasando por el envío por WhatsApp, la recepción automática de PDFs de proveedores y el análisis comparativo con IA.

### A. Migración 0038 — nuevas tablas

- `solicitudes_cotizacion`: entidad central del flujo (estados: borrador → enviada → respondida → confirmada), con `ref_code` único por obra (COT-01, COT-02…), `notes` y `pdf_url`.
- `solicitud_materiales`: M2M entre solicitudes y `task_materials`.
- `solicitud_suppliers`: relación solicitud ↔ proveedor con estado propio (enviada / respondida) y `sent_at`.
- `budgets`: nuevas columnas `solicitud_id` (FK, para vincular la respuesta del proveedor) y `ai_analysis` (TEXT, JSON del análisis comparativo).

### B. Modelos y schemas

- `app/models/solicitud_cotizacion.py`: modelos `SolicitudCotizacion` y `SolicitudSupplier`; tabla de asociación `solicitud_materiales` definida con `Table()` de SQLAlchemy.
- `app/models/budget.py`: agregadas las dos columnas nuevas.
- `app/schemas/solicitud_cotizacion.py`: schemas de lectura completos con anidado de respuestas y análisis IA (`SolicitudCotizacionRead`, `RespuestaCotizacionRead`, `AnalisisComparativoRead`, etc.) y schemas de escritura (`SolicitudCotizacionCreate`, `ConfirmarProveedorRequest`).
- `app/models/__init__.py`: exportación de los nuevos modelos para que Alembic los detecte.

### C. SolicitudService — flujo completo

`app/services/solicitud_service.py` cubre cinco operaciones:

1. **`create()`**: valida materiales y proveedores, genera código de referencia secuencial, construye el PDF de solicitud con reportlab (fallback a texto si no está disponible), envía el mensaje + PDF a cada proveedor por WhatsApp, registra `SolicitudSupplier` por cada uno y loguea en el historial.

2. **`receive_supplier_pdf()`**: descarga el PDF desde la URL de Twilio (autenticado si hay credenciales), delega la extracción en `BudgetService.create()` (que ya maneja PDF→Claude→estructura), vincula el `Budget` resultante a la solicitud, marca al proveedor como "respondida" y dispara `_run_ai_analysis()` cuando hay 2+ respuestas.

3. **`_run_ai_analysis()`**: arma un prompt con los datos estructurados de cada presupuesto y llama a Claude con `output_config` JSON Schema (`_ANALISIS_SCHEMA`). El esquema fuerza: `resumen`, `comparacion_items` (ítem por ítem con precios de cada proveedor y diferencia), `donde_ganas`, `donde_pierdes`, `condiciones_pago`, `plazos`, `riesgos`, `recomendacion` y `supplier_recomendado_id`. El JSON resultante se guarda en `Budget.ai_analysis` de la respuesta más reciente.

4. **`confirmar()`**: crea `PurchaseOrder` con los materiales de la solicitud, pone los materiales en estado "pedido" y marca la solicitud como "confirmada".

5. **`get_pending_for_supplier()`**: lookup para routing de WhatsApp — busca la solicitud más reciente en estado "enviada" o "respondida" para un proveedor dado.

### D. Router y endpoints

`app/api/routes/solicitudes.py` expone tres endpoints (registrados en `main.py`):

- `GET /obras/{obra_id}/solicitudes-cotizacion` → `list_for_obra()`
- `POST /obras/{obra_id}/solicitudes-cotizacion` → `create()`
- `POST /solicitudes-cotizacion/{id}/confirmar` → `confirmar()`

### E. Routing WhatsApp de PDFs de proveedores

`app/services/message_service.py` — nueva sección "4a" antes del ruteo existente: cuando llega un webhook con `NumMedia=1` y `MediaContentType0=application/pdf` (o Excel) de un número **no registrado** como responsable ni staff, se busca al proveedor por teléfono en la tabla `suppliers`. Si hay match y hay una solicitud pendiente, se llama a `receive_supplier_pdf()` y se responde con acuse de recibo por WhatsApp.

Corrección detectada durante el desarrollo: `TwilioInboundPayload.detected_type` devuelve `UNKNOWN` para PDFs (no existe `DOCUMENT` en el enum `MessageType`). El routing filtra por `MediaContentType0` directamente en lugar de depender del `detected_type`.

### F. Frontend

- `ComprasTab.tsx`: rediseño completo de la navegación con tres módulos numerados (01 Materiales / 02 Cotizaciones / 03 Pedidos), pills de estado con indicador de punto de color, y navegación automática post-modal (crear solicitud → va a Cotizaciones; confirmar → va a Pedidos).
- `purchaseOrders.ts`: `fetchSolicitudes()` eliminó el mock estático y ahora llama a `GET /obras/{id}/solicitudes-cotizacion`.

### Validation

`alembic upgrade head` aplicó 0038 sin errores ✓ · `python -c "from app.main import fastapi_app"` importa sin errores ✓ · 3 endpoints registrados verificados con `curl /openapi.json` ✓ · `tsc --noEmit` exit 0 ✓ · `ast.parse` de todos los archivos nuevos/modificados ✓ · `curl /api/v1/obras/1/solicitudes-cotizacion` sin token → 403 (llega al guard) ✓.

---

## Sesión 2026-06-26 — Módulo Compras: mejoras al panel de cotizaciones

### Cambios realizados

#### Backend

**`app/schemas/solicitud_cotizacion.py`**
- `RespuestaCotizacionRead`: nuevos campos `rubro`, `proveedor_nombre`, `fecha`, `iva_pct`, `iva_monto`, `incluye_flete`, `inconsistencias` (datos extraídos del PDF)
- `SolicitudCotizacionRead`: campo `contratista_phone: str | None`
- `AnalisisComparativoRead.supplier_recomendado_id`: cambiado a `int | None` (soporta contratistas sin supplier_id)
- Nuevo schema `ConfirmarContratistaRequest` con `supplier_name` y `supplier_phone`

**`app/services/solicitud_service.py`**
- `_to_read()`: populate los nuevos campos desde `b.data` (rubro, proveedor, fecha, iva, flete, inconsistencias) y agrega `contratista_phone=sol.contratista_phone`
- `_ANALISIS_SCHEMA`: `supplier_recomendado_id` ahora acepta null (para contratistas)
- Nuevo método `confirmar_contratista()`: auto-crea o reutiliza un `Supplier` existente desde nombre+teléfono del contratista, luego llama a `confirmar()`

**`app/api/routes/solicitudes.py`**
- Nuevo endpoint `POST /solicitudes-cotizacion/{id}/confirmar-contratista`

#### Frontend

**`types/index.ts`**
- `RespuestaCotizacion`: agregados `rubro`, `proveedor_nombre`, `fecha`, `iva_pct`, `iva_monto`, `incluye_flete`, `inconsistencias: BudgetInconsistency[] | null`
- `SolicitudCotizacion`: agregado `contratista_phone: string | null`
- `AnalisisComparativo.supplier_recomendado_id`: `number | null`

**`api/purchaseOrders.ts`**
- Nueva función `confirmarContratistaProveedor(solicitudId, supplierName, supplierPhone)`

**`components/ComprasTab.tsx`**
- Nuevo componente `ConfirmarBtn` que maneja la bifurcación supplier formal vs contratista
- `AnalisisPanel` — vista de 1 cotización: muestra tabla completa de ítems con columnas Descripción/Cant./Unidad/P.unit./Subtotal, metadatos del PDF (rubro, fecha, validez, flete, IVA), inconsistencias detectadas, y condiciones de pago/entrega
- `AnalisisPanel` — vista multi cotización: usa `deduped` en lugar de `respuestas`, keys correctas para contratistas (no usa `supplier_id` como key), manejo de `recomendadoId == null`, cards de proveedores con flete incluido, resumen de IA mostrado, secciones de condiciones pago y plazos
- `SolicitudCard` header: muestra nombre del proveedor desde `respuestas` si no hay `suppliers` formales; fallback a "Contratista directo" si hay `contratista_phone`; acepta nueva prop `onConfirmarCont`
- `handleConfirmarContratista()` en el componente principal

### Validation
`python -c "from app.schemas.solicitud_cotizacion import *; from app.services.solicitud_service import SolicitudService"` → OK ✓ · 4 endpoints en router ✓ · `tsc --noEmit` exit 0 ✓.

---

## 2026-06-30 — Bitácora: entradas y sugerencias colapsables (PR #24)

Rediseño de la `BitacoraPage` siguiendo *progressive disclosure*: las notas resueltas ocupan poco y las accionables saltan a la vista.

- **Entradas colapsables** (`motion.div` con `layout` + `AnimatePresence`): cada nota se pliega/despliega; las que **necesitan atención** (sugerencias pendientes) arrancan expandidas, el resto colapsadas.
- **Sugerencias aplicadas/descartadas plegadas**: las ya resueltas se muestran en una línea compacta en vez de la tarjeta completa con inputs de edición.
- **Filtros mínimos**: se eliminaron los dropdowns de tipo y fecha (ruidosos); queda solo la **búsqueda** por texto/responsable, combinada con el "solo pendientes".

### Validation
`tsc -b` exit 0 ✓. Revisión visual en vivo (HMR) sobre la página de bitácora de una obra.

---

## 2026-06-30 — Gantt: dependencias visibles, agrupamiento WBS, pinch-zoom y borrar (PR #25)

Tanda de mejoras de visualización del cronograma (solo capa visual/orden; **no se tocó la lógica del drag**).

- **Agrupamiento WBS**: nuevo `groupChildrenUnderParents()` reordena las filas en árbol para que cada subtarea quede **justo debajo de su tarea padre** (antes caían sueltas según `order_index`). Respeta colapsos y el reorder por drag.
- **Dependencias legibles**: flechas más marcadas (azul `#3D6FB5` + halo blanco, cabeza/punto más grandes) y un **chip "depende de …"** en la columna de tareas. El chip se **omite cuando la predecesora es la propia tarea padre** (relación redundante con la jerarquía).
- **Filas compactas**: `ROW_H 48` / `BAR_H 28` → entra más obra de un vistazo.
- **Pinch-to-zoom**: listener nativo de `wheel` con `ctrlKey` (así reporta el *trackpad* el pellizco; también Ctrl+rueda) que multiplica `dayW` de forma continua, **anclado al cursor** (ajusta `scrollLeft` por ratio en `requestAnimationFrame`). Límites `0.35×`–`3×`; cambiar de preset (semana/mes/trim) resetea el zoom fino. Como toda la matemática del Gantt deriva de `dayW`, el drag/resize/flechas escalan coherentes.
- **Botón eliminar en hover**: la prop `onDeleteTask` (ya existente en `GanttTimeline`) se cablea desde `ObraDetailPage` → `ResumenTab`, gateada por `can("tarea.delete")` (solo admin); reusa el modal `TaskDeleteConfirm`.

Archivos: `GanttTimeline.tsx`, `ResumenTab.tsx`, `ObraDetailPage.tsx`.

### Validation
`tsc -b` exit 0 ✓. Verificación manual de drag/resize tras zoom, agrupamiento de subtareas, pinch anclado al cursor y borrado por hover (queda como checklist del PR).

---

## 2026-07-01 — Planilla tipo Google Sheets (feature/planilla-sheets)

Reescritura profunda de la vista **planilla** (`TaskSheetView`) para que se comporte como una hoja de cálculo real, más un rollup de materiales en el backend.

### Frontend (`TaskSheetView.tsx`)
- **Zoom continuo**: pinch del *trackpad* / `Ctrl+rueda` (listener `wheel` nativo con `ctrlKey`) que aplica CSS `zoom` sobre el lienzo, **anclado al cursor** (ajusta `scrollLeft/Top` por ratio). Persistido por obra; límites `0.5×`–`2×`.
- **Grilla completa estilo Sheets**: columnas de ancho fijo (Tarea dejó de ser `1fr`) y un lienzo que se **extiende más allá de los datos** (celdas vacías abajo/derecha) para poder scrollear como en Sheets. Las líneas vacías se dibujan con gradientes CSS alineados a las columnas; el alto de fila/header se **mide del DOM** (÷ zoom) para que la grilla vacía alinee exacto. Un `ResizeObserver` extiende el lienzo para llenar siempre la pantalla a cualquier zoom.
- **Escribir directo**: se quitó el botón "Agregar fila". Clic en una celda vacía (o en la fila fantasma) abre una fila nueva con el cursor en el título vacío. Barra de estado inferior fija con totales + control de zoom + menú "Columnas".
- **Insertar en cualquier posición**: clic derecho en una fila → *insertar arriba/abajo* (crea y reordena para que caiga en ese lugar, sin huecos) o *eliminar*. El botón de eliminar por hover pasó a la primera columna (`#`).
- **Mostrar/ocultar columnas**: menú "Columnas" (persistido por obra). Colapso vía `cellStyle`/`gridTemplateColumns` sin tocar el modelo de selección por índice (por eso no se hace *reorder*, que lo rompería).
- **3 columnas nuevas** (apagadas por defecto): **Hito** (toggle por clic), **Depende de** y **Costo/Materiales** (resumen read-only; clic abre el modal de la tarea vía nueva prop `onOpenTask`).

### Backend
- **Reorder**: `POST /tasks/obra/{id}/reorder` (schema `TaskReorder`, `TaskService.reorder`) reasigna `order_index` según la lista de IDs → permite insertar en cualquier posición y persiste el orden en la base.
- **Rollup de materiales**: `TaskRepository.materials_summary_by_obra` (una query agregada) + campos `materials_count/cost/pending` en `TaskRead`, para la columna Costo.

### Validation
`tsc -b` exit 0 ✓ · backend `py_compile` + `import app.main` ✓. Rebase limpio sobre `main` actualizado (integró PR #26 docs y #27 compras; merge de 3 vías sin conflictos). De paso se quitó el componente muerto `NuevaSolicitudModal` (PR #27) que rompía `tsc`. Pruebas e2e (zoom, insertar, columnas, costo con materiales reales) quedan como checklist del PR.

---

## 2026-07-02 — Estado de obra: automático + manual (feature/obra-estado-auto)

Antes el estado de la obra arrancaba en `planificada` y **nunca cambiaba** (no había transición automática ni UI para cambiarlo): todas quedaban planificadas y las pestañas Activas/Completadas siempre en 0.

### Automático (backend)
`TaskService.recompute_obra_status(obra_id, allow_complete=True)` derivado de las tareas, enganchado en **create / update / apply_status_update / delete** de tareas:
- `planificada → en_progreso` cuando alguna tarea arranca (en progreso/bloqueada/completada o avance > 0%).
- `en_progreso → completada` cuando todas las tareas (no canceladas) están al 100%.

### La regla: no se pisan
`pausada`, `cancelada` y `completada` son **pegajosos** — el automático nunca los toca (guard al inicio de la función). El auto solo maneja el tramo `planificada ↔ en_progreso → completada`.

### Manual (frontend)
La **pastilla de estado** de cada card (`PortfolioPage`) es clickeable (menú por `createPortal` para no ser recortado por el `overflow:hidden` del hero) y ofrece acciones contextuales: Pausar / Reactivar. Los estados **terminales** (completada/cancelada) no se cambian a mano: solo se pueden **Eliminar** (borrado real vía `deleteObra` → `DELETE /obras/{id}`, cascada a tareas/equipo). `completada` se alcanza solo de forma automática (se quitó "Marcar completada" manual) y `Cancelar` se reemplazó por Eliminar.

### Reactivar/reabrir al toque
`ObraService.update`, tras un cambio manual de `status`, llama a `recompute_obra_status(allow_complete=False)` y re-lee la obra: reactivar recalcula el estado real al instante, pero **no re-completa** en el mismo acto (para que reabrir no rebote a completada) y devuelve la obra ya recalculada.

### Fix incluido
Los clics del menú (portal) burbujeaban por el árbol de React hasta el `onClick` de la card y navegaban al resumen (además de tapar el borrado): se agregó `stopPropagation` al backdrop y al panel del portal.

### Validation
`tsc -b` exit 0 ✓ · backend `py_compile` + `import app.main` ✓. Pruebas e2e (auto al mover tareas, pausar/reactivar, eliminar, terminal solo-eliminar) quedan como checklist del PR.

---

## 2026-07-17 — Auditoría sistemática del sistema + informe consolidado

Auditoría técnica módulo por módulo de **todo el sistema**, sin cambios de código de producto: solo relevamiento y documentación de hallazgos.

### Alcance y método
Se reconciliaron los ocho análisis por módulo (`docs/analisis-modulo-*.md`) contra las **26 rutas** del backend, los 18 servicios y los 22 modelos, con verificación puntual del código real de cada hallazgo crítico. Resultado: **cobertura 26/26 rutas** (ningún módulo sin auditar).

### Entregable
Nuevo documento maestro **`docs/auditoria-sistema-consolidada.md`** que consolida los 8 análisis en uno solo:
- Resumen ejecutivo + conteo por severidad: **15 P0 (seguridad) · ~28 P1 (robustez/negocio) · ~20 P2 (pulido)**.
- Matriz de cobertura de las 26 rutas (cada ruta → doc → hallazgo de mayor severidad).
- Los 15 P0 en tabla (módulo, impacto, causa raíz), los P1 agrupados por área, los P2.
- Tabla de resumen por módulo (# de gaps y severidad máxima de ~29 submódulos).
- Fortalezas del sistema y orden de remediación recomendado.

### Hallazgo dominante (causa raíz única)
`tenant_id` está desnormalizado en solo 8 de ~22 tablas; las tablas hijas (task, task_material, alert, calendar, baseline, solicitud, historial, plano, obra_team_member) llegan al tenant **por join** con la obra padre, y varios endpoints omitían ese join al chequear acceso → **~13 fugas cross-tenant tipo IDOR** que comparten una sola causa raíz. Los tres P0 más graves fuera de ese patrón: `/uploads` y planos servidos **sin autenticación**, `INTERNAL_API_KEY` vacío que deja pasar los endpoints internos, y el `connect` de Socket.IO que une a las salas de **todas** las obras (fuga en tiempo real).

### Nota de estado
Existe un borrador de corrección de los IDOR (guards de tenant) + un primer arnés de tests de aislamiento (`backend/tests/test_tenant_isolation.py`, pytest, 3 tests / 10 endpoints verificados con 404 cross-tenant) en la rama `feature/hardening-autorizacion`. **No está mergeado ni pusheado** — este trabajo es solo la auditoría/documentación; aplicar el fix queda como paso aparte.

### Validation
Documentación pura (sin cambios de código de producto). Cobertura verificada 26/26 rutas.

---

## 2026-07-18 — Remediación del cluster P0 de seguridad (14/15 cerrados)

Se cerró y mergeó a `main` **todo el cluster P0 de aislamiento por tenant** del informe consolidado de auditoría, en una serie de PRs enfocados. Cada uno con tests y verificado por CI.

### Qué se cerró
- **13 IDOR cross-tenant** (#3–#13): guards de tenant en cada endpoint hijo de obra/tarea (tasks, materiales, solicitudes, obra_team, exports, planos, historial, alerts, calendar, baseline) + `socket_manager` que conecta solo a las salas del tenant. Arnés `tests/test_tenant_isolation.py`.
- **#1 uploads/planos/audios sin auth**: URLs firmadas HMAC + expiración (`app/core/signing.py`); la ruta `/uploads` exige firma para no-imágenes (planos/audio); imágenes de portada/avatar siguen públicas (uuid4). `tests/test_upload_signing.py`.
- **#5 `INTERNAL_API_KEY`**: ya fallaba cerrado (401 si vacío) — sin cambio.
- **#15 SSE/JWT en query**: se removió el endpoint SSE (`events.py` + `sse_manager`) — era **código muerto** (el front usa Socket.IO); elimina el token de la query.
- **#2 causa raíz — denormalización de `tenant_id`**:
  - **Fase 1** (mig. 0040): columna `tenant_id` (nullable, FK, index) en 8 tablas hijas + backfill desde la obra + keep-in-sync (`app/core/tenant_denorm.py` en los ~10 sitios de creación). `tests/test_tenant_denorm.py`.
  - **Fase 2** (mig. 0041): `tenant_id NOT NULL` en obras + 6 hijas siempre-parentadas (alerts/historial quedan nullable por su `obra_id` nullable) + guard de `task_materials` filtrando por `task.tenant_id` directo (single-`WHERE`, sin join).
- **CI** (GitHub Actions, `.github/workflows/ci.yml`): corre los 16 tests + build del front en cada push/PR → ningún endpoint nuevo reintroduce un IDOR.

### Único punto abierto — #14 (parcial)
El IDOR de responsables se cerró. El `whatsapp_number` **único-global** NO se volvió per-tenant: es la clave de ruteo del WhatsApp entrante (número Twilio compartido → el `From` es la única señal de tenant). Volverlo per-tenant exige un número por tenant → **decisión de arquitectura de producto**, documentada como limitación en el audit.

### Validation
`import app.main` ✓ · **pytest 16/16** ✓ · build del front ✓ (CI en verde). Migraciones 0040/0041 se validan con `alembic upgrade` sobre Postgres (los tests usan `create_all`). Doc de auditoría (`auditoria-sistema-consolidada.md`) actualizado con el estado de resolución (§1/§4/§7).

---

## 2026-07-23 — Fix de arranque del backend por colisión de variable DEBUG

### Objective
Restaurar la carga de obras en el frontend: la aplicación de Vite abría en `localhost:5173`, pero el backend no iniciaba correctamente y la vista mostraba “No se pudieron cargar las obras”.

### Changes made
- Se reemplazó la variable de configuración genérica `DEBUG` por `APP_DEBUG` para evitar colisiones con variables heredadas del entorno.
- Se actualizaron los consumidores de la configuración y los archivos de entorno.
- Se aplicaron las migraciones pendientes de PostgreSQL, desde `0037` hasta `0041`.

### Files modified
- `backend/app/core/config.py` — renombra el campo de configuración a `APP_DEBUG`.
- `backend/app/core/database.py` — usa `APP_DEBUG` para controlar el log SQL.
- `backend/app/integrations/twilio/security.py` — usa `APP_DEBUG` para el bypass de validación en desarrollo.
- `backend/.env` — migra la configuración local a `APP_DEBUG=false`.
- `backend/.env.example` — documenta la nueva variable.
- `docs/documentacion.md` — registra la sesión de debugging.

### Problems found
- El entorno del proceso definía `DEBUG=release`; esa variable sobrescribía el valor booleano del `.env` y Pydantic abortaba con `ValidationError: Input should be a valid boolean`.
- La base local estaba en la revisión Alembic `0037`, mientras el código requería `0041`.

### Solutions applied
- Se adoptó el nombre específico `APP_DEBUG`, eliminando la colisión que impedía importar `app.main`.
- Se ejecutó `alembic upgrade head`, aplicando correctamente las revisiones `0038`, `0039`, `0040` y `0041`.

### Validation
- `./.venv/bin/python -c "from app.main import app; print('imports OK')"` — OK.
- `GET http://127.0.0.1:8000/health` — `200 OK`, `{"status":"ok","app":"CONSTRUCTA"}`.
- `GET /api/v1/obras` sin token y con origen `http://localhost:5173` — `403 Not authenticated` esperado y encabezado CORS correcto.
- `./.venv/bin/alembic current` — `0041 (head)`.
- `cd frontend && npm run build` — build completado sin errores; solo advertencia no bloqueante por tamaño del bundle.

### Pending / next steps
Recargar `http://localhost:5173`; si la sesión fue invalidada durante la caída, iniciar sesión nuevamente para que el listado de obras envíe el token.

---

## 2026-07-23 — Auditoría de avance para la primera entrega de agosto

### Objective
Determinar el estado real de CONSTRUCTA frente al Anteproyecto, el documento de módulos, el Gantt, la plantilla IPI v2.1–2026 y la evidencia del repositorio, para estimar la completitud del producto y del informe y priorizar el cierre de la primera entrega de agosto.

### Changes made
- Se creó un diagnóstico consolidado con porcentajes separados de implementación, evidencia, documentación y preparación de entrega.
- Se construyó una matriz de 17 compromisos originales y se contrastó contra el código y las pruebas existentes.
- Se comparó `docs/IPI-CONSTRUCTA.md` contra la plantilla oficial y contra los objetivos aprobados en el Anteproyecto.
- Se documentó la imposibilidad de leer la hoja online por autenticación y se analizó provisionalmente la copia local del Gantt.
- No se modificó código de producto; los riesgos encontrados quedaron documentados para una remediación posterior explícita.

### Files modified
- `docs/estado-proyecto-agosto-2026.md` — informe consolidado, porcentajes, brechas y plan de cierre.
- `docs/documentacion.md` — registro de la sesión de auditoría.

### Problems found
- El Gantt local tiene 48 actividades con fechas hasta el 2026-06-01, pero no registra estado, porcentaje real, responsables ni evidencia; la hoja de Google devolvió HTTP 401.
- El IPI tiene estructura avanzada, pero reemplaza los 12 objetivos aprobados por 9 nuevos, omite compromisos originales y agrega compras/costos pese a que el Anteproyecto los excluía.
- El IPI mantiene datos obsoletos (`0038` frente a `0041`), ocho bloques `[COMPLETAR]`, cuatro capturas faltantes, un Resumen de aproximadamente 320 palabras y bibliografía sin correspondencia completa de citas.
- Los 16 tests automatizados pasan, pero cubren un subconjunto de seguridad/archivos; no existen tests de frontend, E2E ni cobertura, y los 20 casos manuales no registran resultados ejecutados.
- La afirmación previa de “cluster P0 cerrado” no coincide con el código: siguen faltando guards de tenant en usuarios, proveedores, compras, export de presupuesto, lookup de responsables, presencia, carga de planos, presupuestos y equipo de obra.
- La plantilla IPI no define el contenido, porcentaje, fecha ni rúbrica de la primera entrega de agosto.

### Solutions applied
- Se separaron los indicadores para evitar un porcentaje engañoso: 78% de implementación funcional, 35% de evidencia, 94% de estructura IPI y 55–60% de preparación del IPI para una entrega final.
- Se estimó una preparación global aproximada de 68% (±5 puntos), condicionada a la consigna real de agosto.
- Se propuso rebaselinar el Gantt y un plan de cierre fechado entre el 2026-07-24 y el 2026-08-07.
- No se aplicaron correcciones de producto durante esta auditoría; el alcance solicitado fue diagnosticar y priorizar.

### Validation
- Lectura completa de los dos DOCX aportados y de las 21 páginas de la plantilla IPI — completada.
- Revisión de `docs/IPI-CONSTRUCTA.md` — 431 líneas, 8.279 palabras, ocho marcadores `[COMPLETAR]` y siete figuras previstas.
- Revisión de `/Users/agustinllancaman/Downloads/Gantt_Final_Constructa.xlsx` — 48 actividades en 10 fases.
- Export de la hoja online — HTTP 401; no se pudo validar si existe una versión posterior.
- `pytest` — 16/16 tests aprobados.
- `npm run build` — TypeScript y Vite completados; advertencia no bloqueante por bundle superior a 500 kB.
- `alembic current` — `0041 (head)`.

### Pending / next steps
- Obtener la consigna y fecha exactas de la primera entrega de agosto.
- Compartir/exportar la versión vigente del Gantt y rebaselinarla con avance real.
- Remediar y probar los guards multi-tenant abiertos.
- Alinear el IPI con los 12 objetivos originales, explicar la evolución del alcance y completar evidencias, citas, costos y figuras.
- Consolidar en `main` una versión única y etiquetada para la entrega.

---

## 2026-07-23 — Recalibración del alcance para la defensa del 15 de agosto

### Objective
Recalcular el estado de CONSTRUCTA usando el Gantt completo aportado por el equipo y delimitar exactamente qué funcionalidades, evidencia y documentación deben defenderse el 2026-08-15, sin mezclar ese corte parcial con la entrega final de 2027.

### Changes made
- Se analizó `Gantt_Proyecto.xlsx`, compuesto por 97 actividades y una planificación entre el 2026-04-07 y el 2027-02-01.
- Se identificaron 64 actividades planificadas como finalizadas, dos en curso y 31 futuras al 2026-08-15.
- Se cruzaron las 66 actividades del corte contra código, documentación y pruebas.
- Se generó un informe específico de alcance, estado, faltantes y guion de defensa.
- Se marcó el diagnóstico preliminar anterior como reemplazado para este corte académico.

### Files modified
- `docs/alcance-defensa-2026-08-15.md` — diagnóstico específico de la defensa, alcance incluido/excluido, porcentajes y plan de cierre.
- `docs/estado-proyecto-agosto-2026.md` — aviso de reemplazo de la estimación preliminar para el corte del 2026-08-15.
- `docs/documentacion.md` — registro de la recalibración.

### Problems found
- El Gantt no contiene estado real, porcentaje completado, responsables, evidencia ni fechas reales; sus colores representan fases.
- El 2026-08-15 no figura como hito. El corte atraviesa “Extracción de eventos y estados”, cuya finalización está planificada para el 2026-08-16.
- Las entrevistas con expertos y la preparación de la presentación no tienen evidencia suficiente.
- Las pruebas funcionales, de integración y de escenarios están parcialmente documentadas, pero los casos manuales no registran resultados ejecutados.
- La interpretación de mensajes puede confundirse con NLP de texto libre; el alcance implementado combina respuestas estructuradas del chatbot con análisis de audios/textos de bitácora.
- El IPI debe alinearse con los 12 objetivos aprobados y expresar estado al corte, no cierre final.

### Solutions applied
- Se descartó la cifra preliminar de 68% para esta presentación.
- Se calculó 51,9% como avance funcional planificado del proyecto global al corte.
- Se estimó 89,6% de implementación técnica del alcance que debe defenderse y 73–76% de preparación del paquete completo.
- Se delimitó como último entregable completamente exigible el parser de mensajes, planificado hasta el 2026-08-10.
- Se separaron expresamente fases posteriores, ampliaciones y requisitos de producción que no bloquean la defensa de agosto.
- Se propuso un plan fechado del 2026-07-24 al 2026-08-15 y un guion de demostración con contingencia para WhatsApp e IA.

### Validation
- Lectura de las hojas `Gantt`, `Leyenda` y `Datos` — 121, 22 y 119 filas respectivamente.
- Cálculo de calendario — día 1: 2026-04-07; día 131: 2026-08-15; día 301: 2027-02-01.
- Conteo del corte — 64 actividades finalizadas según plan, dos en curso y 31 posteriores.
- Cruce de evidencia — 50 completas, 14 parciales y dos pendientes entre las 66 actividades del corte.
- Revisión de consistencia documental — informe nuevo guardado, fecha absoluta correcta y próximos pasos completos.

### Pending / next steps
- Incorporar el 2026-08-15 como hito y agregar estado/evidencia al tablero operativo.
- Documentar entrevistas y un corpus de 10–15 mensajes con resultados esperados y reales.
- Ejecutar y registrar el flujo crítico completo de MVP, WhatsApp y bitácora.
- Preparar y ensayar la presentación antes del 2026-08-15.
- Actualizar el IPI con los objetivos aprobados, estado al corte y evidencia.

---

## 2026-07-24 — Alineación del IPI y corrección de la presentación del 13 de agosto

### Objective
Alinear el borrador del IPI con el Anteproyecto aprobado, la implementación y la evidencia realmente disponibles, y corregir la preparación del corte de agosto según la consigna oficial de presentación obligatoria y calificada del 2026-08-13.

### Changes made
- Se restituyeron en el IPI el objetivo global y los doce objetivos específicos aprobados, con una matriz de trazabilidad que distingue estado, evidencia y pendiente.
- Se agregó una sección de evolución del alcance para separar las ampliaciones desarrolladas de los compromisos originales, en especial planificación avanzada, importaciones, presupuestos, compras y capacidades multiempresa.
- Se incorporaron los integrantes y directores informados por el equipo, y se actualizaron arquitectura, módulos, migraciones, pruebas, beneficios, impactos y conclusión con afirmaciones ajustadas a la evidencia.
- Se documentó el relevamiento exploratorio realizado en junio de 2026 con cuatro arquitectas docentes, el director de RODE y un jefe de obra de esa empresa, diferenciándolo de una validación formal con usuarios.
- Se distinguió la calificación 10 obtenida ante los docentes de Administración de Proyectos de una prueba de aceptación con usuarios finales.
- Se corrigió el informe de defensa desde el 2026-08-15 al 2026-08-13 y se incorporaron el checkpoint del 2026-08-06, el recuperatorio del 2026-08-20 y la distribución oficial de ocho minutos.
- Se recalculó el corte del Gantt al día 129 y se ajustó el plan de preparación para mostrar la extracción de eventos y estados como actividad en curso.
- Se actualizó el generador DOCX con los nombres de estudiantes y directores y con el reconocimiento visual de marcadores `[PENDIENTE]`.

### Files modified
- `docs/IPI-CONSTRUCTA.md` — objetivos aprobados, evolución del alcance, estado técnico, pruebas, relevamiento, impactos, conclusión y anexos.
- `docs/build_ipi_docx.py` — integrantes, directores y tratamiento de marcadores pendientes.
- `docs/alcance-defensa-2026-08-13.md` — informe renombrado y recalculado para la fecha oficial, con consigna y guion temporal.
- `docs/estado-proyecto-agosto-2026.md` — referencia al informe vigente y actualización de datos técnicos.
- `docs/documentacion.md` — registro de la alineación y de la corrección de fecha.

### Problems found
- El IPI reemplazaba los doce objetivos aprobados por nueve formulaciones diferentes y no explicaba qué funciones surgieron como ampliaciones posteriores.
- Presupuestos, costos y finanzas figuraban como parte central pese a estar excluidos del alcance original del Anteproyecto.
- Existían afirmaciones demasiado amplias sobre seguridad multiempresa, escalabilidad, inmutabilidad, beneficios y cierre de pruebas.
- El código contiene migraciones hasta `0043`, pero la base local auditada permanece en `0041`.
- Los veinte casos manuales solo contienen pasos y resultados esperados; no constituyen evidencia de ejecución.
- La consolidación de auditoría ya no representa con precisión todos los pendientes: persisten controles multiempresa incompletos en rutas de usuarios, proveedores, compras, presupuestos, responsables, equipo, planos y presencia.
- La presentación estaba documentada para el 2026-08-15, aunque la fecha oficial informada es el 2026-08-13.

### Solutions applied
- Se preservaron como núcleo de trazabilidad los doce objetivos aprobados y se etiquetaron las incorporaciones posteriores como evolución del alcance.
- Se reformularon los resultados no medidos como hipótesis o beneficios esperados y se señalaron los métodos necesarios para validarlos.
- Se presentó la verificación manual existente como exploratoria y se definió el formato de evidencia que deberán completar los recorridos críticos.
- Se actualizaron las referencias a migraciones de código hasta `0043` y se explicitó la necesidad de llevar la base local desde `0041` antes de depender de las funciones nuevas.
- Se moderaron las afirmaciones de seguridad, tiempo real, escalabilidad e historial para reflejar las limitaciones detectadas.
- Se recalculó el avance funcional planificado al 2026-08-13 en 51,4 %, con 64 actividades finalizadas, dos en curso y 31 futuras.
- Se reorganizó la preparación alrededor de la dinámica oficial de un minuto de introducción, cinco de demostración y dos de pendientes y organización.

### Validation
- `backend/.venv/bin/pytest -q` — 24 pruebas aprobadas y 16 advertencias no bloqueantes.
- `npm run build` en `frontend/` — TypeScript y Vite completados; advertencia no bloqueante por paquete principal superior a 500 kB.
- Revisión del Gantt — 2026-08-13 corresponde al día 129; documentación en 129/301 y extracción de eventos/estados en 3/6.
- Conteo del corte — 64 actividades finalizadas según plan, dos en curso y 31 posteriores; avance funcional ponderado de 51,4 %.
- Revisión de extensión — Resumen y Abstract permanecen por debajo del límite de 300 palabras.
- `git diff --check` — sin errores de espacios ni formato de parche.

### Pending / next steps
- Realizar una copia de seguridad y actualizar de forma controlada la base local de `0041` a `0043`.
- Corregir y probar los controles multiempresa todavía abiertos antes de presentar el producto como SaaS listo para producción.
- Ejecutar sobre un único commit los recorridos críticos y registrar fecha, entorno, entrada, resultado real, evidencia e incidencia.
- Preparar diapositivas, datos de demostración, contingencias y un guion ensayado de ocho minutos.
- Actualizar el DER, `docs/database.md`, las figuras del IPI y sus referencias.
- Completar la matriz retrospectiva del relevamiento, el estudio económico, la reflexión del equipo, el título definitivo y la fecha de portada.

---

## 2026-07-24 — Organización del equipo y base de costos del IPI

### Objective
Incorporar al IPI la modalidad real de trabajo del equipo, la variabilidad de su dedicación y los gastos informados durante el desarrollo, evitando inventar horas, atribuciones de entrevistas o costos operativos que todavía no cuentan con evidencia suficiente.

### Changes made
- Se documentó que Martina Becerra, Facundo Graffigna y Agustín Llancaman comparten tareas de código y documentación según necesidad y disponibilidad.
- Se registraron la reunión semanal de seguimiento y el grupo de WhatsApp como mecanismos de coordinación sincrónica y asincrónica.
- Se explicó que la dedicación varía por parciales, exámenes finales y otras obligaciones, y que no existe un registro contemporáneo de horas.
- Se agregó una reflexión sobre las ventajas y limitaciones de la propiedad compartida y una mejora propuesta con responsable principal, revisor, fecha y criterio de aceptación por entregable.
- Se separaron los gastos directos de desarrollo de los costos futuros de operación por empresa.
- Se incorporaron las suscripciones de Claude y ChatGPT/OpenAI, el uso gratuito o de prueba de Twilio y el alojamiento local, señalando los datos que requieren comprobación.
- Se explicitó que no se reconstruirán hallazgos individuales de las entrevistas cuando el equipo no conserva un recuerdo suficientemente detallado.
- Se incorporó la modalidad organizativa al cierre recomendado de dos minutos de la presentación.

### Files modified
- `docs/IPI-CONSTRUCTA.md` — organización, dedicación, reflexión, límites del relevamiento y base del estudio económico.
- `docs/alcance-defensa-2026-08-13.md` — explicación breve de la organización del equipo para el cierre de la presentación.
- `docs/documentacion.md` — registro de las decisiones documentales y económicas.

### Problems found
- No se registraron horas de trabajo por integrante y la dedicación semanal fue deliberadamente variable.
- Se informó un valor de USD 20 para Claude, pero debe confirmarse si la periodicidad indicada es semanal o mensual.
- No se informó el importe exacto, el producto contratado ni la periodicidad de ChatGPT/OpenAI.
- Las suscripciones personales de asistencia al desarrollo podrían confundirse con el consumo de API generado por la aplicación.
- El uso de Twilio continúa en modalidad gratuita o de prueba y el sistema se aloja localmente, por lo que todavía no existen costos reales de producción.
- No hay recuerdo suficiente para atribuir con rigor observaciones específicas a cada participante del relevamiento.

### Solutions applied
- Se descartó presentar una cifra única de horas-persona y se propuso una reconstrucción por rangos basada en Git, reuniones, mensajes y estimaciones individuales.
- Los importes informados se registraron como datos pendientes de comprobante y no se utilizaron para calcular un total.
- Se separaron suscripciones de desarrollo, consumo variable de servicios externos e infraestructura futura.
- Se definieron unidades de medición para hosting, mensajería, IA y correo antes de proyectar escenarios de operación.
- Se mantuvieron únicamente hallazgos generales del relevamiento, con límites explícitos y una propuesta de validación posterior.

### Validation
- Revisión manual de las nuevas secciones de organización, economía, conclusión y guion de presentación — estructura y tono consistentes con el resto del IPI.
- Recuento del Resumen — 284 palabras, por debajo del máximo de 300.
- Recuento del Abstract — 257 palabras, por debajo del máximo de 300.
- `git diff --check` — sin errores de espacios ni formato de parche.
- No se modificó código de producto; no correspondió repetir pruebas de backend o frontend para estos cambios documentales.

### Pending / next steps
- Confirmar con comprobantes si los USD 20 de Claude son semanales o mensuales y durante cuántos períodos los abonó cada integrante.
- Confirmar el producto, importe, periodicidad y períodos abonados de ChatGPT/OpenAI.
- Reconstruir rangos de horas por etapa e integrante para obtener escenarios mínimo, probable y máximo.
- Registrar desde ahora responsable, revisor, fecha, evidencia y esfuerzo aproximado de cada entregable.
- Seleccionar infraestructura de despliegue y estimar costos de Twilio, IA, correo y alojamiento bajo tres escenarios de uso.
- Solicitar, si es posible, la validación de la síntesis general a los participantes del relevamiento.
- Agregar las principales dificultades técnicas y aprendizajes cuando el equipo pueda reconstruirlos.

---

## 2026-07-24 — Cuantificación de suscripciones de IA del equipo

### Objective
Precisar el gasto mensual informado por el equipo para las suscripciones personales de Claude y ChatGPT utilizadas durante el desarrollo de CONSTRUCTA y eliminar la ambigüedad de periodicidad que impedía calcular una base económica.

### Changes made
- Se confirmó que cada uno de los tres integrantes abona una cuenta de Claude de USD 20 mensuales.
- Se confirmó que cada uno de los tres integrantes abona una cuenta de ChatGPT de USD 20 mensuales.
- Se calculó un gasto base de USD 60 mensuales por cada proveedor y USD 120 mensuales para el equipo.
- Se agregó la fórmula para obtener el costo acumulado una vez conocida la cantidad de meses abonados.
- Se mantuvo separada esta inversión de asistencia al desarrollo respecto del consumo de APIs generado por la aplicación.

### Files modified
- `docs/IPI-CONSTRUCTA.md` — periodicidad, costo por servicio, total mensual y fórmula de acumulación.
- `docs/documentacion.md` — registro de la confirmación económica.

### Problems found
- Aún no se conoce desde qué mes se abona cada cuenta ni si las seis suscripciones estuvieron activas durante todos los meses del proyecto.
- El valor informado no contempla impuestos, recargos ni diferencias de cambio.
- Falta definir qué proporción de suscripciones de uso personal corresponde atribuir específicamente a CONSTRUCTA.

### Solutions applied
- Se utilizó únicamente el valor base confirmado: `3 × USD 20 + 3 × USD 20 = USD 120 por mes`.
- El documento evita presentar un total histórico hasta contar con fechas y comprobantes.
- Se distinguieron explícitamente las suscripciones personales de los costos futuros de API e infraestructura del producto.

### Validation
- Revisión aritmética — Claude: USD 60/mes; ChatGPT: USD 60/mes; total: USD 120/mes.
- Revisión manual de la tabla y la fórmula de acumulación — consistentes con los datos informados.
- `git diff --check` — sin errores de espacios ni formato de parche.
- No se modificó código de producto; no correspondió ejecutar pruebas técnicas.

### Pending / next steps
- Confirmar el mes inicial y la continuidad de cada una de las seis suscripciones.
- Incorporar comprobantes e impuestos si la cátedra solicita costo efectivamente pagado y no solo precio base.
- Definir un criterio razonable para imputar al proyecto suscripciones que también tengan uso personal.
- Reconstruir el esfuerzo por rangos y completar los escenarios de operación y retorno de inversión.

---

> **Nota de mantenimiento (2026-08-26):** entre el 2026-07-24 y esta fecha se mergearon 37 PRs sin registrar sesión por sesión en esta bitácora. Las siguientes entradas son un resumen condensado por tema (no una por cada PR) reconstruido a partir del historial de git para cerrar el bache; el detalle línea por línea de cada commit está en `git log`.

## 2026-07-28 a 2026-07-30 — Remediación P1 post-auditoría + hardening de infraestructura

### Objective
Cerrar el resto del backlog abierto por `auditoria-sistema-consolidada.md` (los P1 de robustez/negocio que quedaron fuera del cluster P0 del 2026-07-18) y endurecer el arranque del backend antes del sprint de preparación de la defensa.

### Changes made
- **IDOR #16/#17** — guard de tenant en cambiar-rol/eliminar-miembro y en Compras (aislamiento + idempotencia de purchase orders).
- **Imports (#18)** — robustez del importador Excel/CSV/MS Project ante archivos malformados o maliciosos.
- **Bitácora (#19)** — control de costo de la IA (límite de consumo) + validación del audio recibido antes de mandarlo a transcripción.
- **Ruta crítica (#20)** — las tareas sin fecha se excluyen del cálculo de CPM en vez de romperlo, y se reportan aparte.
- **Panel admin (#21)** — `tasks_count` del panel de uso quedó scopeado a tenant (antes contaba entre tenants).
- **Alertas (F5, #22)** — filtro por obra pasado al servidor + `limit`, en vez de traer todo y filtrar en el cliente (revierte la decisión original de Fase 7, ya no se sostenía con el volumen real).
- **Invitaciones (F9, #23)** — la pantalla de aceptar invitación muestra empresa/email/rol antes de confirmar.
- **Sidebar (F8, #24)** — se sacaron affordances muertas (switcher estático que no hacía nada); dejó paso al switcher real de empresa de Fase 4 del rediseño multi-tenant.
- **Upload (#25)** — `VITE_API_URL` faltante en `upload.ts`.
- **Infra (`chore/startup-validation-cors`, `chore/infra-whatsapp-cleanup`)** — validación de secretos obligatorios al arranque, CORS configurado por variable de entorno, rate-limit en el webhook de WhatsApp, limpieza de sesiones, Sentry y logging estructurado en JSON.
- **Auth (2026-08-03)** — refresh token con rotación real + logout que invalida el token.

### Files modified
Repositorios/servicios de `team`, `purchase_order`, `imports`, `bitacora`, `critical_path`, `admin`; `AlertasTab.tsx` + `api/alerts.ts`; `AcceptInvitePage.tsx`; `Sidebar.tsx`; `upload.ts`; `app/core/config.py`/`security.py` (nuevo); `app/integrations/whatsapp` (rate-limit); logging/Sentry init.

### Problems found
El backlog de la auditoría del 2026-07-17 tenía ~28 P1; este barrido cerró el subconjunto priorizado para la entrega de agosto (docs de handoff y backlog actualizados en `#53` y `#64` para no perder el resto).

### Validation
Cada PR con su propio test/verificación puntual (no hay una corrida consolidada registrada para todo el barrido); CI en verde en cada merge.

### Pending / next steps
Ver `docs/estado-proyecto-agosto-2026.md` y el backlog post-audit para lo que quedó fuera de este barrido.

---

## 2026-08-12 — Documentación técnica y figuras del IPI para la defensa

### Objective
Poner al día los diagramas técnicos y las capturas del IPI de cara a la defensa del 13/15 de agosto.

### Changes made
- Diagramas actualizados: DER, casos de uso, diagrama de estados y diagrama de secuencia del chatbot (`docs/diagramas/`).
- Se cablearon las 4 capturas faltantes (Figuras 2–5) en `docs/IPI-CONSTRUCTA.md` y se avanzó el resto del informe.

### Files modified
- `docs/diagramas/*.svg`
- `docs/IPI-CONSTRUCTA.md`

### Validation
Regeneración del DOCX con `build_ipi_docx.py` (diagramas rasterizados con `qlmanage`).

---

## 2026-08-15 — Defensa de tesis

Defensa de tesis rendida. Demo de 4 escenarios: Gantt, chatbot de WhatsApp, Bitácora IA, Presupuestos con análisis comparativo. Detalle completo (qué se resolvió en la sesión previa — Twilio, SDK de Anthropic, seed de datos — y cómo volver a levantar el entorno de demo) en la memoria de sesión `project_thesis_defense`.

---

## 2026-08-18 — Bitácora: procesar audio en background

### Objective
El webhook de Twilio quedaba bloqueado mientras se transcribía y analizaba una nota de voz larga, con riesgo de timeout en el proveedor.

### Changes made
Se movió el procesamiento del audio (transcripción + análisis IA) a una tarea en background: el webhook responde de inmediato y el resultado se aplica de forma asíncrona.

### Files modified
Módulo de bitácora (integración WhatsApp/Twilio + servicio de procesamiento de audio).

---

## 2026-08-18 a 2026-08-25 — Segunda auditoría sistemática (post-defensa) y su remediación

### Objective
Repetir el ejercicio de auditoría del 2026-07-17 sobre el sistema ya con la carga de features de la defensa, módulo por módulo, y cerrar los hallazgos priorizados antes de seguir sumando features.

### Changes made
- **Auditoría (11 reportes, `docs/auditoria/`)**: 01 login/usuarios/planes, 02 panel resumen, 03 tareas + bot WhatsApp, 04 responsables (User + Responsible + ObraTeamMember), 05 planos (PDFs técnicos), 06–11 alertas, historial, bitácora, equipo, admin, configuración.
- **Remediación cerrada de esta ronda:**
  - **Auditoría 02 (panel resumen)** — cierre completo (`#81`/`fix(panel-resumen)`).
  - **Auditoría 03 (tareas)** — cierre completo (`#82`/`fix(tareas)`).
  - **Auditoría 04 (responsables)** — se eliminó el concepto de "contratista" que había quedado suelto entre `User`/`Responsible`/`ObraTeamMember` (`#86`).
  - **Auditoría 05 (planos)** — hallazgos críticos de seguridad cerrados, versionado explícito de planos + guards que faltaban, y la pantalla pasó a mostrar planos versionados en vez de archivos sueltos (`#74`, `#75`, `#78`, y `#80` que ocultó "Nueva versión" a quien no puede subir).
  - **Auditoría 09** — reenvío de invitación pendiente + se dejó de exponer el token de invitación en la UI (`#83`); luego un segundo fix porque `is_verified` no tenía default seguro y el feedback de "email enviado" no reflejaba si realmente se había enviado (`#89`, 2026-08-26).
  - **Auditoría 10** — los conteos del panel admin quedaron siempre scopeados a tenant + enforcement real de `active_until`; el modal de límite distingue "plan vencido" de "límite de plan alcanzado" (`#84`).
  - **Auditoría 11** — settings pasaron a ser por tenant (antes globales), alertas de "prueba" reemplazadas por generación real, y se cerró una fuga en el endpoint de simular tareas vencidas (`#85`).
  - Fix relacionado de alertas: `notify_task_overdue` ahora también gatea el chequeo proactivo (antes solo el manual).
- También se aprovechó para sincronizar `IPI-CONSTRUCTA.md` con la última versión del DOCX y cerrar objeciones puntuales de la revisión de tesis (Presentación, Diagnóstico, Objetivos, Marco teórico).

### Files modified
Repositorios/servicios de responsables, planos, admin, configuración, alertas; `TaskFormModal`/`TaskTable` (auditoría 03); `ResumenTab` (auditoría 02); `docs/auditoria/*.md`; `docs/IPI-CONSTRUCTA.md`.

### Pending / next steps
Reporte 08 (bitácora): P0 cerrado el 2026-08-26; P1/P2 siguen abiertos. Reporte 06 (alertas) cerrado el 2026-08-26. Reporte 07 (historial) cerrado el 2026-08-27 (ver entradas más abajo).

---

## 2026-08-21 — Fix Gantt: flecha de dependencia superpuesta a la barra sucesora

### Objective
Cuando una tarea dependiente empezaba inmediatamente después de su predecesora (sin espacio entre barras), la flecha de dependencia SVG se dibujaba encima de la barra sucesora en vez de terminar prolijamente en su borde.

### Changes made
Iteración de varios estilos hasta converger en el definitivo: primero se probó un codo redondeado al entrar a la sucesora, luego un estilo minimal sin puntos de conexión, luego se volvió a los puntos pero más chicos, y la versión final dejó la sucesora solo con la punta de flecha (sin punto de conexión) y la línea más fina.

### Files modified
- `frontend/src/components/GanttTimeline.tsx` — geometría de las flechas SVG de dependencia.

---

## 2026-08-24 — Roles por obra y permisos granulares

### Objective
Hasta acá los permisos eran solo `admin`/`collaborator` a nivel tenant. Se agregó un sistema de roles a nivel obra para poder distinguir, dentro de una misma empresa, quién puede ver, editar o administrar cada obra puntual.

### Changes made
Sistema de roles por obra y permisos granulares (nueva capa de autorización además de `AdminUser`/`CurrentUser` a nivel tenant).

### Files modified
Backend: nuevo modelo/lógica de permisos por obra. Frontend: guards condicionados al rol en la obra activa.

### Pending / next steps
Revisar interacción con el rediseño multi-tenant (Fases 1-4, mergeado dos días después) para confirmar que los guards de rol por obra siguen siendo consistentes con `TenantMembership`.

---

## 2026-08-25 — Fix: colisión de revisión Alembic 0053 duplicada

### Objective
Dos ramas en paralelo generaron una migración `0053` cada una, con el mismo `down_revision` — Alembic no podía resolver una cadena lineal.

### Changes made
Se renumeró/resolvió la colisión de revisión duplicada y se actualizaron los tests que dependían de la migración 0054 (drop de `member_type`).

### Files modified
- `backend/alembic/versions/0053_*.py` (colisión resuelta)
- Tests rotos por el drop de `member_type` en la migración 0054.

---

## 2026-08-26 — Rediseño multi-tenant: identidad separada de membership

RESUELTO en la rama `feature/membership-table`, en 4 fases (mergeado a `main` en `#88`). Una misma persona (mismo email, misma password) ya puede pertenecer a varias empresas en Constructa — antes, invitar a alguien que ya tenía cuenta en otra empresa fallaba con 409 o duplicaba el `User`.

Detalle completo de las 4 fases (tabla `tenant_memberships`, corte de lecturas a `TenantMembership`, login/invite/switch-tenant reales, frontend de selección/switcher de empresa) y de la Fase 5 (limpieza de columnas vestigiales en `users`, diferida a propósito) está en la memoria de sesión `project_multitenant_email` — no se repite acá para no desincronizarse de esa fuente.

### Files modified (resumen)
- Migraciones `0056`-`0058`.
- `backend/app/services/auth_service.py`, `backend/app/api/routes/users.py`, `backend/app/core/deps.py`, `backend/app/core/obra_permissions.py`, `backend/app/core/plan_limits.py`, `backend/app/core/membership_context.py` (nuevo).
- `frontend/src/pages/LoginPage.tsx`, `AcceptInvitePage.tsx`, `components/Sidebar.tsx`.
- Fixes de acompañamiento el mismo día: `/auth/register` mostraba `role=collaborator` para el admin recién creado; `ComprasTab` filtraba contratistas por un `member_type` que ya no existe; la pantalla de selección de empresa no compartía layout con el login.

### Validation
Tests de aislamiento de tenant y de límites de plan actualizados con fixtures de `TenantMembership` espejo (mismo patrón en `test_tenant_isolation.py`, `test_plan_limits.py`, etc.).

### Pending / next steps
Fase 5 (drop de columnas vestigiales en `users`) queda deliberadamente pendiente — ver memoria `project_multitenant_email` para el criterio de cuándo retomarla.

---

## 2026-08-26 — Cierre de la auditoría 06 (Alertas)

### Objective
Cerrar `docs/auditoria/06-alertas.md`, la única de las 11 auditorías de la ronda post-defensa que quedaba sin remediación explícita. Antes de tocar nada se comparó cada hallazgo contra el código actual, porque commits posteriores a la auditoría (`#89`/`#90`, cierre de la auditoría 11) ya habían resuelto parcialmente el hallazgo 8.1 (notify_task_overdue) y 8.2/8.8 sin mencionar la 06 explícitamente.

### Changes made
- **8.1 (P0) Auto-resolve TASK_OVERDUE incompleto** — ya se resolvía DELAY_RISK al cambiar responsable/fecha vía `update()` HTTP, pero TASK_OVERDUE nunca se auto-resolvía y el path del chatbot (`apply_status_update()`) no disparaba ninguna resolución. Ahora: `update()` también resuelve TASK_OVERDUE al empujar `due_date` a futuro, y `apply_status_update()` resuelve TASK_OVERDUE + DELAY_RISK "vencida" al completar o cancelar la tarea (el caso que importaba: cerrar una tarea vencida por WhatsApp dejaba el badge del header elevado para siempre).
- **8.4 (P1) DELAY_RISK puramente reactivo** — nuevo método `AlertService.evaluate_task_risks_for_all_obras()` + job en `scheduler.py` cada 4 horas. Antes, una obra sin tráfico (nadie abría el tab Tareas/Gantt) nunca generaba alertas aunque tuviera tareas vencidas o bloqueadas.
- **8.3 (P1) Dos implementaciones de ventana de envío** — `_within_send_window()` de `message_service.py` (offset AR fijo, sin mirar el día) se unificó con `calendar_service.py` como `is_within_send_window()`: ahora también rechaza fines de semana y feriados nacionales antes de mandar un recordatorio de bitácora.
- **8.5 (P1) Toast único pierde alertas** — `useGlobalAlerts` pasó de un `toastAlert` de slot único a una cola (`toastQueue`); dos alertas críticas seguidas ya no se pisan.
- **8.7 (P2) Sin tenant check en el auto-resolve** — `mark_read_by_task_and_fragment/_and_type/_by_task` en `alert_repository.py` ganaron un `tenant_id` opcional, y todos los callers internos de `task_service.py` ahora lo pasan.
- **8.6 (P2) Sin paginación en la carga inicial** — `useGlobalAlerts` pasó a pedir `unread_only=true` al montar (la campana solo muestra no leídas de todos modos).
- Confirmado sin cambios: 8.2 (`notify_*`) y 8.8 (columna `tenant_id` denormalizada) ya estaban resueltos por `#89`/`#90`; 7.7 (rol mínimo para marcar alertas leídas) ya estaba resuelto por el sistema de roles por obra del 2026-08-24.

### Files modified
`backend/app/services/task_service.py`, `backend/app/services/alert_service.py`, `backend/app/repositories/alert.py`, `backend/app/core/scheduler.py`, `backend/app/services/calendar_service.py`, `backend/app/services/message_service.py`, `frontend/src/hooks/useGlobalAlerts.ts`. Test nuevo: `backend/tests/test_audit06_alertas.py` (9 casos). Un test de regresión estructural (`test_responsibles_audit_04.py::test_send_window_not_used_in_inbound_path`) se actualizó para reflejar el nuevo nombre/ubicación de la función.

### Validation
Suite completa de backend: 295 passed, 1 failed (falla pre-existente y ambiental — `test_webhook_missing_account_sid_returns_200_with_twiml`, reproducida también en `main` antes de este cambio, no relacionada). `npx tsc --noEmit` en frontend sin errores.

### Pending / next steps
No quedó nada abierto de la auditoría 06. La cola de toasts (8.5) y la carga con `unread_only` (8.6) no tienen verificación en navegador registrada en esta sesión — no hay infraestructura de tests de frontend en el repo (no hay vitest/jest configurado) y simular dos alertas críticas casi simultáneas requiere emitir eventos de socket a mano; quedó cubierto por revisión de código + `tsc` limpio.

---

## 2026-08-27 — Cierre de la auditoría 07 (Historial)

### Objective
Cerrar `docs/auditoria/07-historial.md`, la última de las 11 auditorías de la ronda post-defensa sin remediación (ningún commit previo la tocaba). El hallazgo más grande, 7.1, tenía un trade-off de diseño explícito en el documento (preservar vs. borrar en cascada); se consultó al usuario antes de implementar y se optó por **preservar y exponer**.

### Changes made
- **7.1/8.1 (crítico) Historial de obra borrada, inaccesible para siempre** — `ObraService.delete()` ahora loguea un evento `obra_deleted` con snapshot (nombre, estado, manager) ANTES de borrar la obra (mismo patrón que `task_deleted`). Se mantiene `ondelete="SET NULL"` en `obra_id` (no se cambió a CASCADE — se pierde igual el resto de eventos previos de esa obra, pero eso es un trade-off aceptado, no algo que se pueda evitar sin CASCADE en todo el módulo). Nuevo endpoint `GET /obras/historial/global` (solo admin, scopeado a tenant) recupera estos eventos huérfanos usando la columna `tenant_id` denormalizada, que sobrevive al `SET NULL` de la FK porque es una columna propia, no derivada. Nueva sección "Actividad de la empresa" en `ConfiguracionPage` (solo admin) que la muestra.
- **7.3/8.2 (alto) Responsables y baseline sin rastro** — `ResponsibleService.create/update/reactivate()` ahora loguean `responsible_created/updated/reactivated` (obra_id=None porque son del directorio global — `HistorialRepository.log()` ganó un parámetro `tenant_id` explícito para estos casos, ya que sin obra no hay forma de derivarlo). `POST /obras/{id}/baseline` loguea `baseline_saved`. Upload/delete de planos ya estaba cubierto desde la auditoría 05, no hizo falta tocarlo.
- **7.2/8.3 (alto) Frontend trunca a 30 sin avisar** — límite default subido a 100 (el servidor soporta hasta 200) y el contador del tab cambia a "mostrando los últimos 100" en vez de "100 eventos" cuando toca el límite.
- **7.4/8.4 (medio) Import MS Project XML — 50 eventos individuales** — `TaskService.create()` ganó `silent=True` para suprimir el evento individual (necesario para no reescribir el loop de `confirm_import`, que resuelve WBS/dependencias tipadas fila por fila y no encaja en `bulk_create`); after the loop se loguea un único evento agregado (`tasks_imported_from_msproject` o `tasks_bulk_imported` según `source`).
- **7.6/8.5 (medio) Sin refresh en tiempo real** — `HistorialRepository.log()` emite `historial_created` por Socket.IO desde un único punto central, cubriendo todos los tipos de evento sin instrumentar cada call site. Nuevo hook `useHistorialSocket` + wiring en `ObraDetailPage`.
- **7.7/8.6 (bajo) Descripciones en inglés** — `task_created`/`obra_created`/`obra_updated` pasaron a español (la última además dejó de mostrar el `repr()` de una lista Python).
- **7.8/8.7 (bajo) `ORDER_RECEIVED` sin `alert_created`** — agregado en `purchase_orders.py: receive_order()`, consistente con los demás tipos de alerta.
- **7.9/8.8 (bajo) Código muerto** — se borró el `case "task_rescheduled"` de `HistorialPanel.tsx` (ningún servicio genera ese `event_type`; el backend usa `task_updated`).
- **7.10/8.9 (bajo) Índice compuesto** — migración 0061: `(obra_id, created_at DESC)` en `historial_eventos`.
- De paso: el filtro "Tareas" del tab de historial no matcheaba `tasks_bulk_imported`/`tasks_imported_from_msproject` (el prefijo era `task_`, no `tasks_`) — se corrigió al agregar soporte visual para esos eventos.

### Files modified
Backend: `models/historial.py` (sin cambios de schema, solo el nuevo índice via migración), `repositories/historial.py`, `core/socket_manager.py`, `services/obra_service.py`, `services/responsible_service.py`, `services/task_service.py`, `api/routes/obras.py`, `api/routes/responsibles.py`, `api/routes/obra_team.py`, `api/routes/baseline.py`, `api/routes/purchase_orders.py`, `api/routes/imports.py`, `schemas/imports.py`, `alembic/versions/0061_historial_composite_index.py`. Frontend: `api/historial.ts`, `api/imports.ts`, `components/ImportModal.tsx`, `components/HistorialPanel.tsx`, `pages/ObraDetailPage.tsx`, `pages/ConfiguracionPage.tsx`, nuevo `hooks/useHistorialSocket.ts`. Test nuevo: `backend/tests/test_audit07_historial.py` (11 casos).

### Validation
Suite completa de backend: 307 passed (0 failed — la falla ambiental de Twilio de la sesión anterior no se reprodujo esta vez). `npx tsc --noEmit` en frontend sin errores. No se pudo verificar en navegador porque el puerto 8000 ya estaba ocupado por otra instancia del backend corriendo en la máquina — se evitó interferir con esa sesión.

### Pending / next steps
No quedó nada abierto de la auditoría 07. Verificación manual en navegador pendiente: crear una obra, generarle historial, borrarla y confirmar que aparece en Configuración → Actividad; disparar un import de MS Project XML con varias tareas y confirmar un solo evento agregado; tener el tab Historial abierto en dos pestañas y confirmar que una actualización de tarea aparece sin recargar.

---

## 2026-08-27 (cont.) — Cierre de la auditoría 08 (Bitácora), P1/P2 restantes

### Objective
Los 2 hallazgos P0 de `docs/auditoria/08-bitacora.md` ya se habían cerrado el 26/08 (`fix/bitacora-audit-p0`, junto con N2-N5). Quedaban el resto de P1 (§8.3, §8.5, §8.6) y los N6-N9 documentados en la adenda del propio archivo bajo "Pendiente para una próxima pasada". Se cerró todo ese resto en esta sesión.

### Changes made
- **§8.3 (P1) Sin rate limit por WhatsApp** — `_handle_bitacora_audio` ahora corta con un mensaje claro si el mismo `created_by` (solo staff puede mandar audio a bitácora desde la migración 0054) mandó ≥10 notas en la última hora, antes de gastar en Whisper/Claude.
- **§8.5 (P1) `BitacoraPage` no actualiza en tiempo real** — el evento `bitacora_created` (ya emitido por el backend) ahora se escucha en la página; refetchea con el límite actual para no perder páginas ya cargadas con "Cargar más".
- **§8.6 (P1) Excepción externa del background task no avisa** — el `except Exception` exterior de `_bg_process_entry` ahora manda un WhatsApp de error al emisor (antes el "te aviso enseguida" quedaba incumplido en silencio si fallaba algo como la DB).
- **N6 Reprocesar pisa sugerencias ya aplicadas** — `reprocess()` rechaza con 422 si la entrada está `procesado` y tiene alguna sugerencia `applied=True` (nada que perder si no hay ninguna aplicada, eso sigue permitido).
- **N7 Reprocesar es no-op silencioso sin audio en disco** — mismo endpoint, 422 explícito en vez de un 200 que no cambia nada.
- **8.7 (P2) AMR sin mensaje específico** — `_transcribe` detecta la extensión `.amr` cuando Whisper rechaza el archivo y da un mensaje puntual en vez del genérico "Error en el procesamiento: ...".
- **8.4 (P2) Sin paginación en el frontend** — `BitacoraPage` pasó de pedir 100 de una a páginas de 30 con botón "Cargar más" (`limit`/`offset`, que la API ya soportaba).
- **N8 Filtro "Solo pendientes" más angosto que la tarjeta** — unificado en un solo helper `entryNeedsAttention()` que usan tanto el filtro como `EntryCard`; de paso se corrigió que el filtro "Tareas" del historial tampoco matcheaba correctamente (ver entrada de la auditoría 07 arriba, mismo prefijo `tasks_` vs `task_`).
- **N9 Estado de edición no se resincroniza** — `SuggestionCard` refresca `edit` desde la sugerencia actual cada vez que se abre el editor, en vez de una sola vez al montar.
- Confirmado sin acción: §8.9 (permisos de collaborator en `apply/dismiss`) — el sistema de roles por obra del 24/08 ya lo resolvió con una decisión de producto razonable (mínimo COLABORADOR, no AdminUser), documentado como tal en la adenda §12.1 del propio audit.

### Files modified
Backend: `services/message_service.py` (rate limit + notify-on-exception), `services/bitacora_service.py` (mensaje AMR), `api/routes/bitacora.py` (guards N6/N7). Frontend: `pages/BitacoraPage.tsx` (tiempo real, paginación, N8, N9), `api/bitacora.ts` (limit/offset). Test: 5 casos nuevos en `backend/tests/test_bitacora.py` (15 en total en el archivo).

### Validation
Suite completa de backend: 312 passed. `npx tsc --noEmit` en frontend sin errores. No se verificó en navegador (mismo motivo que la entrada anterior — puerto 8000 ocupado por otra instancia).

### Pending / next steps
Con esto se cierran las 11 auditorías de la ronda post-defensa (`docs/auditoria/01` a `11`) — no queda ningún hallazgo documentado sin resolver o sin decisión explícita de producto.

---

## 2026-08-26 a 2026-08-28 — Planos por WhatsApp: bugs de producción y control de acceso

### Objective
La auditoría 05 (planos) se había cerrado el 21/08 con los 15 riesgos de su tabla resueltos, pero al probar el flujo real con Twilio aparecieron tres problemas que ninguna lectura de código había detectado: dos eran bugs de verdad y el tercero un límite de la plataforma que el sistema no comunicaba. En paralelo se cerró un pedido de producto: poder decidir rápido si un responsable puede pedir planos por WhatsApp.

### Changes made

**Desambiguación de obra rota (`#91`)** — Cuando un responsable trabaja en varias obras que tienen la misma disciplina cargada, el bot pregunta "¿de cuál obra?" y lista las opciones, pero el parser de la respuesta solo aceptaba un número (`re.search(r"\d+", body)`). Contestar con el **nombre** de la obra —lo más natural, dado que el propio mensaje lo ofrece como opción— no matcheaba nunca y repetía la pregunta en loop, sin entregar el plano jamás. Se reprodujo con datos reales del tenant 1 (obras "Edificio Norte" / "Edificio Norte — Demo", ambas con plano de arquitectura).
`_match_numbered_option()` ahora acepta número o nombre (insensible a mayúsculas y acentos, exacto o parcial si es inequívoco). **Un match exacto siempre gana sobre uno parcial**: sin esa prioridad "Edificio Norte" se volvía ambiguo por ser substring literal de "Edificio Norte — Demo" — caso borde encontrado al verificar contra los datos reales, no en la teoría. El mismo fix se aplicó al flujo análogo de selección de obra para bitácora, que tenía el mismo patrón.

**Descubribilidad del pedido de planos (`#91`)** — Un responsable podía no enterarse nunca de que podía pedir planos: el staff sí tenía un menú explicativo (`_staff_menu`), pero los responsables no. Se agregó la mención con ejemplo de frase a `build_no_tasks_message` — el único punto del flujo de responsables con margen para mencionarlo sin cortar un reporte en curso (el resto es una máquina de estados rígida, sin un "no entendí" genérico donde insertarlo). Se descartó explícitamente un menú numerado nuevo: obligaría a navegarlo a quien ya sabe escribir "plano de gas".

**Control de acceso a planos, decisión de producto (`#91`)** — Hasta acá, cualquiera del equipo de una obra podía pedir cualquier plano salvo que se le restringieran disciplinas una por una desde el modal de edición. Se agregó un interruptor de un click en la fila del responsable que alterna entre "Todos los planos" y "Sin acceso a planos", y un checkbox en el alta (tildado por default, en la misma fila del botón para no sumar altura al formulario). El default no cambió: quien se suma al equipo sigue teniendo acceso total salvo que se lo restrinja a mano.
Decisión de diseño: cuando el responsable tiene disciplinas puntuales asignadas, el click **no alterna — abre el modal**. Alternar ahí borraría esa selección fina de un click y sin deshacer.

**Bug destapado por lo anterior (`#91`)** — El POST de `obra_team` hacía `plan_disciplines=payload.plan_disciplines or None`. Como `[]` es *falsy* en Python, dar de alta a alguien **sin** acceso a planos guardaba `None` — es decir, acceso total, exactamente lo contrario de lo pedido. Llevaba tiempo latente porque ninguna UI mandaba `[]` al crear; recién apareció al existir el checkbox. El PATCH ya lo manejaba bien (de paso se simplificó ahí una condición redundante `x if x != [] else []`).

**Planos demasiado pesados para WhatsApp (`#99`)** — Un plano de más de 16 MB se sube y se descarga bien desde la web, pero Twilio lo rechaza al entregarlo (error `63019`) y el responsable en obra no recibe **nada**: ni el archivo ni un aviso. Twilio acepta el mensaje y falla *después*, al bajar el media, así que tampoco quedaba registro en el envío. Se diagnosticó consultando el estado real de los mensajes en la API de Twilio: el plano que fallaba pesaba 19,5 MB (un PNG) y el que funcionaba 169 KB.
No se bloquea la carga (el tope sigue en 25 MB y el plano sirve igual para descargar). Se avisa en los tres momentos en que uno pesado puede entrar: al elegir el archivo en el modal, después de subir una nueva versión (ese flujo no tiene modal, es click y sube), y con un badge permanente en la fila. El umbral vive en el backend (`WHATSAPP_MAX_BYTES`) y se expone como el campo calculado `too_big_for_whatsapp` para no duplicar la regla.
Se **descartó** avisarle al usuario por WhatsApp cuando pide un plano muy pesado: los responsables que usan el bot no tienen acceso a la aplicación, así que un mensaje del tipo "descargalo desde el sistema" no les sirve. Queda como brecha conocida: quien pide un plano de más de 16 MB sigue recibiendo silencio.

### Files modified
Backend: `services/message_service.py` (`_match_numbered_option`, ambos flujos de selección de obra), `services/message_templates.py`, `services/plano_service.py` (`WHATSAPP_MAX_BYTES`), `schemas/plano.py`, `api/routes/planos.py`, `api/routes/obra_team.py`. Frontend: `components/ObraResponsablesTab.tsx` (interruptor + checkbox de alta), `components/PlanosTab.tsx` (avisos de tamaño), `types/index.ts`. Tests nuevos: `test_whatsapp_planos_desambiguacion.py` (11 casos), `test_obra_team_plan_disciplines.py` (5 casos), + 3 casos de tamaño en `test_planos.py`.

### Validation
Suite completa de backend: 315 passed. `npx tsc -b` sin errores. Verificado en navegador: los tres estados del badge de acceso, el interruptor persistiendo en la base, el modal abriéndose en el caso de disciplinas puntuales, un usuario `solo_lectura` viendo los badges sin poder tocarlos, y los avisos de tamaño con un archivo de 18 MB. El flujo del bot se verificó de punta a punta contra Twilio real una vez que se renovó el sandbox.

Se verificó además que el test del `[]` **falla** si se reintroduce el `or None`, para confirmar que la protección es real y no decorativa.

### Pending / next steps
- **Compresión automática de planos pesados** — evaluada y postergada por decisión de alcance. Para imágenes (PNG/JPG) es sencilla con Pillow y cubriría el caso real observado; para PDFs requiere Ghostscript o `pikepdf` y tiene un riesgo concreto: comprimir mal un plano vectorial arruina la legibilidad de las cotas, que es justamente lo que se necesita leer en obra. Quedaría además por decidir si el archivo comprimido reemplaza al original o convive como copia liviana solo para WhatsApp.
- **Nota de infraestructura detectada en el camino:** `npx tsc --noEmit` **no chequea nada** en este repositorio — el `tsconfig.json` raíz tiene `"files": []` y solo referencias, que no se siguen sin `--build`. El comando correcto es `npx tsc -b`. Varias entradas previas de esta bitácora reportan "tsc sin errores" usando el comando que no verifica; si hay verificación de tipos en integración continua, conviene revisar que use `-b`.

---

## 2026-08-28 (cont.) — Cierre de la brecha de tamaño: el bot ahora explica

### Objective
La entrada anterior dejó declarada una brecha: se avisaba a quien **carga** un plano de más de 16 MB, pero el responsable que lo **pedía** desde la obra seguía recibiendo silencio absoluto. Al revisarla se concluyó que estaba a medio resolver — el aviso de la interfaz protege a quien tiene acceso a la aplicación, que es justamente quien menos lo necesita.

### Changes made
`_format_plano_reply` verifica el tamaño **antes** de construir la URL firmada. Si el plano excede el límite, devuelve el mismo encabezado de siempre (disciplina, sector, versión y fecha) más la explicación, y **sin `media_url`** — así no se le pide a Twilio un envío que va a rechazar. Antes se le pasaba la URL igual: Twilio aceptaba el mensaje, fallaba después al bajar el media (error 63019) y el usuario no recibía nada, ni siquiera el texto.

El mensaje resultante:

> 📐 Plano de electricidad — Tablero principal (v3, 27/08/2026).
>
> ⚠️ No te lo puedo mandar por acá: pesa 19.5 MB y WhatsApp no permite archivos de más de 16 MB. Pedíselo al jefe de obra.

Decisión de redacción: **no deriva a la aplicación web**. Quien pide un plano por WhatsApp es, por definición, alguien que no tiene acceso a ella —fue el motivo por el que se descartó la primera versión de este aviso—, así que la única salida accionable desde la obra es pedírselo a quien sí lo tiene. Hay un test que verifica esa restricción explícitamente, buscando las formas en que el mensaje podría nombrar la aplicación.

Se verificó que este es el **único** punto del sistema que envía media por WhatsApp, de modo que no quedan otros flujos con el mismo problema latente.

### Files modified
Backend: `services/message_service.py`. Tests: 2 casos nuevos en `test_whatsapp_planos_desambiguacion.py` (13 en total). Documentación: `IPI-CONSTRUCTA.md` (fila 10 de trazabilidad, que declaraba la brecha abierta) y `auditoria/05-planos.md` (§D.3, que la declaraba aceptada).

### Validation
Suite completa: 317 passed. `npx tsc -b` sin errores. Se comprobó que el test **falla** si se neutraliza la condición de tamaño, para confirmar que la protección es efectiva y no decorativa. El mensaje final se verificó ejecutando la función con los datos del plano real que originó el hallazgo (19,5 MB).

### Pending / next steps
Queda fuera de alcance **entregar** el plano igualmente, es decir la compresión automática: viable para imágenes con Pillow, riesgosa para PDF vectorial porque comprimir de más arruina la legibilidad de las cotas. Con este cambio el usuario al menos entiende qué pasó y sabe a quién recurrir, que era el vacío real.

---

## 2026-08-31 — Limpieza del panel de Configuración: duplicados, herramientas de dev y badges falsos

### Objective
El usuario reportó que la sección "Calendario laboral" de Configuración se ve rota (un `<select>` desplegado con overlay oscuro tapando toda la tarjeta) y desconfió de que estuviera en ese lugar, notando además que Configuración es accesible sin ninguna obra seleccionada (desde el panel principal), lo cual no encaja con una feature que es *por obra*. La revisión se extendió a discutir qué debería ser configuración global vs. por obra, y de ahí a la sección "Testing" (Probar WhatsApp / Simular tarea vencida) y al módulo de Automatizaciones y Alertas.

### Changes made

**Calendario laboral — duplicado eliminado (no relocalizado).** El componente `CalendarSection` en `ConfiguracionPage.tsx` llamaba a `fetchCalendar(selectedObraId)` con un selector de obra propio, redundante y confuso al no haber obra en contexto. Se encontró que `GanttSettingsDrawer.tsx` ya implementa exactamente la misma funcionalidad (días laborables, horario, excepciones, feriados) recibiendo `obraId` como prop, sin selector, correctamente scoped desde el Gantt de cada obra. No hizo falta construir nada nuevo: se eliminó la versión global completa (función, card, entrada del índice, imports que quedaban sin uso).

**Sección "Testing" eliminada de raíz.** Se determinó que "Probar mensaje WhatsApp" y "Simular tarea vencida" no le sirven a un usuario final — son herramientas de QA que en el mejor caso confunden y en el peor generan alertas falsas o mandan un WhatsApp real a un número al azar. Estaban ocultas en el frontend por `import.meta.env.DEV`, pero el backend nunca validaba ese modo: cualquier admin podía pegarle directo a `POST /settings/test-whatsapp` o `/settings/simulate-overdue` en producción (brecha ya señalada en `docs/auditoria/11-panel-configuracion.md` y no resuelta hasta ahora). Se eliminaron ambos endpoints por completo — no se los gateó, se los sacó —, confirmado con `curl` (404 tras el cambio). La lógica real que usaban (`NotificationService.mark_overdue_tasks`, `send_whatsapp_message`) sigue viva vía el cron del scheduler, que es su único consumidor legítimo. Dos tests (`test_settings_per_tenant.py`) dependían del endpoint HTTP para ejercitar esa lógica; se migraron a invocar el servicio directamente, lo cual de paso deja el test menos acoplado a una ruta que ya no existe.

**Dos badges de Automatizaciones no reflejaban el comportamiento real del backend** (encontrado auditando el módulo a pedido del usuario, con alcance acotado a "mantenerlo global, revisar lo que hay" tras descartar overrides por obra por falta de un caso de uso concreto):
- "Alertar sin respuesta" mostraba `24h` fijo en el badge, sin importar el valor real de `max_response_hours` (configurable en 6/12/24/48/72h). Pasa a ser dinámico.
- "Reintentar envío fallido" decía `×3`; el backend (`notification_service.py:mark_no_response`) reintenta **una sola vez** por recordatorio sin respuesta (un chequeo booleano, no un contador). Corregido a `×1`.
- Ese mismo toggle no se deshabilitaba cuando "Recordatorios automáticos" está apagado, pese a que el backend ya lo bloquea en ese caso (`if cfg.retry_failed and cfg.auto_reminders`). Se le agregó el mismo `disabled={!form.auto_reminders}` que ya tenían los otros dos recordatorios.

Se revisaron también los 4 toggles de "Configuración de alertas" (`notify_task_overdue/blocked/no_response/rescheduled`): los cuatro están correctamente conectados a sus servicios (confirmado por comentarios en el código citando la Auditoría 11 y por los tests existentes), así que no hicieron falta cambios ahí — el hallazgo de "campos decorativos" de esa auditoría ya estaba resuelto de antes.

### Files modified
Backend: `api/routes/settings.py` (elimina `test_whatsapp`/`simulate_overdue`), `schemas/settings.py` (elimina `TestWhatsAppRequest`), `services/notification_service.py` (docstring). Tests: `tests/test_settings_per_tenant.py` (2 tests migrados a llamar al servicio directo). Frontend: `api/settings.ts` (elimina `testWhatsApp`/`simulateOverdue`), `pages/ConfiguracionPage.tsx` (elimina `CalendarSection` completa y la sección Testing; corrige los dos badges de Automatizaciones).

### Validation
Suite completa de backend: 317 passed. `npx tsc --noEmit` sin errores (nota: para chequeo real de tipos en este repo hay que usar `tsc -b`, ver entrada del 2026-08-28 — se corrió también `-b` sin errores). Verificado en navegador con un usuario de prueba creado vía API: Configuración sin obra seleccionada ya no muestra "Calendario" ni "Testing" en el índice de secciones ni en el contenido; los endpoints eliminados devuelven 404; el badge de "Alertar sin respuesta" se actualiza en vivo al cambiar el select de horas; "Reintentar envío fallido" se deshabilita junto con "Recordatorio 1 día antes" al apagar "Recordatorios automáticos" (confirmado inspeccionando el DOM). Mergeado a `main` vía PR #103.

### Pending / next steps
Quedó sin resolver, por falta de un caso de uso concreto: si Automatizaciones/Alertas debería admitir *overrides* por obra (ej. pausar recordatorios en una obra específica) en vez de ser una única config por tenant. La arquitectura actual es así a propósito (Auditoría 11 corrigió el bug de que fuera por-manager), así que un cambio a overrides por obra requeriría una tabla de overrides + UI que distinga "usa el default de la empresa" vs. "personalizado en esta obra" — no se justifica sin un caso real. También quedó sin resolver la utilidad original de `main_responsible`/`company_phone` en Datos generales: no lo usa ningún servicio del backend hoy, el usuario recordaba que el teléfono tenía algún propósito pero no cuál, y no se encontró rastro en git history ni en comentarios — se dejó como está a pedido del usuario.

---

## 2026-09-03 — Detección de riesgo: las 11 reglas propuestas, implementadas

### Objective
La propuesta de reglas de riesgo (`docs/propuesta-reglas-riesgo.md`, PR #104) había quedado escrita y sin implementar. Su punto de partida era un desperdicio concreto: el sistema **ya calculaba o guardaba** ruta crítica con holgura por tarea, línea base, estado de materiales y órdenes de compra, calendario laboral con feriados e historial append-only, pero ninguno de esos datos se usaba para generar alertas. Las seis reglas existentes miraban solamente fechas de vencimiento y respuestas del chatbot. El objetivo fue llevar las once reglas a código, sin recortar alcance.

### Changes made

**Motor propio, separado del que ya existía.** Las reglas viven en un `RiskService` nuevo y no dentro de `AlertService`. El motivo es el costo: `evaluate_task_risks_for_obra()` corre en cada carga del dashboard de una obra y solo compara fechas en memoria; las reglas nuevas recalculan el CPM y leen línea base, materiales, órdenes, calendario e historial. Meterlas ahí habría hecho que abrir una obra dispare media docena de consultas pesadas. Un `RiskContext` carga esos insumos una vez por obra y **bajo demanda**: si la empresa apagó las reglas que usan el CPM, el CPM no se calcula.

**Las reglas se declaran como tabla, no como código suelto.** `RULES` mapea cada regla a su campo de configuración y su cadencia; agregar una es escribir el método y sumar una línea. Un test recorre la tabla y falla si una regla apunta a un campo de settings inexistente (quedaría apagada para siempre en silencio) o a una cadencia mal escrita (no la correría ningún job).

**Las once reglas.** Ruta crítica vencida o por vencer y holgura que se achica (§1); desvío de línea base (§2); material sin pedir, pedido sin confirmar y material que va a bloquear una tarea (§3); avance estancado (§4); vencimiento en día no laborable (§5); bloqueo recurrente y responsable crónicamente sin respuesta (§6); hito en riesgo (§7). El aporte no es la cantidad: es que el sistema pasa de avisar que algo **ya** salió mal a avisar que **va a** salir mal.

**Las dos piezas transversales que la propuesta marcaba como bloqueantes.** Severidad por alerta (`critica`/`alta`/`media`/`baja`, VARCHAR y no enum de PG para no pagar un `ALTER TYPE` por nivel nuevo) y configuración por empresa: un interruptor por regla más su umbral, 23 columnas en `system_settings`. Aprovechando eso, `_defaults()` del repositorio de settings pasó a resolver los valores por introspección del modelo: copiaba 14 campos a mano y un olvido habría devuelto `None` en un umbral, rompiendo una comparación numérica en silencio.

**Solo dos reglas necesitaron persistir estado, y por el mismo motivo:** comparan el presente contra el pasado. `tasks.last_progress_at` (sellado en `TaskRepository.update_fields()`, un único punto de paso que cubre edición manual, cambio de estado y chatbot, y solo si el avance cambió de verdad — reguardar con el mismo 40 % no debe reiniciar el reloj) y la tabla `task_risk_snapshots`, una fila por tarea con la holgura de la corrida anterior.

**Tres cadencias en vez de un job.** Cada 4 h las siete reglas que miran el estado de hoy; diaria las dos que comparan contra el snapshot de ayer; semanal las dos de patrón sobre historial. Una regla que compara contra el snapshot de ayer no cambia de resultado entre las 8 y las 12 del mismo día.

**Frontend: un solo origen de metadatos y color por severidad.** `AlertasTab`, `AlertBell` y `CriticalAlertToast` tenían cada uno su propio mapa exhaustivo de tipos; con 17 tipos, cada agregado obligaba a tocar tres archivos. Ahora salen de `lib/alertMeta.ts`. Y el color pasó a mandarlo la **severidad** y no el tipo: diecisiete colores sin jerarquía entre sí no le dicen al lector qué mirar primero. Consecuencia directa: el toast dispara por severidad (crítica/alta) en lugar de por una lista de dos tipos hardcodeada — para `task_blocked` y `task_overdue` el resultado no cambia, ambos son `alta`.

**Decisiones donde se corrigió la letra de la propuesta.** `material_pending_too_long` agrupa por tarea en vez de emitir una alerta por material (veinte materiales cargados el mismo día darían veinte alertas idénticas en intención, y el destinatario tiene una sola acción para todas). `material_blocking_task` incluye las tareas cuyo inicio ya pasó, donde el problema es peor y no menor. `baseline_deviation` solo alerta el atraso: adelantarse respecto de la línea base no es un riesgo. Y `order_sent_no_confirmation` y `chronic_no_response` van a nivel obra, porque su sujeto es un pedido o una persona, no una tarea.

**Una restricción que atraviesa todas las reglas:** los mensajes no llevan contadores volátiles. La dedup es por mensaje exacto contra alertas no leídas, así que un texto tipo "vence en 3 días" cambiaría a diario y cada corrida crearía una alerta nueva en vez de deduplicar. Está documentado en `emit()` para quien agregue reglas después. La única excepción es deliberada: `chronic_no_response` sí incluye la cuenta, porque pasar de 3 a 5 es un escalamiento que merece volver a avisar.

### Files modified
Backend: `services/risk_service.py` (**nuevo**), `services/alert_service.py` (`emit()` genérico; `_task_alert`/`_obra_alert` delegan ahí), `services/task_service.py` (`compute_critical_path_unchecked()`), `models/alert.py`, `models/settings.py`, `models/task.py`, `models/task_risk_snapshot.py` (**nuevo**), `repositories/alert.py`, `repositories/settings.py`, `repositories/task.py`, `core/scheduler.py`, `core/socket_manager.py`, `schemas/alert.py`, `schemas/settings.py`. Migraciones `0062`–`0064`. Frontend: `lib/alertMeta.ts` (**nuevo**), `types/index.ts`, `api/settings.ts`, `components/AlertasTab.tsx`, `components/AlertBell.tsx`, `components/CriticalAlertToast.tsx`, `hooks/useGlobalAlerts.ts`, `hooks/useAlertSocket.ts`, `pages/ConfiguracionPage.tsx`, `App.tsx`. Tests: `tests/test_risk_rules.py` (**nuevo**, 39 casos). Documentación: `docs/implementacion-reglas-riesgo.md` (**nuevo**, reporte de la implementación) e `IPI-CONSTRUCTA.md`.

### Validation
Suite completa: **356 passed** (desde 317). Los 39 tests nuevos cubren, además del disparo de cada regla, lo que la propuesta pedía sostener: dedup entre corridas, re-disparo de una alerta leída si la condición persiste, un evento de historial por alerta, el toggle que apaga una regla sin tocar las demás, y una regla que explota sin frenar al resto. `npx tsc -b` y `npm run build` sin errores; ESLint sin errores nuevos respecto de `main`.

**Verificación contra PostgreSQL real, no solo contra el SQLite de los tests.** Se creó una base aparte, se corrieron las migraciones y se sembró una obra con condiciones de riesgo: salieron 8 alertas de 7 reglas distintas, con 8 eventos de historial (la invariante se sostiene) y snapshots de holgura para las 7 tareas. **Eso destapó un bug que los tests no podían ver:** el backfill de la migración `0062` comparaba la columna enum `alert_type` contra parámetros varchar, y PostgreSQL no define ese operador — `alembic upgrade head` fallaba con `UndefinedFunctionError`. En SQLite el enum es un VARCHAR y la suite pasaba igual. Corregido con `type::text`. Es el mismo aprendizaje que ya había dejado la integración con Twilio, en otro plano: hay defectos que solo aparecen ejecutando contra el motor real.

### Pending / next steps
Queda la pasada visual en el navegador de la sección de Configuración y del listado de alertas con severidad. Tres pendientes de alcance, ninguno una regresión: (1) cuando una obra no tiene calendario configurado el repositorio devuelve uno de lunes a sábado, así que `deadline_conflicts_holiday` marca cualquier vencimiento en domingo — se dejó así por ser severidad baja y señal legítima, pero se acota fácil a que dispare solo con excepciones cargadas; (2) las once reglas notifican dentro de la aplicación, mandar las críticas por WhatsApp al jefe de obra es el paso natural siguiente y no estaba en la propuesta; (3) las reglas nuevas no se auto-resuelven cuando la condición desaparece, como sí hacen las seis anteriores vía `TaskService.update()` — el ciclo funciona igual por la dedup, pero cerrarlo mejoraría la señal.
