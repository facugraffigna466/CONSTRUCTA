# Auditoría 11 — Panel de Configuración

> Módulo auditado: `frontend/src/pages/ConfiguracionPage.tsx` (1 536 líneas) → endpoints bajo `GET/PATCH /settings`, `GET /settings/system-health`, `POST /settings/test-whatsapp`, `POST /settings/simulate-overdue`. Auditoría conducida con backend y DB en vivo.

---

## 1. Resumen ejecutivo

La pantalla de Configuración es la más larga del frontend (1 536 líneas) y cubre nueve secciones distintas. La mayoría de los toggles y campos **sí tienen efecto real** sobre el comportamiento del chatbot y las automatizaciones. La capa de permisos de backend es correcta: las cinco rutas están protegidas con `AdminUser` y devuelven 403 a colaboradores, confirmado en vivo.

No obstante, la auditoría encontró **cuatro problemas estructurales** que van más allá de bugs puntuales:

1. **Los settings están ligados al manager, no al tenant.** `SystemSettings` tiene FK `manager_id` (unique). Si un tenant tiene dos admins y cada uno gestiona obras distintas, cada obra responde a la configuración de su respectivo manager. Dos obras del mismo tenant pueden tener el chatbot con horarios completamente distintos. Verificado en vivo con dos admins en tenant 2.

2. **Cuatro campos de la sección "Alertas" son completamente decorativos.** `notify_task_overdue`, `notify_task_blocked`, `notify_no_response`, `notify_rescheduled` se persisten en BD pero ningún servicio los lee. El usuario los activa/desactiva sin ningún efecto.

3. **El botón "Simular vencidos" no tiene filtro de tenant.** `list_overdue()` en el repositorio de tareas no filtra por `tenant_id` → dispara alertas para todas las obras vencidas de todos los tenants del sistema. Es un endpoint de testing que actúa sobre producción.

4. **Dos botones de la sección WhatsApp no tienen manejadores.** "Reconectar" y "Ver registros" están renderizados sin `onClick` — son UI muerta.

---

## 2. Inventario de funcionalidad

| Función | Implementada | Funciona realmente | Archivo(s) |
|---------|-------------|-------------------|------------|
| `GET /settings` — cargar configuración del admin logueado | Sí | Sí | `settings.py:12`, `ConfiguracionPage.tsx:74` |
| `PATCH /settings` — guardar todos los campos | Sí | Sí | `settings.py:22`, `ConfiguracionPage.tsx:95` |
| Guard `AdminUser` en los 5 endpoints | Sí | **Sí — 403 confirmado en vivo para colaborador** | `settings.py:12,22,34,44,54` |
| `canEdit = usePermission("configuracion.edit")` (frontend) | Sí | Solo visual — no replica el guard del backend | `ConfiguracionPage.tsx:61`, `usePermission.ts:8` |
| Datos generales (company_name, email, phone) | Sí | Sí — se persisten y los usa WhatsApp bot en mensajes | `settings.py model` |
| Toggle chatbot_enabled | Sí | **Sí** — `message_service.py` lo comprueba antes de procesar cada mensaje | `message_service.py:~42` |
| Horario de envío (send_hour_from / send_hour_to) | Sí | **Sí** — `notification_service.send_reminders()` respeta la ventana | `notification_service.py:~38` |
| max_response_hours | Sí | **Sí** — `check_unanswered_reminders()` calcula el umbral con este valor | `notification_service.py:~80` |
| auto_reminders | Sí | **Sí** — guard en `send_reminders()` | `notification_service.py:~30` |
| reminder_3days / reminder_1day | Sí | **Sí** — dos condicionales separados en `send_reminders()` | `notification_service.py:~45-55` |
| alert_overdue | Sí | **Sí** — guard en `mark_overdue_tasks()` | `notification_service.py:~65` |
| alert_no_response | Sí | **Sí** — guard en `check_unanswered_reminders()` | `notification_service.py:~75` |
| retry_failed | Sí | **Sí** — controla reintento de mensajes fallidos | `notification_service.py:~90` |
| notify_task_overdue | Sí (UI + DB) | **NO** — ningún servicio lo lee | `settings.py model:~35` |
| notify_task_blocked | Sí (UI + DB) | **NO** — ídem | `settings.py model:~36` |
| notify_no_response | Sí (UI + DB) | **NO** — ídem | `settings.py model:~37` |
| notify_rescheduled | Sí (UI + DB) | **NO** — ídem | `settings.py model:~38` |
| Sección "Tiempo real" (Socket.IO presence) | Sí (UI) | **Parcialmente** — el campo `socketio_enabled` no existe en el modelo | `ConfiguracionPage.tsx:~1100` |
| `GET /settings/system-health` | Sí | **Sí** — devuelve estado real de DB y WhatsApp | `settings.py:34` |
| Botón "Reconectar" WhatsApp | Sí (UI) | **NO** — sin `onClick`, UI muerta | `ConfiguracionPage.tsx:1007` |
| Botón "Ver registros" WhatsApp | Sí (UI) | **NO** — sin `onClick`, UI muerta | `ConfiguracionPage.tsx:1008` |
| `POST /settings/test-whatsapp` | Sí | **Sí** — envío real confirmado (SID `SMb1f8d98...`) | `settings.py:44` |
| `POST /settings/simulate-overdue` | Sí | **Sí, pero cross-tenant** — sin filtro de tenant | `settings.py:54`, `task.py:list_overdue()` |
| Sección "Tu plan" (barras de uso) | Sí | Parcial — bug en barra de tareas (ver §7) | `ConfiguracionPage.tsx:1280-1340` |
| Modal de upgrade inline | Sí | Sí (visual) | `ConfiguracionPage.tsx:~1350-1420` |
| Sección Proveedores (CRUD) | Sí | Sí | `ConfiguracionPage.tsx:~1430` |
| Sección Calendario laboral | Sí | Sí | `ConfiguracionPage.tsx:~1480` |
| Sección Testing (solo DEV) | Sí | Parcial — gateada en frontend por `import.meta.env.DEV`, pero backend no valida el modo | `ConfiguracionPage.tsx:~1060` |

---

## 3. Permisos: frontend vs. backend

### Backend — correcto

Las cinco rutas están definidas con la dependencia `AdminUser` (implementada en `deps.py` como `require_admin()`, que verifica `current_user.role == "admin"` y lanza HTTP 403 si no).

Prueba en vivo con el token de `invite-ui-test@example.com` (rol collaborator, tenant 2):

```
GET  /api/settings           → 403 Forbidden  ✓
PATCH /api/settings          → 403 Forbidden  ✓
GET  /api/settings/system-health → 403 Forbidden  ✓
POST /api/settings/test-whatsapp → 403 Forbidden  ✓
POST /api/settings/simulate-overdue → 403 Forbidden  ✓
```

### Frontend — solo decorativo

`ConfiguracionPage.tsx:61` llama `usePermission("configuracion.edit")` y pone el resultado en `canEdit`. El flag se usa para deshabilitar campos y ocultar el botón "Guardar cambios". Pero:

- Si el colaborador desactiva JavaScript o usa `curl` directamente, el backend ya lo bloquea. ✅
- Si un colaborador accede a la ruta `/configuracion` en el navegador, **la pantalla se renderiza pero los campos aparecen deshabilitados**. No hay redirección ni mensaje de error — la experiencia es confusa.
- `usePermission` es un lookup sobre un objeto hardcodeado en el cliente (`ROLE_PERMISSIONS` en `usePermission.ts:8`). No hay validación de servidor.

### Conclusión de permisos

La seguridad real la pone el backend. El frontend añade UX (campos disabled) pero no es la línea de defensa. La ausencia de redirección para colaboradores es un problema de UX menor, no de seguridad.

---

## 4. Hallazgo: settings por manager, no por tenant

### La arquitectura

`SystemSettings` tiene `manager_id INT REFERENCES users(id) UNIQUE`. La tabla tiene **una fila por usuario admin**, no una por tenant.

Cuando el chatbot necesita la configuración de una obra, llama `SettingsRepository.get_for_obra(obra_id)`:

```python
select(SystemSettings)
.join(Obra, SystemSettings.manager_id == Obra.manager_id)
.where(Obra.id == obra_id)
```

La obra tiene una columna `manager_id` (FK al usuario que la creó/gestiona). La query busca el `SystemSettings` de ese usuario. Si ese usuario no tiene fila en `SystemSettings`, cae a `_defaults()` (hardcoded en el repositorio).

### El problema en un tenant con dos admins

Si en tenant 2 hay Admin A (gestiona obras 1, 3, 5) y Admin B (gestiona obras 2, 4, 6):

- Admin A activa/desactiva el chatbot, cambia horarios → afecta obras 1, 3, 5.
- Admin B tiene su propia fila en `SystemSettings` o cae a `_defaults()` → obras 2, 4, 6 responden a otra configuración.

**Verificado en vivo:**

```
Admin A (user_id=1):  PATCH /settings → chatbot_enabled=false, send_hour_from=9, send_hour_to=17
Admin B (user_id=51): PATCH /settings → chatbot_enabled=true,  send_hour_from=6, send_hour_to=22

GET /obras/16/tasks → get_for_obra(16) → chatbot=false, 9-17  (obra de Admin A)
GET /obras/17/tasks → get_for_obra(17) → chatbot=true,  6-22  (obra de Admin B)
```

Dos obras del mismo tenant, comportamiento completamente distinto, sin que el tenant lo sepa.

### El caso del segundo admin sin configurar

Si Admin B nunca abrió la pantalla de Configuración (no tiene fila en `SystemSettings`), `get_for_obra()` devuelve `_defaults()`:

```python
def _defaults() -> SystemSettings:
    return SystemSettings(
        manager_id=0,
        chatbot_enabled=True,
        send_hour_from=8,
        send_hour_to=20,
        ...
    )
```

Las obras de Admin B operan con los defaults hardcodeados, **ignorando cualquier configuración que Admin A haya hecho para el tenant**.

### Impacto

- Un tenant que crea una segunda obra y asigna un segundo admin **pierde silenciosamente la configuración** que estableció para la primera obra.
- No hay indicación en la UI de que la configuración es personal, no del tenant.
- El WhatsApp bot puede enviar mensajes en horarios distintos dependiendo de a qué obra pertenece la tarea.

---

## 5. Duplicación con Panel Admin

Ambas pantallas llaman `GET /admin/usage` y muestran barras de consumo del plan:

| Pantalla | Dónde | Qué muestra |
|----------|-------|-------------|
| `AdminPage.tsx` | Tab lateral "Admin" | Obras: N/max · Usuarios: N/max · Tareas: N total (sin límite global) |
| `ConfiguracionPage.tsx` | Sección "Tu plan" | Obras: N/max · Usuarios: N/max · Tareas: N/**max_por_obra** |

La barra de tareas en `ConfiguracionPage` es la más problemática (ver §7). Fuera de eso, la duplicación no tiene inconsistencias funcionales — ambas páginas leen el mismo endpoint en tiempo real. No hay caché compartida ni sincronización de estado entre las dos pantallas.

El único costo real es la doble llamada HTTP al cargar cada pantalla. Para los volúmenes actuales es negligible.

---

## 6. Qué tiene sentido como está

### Chatbot y automatizaciones — bien implementado

Los doce campos que controlan el comportamiento del chatbot y los schedulers están correctamente integrados en el backend:

- `chatbot_enabled` → primer check en `message_service.py` antes de procesar cualquier mensaje entrante.
- `send_hour_from` / `send_hour_to` → ventana de envío en `notification_service.send_reminders()`.
- `max_response_hours` → umbral para alertas de sin-respuesta.
- `auto_reminders`, `reminder_1day`, `reminder_3days` → tres condicionales en `send_reminders()`.
- `alert_overdue`, `alert_no_response`, `retry_failed` → guards en sus respectivos flows.

Cada uno de estos se lee via `get_for_obra(task.obra_id)` o `get_for_responsible(responsible_id)`. El binding es correcto; el problema es que el "por obra" resulta en "por manager del creador de la obra" (ver §4).

### Guard de backend robusto

Todas las rutas de settings usan `AdminUser` y devuelven 403 correctamente. No hay rutas de settings accesibles a colaboradores.

### Sección de testing restringida al DEV build

La sección "Testing" en `ConfiguracionPage.tsx` está gateada por `import.meta.env.DEV` en el frontend. En un build de producción (`npm run build`), esos botones no aparecen en el HTML generado.

### System Health en tiempo real

`GET /settings/system-health` devuelve estado actual de DB y WhatsApp:

```json
{
  "backend": true,
  "database": true,
  "whatsapp_configured": true,
  "whatsapp_number": "+14155238886"
}
```

Útil para diagnóstico sin necesidad de acceso a logs del servidor.

### Sección Proveedores y Calendario laboral

Ambas secciones funcionan y no tienen anomalías encontradas. Proveedores tiene CRUD completo con validación. Calendario laboral se usa correctamente en el cálculo de duraciones del Gantt.

---

## 7. Qué no tiene sentido, está a medias o no funciona

### 7.1 Cuatro campos decorativos en "Configuración de alertas"

Los campos `notify_task_overdue`, `notify_task_blocked`, `notify_no_response`, `notify_rescheduled` existen en:

- `SystemSettings` model (`settings.py`)
- `SettingsRead` / `SettingsPatch` schemas
- `_defaults()` function
- `ConfiguracionPage.tsx` UI (4 toggles en la sección "Alertas")

**No aparecen en ningún servicio del backend.** Grep exhaustivo sobre todo el código Python:

```
grep -r "notify_task_overdue\|notify_task_blocked\|notify_no_response\|notify_rescheduled" backend/app/
```

Resultados: solo `models/settings.py`, `schemas/settings.py`, `repositories/settings.py`. Cero menciones en `services/`, `api/`, `integrations/`.

El usuario puede activar o desactivar estos toggles. La BD guarda el valor. Nada lo consume.

### 7.2 Botones "Reconectar" y "Ver registros" sin onClick

`ConfiguracionPage.tsx:1007-1008`:

```tsx
<button style={...}>Reconectar</button>
<button style={...}>Ver registros</button>
```

Sin handler, sin `disabled`, sin tooltip explicativo. El usuario hace click y no pasa nada.

### 7.3 Barra de tareas inconsistente con AdminPage

`ConfiguracionPage.tsx:1309`:

```tsx
<UsageBar
  label="Tareas creadas"
  current={planUsage.tasks_count}         // ← total global (ej: 49)
  limit={planUsage.tasks_per_obra_limit}  // ← límite POR OBRA (ej: 50)
/>
```

Muestra "49 / 50" con la semántica "49 tareas totales de tu tenant vs. 50 tareas permitidas por obra". Son unidades incomparables. La barra se va a rojo si el tenant tiene más de 50 tareas totales, aunque ninguna obra haya excedido su límite.

`AdminPage.tsx:149-161` lo hace correctamente: muestra el total como número informativo sin barra de límite.

### 7.4 Simulate-overdue sin filtro de tenant

`POST /settings/simulate-overdue` llama `TaskRepository.list_overdue(today)`:

```python
async def list_overdue(self, as_of: date) -> list[Task]:
    result = await self.session.execute(
        select(Task).where(
            Task.due_date < as_of,
            Task.status.notin_([TaskStatus.COMPLETADA, TaskStatus.CANCELADA]),
        )
    )
```

No hay `where(Task.tenant_id == current_tenant_id)`. El endpoint crea alertas de vencimiento para **todas las tareas vencidas de todos los tenants**. En el entorno actual (un solo tenant real) el impacto es bajo, pero en producción multi-tenant es un vector de ruido y potencial DoS de alertas.

### 7.5 Settings-by-manager vs. settings-by-tenant (ver §4)

Resumido: el diseño actual hace imposible tener una configuración uniforme del chatbot para todo el tenant cuando hay más de un admin que gestiona obras.

### 7.6 Sección "Tu plan" con modal de upgrade duplicado

`AdminPage.tsx` importa y usa `UpgradeModal` (componente separado). `ConfiguracionPage.tsx` tiene un modal de upgrade **inline** con los tres planes hardcodeados directamente en JSX (líneas ~1350-1420), independiente del componente compartido. Si los planes cambian, hay que actualizarlo en dos lugares.

### 7.7 Backend de simulate-overdue accesible en producción

El guard frontend (`import.meta.env.DEV`) oculta los botones de testing en el build de producción. Pero el endpoint `POST /settings/simulate-overdue` no tiene ninguna validación de entorno en el backend. Cualquier admin puede llamarlo directamente con curl en producción.

---

## 8. Mejoras propuestas

### P0 — Correctivos críticos

| # | Problema | Corrección |
|---|----------|-----------|
| P0-1 | `simulate-overdue` sin filtro tenant | Agregar `Task.tenant_id == current_user.tenant_id` en `list_overdue()` o crear una variante filtrada para el endpoint |
| P0-2 | Barra de tareas con unidades mezcladas | Cambiar a mismo patrón que AdminPage: mostrar `tasks_count` como número informativo sin `UsageBar` comparativo, o cambiar `limit` a `tasks_count` real por obra |

### P1 — Corrección de diseño

| # | Problema | Corrección |
|---|----------|-----------|
| P1-1 | Settings por manager en lugar de por tenant | Migrar `manager_id` → `tenant_id` en `SystemSettings`; única fila por tenant; todos los admins del tenant ven y editan la misma configuración |
| P1-2 | Campos `notify_*` decorativos | Eliminar los 4 campos de model/schema/UI, o implementarlos en `alert_service.py` y `notification_service.py` |
| P1-3 | Botones "Reconectar" y "Ver registros" sin acción | Implementar los handlers o eliminar los botones hasta tenerlos |

### P2 — Deuda menor

| # | Problema | Corrección |
|---|----------|-----------|
| P2-1 | Modal de upgrade duplicado | Refactorizar `ConfiguracionPage` para importar y usar el mismo `UpgradeModal` que usa `AdminPage` |
| P2-2 | Colaboradores ven la pantalla de configuración con campos disabled | Redirigir a `/` con mensaje "Sin permisos" si `role !== "admin"` |
| P2-3 | `simulate-overdue` accesible en producción por curl | Agregar guard de entorno en el backend: `if not settings.DEBUG: raise HTTPException(403)` |
| P2-4 | UI no indica que la configuración es personal (per-manager) | Hasta que se corrija P1-1, agregar un aviso: "Esta configuración aplica a las obras que vos gestionás" |

---

## 9. Riesgos

| Riesgo | Probabilidad | Impacto | Estado |
|--------|-------------|---------|--------|
| Un admin llama `simulate-overdue` en producción y genera alertas basura para todos los tenants | Media (botón accesible via curl) | Alto (ruido operacional, WhatsApp messages innecesarios) | Abierto |
| Tenant con dos admins tiene configuración de chatbot inconsistente entre obras | Alta (es el estado por defecto al agregar un segundo admin) | Medio (chatbot con comportamiento inesperado en obras del segundo admin) | Abierto |
| Los 4 campos `notify_*` crean expectativa de funcionalidad que no existe | Media (cualquier usuario que lea los toggles) | Medio (confianza en el sistema) | Abierto |
| Barra de tareas en "Tu plan" muestra 100% / rojo aunque ninguna obra haya excedido su límite | Baja (requiere >50 tareas totales en el tenant, posible con uso real) | Bajo (confusión visual, falsa alarma) | Abierto |
| Modal de upgrade con planes hardcodeados diverge de los precios reales | Baja | Bajo (solo cosmético hasta que se procese un pago real) | Abierto |
