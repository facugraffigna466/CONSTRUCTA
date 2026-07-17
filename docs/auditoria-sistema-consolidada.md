# Auditoría del sistema — Informe consolidado

**Fecha:** 2026-07-17
**Método:** reconciliación de los 8 análisis técnicos por módulo (`docs/analisis-modulo-*.md`) contra las **26 rutas** del backend, los 18 servicios y los 22 modelos, con verificación puntual del código real de cada hallazgo crítico.
**Alcance:** todo el sistema — autenticación, planes/tenants, obras, tareas, cronograma, comunicación de campo (WhatsApp/alertas/presencia), compras y documentos, bitácora con IA, infraestructura transversal, frontend, y modelo de datos/integraciones.

Este documento **no reemplaza** los análisis por módulo: los consolida. El detalle de cada hallazgo (solución propuesta con código, esfuerzo estimado) está en el documento del módulo correspondiente. Acá está el mapa completo, la cobertura verificada y el ranking de severidad de todo el sistema.

---

## 1. Resumen ejecutivo

**Estado general: funcional y sano en el camino feliz, con una deuda de seguridad multi-tenant concentrada y una causa raíz única.** El sistema hace lo que promete (portfolio, obras, Gantt, tareas, alertas en tiempo real, chatbot, compras, bitácora con IA). Los hallazgos no son "cosas rotas" para un usuario solo; son de **aislamiento entre empresas (tenants)**, robustez operativa y features de negocio faltantes (billing, recuperación de cuenta).

**El hallazgo dominante:** `tenant_id` está desnormalizado en solo 8 de ~22 tablas. Las tablas hijas (task, task_material, alert, calendar, baseline, solicitud, historial, plano, obra_team_member) llegan al tenant vía *join* con la obra padre — y buena parte de los endpoints omitían ese *join* al chequear acceso. Resultado: **~13 fugas cross-tenant tipo IDOR** que comparten **una sola causa raíz**. Se resuelven con el mismo patrón (guard de tenant) y, de fondo, denormalizando `tenant_id`.

**Conteo de hallazgos:**

| Severidad | Cantidad | Naturaleza |
|-----------|----------|------------|
| 🔴 **P0 — Crítico / Seguridad** | 15 | Fugas cross-tenant (IDOR), archivos públicos sin auth, secretos con default inseguro |
| 🟠 **P1 — Robustez / Negocio** | ~28 | Sin tests/CI, billing incompleto, recuperación de cuenta, rate limiting, multi-worker |
| 🟡 **P2 — Pulido / UX / Deuda** | ~20 | Paginación, accesibilidad, routing por URL, copy, memoización |

**Prioridad #1 absoluta:** cerrar el cluster de aislamiento por tenant (los 15 P0). Es lo que separa "app de demo" de "SaaS multi-empresa que puede vender".

---

## 2. Índice de documentos por módulo

| Documento | Cubre |
|-----------|-------|
| [`analisis-modulo-auth-planes.md`](analisis-modulo-auth-planes.md) | Login/JWT, registro/tenants, planes y límites (402), invitaciones por email, roles/permisos, seguridad de auth |
| [`analisis-modulo-obras-tareas-cronograma.md`](analisis-modulo-obras-tareas-cronograma.md) | Obras (CRUD), tareas (CRUD + estados), Gantt, planilla, ruta crítica CPM, baseline, import/export |
| [`analisis-modulo-comunicacion-campo.md`](analisis-modulo-comunicacion-campo.md) | Chatbot WhatsApp (webhooks/reglas), integración Twilio, alertas, presencia/edición colaborativa (Socket.IO), bitácora IA |
| [`analisis-modulo-compras-documentos.md`](analisis-modulo-compras-documentos.md) | Bitácora (audio→IA), solicitudes de cotización, órdenes de compra, materiales por tarea, planos/uploads |
| [`analisis-modulo-transversal-infra.md`](analisis-modulo-transversal-infra.md) | Config/secretos, CORS, base de datos, tests, CI, manejo de errores, observabilidad, deployment |
| [`analisis-modulo-complementos.md`](analisis-modulo-complementos.md) | Responsables, settings, exports, notificaciones/SSE, calendario |
| [`analisis-modulo-frontend.md`](analisis-modulo-frontend.md) | Arquitectura React, cliente API, accesibilidad, responsive, performance |
| [`analisis-modulo-datos-integraciones.md`](analisis-modulo-datos-integraciones.md) | Modelo de datos (`tenant_id`, nullability), email (Brevo), n8n, auth interno |

**Auditorías complementarias previas** (ya resueltas o de otro alcance): [`auditoria-ux.md`](auditoria-ux.md) (P0/P1/P2 de UX, cerrada), [`auditoria-general.md`](auditoria-general.md) (recorrido en navegador, 7 hallazgos cerrados), [`auditoria-flujo-alta.md`](auditoria-flujo-alta.md) (flujo de onboarding).

---

## 3. Matriz de cobertura — las 26 rutas del backend

Verificación de que **cada** módulo del sistema quedó auditado (respuesta directa a "¿están todos los módulos investigados?"):

| Ruta | Documento principal | Hallazgo de mayor severidad |
|------|---------------------|------------------------------|
| `auth.py` | auth-planes | Sin refresh token / rate limiting / recuperación (P1) |
| `users.py` | auth-planes | Sin mínimo de admins por tenant (P1) |
| `admin.py` | auth-planes | Definición inconsistente de "activa" (P2) |
| `obras.py` | obras-tareas | `GET /obras/{id}/historial` fuga cross-tenant (P0) + editar/borrar exige manager (P1) |
| `tasks.py` | obras-tareas | Chequeo de acceso es no-op → IDOR (P0) |
| `baseline.py` | obras-tareas | Hereda el acceso de tareas (P0 vía tasks) |
| `critical_path.py` | obras-tareas | Tareas sin fecha caen sin aviso (P2) |
| `calendar.py` | obras-tareas / complementos | Endpoints sin scope de tenant (P0) |
| `exports.py` | complementos | Export de tareas sin verificar tenant → exfiltración (P0) |
| `imports.py` | obras-tareas | Robustez ante archivos malformados (P1) |
| `alerts.py` | comunicacion-campo | `PATCH /alerts/{id}/read` no valida tenant (P0) |
| `events.py` (SSE) | complementos | SSE sin scope de tenant + token en query string (P0) |
| `notifications.py` | complementos | Sin push offline para alertas críticas (P1) |
| `presence.py` + `socket_manager` | comunicacion-campo | `connect` une a las salas de TODAS las obras (P0) |
| `responsibles.py` | complementos | GET/lookup/mutación no verifican tenant (P0) + `whatsapp_number` único global (P0) |
| `obra_team.py` | compras-documentos / datos | Endpoints sin scope de tenant → IDOR (P0) |
| `task_materials.py` | compras-documentos | Sin verificación de tenant → IDOR (P0) |
| `budgets.py` | obras-tareas / complementos | Hereda scope de obra (P0 vía obra) |
| `solicitudes.py` | compras-documentos | Endpoints sin scope de tenant → IDOR (P0) |
| `purchase_orders.py` | compras-documentos | Envío externo sin idempotencia + verificar tenant (P0/P1) |
| `suppliers.py` | compras-documentos | (tenant ya denormalizado — OK) |
| `planos.py` | compras-documentos | `GET /obras/{id}/planos` no verifica tenant + **archivos sin auth** (P0) |
| `uploads.py` | compras-documentos | **Archivos servidos sin autenticación** (P0) + sin validación de tamaño/tipo (P1) |
| `bitacora.py` | comunicacion-campo / compras | Costo de IA sin control + sin validación de audio (P1) |
| `settings.py` | complementos | Settings por `manager_id`, no por tenant (P0/P1) |
| `webhooks.py` | comunicacion-campo | Sin rate limiting por número (P1) |

**Cobertura: 26/26 rutas.** No hay módulo sin auditar.

---

## 4. Hallazgos consolidados por severidad

### 🔴 P0 — Crítico / Seguridad

Todo lo que permite que **la Empresa B vea o toque datos de la Empresa A**, o que expone datos/endpoints sin control. Ordenado por gravedad.

| # | Hallazgo | Módulo | Impacto | Causa raíz |
|---|----------|--------|---------|-----------|
| 1 | **Documentos (planos, imágenes) servidos SIN autenticación** en `GET /uploads/{filename}` | uploads/planos | Cualquiera con la URL ve el documento; sin scope de tenant | Ruta pública; mitiga (no elimina) el nombre uuid4 no adivinable |
| 2 | **`tenant_id` no denormalizado** en tablas hijas | datos-integraciones | **Causa raíz de todos los IDOR de abajo** | El chequeo de tenant requiere un join que el código omite |
| 3 | **IDOR en tareas** — el chequeo de acceso es un no-op | tasks/baseline | La Empresa B lee/edita/borra tareas de A conociendo el id | `CurrentUserId` sin resolver el tenant |
| 4 | **Socket.IO `connect` une a las salas de TODAS las obras** | presence/socket | Fuga cross-tenant en tiempo real (presencia, alertas, edición) | No filtra obras por tenant al suscribir |
| 5 | **`INTERNAL_API_KEY` vacío deja pasar los endpoints internos** | transversal-infra | Si la env var no está seteada, `InternalAuth` no protege nada | Default `""` tratado como "sin auth requerida" |
| 6 | **Export de tareas sin verificar tenant** (`GET /exports/obras/{id}/excel`) | complementos | Exfiltración masiva de datos de otra empresa en un Excel | Falta guard de tenant |
| 7 | **Materiales por tarea sin scope de tenant** (IDOR) | task_materials | CRUD de materiales de tareas ajenas | task→obra→tenant no verificado |
| 8 | **Solicitudes de cotización sin scope de tenant** (IDOR) | solicitudes | Ver/editar/enviar cotizaciones de otra empresa | Falta guard de tenant |
| 9 | **Equipo de obra (`obra_team`) sin scope de tenant** (IDOR) | obra_team | Listar/agregar/quitar miembros de obras ajenas | Falta guard de tenant |
| 10 | **`GET /obras/{id}/planos` no verifica tenant** | planos | Enumerar los planos de otra empresa | Falta guard de tenant |
| 11 | **`GET /obras/{id}/historial` fuga cross-tenant** | obras | Leer el log de actividad de otra empresa | Falta guard de tenant |
| 12 | **`PATCH /alerts/{id}/read` no valida tenant** | alerts | Marcar leídas alertas de otra empresa | Falta guard de tenant |
| 13 | **Calendario laboral sin scope de tenant** | calendar | Ver/editar el calendario de obras ajenas | Falta guard de tenant |
| 14 | **Responsables: GET/lookup/mutación sin verificar tenant** + `whatsapp_number` único GLOBAL | responsibles | IDOR + **el mismo número no puede existir en dos empresas** | Falta guard + constraint global mal modelado |
| 15 | **SSE (`events.py`) sin scope de tenant + JWT en query string** | events | Fuga cross-tenant en el stream + token en logs del servidor | Falta guard + token fuera del header |

> **Nota de estado:** existe un borrador de corrección para los hallazgos #3–#15 (guards de tenant) en la rama de trabajo `feature/hardening-autorizacion`, con un set de tests de aislamiento (`tests/test_tenant_isolation.py`) que verifica que 10 endpoints cross-tenant devuelven 404. **No está mergeado ni pusheado** (a pedido: primero cerrar auditoría/documentación). El #1 (uploads público) y el #2 (denormalización de fondo) quedan como decisión de diseño pendiente. Este informe documenta los hallazgos; la aplicación del fix es un paso aparte.

### 🟠 P1 — Robustez operativa y features de negocio

Agrupados por área. Detalle y solución en el doc del módulo.

**Autenticación y cuenta** (`auth-planes`)
- Sin refresh token → la sesión expira sin renovación silenciosa.
- Sin "Olvidé mi contraseña" ni recuperación de cuenta.
- Sin verificación de email en el registro.
- Sin rate limiting en login (fuerza bruta).
- Validación de contraseña mínima (solo 8 caracteres).
- Sin logout real (tokens sin revocación) ni "cerrar sesión en todos los dispositivos".

**Planes y monetización** (`auth-planes`)
- Sin billing real / pasarela de pago.
- `active_until` no se verifica en ningún lado → un plan vencido no bloquea nada.
- Sin trial, sin self-service upgrade, sin página de precios pública.
- El error 402 (límite de plan) no está manejado/centralizado en el frontend.

**Obras y tareas** (`obras-tareas`)
- Editar/borrar obra exige ser el *manager* creador → rompe el modelo multi-empresa (un admin no puede administrar obras de su propio tenant creadas por otro).
- El borrado de obra deja huérfanos (`obra_id=NULL` en presupuestos/alertas) y es permanente, sin papelera.
- Sin paginación en el listado de tareas.
- Transiciones de estado que el frontend ofrece pero el backend rechaza (desalineación).
- La evaluación de alertas se recalcula en **cada** `GET /tasks` (costo y acoplamiento).

**Comunicación de campo** (`comunicacion-campo`)
- Un solo proveedor de WhatsApp (Twilio); sin Evolution API ni WhatsApp Cloud API.
- Sin rate limiting por número en el webhook.
- Sesiones de conversación vencidas no se limpian.
- Presencia/edición colaborativa **en memoria del proceso** → se rompe con múltiples workers/instancias.
- Edición colaborativa es "soft lock" (el último en guardar gana).

**Bitácora con IA** (`comunicacion-campo` / `compras-documentos`)
- Costo de IA sin control ni presupuesto por tenant/plan.
- Sin validación de tamaño/tipo del audio entrante.
- Entradas "pendientes" (sin keys configuradas) no se reprocesan solas.

**Infraestructura** (`transversal-infra`)
- **Sin tests automatizados** (el mayor riesgo de calidad — el set de aislamiento por tenant es el primer paso).
- Sin CI que corra `tsc`/`py_compile`/tests en cada push.
- Sin manejo global de excepciones (errores se filtran crudos).
- Sin tracking de errores (Sentry) ni logging estructurado.
- Health check no verifica dependencias (DB, etc.).
- Secretos con default `""` y sin validación en el arranque; sin discriminador de entorno (`ENV`).
- CORS hardcodeado a localhost.
- Sin artefacto ni pipeline de deployment.

**Datos e integraciones** (`datos-integraciones`)
- `tenant_id` es `nullable` en varias tablas (facilita filas sin tenant → escapan a los filtros).
- Sin reintento/backoff ante fallas transitorias de email.
- Verificar que el envío de email no bloquee el event loop.
- Dependencia crítica de n8n sin visibilidad/monitoreo.

**Compras y documentos** (`compras-documentos`)
- Órdenes de compra: envío externo sin idempotencia ni reintento controlado.
- El contratista responde por un canal no verificado.
- Uploads/planos sin validación de tamaño/tipo; almacenamiento en filesystem local (no escala, riesgo de pérdida).

### 🟡 P2 — Pulido, UX y deuda técnica

- **Frontend:** sin enrutamiento por URL (todo es estado en `App.tsx`, no hay deep-links ni back del navegador); prop-drilling de navegación desde `App.tsx`; accesibilidad mínima (foco, roles ARIA, teclado); desktop-first sin responsive real; componentes pesados sin memoizar.
- **Cronograma:** tareas sin fechas quedan fuera del cálculo de ruta crítica sin aviso claro; la ruta crítica se recalcula en el front bajo demanda sin caché.
- **Planilla/Gantt:** no se pueden reordenar columnas (selección atada al índice); el reorden de filas solo persiste en `localStorage`; la columna "Costo/Materiales" hace ida y vuelta al modal.
- **Settings:** `ConfiguracionPage` concentra varias responsabilidades sin auditar como flujo.
- **Roles:** sin granularidad de permisos (solo admin/colaborador); sin log de auditoría de accesos.
- **Copy/consistencia:** ver `auditoria-general.md` (ya resuelto).

---

## 5. Resumen por módulo

| Módulo | # gaps | Severidad máx. | Comentario |
|--------|:------:|:--------------:|------------|
| Auth / JWT | 5 | P1 | Sólido en lo básico; falta ciclo de vida de cuenta (refresh, recuperación, verificación) |
| Registro / Tenants | 5 | P1 | Onboarding funciona; falta email de bienvenida y URLs propias |
| Planes / Límites | 7 | P1 | Límites (402) funcionan; falta todo el aparato de monetización real |
| Invitaciones | 5 | P1 | Funciona con Brevo; frágil si falta la API key |
| Roles / Permisos | 3 | P1 | Guard admin/colaborador OK; sin granularidad ni auditoría |
| Seguridad de auth | 5 | 🔴 P0 | `INTERNAL_API_KEY` vacío es el crítico |
| Obras | 6 | 🔴 P0 | Historial cross-tenant + modelo manager-only |
| Tareas | 4 | 🔴 P0 | **IDOR** (el gap más serio del módulo) |
| Gantt / Planilla | 3 | P2 | Rico en features; deuda de UX/persistencia |
| Ruta crítica CPM | 2 | P2 | Correcto; sin caché ni aviso de tareas sin fecha |
| Baseline | — | (vía tareas) | Hereda el acceso de tareas |
| Import / Export | 3 | 🔴 P0 | Export cross-tenant + robustez de parsing |
| Chatbot / Webhooks | 2 | P1 | Reglas OK; falta rate limiting y limpieza de sesiones |
| Twilio / WhatsApp | 1 | P1 | Un solo proveedor |
| Alertas | 3 | 🔴 P0 | `mark_read` sin tenant + acople al GET |
| Presencia / Socket | 3 | 🔴 P0 | **Salas de TODAS las obras** + estado en memoria |
| Bitácora IA | 3 | P1 | Innovador; falta control de costo y validación de audio |
| Solicitudes / OC | 4 | 🔴 P0 | IDOR + envío externo sin idempotencia |
| Materiales | 1 | 🔴 P0 | IDOR |
| Proveedores | 0 | ✅ | `tenant_id` ya denormalizado — OK |
| Planos / Uploads | 4 | 🔴 P0 | **Archivos sin auth** (el más grave) |
| Responsables | 2 | 🔴 P0 | IDOR + `whatsapp_number` único global |
| Settings | 2 | 🔴 P0 | Por `manager_id`, no por tenant |
| Calendario | 1 | 🔴 P0 | Sin scope de tenant |
| Notificaciones / SSE | 2 | 🔴 P0 | SSE cross-tenant + token en query |
| Config / Infra | 3 | 🔴 P0 | Secretos con default inseguro |
| Base de datos | 2 | 🔴 P0 | `tenant_id` no denormalizado / nullable |
| Tests / CI / Observabilidad | 6 | P1 | Sin tests, sin CI, sin tracking |
| Frontend | 6 | P2 | Funcional; deuda de routing/a11y/responsive |

---

## 6. Tema transversal — la causa raíz

Casi todos los P0 de seguridad son el **mismo bug visto desde 13 endpoints distintos**:

> `tenant_id` vive solo en 8 tablas raíz (user, tenant, obra, responsible, supplier, budget, plano, ai_mapping_cache). Las tablas hijas llegan al tenant **solo por join** con la obra padre. Los endpoints que reciben `CurrentUserId` (solo el id, sin tenant) o que hacen `get_or_raise` sin pasar `tenant_id` **no hacen ese join** → validan existencia, no pertenencia → IDOR.

**Dos niveles de solución:**
1. **Táctico (rápido, ya drafteado):** guard de tenant en cada endpoint hijo — `ObraService(db).get_or_raise(obra_id, tenant_id=current_user.tenant_id)` o resolver el tenant del usuario dentro de los helpers de acceso compartidos. Cierra los 13 IDOR sin migración.
2. **Estructural (de fondo):** denormalizar `tenant_id` en las tablas hijas (task, task_material, alert, calendar, baseline, solicitud, historial, obra_team_member) y hacerlo `NOT NULL`. Permite filtrar por tenant en una sola cláusula `WHERE`, sin joins, y previene la clase entera de bug para features futuras.

La recomendación es hacer **ambos**: el táctico ahora (blinda), el estructural en una migración planificada (previene reincidencia).

---

## 7. Orden de remediación recomendado

1. **Cerrar el cluster P0 de aislamiento por tenant** (los 13 IDOR) con guards + tests de regresión. *Es lo que habilita vender el SaaS.* — borrador existente.
2. **Autenticar el serving de documentos** (`/uploads`, planos): URLs firmadas o proxy autenticado. *Exposición pública de documentos privados.*
3. **`INTERNAL_API_KEY`:** fallar el arranque si está vacío en producción (no "pasar por defecto").
4. **Denormalizar `tenant_id`** (migración) para eliminar la causa raíz.
5. **CI mínimo** que corra los tests de aislamiento en cada push → que ningún endpoint nuevo reintroduzca un IDOR.
6. **Ciclo de vida de cuenta** (recuperación de contraseña, verificación de email, refresh token).
7. **Monetización real** (billing, verificación de `active_until`, trial).
8. **Robustez operativa** (multi-worker para presencia, rate limiting, manejo global de errores, Sentry).
9. **P2** de UX/frontend según prioridad de producto.

---

## 8. Fortalezas del sistema (lo que está bien hecho)

Para balancear: la auditoría también confirma decisiones sólidas.

- **Arquitectura backend limpia:** capas routes → services → repositories bien separadas; el commit centralizado en `get_db()` evita commits sueltos.
- **Modelo de datos rico y correcto:** dependencias M2M con 4 tipos (FS/SS/FF/SF) + lag, WBS con `parent_task_id`, baseline, historial append-only, soft-delete consistente.
- **Cronograma de nivel MS Project:** ruta crítica CPM real (Kahn + detección de ciclos), cascade reschedule, snapping a días laborables.
- **Tiempo real funcional:** Socket.IO con salas por obra, presencia, edición colaborativa (el problema es el scoping, no el mecanismo).
- **Chatbot sin fricción:** el responsable reporta desde su WhatsApp de siempre; el `whatsapp_number` como clave inmutable es un buen diseño (salvo por el constraint global).
- **Bitácora con IA:** audio → transcripción → análisis → sugerencias aplicables; feature diferencial.
- **Frontend consistente:** inline styles con paleta unificada, tipografías definidas, componentes ricos (Gantt drag/resize, planilla estilo Sheets).

El sistema está **cerca** de ser production-ready. Lo que lo separa es, sobre todo, el cluster de aislamiento por tenant y el arnés de tests/CI que lo mantenga cerrado.
