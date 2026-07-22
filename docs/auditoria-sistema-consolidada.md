# Auditoría del sistema — Informe consolidado

**Fecha:** 2026-07-17 (actualizado 2026-07-18: auditoría de frontend pantalla por pantalla — §9 — y **estado de resolución de los P0**, ver §1/§4/§7).
**Estado:** 🟢 **cluster P0 de seguridad cerrado y mergeado a `main`** (14/15; abierto solo #14 por diseño). 16 tests + CI lo sostienen.
**Método:** reconciliación de los 8 análisis técnicos por módulo (`docs/analisis-modulo-*.md`) contra las **26 rutas** del backend, los 18 servicios y los 22 modelos, con verificación puntual del código real de cada hallazgo crítico. Se sumó una pasada por las **12 páginas y ~35 componentes** del frontend, una por una (§9).
**Alcance:** todo el sistema — autenticación, planes/tenants, obras, tareas, cronograma, comunicación de campo (WhatsApp/alertas/presencia), compras y documentos, bitácora con IA, infraestructura transversal, frontend, y modelo de datos/integraciones.

Este documento **no reemplaza** los análisis por módulo: los consolida. El detalle de cada hallazgo (solución propuesta con código, esfuerzo estimado) está en el documento del módulo correspondiente. Acá está el mapa completo, la cobertura verificada y el ranking de severidad de todo el sistema.

---

## 1. Resumen ejecutivo

**Estado general: funcional y sano en el camino feliz, con una deuda de seguridad multi-tenant concentrada y una causa raíz única.** El sistema hace lo que promete (portfolio, obras, Gantt, tareas, alertas en tiempo real, chatbot, compras, bitácora con IA). Los hallazgos no son "cosas rotas" para un usuario solo; son de **aislamiento entre empresas (tenants)**, robustez operativa y features de negocio faltantes (billing, recuperación de cuenta).

**El hallazgo dominante:** `tenant_id` está desnormalizado en solo 8 de ~22 tablas. Las tablas hijas (task, task_material, alert, calendar, baseline, solicitud, historial, plano, obra_team_member) llegan al tenant vía *join* con la obra padre — y buena parte de los endpoints omitían ese *join* al chequear acceso. Resultado: **~13 fugas cross-tenant tipo IDOR** que comparten **una sola causa raíz**. Se resuelven con el mismo patrón (guard de tenant) y, de fondo, denormalizando `tenant_id`.

**Conteo de hallazgos:**

| Severidad | Cantidad | Naturaleza |
|-----------|----------|------------|
| 🔴 **P0 — Crítico / Seguridad** | 15 → **14 ✅ resueltos** | Fugas cross-tenant (IDOR), archivos públicos sin auth, secretos con default inseguro. **Cerrado y mergeado** (2026-07-18); abierto solo #14 (diseño WhatsApp) |
| 🟠 **P1 — Robustez / Negocio** | ~28 | Sin tests/CI, billing incompleto, recuperación de cuenta, rate limiting, multi-worker |
| 🟡 **P2 — Pulido / UX / Deuda** | ~27 | Paginación, accesibilidad, routing por URL, copy, memoización, código muerto, diálogos nativos |

> **Adenda 2026-07-18 (§9):** la pasada por pantalla del frontend no sumó P0. Sí sumó **~4 P1** (dato incorrecto en `AdminPage`, errores en silencio en `EquipoPage`, `BACKEND_URL` localhost en Bitácora, a11y en Gantt/planilla) y **~7 P2** (destacan **~2.229 líneas de código muerto** en 7 archivos y diálogos nativos `confirm()`/`alert()` en 8 pantallas).

**Prioridad #1 absoluta — ✅ HECHA (2026-07-18):** el cluster de aislamiento por tenant está **cerrado y mergeado**. **14 de 15 P0 resueltos**; el único abierto es la punta de diseño de #14 (`whatsapp_number` per-tenant, ver §4). Era lo que separaba "app de demo" de "SaaS multi-empresa que puede vender".

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

> La **auditoría del frontend pantalla por pantalla** (las 12 páginas y ~35 componentes, una por una) está incorporada en este mismo documento — **§9**.

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

> **✅ Estado de resolución (2026-07-18) — el cluster P0 está CERRADO y MERGEADO a `main`.**
>
> - **#3–#13 (13 IDOR)** → guards de tenant en cada endpoint hijo + set de tests de aislamiento (`tests/test_tenant_isolation.py`).
> - **#1 (uploads/planos/audios sin auth)** → URLs firmadas HMAC + expiración (`app/core/signing.py`, `tests/test_upload_signing.py`); las imágenes de portada/avatar siguen públicas (uuid4, baja sensibilidad).
> - **#4 (Socket.IO une a todas las obras)** → `connect` con scope de tenant.
> - **#5 (`INTERNAL_API_KEY` vacío)** → el código ya fallaba cerrado (401 si está vacío); no requería fix.
> - **#15 (SSE sin tenant + JWT en query)** → se removió el endpoint SSE, que era **código muerto** (el front usa Socket.IO); elimina el vector entero.
> - **#2 (causa raíz — `tenant_id` no denormalizado)** → **Fase 1** (columna + backfill + keep-in-sync) **+ Fase 2** (`NOT NULL` en obras y 6 hijas + guard por columna, single-`WHERE`), con `tests/test_tenant_denorm.py`.
> - Todo protegido por **CI** (GitHub Actions) que corre los **16 tests** en cada push → ningún endpoint nuevo reintroduce un IDOR.
>
> **Único punto abierto — #14 (parcial):** el IDOR de responsables se cerró (guard de tenant). Lo que **NO** se cerró es el `whatsapp_number` **único-global**: volverlo per-tenant haría ambiguo el ruteo del mensaje entrante de WhatsApp (con un número de Twilio compartido, el `From` del remitente es la única señal de a qué empresa pertenece). Cerrarlo exige un **número de WhatsApp por tenant** → es una **decisión de arquitectura de producto**, no un bug de código. Queda documentado como limitación conocida.

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

**Frontend — pantallas** (§9)
- `AdminPage`: la barra "Tareas totales en el sistema" compara el total contra el límite **por obra** → dato/porcentaje incorrecto (F1).
- `EquipoPage`: cambio de rol y baja de miembro **fallan en silencio**; la baja **no pide confirmación** (F2).
- `BitacoraPage`: `BACKEND_URL` cae a `localhost:8000` si falta el env → **audios rotos en producción** (F3).
- Accesibilidad casi nula en los componentes interactivos pesados (Gantt: 0 `aria`; planilla: 1) y modales sin foco atrapado (F4).

### 🟡 P2 — Pulido, UX y deuda técnica

- **Frontend:** sin enrutamiento por URL (todo es estado en `App.tsx`, no hay deep-links ni back del navegador); prop-drilling de navegación desde `App.tsx`; accesibilidad mínima (foco, roles ARIA, teclado); desktop-first sin responsive real (matizado: el *chrome* sí tiene drawer responsive); componentes pesados sin memoizar.
- **Frontend — pantallas (§9):** ~2.229 líneas de **código muerto** (7 archivos, 4 páginas nunca montadas); diálogos nativos `confirm()`/`alert()` en 8 pantallas (inconsistente con los modales estilados); afford muertos en el Sidebar (workspace switcher, % de "Fijadas" hardcodeado); Tailwind usado en producción contra la regla del `CLAUDE.md`; mega-componentes (`ComprasTab` 2578, `TaskSheetView` 1923, `GanttTimeline` 1858); `fetchAlerts()` trae todas las alertas y filtra en el cliente; `AcceptInvitePage` acepta a ciegas.
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
| Frontend (transversal) | 6 | P2 | Funcional; deuda de routing/a11y/responsive |
| Frontend — pantallas (§9) | 11 | 🟠 P1 | Alta calidad por pantalla; dato incorrecto en `AdminPage`, errores en silencio en `EquipoPage`, `BACKEND_URL` localhost; ~2.229 líneas muertas |

---

## 6. Tema transversal — la causa raíz

Casi todos los P0 de seguridad son el **mismo bug visto desde 13 endpoints distintos**:

> `tenant_id` vive solo en 8 tablas raíz (user, tenant, obra, responsible, supplier, budget, plano, ai_mapping_cache). Las tablas hijas llegan al tenant **solo por join** con la obra padre. Los endpoints que reciben `CurrentUserId` (solo el id, sin tenant) o que hacen `get_or_raise` sin pasar `tenant_id` **no hacen ese join** → validan existencia, no pertenencia → IDOR.

**Dos niveles de solución:**
1. **Táctico (rápido, ya drafteado):** guard de tenant en cada endpoint hijo — `ObraService(db).get_or_raise(obra_id, tenant_id=current_user.tenant_id)` o resolver el tenant del usuario dentro de los helpers de acceso compartidos. Cierra los 13 IDOR sin migración.
2. **Estructural (de fondo):** denormalizar `tenant_id` en las tablas hijas (task, task_material, alert, calendar, baseline, solicitud, historial, obra_team_member) y hacerlo `NOT NULL`. Permite filtrar por tenant en una sola cláusula `WHERE`, sin joins, y previene la clase entera de bug para features futuras.

La recomendación era hacer **ambos** — y **ambos están hechos y mergeados** (2026-07-18): el táctico (guards de tenant en cada endpoint hijo, con tests) y el estructural (migraciones 0040/0041: `tenant_id` denormalizado + backfill + keep-in-sync + `NOT NULL` + guard por columna en `task_materials`).

---

## 7. Orden de remediación recomendado

1. ✅ **Cerrar el cluster P0 de aislamiento por tenant** (los 13 IDOR) con guards + tests de regresión. — **hecho y mergeado.**
2. ✅ **Autenticar el serving de documentos** (`/uploads`, planos): URLs firmadas (HMAC + expiración). — **hecho.**
3. ✅ **`INTERNAL_API_KEY`:** ya falla cerrado (401 si está vacío). — **verificado, sin cambio necesario.**
4. ✅ **Denormalizar `tenant_id`** (migraciones 0040/0041): columna + backfill + keep-in-sync + `NOT NULL` + guard por columna. — **hecho (Fase 1 + 2).**
5. ✅ **CI mínimo** que corre los 16 tests en cada push (GitHub Actions). — **hecho.**
6. ⬜ **Ciclo de vida de cuenta** (recuperación de contraseña, verificación de email, refresh token). — pendiente (P1).
7. ⬜ **Monetización real** (billing, verificación de `active_until`, trial). — pendiente (P1).
8. ⬜ **Robustez operativa** (multi-worker para presencia, rate limiting, manejo global de errores, Sentry). — pendiente (P1).
9. ⬜ **P2** de UX/frontend según prioridad de producto (código muerto, `BACKEND_URL` localhost, a11y, etc.). — pendiente.

> **Resumen:** los pasos **1–5 (todo el bloque P0 de seguridad) están hechos y mergeados**; del 6 en adelante es robustez/negocio/pulido (P1/P2), aún abierto. Más el punto de diseño de #14 (WhatsApp per-tenant).

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

---

## 9. Frontend — auditoría pantalla por pantalla

Complemento del `analisis-modulo-frontend.md` (que auditó el front por temas transversales). Acá se recorrió **cada una de las 12 páginas y los ~35 componentes** leyendo el código real de las pantallas vivas, para responder "¿qué muestra cada pantalla, qué estados maneja, qué se rompe y qué le falta?". *(Método: lectura del código + barrido de señales — diálogos nativos, catches que tragan errores, `aria`/`role`, estados vacío/carga — + verificación de montaje contra `App.tsx`. Fecha: 2026-07-18.)*

**Veredicto:** la calidad por pantalla es alta y consistente (estados de carga/error/vacío casi siempre, validaciones con mensajes accionables, lenguaje visual homogéneo). **No hay P0 de UI**: ningún gap rompe el flujo principal ni es de seguridad. Los hallazgos son de higiene de UX, consistencia, dato correcto y limpieza.

### 9.1 Mapa de pantallas — vivas vs muertas

Solo **8 de las 12 páginas están montadas** en `App.tsx` (routing por estado, sin URL). Las otras 4 son **código muerto** (nunca importadas), y arrastran 3 componentes muertos:

| Módulo muerto | Tipo | Por qué |
|---|---|---|
| `pages/DashboardPage.tsx` (161) | Página | Nunca importada |
| `pages/ObrasPage.tsx` (161) | Página | Nunca importada |
| `pages/ResponsablesPage.tsx` (419) | Página | Nunca importada (el equipo per-obra vive en `ObraResponsablesTab`) |
| `pages/PresupuestosPage.tsx` (556) | Página | Nunca importada |
| `components/PresupuestoTab.tsx` (745) | Componente | El tab Presupuesto monta `ComprasTab`, no este |
| `components/AlertsPanel.tsx` (108) | Componente | Solo lo usaba `DashboardPage` (muerta) |
| `components/StatCard.tsx` (79) | Componente | Solo lo usaba `DashboardPage` (muerta) |

**Total: ~2.229 líneas de código muerto en 7 archivos.** Verificado por grep de imports; borrarlos es un PR de limpieza de bajo riesgo (antes de borrar `ResponsablesPage`/`PresupuestosPage`, confirmar que su función está cubierta por `ObraResponsablesTab`/`ComprasTab` — lo está).

Pantallas vivas: `LoginPage`, `AcceptInvitePage`, `PortfolioPage`, `ObraDetailPage` (+ tabs), `BitacoraPage`, `EquipoPage`, `AdminPage`, `ConfiguracionPage`.

### 9.2 Qué funciona (por área)

| Área | Highlights |
|---|---|
| **Auth** (`LoginPage`, `AcceptInvitePage`) | Login+registro con creación de tenant; errores por código (409/422); toggle password; validaciones con mensajes accionables |
| **Portfolio** | KPI strip, filtros con contador, búsqueda, **3 estados vacíos** distintos, fallback de imagen, menú de estado por portal |
| **Hub de obra** (`ObraDetailPage`) | Carga única con `Promise.all`, distingue 403 de error de red, sockets en vivo, skeletons, toggle planilla/tabla, panel de tareas críticas |
| **Cronograma** (`Gantt`, planilla, `TaskFormModal`) | Drag/resize, cascade con preview, snapping a día laboral, grilla tipo Sheets, confirmación de cascade |
| **Compras** (`ComprasTab`) | Sub-tabs, análisis comparativo de cotizaciones IA, modales de material/pedido, manejo de error |
| **Bitácora IA** | Grabación→transcripción→sugerencias editables aplicables, estados con metadata clara, animaciones |
| **Org/Admin/Config** | Barras de uso con umbrales de color, permisos por rol, índice de secciones sticky |
| **UI transversal** | Top bar sticky, **drawer responsive real** (matiza el "sin responsive" del audit temático), `ErrorBoundary` doble, toasts, skeletons |

### 9.3 Gaps de frontend por pantalla

| # | Pantalla | Gap | Severidad |
|---|----------|-----|:---------:|
| F1 | `AdminPage` | La barra "Tareas totales en el sistema" compara el total contra `tasks_per_obra_limit` (límite **por obra**) → % y color engañosos (`AdminPage:147-152`) | 🟠 P1 |
| F2 | `EquipoPage` | Cambio de rol y baja de miembro **fallan en silencio** (`catch { /* silent */ }`); la baja se ejecuta **sin confirmación** | 🟠 P1 |
| F3 | `BitacoraPage` | `BACKEND_URL` cae a `http://localhost:8000` si falta `VITE_API_URL` → **audios rotos en producción** (`BitacoraPage:16`) | 🟠 P1 |
| F4 | Gantt / planilla / modales | Accesibilidad casi nula: `GanttTimeline` (1858 líneas) **0** `aria`/`role`; `TaskSheetView` 1; modales sin foco atrapado / `Esc` consistente | 🟠 P1 |
| F5 | `ObraDetailPage`, `AppLayout` | `fetchAlerts()` trae **todas** las alertas del tenant y filtra por obra en el cliente → costo en escala | 🟡 P2 |
| F6 | 8 pantallas | Diálogos nativos `confirm()`/`alert()` para acciones destructivas conviviendo con modales estilados → inconsistencia (`PortfolioPage`, `TaskSheetView`, `ComprasTab`, `PlanosTab`, `ObraSetupWizard`, `BitacoraPage`, `InviteModal`) | 🟡 P2 |
| F7 | Todas | **~2.229 líneas de código muerto** (§9.1) | 🟡 P2 |
| F8 | `Sidebar` | Afford muertos: "workspace switcher" con chevron que **no cambia de workspace**; obras "Fijadas" con % **hardcodeado** por estado, no avance real | 🟡 P2 |
| F9 | `LoginPage`, `AcceptInvitePage` | Sin "olvidé mi contraseña" (ya en P1 auth); `AcceptInvitePage` **acepta a ciegas** (no muestra quién invitó ni a qué empresa/email) | 🟡 P2 |
| F10 | `CLAUDE.md` vs código | El front **sí usa Tailwind en producción** (`LoginPage`, `AppLayout`, clases `constructa-*`), contra la regla documentada "NO Tailwind" → doc y código no coinciden | 🟡 P2 |
| F11 | `ComprasTab` (2578), `TaskSheetView` (1923), `GanttTimeline` (1858) | Mega-componentes: render + estado + interacción + API en un archivo, sin `React.memo` → mantenibilidad y jank en obras grandes | 🟡 P2 |

> El detalle por pantalla (Qué funciona / Gaps con solución y esfuerzo) fue redactado en esta pasada; sus hallazgos quedan consolidados acá. Los mega-componentes (`ComprasTab`, `GanttTimeline`, `TaskSheetView`, `ConfiguracionPage`) se auditaron por estructura + señales + lo cubierto en `auditoria-ux.md`; una revisión línea por línea de su lógica interna queda como profundización opcional.
