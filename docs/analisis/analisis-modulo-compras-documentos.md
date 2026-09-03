# Análisis: Presupuestos · Cotizaciones · Compras · Materiales · Proveedores · Planos (Compras y documentos)

> Módulo auditado: procurement y gestión documental — lectura de presupuestos con IA, solicitudes de cotización, órdenes de compra, materiales por tarea, proveedores y planos versionados.
> Fecha: 2026-07-02 | Rama: `main`

---

## TL;DR

La calidad es **despareja según el sub-módulo**: **Presupuestos** y **Proveedores** están bien hechos (aislamiento por tenant en todos los endpoints, proveedores solo-admin, validación de tipo de archivo, lectura con IA multimodal PDF/imagen/Excel). Pero **Cotizaciones, Materiales y Planos repiten el patrón de fuga cross-tenant** que ya apareció en los otros dos audits: usan `CurrentUserId` (solo el id, sin tenant) o funciones de acceso que solo verifican existencia, no pertenencia.

El hallazgo más grave de todo el sistema aparece acá: **la ruta que sirve los archivos subidos (`GET /uploads/{filename}`) no tiene autenticación** — cualquier persona en internet, con el nombre del archivo, descarga planos, presupuestos en PDF e imágenes de obra. Sumado a que los archivos se guardan en el **filesystem local** del proceso, hay un problema de seguridad y de escala en la capa documental.

> **Nota transversal (3 audits):** el aislamiento multi-tenant está aplicado de forma **inconsistente**. Obras, presupuestos, proveedores y bitácora scopean por tenant; tareas, materiales, cotizaciones, historial, salas de socket y servido de archivos **no**. La causa raíz es el uso mezclado de `CurrentUserId` vs `CurrentUser` y de "asserts" de acceso que no assertan. Conviene un barrido único de autorización sobre todo el backend.

---

## 1. Presupuestos (lectura con IA)

### Qué funciona

| Aspecto | Estado |
|---------|--------|
| Subida de presupuesto (PDF/imagen/Excel) + creación desde texto | ✅ |
| Lectura con IA **multimodal** (Claude): PDF nativo, imagen base64, Excel | ✅ |
| Extracción estructurada (ítems, subtotal, IVA, total, condiciones, inconsistencias) | ✅ |
| **Comparación** de presupuestos (`/compare`) con recomendación | ✅ |
| **Aislamiento por tenant en TODOS los endpoints** (upload/text/list/get/delete/compare pasan `current_user.tenant_id`) | ✅ |
| Validación de tipo de archivo (raise si el tipo no es soportado) | ✅ |
| Manejo de error de IA (`except Exception` → estado de error) | ✅ |

### Gaps detectados y cómo resolverlos

---

#### Gap 1 — Sin límite de tamaño de archivo

**Impacto:** Medio

`_build_content` valida el **tipo** pero no el **tamaño**. Un PDF/imagen enorme se convierte a base64 y se manda entero a la IA: llamada cara, lenta y potencial timeout / error de límite de tokens.

**Solución profesional:** validar `len(file_bytes)` contra un tope (p. ej. 10 MB) antes de procesar, con un 413/422 claro. Para PDFs grandes, considerar recortar a las primeras N páginas.

**Esfuerzo estimado:** 1h

---

#### Gap 2 — Sin control de costo/uso de IA por tenant/plan

**Impacto:** Bajo-Medio

Igual que la bitácora: cada lectura de presupuesto es una llamada a IA sin métrica ni límite por plan. Es costo y a la vez un gancho de monetización desaprovechado (Básico: N presupuestos/mes).

**Solución profesional:** contador `ai_usage` por tenant, atado al plan (compartido con la bitácora — ver audit de comunicación).

**Esfuerzo estimado:** 3-4h (compartido con bitácora)

---

## 2. Cotizaciones (solicitudes de cotización)

### Qué funciona

| Aspecto | Estado |
|---------|--------|
| Crear solicitud de cotización por obra, con envío a contratistas | ✅ |
| Análisis de compras con IA (`analisis_compras`) | ✅ |
| Confirmar respuestas / registrar cotizaciones recibidas | ✅ |
| Manejo de errores de dominio (`ValueError` → 422/404) | ✅ |
| Estados de la solicitud (enviada/respondida) | ✅ |

### Gaps detectados y cómo resolverlos

---

#### Gap 1 — Endpoints sin scope de tenant (IDOR)

**Impacto:** Alto — seguridad

Las rutas de solicitudes usan `CurrentUserId` y varias ignoran al usuario (`_: CurrentUserId`), operando por `obra_id` sin verificar que la obra sea del tenant:

```python
@router.get(...)
async def list_solicitudes(obra_id: int, db: DbSession, _: CurrentUserId):
    # ← no valida que obra_id pertenezca al tenant del usuario
```

Un usuario de otra empresa puede listar/crear/confirmar cotizaciones de una obra ajena conociendo el `obra_id`. Es el mismo IDOR de tareas y materiales.

**Solución profesional:** pasar `CurrentUser` y validar `obra.tenant_id == user.tenant_id` (404 si no) en cada endpoint, reusando el helper de acceso a obra que se arregle en el núcleo operativo.

**Esfuerzo estimado:** 2-3h (todo el router de solicitudes)

---

#### Gap 2 — El contratista responde por un canal no verificado

**Impacto:** Medio

La solicitud se envía a contratistas (por WhatsApp/email) y luego alguien confirma la respuesta manualmente. Conviene revisar que el enlace/flujo por el que el contratista responde no permita a un tercero cargar cotizaciones a nombre de otro (token por link, expiración), similar al patrón de invitaciones.

**Solución profesional:** token de respuesta por contratista con expiración; la carga de la cotización queda atada a ese token, no abierta.

**Esfuerzo estimado:** 3-4h

---

## 3. Órdenes de compra

### Qué funciona

| Aspecto | Estado |
|---------|--------|
| Listar/crear órdenes por obra | ✅ |
| **Enviar** orden al proveedor (WhatsApp/email) | ✅ |
| **Recibir** (confirmar recepción) → alerta + historial | ✅ |
| Vista de presupuesto por obra (`/obras/{id}/presupuesto`) | ✅ |

### Gaps detectados y cómo resolverlos

---

#### Gap 1 — Verificar scope de tenant en enviar/recibir

**Impacto:** Alto (a confirmar) — seguridad

Los endpoints operan por `order_id`/`obra_id`. Dado el patrón del resto del cluster, hay que verificar que enviar/recibir/crear una orden valide el tenant de la obra. Enviar una orden dispara un mensaje real a un proveedor: un IDOR acá no solo lee datos, **ejecuta una acción externa** (manda un WhatsApp/email a nombre de otra empresa).

**Solución profesional:** mismo fix de tenant-scope; y como el envío es un side-effect externo, gatearlo además por rol (admin/jefe).

**Esfuerzo estimado:** 2-3h

---

#### Gap 2 — Envío externo sin idempotencia ni reintento controlado

**Impacto:** Bajo-Medio

"Enviar orden" hace una llamada externa (WhatsApp/email). Conviene que sea idempotente (no reenviar dos veces por doble click) y que un fallo del proveedor no deje la orden en estado ambiguo.

**Solución profesional:** marcar `sent_at` y bloquear reenvío si ya está enviada (o pedir confirmación explícita para reenviar); registrar el resultado del envío.

**Esfuerzo estimado:** 1-2h

---

## 4. Materiales por tarea

### Qué funciona

| Aspecto | Estado |
|---------|--------|
| CRUD de materiales por tarea (nombre, cantidad, unidad, precio, proveedor, responsable, estado) | ✅ |
| Enriquecido con nombres de proveedor/responsable/creador (`_enrich`) | ✅ |
| Rollup a la planilla (cantidad/costo/pendientes en `TaskRead`) | ✅ |
| Estados de material (pendiente/pedido/recibido) | ✅ |

### Gaps detectados y cómo resolverlos

---

#### Gap 1 — Sin verificación de tenant/acceso (IDOR)

**Impacto:** Alto — seguridad

`create_material` valida la tarea con `_get_task_or_404(task_id, db)`, que **solo chequea que la tarea exista**, no que su obra pertenezca al tenant del usuario. `list`/`update`/`delete` usan `CurrentUserId` sin chequeo. Un usuario puede leer/cargar/editar/borrar materiales (y por ende el presupuesto) de tareas de **otra empresa**.

**Solución profesional:** que `_get_task_or_404` (o su reemplazo) valide `task.obra.tenant_id == user.tenant_id`, y que todas las rutas usen `CurrentUser`. Es el mismo fix sistémico.

**Esfuerzo estimado:** 1-2h (una vez que exista el helper de acceso por tenant)

---

## 5. Proveedores

### Qué funciona

| Aspecto | Estado |
|---------|--------|
| CRUD **solo-admin** (`AdminUser` en create/update/delete) | ✅ |
| **Aislamiento por tenant** (`tenant_id` en create, filtros por tenant) | ✅ |
| Categoría, contacto, notas; buscable al cargar material | ✅ |

### Gaps detectados

- **Gap 1 (Bajo):** el borrado de proveedor — verificar qué pasa con los materiales/órdenes que lo referencian (FK `SET NULL` en materiales según el modelo). Al borrar, esos quedan "sin proveedor"; está bien, pero conviene avisar "este proveedor está usado en N materiales" antes de borrar.

Este sub-módulo es el mejor resuelto del cluster: admin-only + tenant-scoped. Sirve de **referencia** de cómo deberían quedar los otros.

---

## 6. Planos (gestión documental versionada)

### Qué funciona

| Aspecto | Estado |
|---------|--------|
| Subir plano por obra con disciplina + versionado (`version`, `is_latest`) | ✅ |
| Listar planos por obra; borrar (tenant-scoped en delete) | ✅ |
| Consulta por WhatsApp (el responsable pide el plano desde el chat) | ✅ |
| Metadatos: disciplina, nombre, tipo, tamaño, quién subió | ✅ |

### Gaps detectados y cómo resolverlos

---

#### Gap 1 — `GET /obras/{id}/planos` no verifica tenant

**Impacto:** Alto — seguridad

`list_planos(obra_id, db, _: CurrentUser)` ignora al usuario: lista los planos de cualquier obra por id, sin chequear tenant. Fuga cross-tenant de documentos técnicos.

**Solución profesional:** validar `obra.tenant_id == user.tenant_id` antes de listar.

**Esfuerzo estimado:** 30 min

---

#### Gap 2 — Los archivos se sirven SIN autenticación (exposición pública de documentos)

**Impacto:** Crítico — seguridad (el gap más grave del sistema)

Los planos/presupuestos/imágenes se sirven por:

```python
@app.get("/uploads/{filename}")
async def serve_uploaded_file(filename: str):     # ← sin dependency de auth
    safe = Path(filename).name                    # ok: previene path traversal
    fp = UPLOADS_DIR / safe
    return FileResponse(str(fp))
```

**No hay autenticación ni scope de tenant.** Cualquiera con el nombre del archivo (compartido, cacheado, filtrado en logs, o un ex-empleado con una URL vieja) descarga el documento. Para planos de obra y presupuestos —información sensible y a veces contractual— es una exposición pública.

**Solución profesional — servir archivos autenticados y scopeados:**
```python
@app.get("/uploads/{filename}")
async def serve_uploaded_file(filename: str, current_user: CurrentUser, db: DbSession):
    # 1. buscar el registro (plano/budget/imagen) por file_path
    # 2. verificar que su tenant == current_user.tenant_id
    # 3. recién ahí devolver el FileResponse
```
Mejor aún: **URLs firmadas con expiración** (signed URLs) o mover a un bucket privado (S3/R2) con URLs prefirmadas. Así el enlace caduca y no queda expuesto para siempre.

**Esfuerzo estimado:** 3-4h (auth + scope) / 1 día (migrar a bucket con signed URLs)

---

#### Gap 3 — Almacenamiento en filesystem local (no escala, riesgo de pérdida)

**Impacto:** Medio-Alto

`UPLOADS_DIR = .../uploads` es el disco del proceso. Problemas: en deploy con múltiples instancias, cada una tiene sus archivos (un plano subido en la instancia A no existe en la B); en contenedores efímeros, un redeploy **borra los archivos**; no hay backup ni CDN.

**Solución profesional:** almacenamiento de objetos (S3 / Cloudflare R2 / GCS). Se sube al bucket, se guarda la key en BD, se sirve con URL prefirmada. Es el estándar para cualquier app con archivos en producción.

**Esfuerzo estimado:** 1 día (integración de bucket + migración de existentes)

---

#### Gap 4 — Sin validación de tamaño/tipo en la subida

**Impacto:** Medio

Conviene limitar tamaño (planos pueden ser pesados, pero un tope evita abuso) y validar el tipo/extensión antes de guardar.

**Esfuerzo estimado:** 1h

---

## 7. Resumen: Fortalezas vs Debilidades

### Fortalezas

1. **Presupuestos con IA multimodal** (PDF/imagen/Excel) + comparación con recomendación, bien aislado por tenant.
2. **Proveedores solo-admin + tenant-scoped** — el sub-módulo mejor resuelto, sirve de referencia.
3. **Flujo de compras end-to-end**: material → orden → envío al proveedor → recepción → alerta + historial.
4. **Planos versionados** con consulta por WhatsApp (buen diferencial).
5. **Validación de tipo de archivo** y manejo de error de IA en presupuestos.

### Debilidades (ordenadas por impacto)

| # | Debilidad | Categoría |
|---|-----------|-----------|
| 1 | `GET /uploads/{filename}` sin auth → planos/presupuestos públicos | Seguridad (crítico) |
| 2 | Materiales, cotizaciones y `list_planos` sin scope de tenant (IDOR) | Seguridad |
| 3 | Órdenes de compra: envío externo — verificar tenant + gate por rol | Seguridad |
| 4 | Archivos en filesystem local (no escala, se pierden en redeploy) | Escala / Datos |
| 5 | Sin límite de tamaño en subidas (planos, presupuestos) | Robustez |
| 6 | Sin control de costo/uso de IA (presupuestos + bitácora) | Costo / Monetización |
| 7 | Envío de órdenes sin idempotencia | Robustez |

---

## 8. Prioridad de correcciones

### P0 — Seguridad

| Tarea | Qué cambiar | Esfuerzo |
|-------|-------------|---------|
| Autenticar y scopear el servido de `/uploads/{filename}` | `main.py` (dependency + verificación de tenant) | 3-4h |
| Scope de tenant en materiales (`_get_task_or_404`) | `routes/task_materials.py` | 1-2h |
| Scope de tenant en cotizaciones (todo el router) | `routes/solicitudes.py` | 2-3h |
| Scope de tenant en `list_planos` | `routes/planos.py` | 30 min |
| Verificar tenant + gate por rol en enviar/recibir orden | `routes/purchase_orders.py` | 2-3h |

### P1 — Robustez y costo

| Tarea | Qué cambiar | Esfuerzo |
|-------|-------------|---------|
| Límite de tamaño en subidas (presupuestos/planos) | `budget_service.py`, `routes/planos.py` | 1-2h |
| Idempotencia en envío de órdenes (`sent_at`) | `purchase_order` service/route | 1-2h |
| Aviso al borrar proveedor usado | `routes/suppliers.py`, front | 1h |
| Token de respuesta por contratista en cotizaciones | `solicitud_service.py` | 3-4h |

### P2 — Escala

| Tarea | Qué cambiar | Esfuerzo |
|-------|-------------|---------|
| Migrar archivos a bucket (S3/R2) con signed URLs | `main.py`, servicios de upload, migración | 1 día |
| Control de uso de IA por tenant/plan (compartido) | `models/ai_usage.py`, `budget_service.py`, `bitacora_service.py` | 3-4h |

---

## 9. Archivos clave por corrección

| Corrección | Backend | Frontend |
|-----------|---------|----------|
| Servido de uploads autenticado | `app/main.py` (`serve_uploaded_file`) | — |
| Tenant en materiales | `api/routes/task_materials.py` (`_get_task_or_404`) | — |
| Tenant en cotizaciones | `api/routes/solicitudes.py` | — |
| Tenant en planos (list) | `api/routes/planos.py` | — |
| Tenant + rol en órdenes | `api/routes/purchase_orders.py` | — |
| Límite de tamaño de archivo | `services/budget_service.py`, `api/routes/planos.py` | `ImportModal.tsx`/`PlanosTab` |
| Bucket S3/R2 + signed URLs | `app/main.py`, servicios de upload, nueva config | — |
| Uso de IA por plan | nueva `models/ai_usage.py`, `services/budget_service.py`, `services/bitacora_service.py`, `core/plan_limits.py` | `AdminPage.tsx` |

---

## 10. Cierre — visión de sistema (los 3 audits)

Con los tres clusters auditados (auth/planes, núcleo operativo, comunicación de campo, compras/documentos) el diagnóstico es consistente:

- **El producto es funcionalmente completo y algorítmicamente sólido** (CPM, cascade, chatbot conversacional, IA multimodal, versionado de planos). Está mucho más avanzado que un MVP típico.
- **La deuda concentrada es de autorización multi-tenant.** El mismo bug se repite en tareas, materiales, cotizaciones, historial, salas de socket y servido de archivos: `CurrentUserId` sin tenant y "asserts" que solo verifican existencia. **Es una sola corrección conceptual aplicada en ~8 lugares.** Debería ser el P0 número uno del proyecto antes de cualquier cliente real multi-empresa.
- **La segunda deuda es de producción/escala:** archivos locales sin auth, estado en memoria del socket, falta de rate limiting y de billing real (del audit de auth).

Recomendación: una **rama única "hardening de autorización"** que barra todos los endpoints y unifique el acceso por tenant (helper compartido), seguida de la capa de archivos (bucket + auth) y el backplane de Redis. Con eso, el sistema pasa de "demo muy avanzada" a "listo para multi-empresa real".
