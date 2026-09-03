# Análisis: Complementos — Responsables · Configuración · Calendario · Exports · Baseline · Eventos · Dashboard

> Módulo auditado: la "cola" de módulos que quedaban con cobertura liviana o sin auditar, para completar el 100% de las rutas del backend.
> Fecha: 2026-07-02 | Rama: `main`

---

## TL;DR

Esta tanda **confirma y agrava** el diagnóstico de los cuatro audits anteriores: el problema de aislamiento multi-tenant no era de dos o tres módulos, es **sistémico**. Calendario, Exports, Baseline, `obra_team` (list), Responsables (get) y SSE de eventos operan por `obra_id`/`responsible_id` con `CurrentUserId` **sin verificar el tenant**. Aparecen además dos gaps **de diseño de datos**: el `whatsapp_number` de un responsable es **único a nivel global** (dos empresas no pueden compartir un teléfono) y los **settings se guardan por `manager_id`, no por tenant** (no hay una configuración por empresa). Lo peor de la tanda: **Exports permite bajar a Excel las tareas de cualquier obra** conociendo su id — exfiltración cross-tenant en un click.

---

## 1. Responsables / Equipo global

### Qué funciona

| Aspecto | Estado |
|---------|--------|
| Crear/editar/reactivar/desactivar responsable **solo-admin** (`AdminUser`) | ✅ |
| Listar responsables **scopeado por tenant** (`tenant_id`) | ✅ |
| Directorio global de la empresa (reutilizable entre obras) + asignación por obra (`obra_team`) | ✅ |
| Soft-delete (`is_active=False`) + reactivación | ✅ |
| `whatsapp_number` como clave del chatbot | ✅ |

### Gaps detectados y cómo resolverlos

---

#### Gap 1 — `whatsapp_number` es único a nivel GLOBAL (bug multi-tenant)

**Impacto:** Alto

```python
whatsapp_number: Mapped[str] = mapped_column(String(20), unique=True, ...)
```

La constraint `unique=True` es sobre **toda la tabla**, no por tenant. Consecuencia: si la Empresa A registra a Juan con `+549...`, la Empresa B **no puede** agregar ese mismo número. En construcción es común que un mismo contratista/albañil trabaje para varias empresas — el sistema lo bloquea.

**Solución profesional:** unicidad **compuesta por tenant**:
```python
__table_args__ = (UniqueConstraint("tenant_id", "whatsapp_number", name="uq_responsible_tenant_phone"),)
```
(Ojo: el chatbot identifica al responsable por número; con unicidad por tenant, un inbound de WhatsApp podría matchear a dos responsables de distintos tenants — hay que resolver el ruteo del webhook por número + tenant. Es parte del mismo hardening.)

**Esfuerzo estimado:** 2-3h (migración + resolver el matcheo del webhook)

---

#### Gap 2 — GET/lookup y mutaciones no verifican el tenant del responsable

**Impacto:** Medio — seguridad

`GET /responsibles/{id}` y `/lookup` usan `CurrentUserId` sin chequear tenant; `update`/`deactivate` usan `AdminUser` pero no validan que el responsable **pertenezca al tenant del admin**. Un admin podría leer/editar/desactivar un responsable de otra empresa por id.

**Solución profesional:** filtrar por `tenant_id` en todas las operaciones por id (mismo helper de tenant del hardening).

**Esfuerzo estimado:** 1h

---

## 2. Equipo por obra (`obra_team`)

### Qué funciona

| Aspecto | Estado |
|---------|--------|
| Agregar/editar/quitar miembro de obra **solo-admin** | ✅ |
| Rol específico por obra + `tenant_id` al agregar | ✅ |
| FK CASCADE (se borra con la obra) | ✅ |

### Gaps detectados

- **Gap 1 (Alto, seguridad):** `GET /obras/{obra_id}/team` usa `CurrentUserId` sin verificar tenant → se lista el equipo de una obra de otra empresa por id. Mismo IDOR.
- **Gap 2 (Medio):** `add_team_member` toma el `tenant_id` del admin, pero conviene validar que la **obra** sea de ese tenant (si no, se agrega un miembro a una obra ajena).

**Esfuerzo estimado:** 1h

---

## 3. Configuración / Settings

### Qué funciona

| Aspecto | Estado |
|---------|--------|
| `GET/PATCH /settings` **solo-admin** | ✅ |
| Config del chatbot: `chatbot_enabled`, ventana horaria (`send_hour_from/to`), `max_response_hours`, `auto_reminders`, recordatorios | ✅ |

### Gaps detectados y cómo resolverlos

---

#### Gap 1 — Los settings van por `manager_id`, no por tenant

**Impacto:** Medio — inconsistencia multi-tenant

```python
class SystemSettings(Base):
    manager_id: Mapped[int]   # ← no tenant_id
```

La configuración se ancla al `manager_id`, no al tenant. Consecuencias posibles: dos admins de la misma empresa tienen **settings distintos** (¿cuál gobierna el chatbot?), o —si se resuelve como singleton— la config es ambigua/global. En un modelo multi-empresa, la configuración (horarios del bot, recordatorios) debería ser **una por tenant**.

**Solución profesional:** migrar `SystemSettings` a `tenant_id` (una fila por empresa), y que `get/patch` operen sobre `current_user.tenant_id`.

**Esfuerzo estimado:** 2-3h (migración + backfill de settings existentes por tenant)

---

#### Gap 2 — La página `ConfiguracionPage` concentra varias responsabilidades sin auditar como flujo

**Impacto:** Bajo

`ConfiguracionPage` mezcla proveedores, equipo, plan y ajustes. Cada pieza se auditó en su cluster, pero como **flujo unificado** conviene revisar consistencia de permisos (todo admin-only) y que cada sub-sección scopee por tenant.

**Esfuerzo estimado:** 1h (revisión)

---

## 4. Calendario laboral

### Qué funciona

| Aspecto | Estado |
|---------|--------|
| Calendario por obra (días laborales + excepciones/feriados) | ✅ |
| GET / PUT / POST excepciones | ✅ |
| Usado por el snapping de fechas de tareas y el Gantt | ✅ |

### Gaps detectados

- **Gap 1 (Alto, seguridad):** **todos** los endpoints del calendario usan `CurrentUserId` sin verificar tenant → leer/editar el calendario de una obra de otra empresa por id. Mismo IDOR.
- **Gap 2 (Bajo):** sin feriados nacionales precargados (ya notado en el audit del núcleo).

**Esfuerzo estimado:** 1h (tenant scope)

---

## 5. Exports (Excel)

### Qué funciona

| Aspecto | Estado |
|---------|--------|
| Export a Excel de las tareas de la obra (formato con estilos) | ✅ |
| Plantilla descargable vacía | ✅ |

### Gaps detectados y cómo resolverlos

---

#### Gap 1 — Export de tareas sin verificar tenant (exfiltración cross-tenant)

**Impacto:** Alto — seguridad (el peor de esta tanda)

`GET /exports/obras/{obra_id}/excel` usa `_user_id: CurrentUserId` sin chequear tenant. Cualquiera puede **descargar el cronograma completo de una obra de otra empresa** en Excel conociendo el `obra_id`. Es más grave que un read puntual: es un **volcado completo de datos** en un archivo.

**Solución profesional:** validar `obra.tenant_id == user.tenant_id` antes de generar el export.

**Esfuerzo estimado:** 30 min

---

## 6. Baseline (línea base)

### Qué funciona

| Aspecto | Estado |
|---------|--------|
| Guardar snapshot del cronograma (`POST /obras/{id}/baseline`) | ✅ |
| Recuperar la línea base para comparar planificado vs real (Gantt) | ✅ |

### Gaps detectados

- **Gap 1 (Alto, seguridad):** `save`/`get` baseline usan `CurrentUserId` sin verificar tenant → capturar/leer la línea base de una obra ajena. Mismo IDOR.
- **Gap 2 (Bajo):** una sola línea base por obra (se pisa al re-guardar). Los gestores serios permiten múltiples baselines con fecha (comparar contra distintos hitos). Roadmap, no urgente.

**Esfuerzo estimado:** 30 min (tenant) / 3-4h (múltiples baselines)

---

## 7. Eventos en tiempo real (SSE — `events.py`)

### Qué funciona

| Aspecto | Estado |
|---------|--------|
| Stream SSE por obra (`GET /events/obra/{id}`) para reflejar cambios del chatbot | ✅ |
| **Auth por JWT** (token por query param, porque `EventSource` no manda headers) | ✅ |
| Keepalive cada 25s, unsubscribe en el `finally` | ✅ |

### Gaps detectados y cómo resolverlos

---

#### Gap 1 — Acceso manager-only (over-restrictivo) + doble mecanismo de tiempo real

**Impacto:** Medio

```python
if not obra or obra.manager_id != user_id:
    raise HTTPException(403)
```

Como en el resto del sistema, el SSE exige ser el **manager** de la obra: un colaborador u otro admin del tenant no puede suscribirse. Además, el sistema ya tiene **Socket.IO** para tiempo real; este SSE es un **segundo mecanismo paralelo** (solo para cambios del chatbot). Mantener dos caminos de real-time duplica complejidad.

**Solución profesional:** cambiar el chequeo a tenant (no manager) y evaluar **unificar** el real-time en Socket.IO (emitir el evento del chatbot por la sala de obra ya existente), retirando el SSE.

**Esfuerzo estimado:** 1h (tenant) / 2-3h (unificar en Socket.IO)

---

#### Gap 2 — Token JWT en la query string (queda en logs)

**Impacto:** Bajo-Medio — seguridad

El token va como `?token=...` (limitación de `EventSource`). Los query params suelen quedar en logs de acceso, proxies y el historial del navegador.

**Solución profesional:** token de corta vida específico para SSE, o migrar ese real-time a Socket.IO (que ya manda el token por el handshake de auth, no por URL).

**Esfuerzo estimado:** incluido en la unificación de arriba

---

## 8. Dashboard (página)

### Qué funciona

| Aspecto | Estado |
|---------|--------|
| Vista agregada por obra: tareas + alertas + historial | ✅ |
| Reutiliza endpoints existentes (`fetchTasksByObra`, `fetchAlerts`, `fetchHistorial`) | ✅ |

### Gaps detectados

- **Gap 1 (heredado):** no agrega superficie nueva de backend, pero **hereda** los gaps de tenant de los endpoints que consume (tareas → IDOR, historial → fuga). Se arregla solo cuando se arreglen esos endpoints.
- **Gap 2 (Bajo):** `fetchAlerts()` trae todas las alertas del tenant y se filtran en el front por obra; a escala conviene un endpoint de alertas por obra.

---

## 9. Resumen: Fortalezas vs Debilidades

### Fortalezas

1. **Mutaciones sensibles gated por admin** (responsables, equipo por obra, settings).
2. **Directorio global de responsables** reutilizable + asignación por obra (buena arquitectura de equipo).
3. **SSE con auth JWT** y limpieza correcta de suscripciones.
4. **Export a Excel con formato** y plantilla descargable.

### Debilidades (ordenadas por impacto)

| # | Debilidad | Categoría |
|---|-----------|-----------|
| 1 | Export de tareas sin tenant → exfiltración cross-tenant en Excel | Seguridad |
| 2 | Calendario, Baseline, `obra_team` (list), Responsables (get) sin tenant | Seguridad |
| 3 | `whatsapp_number` único global → dos empresas no comparten teléfono | Diseño multi-tenant |
| 4 | Settings por `manager_id`, no por tenant | Diseño multi-tenant |
| 5 | SSE manager-only + token en query + duplica Socket.IO | Consistencia / Seguridad |

---

## 10. Prioridad de correcciones

### P0 — Seguridad (parte del hardening de autorización)

| Tarea | Qué cambiar | Esfuerzo |
|-------|-------------|---------|
| Tenant scope en Export a Excel | `routes/exports.py` | 30 min |
| Tenant scope en Calendario (GET/PUT/exceptions) | `routes/calendar.py` | 1h |
| Tenant scope en Baseline (save/get) | `routes/baseline.py` | 30 min |
| Tenant scope en `obra_team` (list) + validar obra del tenant | `routes/obra_team.py` | 1h |
| Tenant scope en Responsables (get/lookup/update/deactivate) | `routes/responsibles.py` | 1h |
| SSE por tenant (no manager) | `routes/events.py` | 1h |

### P1 — Diseño multi-tenant

| Tarea | Qué cambiar | Esfuerzo |
|-------|-------------|---------|
| `whatsapp_number` único por tenant + ruteo del webhook | `models/responsible.py` + migración + `message_service.py` | 2-3h |
| Settings por tenant (migrar de `manager_id`) | `models/settings.py` + migración + `settings_service.py` | 2-3h |

### P2 — Consolidación

| Tarea | Qué cambiar | Esfuerzo |
|-------|-------------|---------|
| Unificar real-time en Socket.IO (retirar SSE) | `routes/events.py`, `conversation_service.py` | 2-3h |
| Múltiples baselines con fecha | `models/baseline.py`, `baseline_service.py`, Gantt | 3-4h |
| Endpoint de alertas por obra | `routes/alerts.py`, `DashboardPage.tsx` | 1-2h |

---

## 11. Cierre — cobertura del 100% de las rutas

Con este documento, **todas** las rutas del backend quedaron auditadas: `admin, alerts, auth, baseline, bitacora, budgets, calendar, critical_path, events, exports, imports, notifications, obra_team, obras, planos, presence, purchase_orders, responsibles, settings, solicitudes, suppliers, task_materials, tasks, uploads, users, webhooks`.

El hallazgo transversal se **confirma y refuerza**: el aislamiento multi-tenant falta en ~**15 puntos** (tareas, materiales, cotizaciones, planos, historial, órdenes, alertas mark-read, salas de socket, servido de archivos, exports, calendario, baseline, obra_team-list, responsables-get, SSE) y hay **dos gaps de diseño de datos** (teléfono único global, settings por manager). Todo se resuelve con **un solo trabajo enfocado** —el "hardening de autorización"— acompañado de su set de tests de tenant. Es, sin discusión, el **P0 número uno** del proyecto antes de operar con más de una empresa.
