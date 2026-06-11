# CONSTRUCTA — Contexto completo para agentes

## Qué es el proyecto

CONSTRUCTA es una app de gestión de obras de construcción con un chatbot de WhatsApp integrado. Resuelve el problema de que la comunicación en obra es informal (WhatsApp, llamadas) y no queda registrada. El sistema conecta el plan de obra con el campo: los responsables reportan estado desde su WhatsApp de siempre, sin instalar ninguna app.

**Propuesta de valor:** "Seguís planificando igual que antes. CONSTRUCTA conecta el plan con el campo."

---

## Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Backend | FastAPI + SQLAlchemy 2.0 async + asyncpg + Socket.IO |
| ORM | SQLAlchemy con `Mapped[]` typing |
| Migraciones | Alembic |
| Base de datos | PostgreSQL (local: `constructa`) / SQLite para dev rápido |
| Frontend | React 19 + TypeScript + Vite + inline styles (NO Tailwind en producción) |
| Tipografías | Plus Jakarta Sans, JetBrains Mono |
| Colores primarios | `#FF6B35` (naranja acción), `#1A2329` (texto), `#1F8A5B` (éxito) |
| Tiempo real | Socket.IO (presencia, alertas, edición colaborativa) |
| Mensajería | Twilio / Evolution API (WhatsApp) |

---

## Cómo correr el proyecto

```bash
# Backend
cd backend
source .venv/bin/activate   # usar .venv (venv/ está incompleto, le faltan deps)
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Frontend
cd frontend
npm run dev   # corre en http://localhost:5173
```

El `app.main:app` es un Socket.IO ASGI que envuelve a FastAPI. El `app` final es el socketio.ASGIApp.

---

## Estructura del repo

```
CONSTRUCTA/
├── backend/
│   ├── app/
│   │   ├── api/routes/     # alerts, auth, baseline, calendar, critical_path,
│   │   │                   # events, exports, imports, notifications, obras,
│   │   │                   # presence, responsibles, settings, tasks, uploads,
│   │   │                   # users, webhooks
│   │   ├── core/           # config, database, deps, scheduler, security, socket_manager
│   │   ├── models/         # alert, baseline, calendar, conversation_session,
│   │   │                   # historial, message, obra, responsible, settings, task, user
│   │   ├── repositories/
│   │   ├── schemas/
│   │   ├── services/
│   │   └── integrations/   # Twilio, WhatsApp
│   ├── alembic/versions/   # 20 migraciones (0001–0020)
│   └── venv/               # virtualenv (NO .venv)
├── frontend/
│   └── src/
│       ├── api/            # Un archivo por recurso
│       ├── components/     # GanttTimeline, ObraSetupWizard, TaskFormModal, etc.
│       ├── hooks/          # useAlertSocket, useTaskSocket, usePermission, useOnlineUsers
│       ├── pages/          # ObraDetailPage, PortfolioPage, LoginPage, etc.
│       └── types/          # index.ts con todos los tipos
├── docs/
│   ├── documentacion.md    # Bitácora de desarrollo (actualizar cada sesión)
│   └── database.md         # Schema completo de la BD
└── CLAUDE.md               # Este archivo
```

---

## Convenciones de código

### Backend
- **Nunca** llamar `session.commit()` dentro de un service o repository — el commit lo hace `get_db()`
- **Siempre** capturar el estado ANTES de cualquier operación con la session (ej: `old_status = task.status` antes de `update_status()`)
- Soft delete: `is_active = False`, nunca borrar filas
- `whatsapp_number` en Responsible es inmutable — es la clave del chatbot
- `HistorialEvento` es append-only — nunca editar ni borrar eventos
- `AdminUser` dep para endpoints de admin, `CurrentUser` para autenticados, `CurrentUserId` para solo el id

### Frontend
- Routing por estado (`App.tsx`): `selectedObra: Obra | null`, NO React Router
- Datos de una obra se cargan UNA SOLA VEZ al montar `ObraDetailPage` con `Promise.all`
- Inline styles (NO clases Tailwind en producción — el diseño usa CSS-in-JS inline)
- Familia tipográfica: `'Plus Jakarta Sans', sans-serif` (texto), `'JetBrains Mono', monospace` (código/IDs)
- Colores en variables inline, no hardcodeados en múltiples lugares

### Git
- Una rama por etapa del plan → PR a `main` → merge → tag
- Protocolo de entrega: antes de pushear, explicar qué cambió + checklist de verificación manual + esperar confirmación del usuario
- Rama principal: `main`

---

## Estado actual del código

### Backend — qué YA está implementado y funcionando

| Módulo | Estado |
|--------|--------|
| Auth JWT | ✅ Completo |
| Obras CRUD + wizard | ✅ Completo |
| Tasks CRUD | ✅ Completo |
| Responsables (per-obra) | ✅ Completo |
| Historial (append-only log) | ✅ Completo |
| Alertas real-time (Socket.IO) | ✅ Completo (5 tipos de alerta) |
| WhatsApp chatbot (reglas) | ✅ Completo |
| Presencia online (Socket.IO) | ✅ Completo |
| Dependencias M2M entre tareas | ✅ Completo (migration 0015+0018: 4 tipos FS/SS/FF/SF + lag_days) |
| WBS parent_task_id | ✅ Completo (migration 0017, modelo + schema) |
| Calendario laboral | ✅ Completo |
| Export Excel | ✅ Completo |
| Import Excel/CSV | ✅ Completo |
| **Ruta crítica CPM** | ✅ Completo (GET /obras/{id}/critical-path) |
| **Baseline / Línea base** | ✅ Completo (migration 0019, POST/GET /obras/{id}/baseline) |
| Roles admin/collaborator + guards | ✅ Completo |
| Invitaciones por email | ✅ Completo |
| Comitentes (client_name/email/phone) | ✅ migration 0020 en rama feature/obra-comitentes |

### Frontend — qué YA está implementado y funcionando

| Módulo | Estado |
|--------|--------|
| Login / Auth | ✅ |
| Portfolio (todas las obras) | ✅ |
| ObraDetailPage con 5 tabs | ✅ (Resumen, Tareas, Responsables, Alertas, Historial) |
| TaskTable (vista tabla) | ✅ |
| TaskSheetView (vista planilla inline editable) | ✅ |
| TaskFormModal (crear/editar tarea) | ✅ |
| ObraSetupWizard (4 pasos) | ✅ |
| GanttTimeline | ✅ Drag, resize, vistas semana/mes/trimestre, sticky columna izquierda |
| **Flechas SVG de dependencias en Gantt** | ✅ Ya implementado (showDependencies: true por defecto) |
| **Baseline en Gantt** | ✅ Ya implementado (toggle en GanttSettingsDrawer) |
| **Ruta crítica en Gantt** | ✅ Ya implementado (toggle highlightCritical en GanttSettingsDrawer) |
| GanttSettingsDrawer | ✅ Calendario laboral, toggles de vista |
| ImportModal | ✅ (Excel/CSV) |
| ObraResponsablesTab | ✅ |
| AlertasTab | ✅ |
| HistorialPanel | ✅ |
| Presencia online en header | ✅ |
| Comitentes en wizard + header obra | 🔄 En rama feature/obra-comitentes (pendiente merge) |

---

## Ramas activas

| Rama | Estado | Descripción |
|------|--------|-------------|
| `main` | Base | Código estable |
| `feature/obra-comitentes` | 🔄 Pendiente merge | Campos client_name/email/phone en obra, wizard step 1, header del detalle |

---

## Estado del roadmap (actualizado 2026-06-11)

**TODAS las fases del plan están implementadas y mergeadas a main:**
- Fase 1 completa (1.1 admin ✅, 1.2 comitentes ✅, 1.3 UX alerts ✅, 1.4 equipo global ✅, 1.5 visual polish ✅ tag `etapa-1.5-visual`)
- Fase 2 completa (2.1 Gantt+cascade ✅ tag `etapa-2.1-gantt`, 2.2 MS Project XML ✅ tag `etapa-2.2-msproject`, 2.3 onboarding ✅ tag `etapa-2.3-onboarding`)
- Fase 3 completa (planes/tenants/límites 402/panel admin ✅ tag `fase-3-monetizacion`)
- Fase 4 completa (materiales por tarea, tab Presupuesto, módulo Compras con envío WhatsApp/email, proveedores en Configuración ✅ tag `fase-4-compras`)
- Migraciones: hasta 0024. Los stashes históricos fueron incorporados y eliminados.

## Roadmap completo — Plan aprobado (histórico)

El plan tiene DOS componentes que trabajan juntos. El archivo completo está en:
`/Users/agustinllancaman/.claude/plans/tenemos-estas-ideas-y-proud-curry.md`

### FASE 1 — Base sólida

#### Etapa 1.1 — Seguridad y Panel Admin `feature/admin-security` ✅ MERGEADO
- Settings protegidos con `AdminUser`
- Endpoint `PATCH /users/{id}/role`
- Frontend: `AdminRoute`, sidebar oculta items a collaborators, selector de rol en EquipoPage

#### Etapa 1.2 — Comitentes en Obra `feature/obra-comitentes` 🔄 PENDIENTE MERGE
- Campos `client_name`, `client_email`, `client_phone` en `obras` (migration 0020)
- Wizard paso 1: sección comitente siempre visible
- ObraDetailPage: `client_name` en header con ícono de persona

#### Etapa 1.3 — UX Quick Wins `feature/ux-alerts-notifications`
**A) Campanita de alertas en header:**
- Ícono 🔔 con badge rojo numérico (count de alertas no leídas) en `AppLayout`/header
- Dropdown con las últimas 5 alertas al hacer click
- Badge actualizado en real-time vía WebSocket

**B) Toast de alertas críticas:**
- Cuando llega WebSocket de tipo `task_blocked` o `task_overdue`: toast en esquina inferior derecha (auto-dismiss 8s)
- Reutilizar o crear `AlertToast.tsx`

**C) Responsable inline en `TaskFormModal.tsx`:**
- Dropdown de responsable tira del equipo global (Etapa 1.4 lo habilita)
- Opción "+ Agregar persona nueva..." al final → mini-formulario inline
- Si directorio vacío: formulario expandido con texto "Todavía no hay nadie en el equipo"

**D) Alertas con trazabilidad en historial:**
- Al crear cualquier alerta (`alert_service.py`) → registrar automáticamente evento en historial
- Un solo evento por alerta (no contaminar el log)

#### Etapa 1.4 — Equipo global de la empresa `feature/global-team-members`
**Problema:** Responsables actuales son per-obra — si Juan trabaja en 5 obras, hay 5 registros duplicados.

**Nueva arquitectura:**
```sql
CREATE TABLE team_members (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(50),        -- E.164, clave del chatbot
  email VARCHAR(255),
  specialty VARCHAR(100),   -- "Hormigón", "Electricidad", "Arquitectura"
  is_active BOOL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE obra_team_members (
  team_member_id INT REFERENCES team_members(id),
  obra_id INT REFERENCES obras(id),
  role VARCHAR(100),        -- rol específico en esa obra
  PRIMARY KEY (team_member_id, obra_id)
);
-- Migrar tasks.responsible_id → apuntar a team_members.id
-- Deduplicar responsibles por nombre+teléfono al migrar datos
```

**Backend:** nuevo router `team.py` con CRUD de `team_members`, endpoint `POST /obras/{id}/team`
**Frontend:**
- Sección "Equipo de la empresa" en `ConfiguracionPage` (solo admin)
- Wizard paso 2: seleccionar del directorio global + crear inline
- `TaskFormModal`: dropdown tira de `team_members`, no de responsibles de la obra

**Impacto:** Elimina el problema de "primero creá un responsable". El directorio ya existe.

#### Etapa 1.5 — Diseño y visualización de tareas `feature/task-visualization-polish`
- `TaskSheetView`: zebra striping, resize de columnas, sticky header, íconos de estado, subtareas indentadas con línea vertical
- `TaskTable`: zebra, avatar de responsable, badge urgencia (amarillo/rojo por fecha), hover revela botones de acción
- Skeleton loaders reemplazando spinners genéricos
- Paleta de colores de estado unificada en todo el sistema

---

### FASE 2 — Módulo Obra enriquecido

#### Etapa 2.1 — Gantt: mejoras `feature/gantt-improvements`

**A) Sticky date header:**
- La fila de meses/semanas/días en el tope del Gantt debe quedar fija al hacer scroll vertical
- Actualmente el header de fechas NO es sticky al scroll vertical (solo la columna izquierda de nombres sí lo es)
- Implementar `position: sticky; top: 0; z-index` en el header de fechas dentro del área scrolleable

**B) Subtareas colapsables:**
- El modelo `parent_task_id` ya existe en BD y en UI del formulario
- Lo que falta: botón chevron para colapsar/expandir hijas en Gantt y en tabla
- Tarea padre muestra barra gruesa que abarca rango de sus hijas
- Estado de colapso persistido en `localStorage` por obra

**C) Flechas de dependencia:** YA ESTÁN implementadas — revisar y mejorar si es necesario:
- Tooltip al hover con tipo de dependencia (FS/SS/FF/SF) + lag en días
- Flecha roja si la dependencia está violada

**D) Cascade automático al cambiar fechas:**
- Al mover una tarea en Gantt o cambiar fechas: si tiene dependientes → dialog de confirmación
- Dialog: "Esta tarea tiene X tareas dependientes. ¿Reprogramarlas automáticamente?" [Sí] [No]
- Si confirma: backend `cascade_reschedule(task_id, new_start, new_finish, db)` BFS/DFS sobre grafo de dependencias
- Recálculo por tipo: FS→ `successor.start = predecessor.finish + lag`, SS→ `successor.start = predecessor.start + lag`, etc.
- Historial: UN SOLO evento "Se reprogramaron N tareas en cascada por [Tarea A]" (no uno por tarea)

#### Etapa 2.2 — Import MS Project XML `feature/msproject-import`
- Parser en `import_service.py` con `xml.etree.ElementTree`
- Mapeo: UID→tareas, OutlineLevel→parent_task_id (WBS), Resources+Assignments→responsible, PredecessorLink→dependency
- Frontend: `.xml` en file picker de `ImportModal`, badge "MS Project"
- Endpoint `GET /exports/template-excel` → `.xlsx` vacío con instrucciones
- Botón "Descargar plantilla" en ImportModal paso 1

#### Etapa 2.3 — Guía de completitud + Onboarding `feature/onboarding-checklist`
- `ObraCompletenessChecklist`: 5 criterios (imagen, comitente, responsables, tareas, fechas en tareas)
- Banner colapsable en `ObraDetailPage` cuando puntaje < 80%, items clickeables al tab correcto
- Modal de onboarding post primer login (localStorage `"onboarding_done"`): 3 pasos, botones Siguiente/Saltar

---

### FASE 3 — Planes y Monetización `feature/plans-monetization`

**Migraciones:**
```sql
CREATE TABLE plans (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50),       -- "basico", "pro", "enterprise"
  max_obras INT,          -- NULL = ilimitado
  max_users INT,
  max_tasks_per_obra INT,
  price_monthly NUMERIC(10,2)
);
CREATE TABLE tenants (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255),
  plan_id INT REFERENCES plans(id),
  owner_user_id INT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  active_until TIMESTAMPTZ
);
ALTER TABLE users ADD COLUMN tenant_id INT REFERENCES tenants(id);
ALTER TABLE obras ADD COLUMN tenant_id INT REFERENCES tenants(id);
```

**Planes:** Básico (3 obras/6 users/50 tareas), Pro (20/30/ilimitado), Enterprise (todo ilimitado)

**Backend:** `plan_limits.py` con `check_plan_limit()` → HTTP 402 en POST /obras, /users/invite, /tasks

**Frontend:**
- Sección "Tu plan" en `ConfiguracionPage` con barras de uso
- Modal de upgrade al llegar al límite
- Panel `/admin` (solo admin) con métricas del tenant

---

### FASE 4 — Presupuestos y Compras

**Decisión de arquitectura — Proveedores:** Gestionados desde `ConfiguracionPage` (solo admin), SIN página en sidebar.

#### Etapa 4.1 — Materiales por Tarea `feature/materiales-presupuesto`
```sql
CREATE TABLE task_materials (
  id SERIAL PRIMARY KEY,
  task_id INT REFERENCES tasks(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  quantity NUMERIC(10,3),
  unit VARCHAR(50),          -- "m2", "kg", "un"
  unit_price NUMERIC(12,2),
  supplier_id INT REFERENCES suppliers(id) ON DELETE SET NULL,
  status VARCHAR(20) DEFAULT 'pendiente'  -- pendiente/pedido/recibido
);
```
Frontend: tab "Materiales" en `TaskFormModal` (tabla inline editable)

#### Etapa 4.2 — Presupuesto por Obra
- Tab "Presupuesto" en `ObraDetailPage`
- Columnas: Tarea / Ítem / Cantidad / Precio unit. / Subtotal / Estado
- Comparar estimado vs real
- Exportar: `GET /exports/obras/{id}/presupuesto-excel`

#### Etapa 4.3 — Módulo Compras `feature/compras-proveedores`
- `purchase_orders` + `purchase_order_items`
- Flujo: "Generar pedido" desde materiales → enviar por WhatsApp/email al proveedor → confirmar recepción → alerta + historial

#### Etapa 4.4 — Proveedores
```sql
CREATE TABLE suppliers (
  id SERIAL PRIMARY KEY,
  tenant_id INT REFERENCES tenants(id),
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(50),
  category VARCHAR(100),  -- "electricidad", "hormigón", "materiales"
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```
Frontend: sección "Proveedores" en `ConfiguracionPage` (admin). Dropdown buscable al agregar material a tarea.

---

## Quick wins del plan MS Project (en paralelo con el roadmap operacional)

Estos son cambios pequeños que se pueden hacer en cualquier momento:

- **% Avance e Hito en TaskTable (30 min):** agregar columna 90px entre Estado y Responsable. Si `is_milestone` → ◆ naranja. Si no → mini barra + `{estimated_progress}%`
- **Duración calculada en TaskFormModal (1h):** input "días" entre fechas. Si cambio inicio+duración → calcula vencimiento. Si cambio vencimiento → recalcula duración mostrada.

Los siguientes del plan de paridad MS Project YA ESTÁN IMPLEMENTADOS:
- ✅ Flechas SVG de dependencias en Gantt (`showDependencies: true` por defecto)
- ✅ Export Excel (exports.py + botón en tab Tareas)
- ✅ Ruta crítica CPM (backend + toggle `highlightCritical` en Gantt)
- ✅ Baseline / Línea base (backend + toggle `showBaseline` en Gantt)
- ✅ Tipos de dependencia SS/FF/SF + lag (migration 0018, M2M table)
- ✅ WBS parent_task_id (migration 0017, dropdown en TaskFormModal)

Lo que falta del plan MS Project:
- UI de subtareas colapsables en Gantt y tabla (la data ya existe)
- Sticky date header en Gantt (la columna izquierda sí es sticky, el header de fechas no)
- Cascade automático al mover tareas con dependientes

---

## Archivos críticos por etapa

| Etapa | Backend | Frontend |
|-------|---------|----------|
| 1.2 (merge) | migración 0020, `obra.py`, `schemas/obra.py` | `ObraSetupWizard.tsx`, `ObraDetailPage.tsx`, `types/index.ts` |
| 1.3 | `alert_service.py`, `historial` repo | `AppLayout` o header, `TaskFormModal.tsx`, nuevo `AlertToast.tsx` |
| 1.4 | nueva migración, nuevo `team.py` router, migrar `responsible_id` en tasks | `ConfiguracionPage.tsx`, `ObraSetupWizard.tsx`, `TaskFormModal.tsx` |
| 1.5 | — | `TaskSheetView.tsx`, `TaskTable.tsx` |
| 2.1 | `task_service.py` (cascade_reschedule) | `GanttTimeline.tsx` (sticky header + cascade dialog + subtareas colapsables) |
| 2.2 | `import_service.py` (parser XML), `exports.py` | `ImportModal.tsx` |
| 2.3 | — | nuevo `ObraCompletenessChecklist.tsx` |
| 3.x | migraciones plans+tenants, `plan_limits.py`, nuevo `admin.py` | `ConfiguracionPage.tsx`, nuevo `AdminPage.tsx` |
| 4.x | migraciones 4 tablas, nuevos routers | `TaskFormModal.tsx` (tab materiales), `ConfiguracionPage.tsx` |

---

## Protocolo de trabajo por etapa

1. Crear rama desde `main` (`git checkout -b feature/nombre`)
2. Desarrollar
3. **Antes de pushear:** explicar qué cambió (archivos, lógica, endpoints) + dar checklist de verificación manual
4. **Esperar confirmación del usuario** antes de hacer `git push`
5. Push → PR → review → merge a `main`

---

## Documentación adicional

- `docs/documentacion.md` — bitácora completa de desarrollo (actualizar después de cada sesión)
- `docs/database.md` — schema completo de todas las tablas
- `docs/casos_de_prueba.md` — casos de prueba manuales
- `GUIA_EJECUCION_LOCAL.md` — instrucciones detalladas para levantar el proyecto
- `/Users/agustinllancaman/.claude/plans/tenemos-estas-ideas-y-proud-curry.md` — plan completo con todos los detalles técnicos
