# Auditoría 04 — Responsables (User + Responsible + ObraTeamMember)

> **Fecha:** 2026-08-18
> **Auditor:** Claude Sonnet 4.6 (con supervisión de Facundo)
> **Alcance:** las tres entidades que forman el "módulo de responsables" — `User` (staff que loguea), `Responsible` (contactos de WhatsApp sin login) y `ObraTeamMember` (relación entre `Responsible` y una obra puntual con `member_type` + `plan_disciplines`). Cubre resolución de identidad en el bot de WhatsApp y filtrado de planos por disciplina.
> **Metodología:** lectura de código + ejecución local (backend `:8000`, frontend `:5173`) + suite `pytest` (72/72 verdes al arrancar) + `curl` para reproducir cada uno de los 5 puntos del contexto + simulación del webhook Twilio con `APP_DEBUG=true`. Se abrieron sesiones con tokens de dos tenants distintos (facundo tenant 2 y admin@demo tenant 8, cuya clave se reseteó a `12345678` para poder probar cross-tenant).

---

## 1. Resumen ejecutivo

El módulo **funciona a nivel operativo básico**: se pueden crear responsables, agregarlos a una obra, asignarles `member_type` y `plan_disciplines`, y el bot de WhatsApp respeta las disciplinas al filtrar planos (probado con `plan_disciplines=["gas"]` → responde "No tenés acceso al plano de electricidad. Podés pedir: gas."). La suite `pytest` arranca en 72/72 verdes.

Pero **no está production-ready**. **Los 5 puntos del contexto están confirmados como bugs reales**, y se detectaron 4 huecos adicionales durante la auditoría. En orden de severidad:

1. **[CRÍTICO — fuga cross-tenant]** `GET /responsibles/lookup?whatsapp=<numero>` **no filtra por tenant**. Un usuario del tenant A puede consultar el responsable de otro tenant y **recibir de vuelta el detalle de sus tareas activas** (obra, título, fecha de vencimiento, estado). Reproducido: con token de facundo (tenant 2) consulté `+15005550001` y me devolvió Carlos Méndez del tenant 8 con 3 tareas suyas expuestas.

2. **[CRÍTICO — cross-tenant injection]** `POST /obras/{obra_id}/team` **no valida que `responsible_id` pertenezca al mismo tenant que la obra**. Reproducido: con token de facundo (tenant 2), agregué el `responsible_id=29` (Carlos Méndez, tenant 8) al equipo de la obra 17 (tenant 2). Respuesta 201, `ObraTeamMember` creado con `tenant_id=2` pero `responsible.tenant_id=8`. Esto es el mismo patrón que el bug 7.2 del audit 03 pero ahora también en `/obras/{id}/team`.

3. **[ALTO — unicidad global rompe multi-tenant]** `Responsible.whatsapp_number` tiene `unique=True` **sin scope de tenant**. Reproducido: creé `+5491199888777` como responsible del tenant 2, luego intenté crearlo en tenant 8 (con token de admin@demo) y devolvió **409 "A responsible with number +5491199888777 already exists"**. Un carpintero que trabaja para dos empresas distintas no puede estar cargado en ambos tenants.

4. **[ALTO — ambigüedad de identidad silenciosa]** En `MessageService.process_inbound()`, la resolución es `sender = responsible or staff`. Si el mismo `whatsapp_number` está en `Responsible` y en `User` (staff), **el Responsible siempre gana y el staff es eclipsado silenciosamente**. Reproducido: `admin@demo.constructa.com` (User admin tenant 8) tiene `whatsapp_number=+5493517066964` — el mismo número que Ximena (Responsible tenant 2). Al mandar un webhook desde ese número, el bot lo atiende como Ximena del tenant 2, y `admin@demo` no ve nada. Sin error, sin log de conflicto.

5. **[MEDIO — no hay directorio general en frontend]** El endpoint `GET /responsibles` existe y funciona (filtra por tenant), pero **el frontend no lo expone**: `EquipoPage.tsx` gestiona solo `User` (staff), y los `Responsible` solo se pueden ver/editar desde `ObraResponsablesTab.tsx` dentro de una obra. Para desactivar a un responsable hay que entrar a alguna obra donde participe. No hay "Directorio de responsables del tenant".

**Diagnóstico de fondo:** la separación User/Responsible/ObraTeamMember tiene una razón conceptual válida (staff loguea, responsable no) pero la implementación arrastra las tres entidades con **campos duplicados sin unificar**, `whatsapp_number` global unique en ambas tablas, y los filtros de tenant no están aplicados uniformemente en los endpoints y repositorios. La mayoría de los bugs se resuelven con `where(X.tenant_id == current_user.tenant_id)` en 4-5 lugares puntuales, sin necesidad de rediseñar el modelo.

---

## 2. Modelo de datos y por qué está dividido así

### 2.1 Las tres entidades

| Entidad | Tabla | Auth | Uso principal | Se ve desde |
|---|---|---|---|---|
| **`User`** | `users` | Sí (JWT) | Staff que loguea a la web (admin/arquitecto/jefe/collaborator). Puede tener `whatsapp_number` para usar el bot como staff. | `EquipoPage.tsx` (frontend/src/pages/EquipoPage.tsx) — llamando `api/users`. |
| **`Responsible`** | `responsibles` | No | Contactos de WhatsApp (obreros, contratistas) sin login. Identificados por `whatsapp_number` E.164. Tenant-wide (una vez creado, se puede reusar en varias obras del mismo tenant). | `ObraResponsablesTab.tsx` (frontend/src/components/ObraResponsablesTab.tsx) — pero **solo dentro de una obra**. |
| **`ObraTeamMember`** | `obra_team_members` | No | Relación N-a-N entre `Responsible` y una obra puntual, con atributos: `member_type` ("equipo"/"contratista") + `plan_disciplines` (JSON `null | []` | `["electricidad", "gas"]`). | Se crea/edita desde `ObraResponsablesTab.tsx` o `ObraSetupWizard.tsx`. |

### 2.2 ¿Tiene sentido la división?

**Sí en teoría, sí con matices en la práctica.** El User tiene contraseña, roles (admin/collaborator), `email`, `full_name`, `is_verified`; el Responsible tiene `whatsapp_number` obligatorio, no tiene contraseña ni email. Fusionarlos como una sola tabla "Persona" con `has_login: bool` traería problemas: buena parte de los responsables (obreros) no tienen email y no aceptarían el flujo de "verificación de email" del audit 01. Y el `Responsible` es tenant-wide por diseño (para poder reusarlo entre obras) mientras que el `User` es del tenant. Se pisan en función pero no en propósito.

**Sí es fuente de bugs cuando:**

- **`whatsapp_number` está en dos tablas.** Tanto `users.whatsapp_number` como `responsibles.whatsapp_number` son `unique=True` a nivel global. Nada impide que un mismo número esté en las dos (probado: `+5493517066964` está en `Responsible` tenant 2 y `User` tenant 8). El bot resuelve la ambigüedad implícitamente eligiendo el Responsible. Es un side-effect de tener dos tablas: si fueran una sola con `has_login`, la unicidad de `whatsapp_number` sería trivial de garantizar.
- **Los filtros de tenant no son homogéneos.** `ResponsibleRepository.get_by_whatsapp` no filtra por tenant, `UserRepository.get_by_whatsapp` tampoco, `POST /obras/{id}/team` no valida tenant del responsible, `GET /responsibles/lookup` no valida tenant. En cambio los CRUD (`POST /responsibles`, `GET /responsibles`) sí filtran. Es inconsistencia, no falta de infraestructura.
- **`ObraTeamMember` puede quedar huérfano.** Si desactivo un `Responsible` (soft-delete → `is_active=False`), la fila en `obra_team_members` sigue apuntando a él y `GET /obras/{id}/team` sigue devolviéndolo con `is_active=False`. La pantalla muestra "Ximena" con badge de "Inactivo" pero la relación no se limpió.

**Recomendación (ver 7):** mantener las tres entidades separadas pero (a) mover `whatsapp_number` **solo a `Responsible`** (y para que un User use el bot, que se linkee a un Responsible autogenerado del mismo tenant), (b) unicidad `(tenant_id, whatsapp_number)` en vez de global, (c) filtrar por tenant en todos los repositorios y endpoints.

---

## 3. Inventario de funcionalidad

| Función | Implementado | Probado y funciona | Archivo(s) |
|---|---|---|---|
| **User** — Listar staff del tenant | Sí | Sí — filtra por tenant | `app/api/routes/users.py:46-48` |
| Invitar staff con token 72h | Sí | Sí (probado en audit 01) | `app/api/routes/users.py:51`, `app/services/auth_service.py:78` |
| Cambiar rol (admin/collaborator) | Sí | Sí, cross-tenant → 404 | `app/api/routes/users.py:63-72` |
| Soft-delete staff | Sí | Sí | `app/api/routes/users.py:79-87` |
| `User.whatsapp_number` con `unique=True` global | Sí | **Sin filtro tenant → colisión posible cross-tenant** (S3) | `app/models/user.py:27` |
| **Responsible** — Crear | Sí | Sí — check `whatsapp_number` unique **GLOBAL** → 409 cross-tenant (S1) | `app/api/routes/responsibles.py:20-25`, `app/services/responsible_service.py:18-25` |
| Listar responsibles del tenant | Sí | Sí — filtra por tenant | `app/api/routes/responsibles.py:28-31` |
| `GET /responsibles/lookup?whatsapp=...` | Sí | **No filtra tenant — fuga cross-tenant de datos** (S2) | `app/api/routes/responsibles.py:36-45`, `app/services/responsible_service.py:36-43` |
| Get by ID (`GET /responsibles/{id}`) | Sí | Sí — usa `get_or_raise(tenant_id)` correctamente | `app/api/routes/responsibles.py:57-62`, `app/services/responsible_service.py:27-34` |
| Update responsible | Sí | Sí | `app/api/routes/responsibles.py:65-69` |
| Reactivar responsible | Sí | Sí | `app/api/routes/responsibles.py:71-75` |
| Soft-delete responsible | Sí (con unassign de tareas) | Sí — **pero deja `ObraTeamMember` huérfano** (S7) | `app/api/routes/responsibles.py:77-85`, `app/services/responsible_service.py:74-97` |
| Soft-delete de User → limpia `Responsible` linkeado | N/A | (no aplica) | — |
| **ObraTeamMember** — Listar equipo de obra | Sí | Sí | `app/api/routes/obra_team.py:GET /obras/{obra_id}/team` |
| Agregar responsible a obra | Sí | **No valida `responsible.tenant_id == obra.tenant_id` — cross-tenant injection reproducido** (S4) | `app/api/routes/obra_team.py:69-72` |
| Update `member_type` y `plan_disciplines` | Sí | Sí — probado con `plan_disciplines=["gas"]` | `app/api/routes/obra_team.py:PATCH /obras/{obra_id}/team/{responsible_id}` |
| Remover del equipo (`DELETE`) | Sí | Sí, pero es **HARD delete** (fila desaparece), inconsistente con el soft-delete del Responsible | `app/api/routes/obra_team.py:DELETE /obras/{obra_id}/team/{responsible_id}` |
| **Bot WhatsApp** — Identificación de emisor (`Responsible` primero, luego `User`) | Sí | Sí, **pero con ambigüedad silenciosa si el número está en ambos** (S5) | `app/services/message_service.py:64-69` |
| Bot — filtrar planos por `plan_disciplines` | Sí | **Sí — funciona correctamente** con `null` (todos), `[]` (ninguno), lista específica | `app/services/message_service.py:266-363`, `app/services/plano_service.py:allowed_disciplines_for_responsible` |
| Send window / `chatbot_enabled` para Responsibles | Sí | Sí — pero mensaje procesado **sin reply**, silencioso (S8) | `app/services/message_service.py:169-179` |
| **Frontend** — Directorio general de Responsibles (fuera de obra) | **No** | **No existe** — `EquipoPage` es solo de Users. `Responsibles` solo se ven desde `ObraResponsablesTab` (S6) | `frontend/src/pages/EquipoPage.tsx`, `frontend/src/components/ObraResponsablesTab.tsx` |
| Frontend — Selector de disciplinas (`plan_disciplines`) | Sí | Sí — tres estados visuales: `null` "Todos" (verde), `[]` "Sin acceso" (naranja), lista (azul) | `frontend/src/components/ObraResponsablesTab.tsx:65-110` |
| Frontend — Selector de `member_type` | Sí | Sí — toggle equipo/contratista | `frontend/src/components/ObraResponsablesTab.tsx:29-63` |
| Frontend — Wizard de alta de obra agrega Responsibles | Sí | No forzado esta ronda | `frontend/src/components/ObraSetupWizard.tsx` (paso "Responsables") |
| Tests directos de responsibles | **No** | Sin cobertura específica; algunas verificaciones en `test_tenant_isolation.py` para tenant | `backend/tests/` |
| Tests directos de bot flow con `plan_disciplines` | **No** | Sin cobertura | — |

---

## 4. Hallazgos sobre los 5 puntos del contexto

### 4.1 [Punto 1 — CONFIRMADO] `Responsible.whatsapp_number` unique global rompe multi-tenant real

**Hipótesis:** dos tenants distintos que intenten crear un `Responsible` con el mismo número reciben `ConflictError` aunque sean empresas totalmente distintas.

**Reproducción:**

```bash
# Con TOKEN_T2 (facundo, tenant 2)
POST /api/v1/responsibles
  {"full_name":"Audit-P1-T2","whatsapp_number":"+5491199888777","role":"Obrero"}
→ 201 {"id":36,"whatsapp_number":"+5491199888777","is_active":true, ...}

# Con TOKEN_T8 (admin@demo, tenant 8)
POST /api/v1/responsibles
  {"full_name":"Audit-P1-T8-diferente","whatsapp_number":"+5491199888777","role":"Contratista"}
→ 409 {"detail":"A responsible with number +5491199888777 already exists"}
```

**Confirma que:** el `unique=True` en `responsibles.whatsapp_number` (definido en `app/models/responsible.py:13-14`) es global. En un sistema multi-tenant real esto es incorrecto — un albañil que trabaja para dos constructoras distintas no puede figurar en ambos tenants. Peor: el atacante puede "reservar" un número de la competencia creando un Responsible con ese número en su tenant (sin verificación de propiedad del número).

**Fix:** cambiar el `unique=True` por un `UniqueConstraint(tenant_id, whatsapp_number)`. Migración requerida.

### 4.2 [Punto 2 — CONFIRMADO] `GET /responsibles/lookup` sin filtro de tenant → fuga de datos

**Hipótesis:** un usuario autenticado del tenant A puede consultar por ese endpoint el responsable de un número que pertenece al tenant B.

**Reproducción:**

```bash
# Token facundo (tenant 2), lookup de un número del tenant 8 (Carlos Méndez)
GET /api/v1/responsibles/lookup?whatsapp=%2B15005550001
Authorization: Bearer <TOKEN_T2>

→ 200 {
    "id":29,
    "full_name":"Carlos Méndez",
    "whatsapp_number":"+15005550001",
    "role":"Jefe de Obra",
    "is_active":true,
    "created_at":"2026-08-10T12:42:46.895296Z",
    "active_tasks":[
      {"id":285,"obra_id":31,"title":"Relevamiento del local existente","status":"pendiente","due_date":"2026-09-08"},
      {"id":271,"obra_id":30,"title":"2.4 Encofrado y hormigonado 1er piso","status":"bloqueada","due_date":"2026-09-14"},
      {"id":287,"obra_id":31,"title":"Trámites municipales y p...", ...}
    ]
  }
```

**Confirma que:** el endpoint devuelve **el responsable completo + detalle de sus tareas activas** (con títulos, fechas, estados, obras) de un tenant ajeno. El guard es `CurrentUserId` (línea 41 de `responsibles.py`) — autentica al usuario pero **no valida que `responsible.tenant_id == current_user.tenant_id`**. Un competidor con una cuenta legítima en el SaaS puede iterar números conocidos y mapear qué obras/tareas maneja la competencia.

**Fix:** en `ResponsibleService.lookup_by_whatsapp`, filtrar por `tenant_id=current_user.tenant_id`. Si el número no pertenece al tenant → 404 (mismo patrón que las otras auditorías).

**Nota importante:** este endpoint también es usado por n8n / integraciones externas para identificar al emisor de un mensaje. Si se agrega el filtro, hay que asegurar que las integraciones pasen su `tenant_id` o usen un token con contexto de tenant explícito.

### 4.3 [Punto 3 — CONFIRMADO] Mismo número en `User` y `Responsible` → Responsible gana silenciosamente

**Hipótesis:** si un mismo número queda cargado en `Responsible` (tenant A) y `User.whatsapp_number` (tenant B), el sistema trata al staff como si fuera un responsable común, sin error ni log de conflicto.

**Reproducción:**

Datos existentes en la DB:
- `Responsible` id=10, tenant 2, nombre "Ximena", `whatsapp_number=+5493517066964`
- `User` id=34, tenant 8, `email=admin@demo.constructa.com`, role=admin, `whatsapp_number=+5493517066964`

Simulé un webhook desde `+5493517066964` (con `AccountSid` completo tras aprender el hueco del audit 03 §7.10):

```bash
POST /api/v1/webhooks/twilio
  From=whatsapp:+5493517066964
  Body=HOLA
  ...

# El bot procesó el mensaje como Ximena (Responsible tenant 2)
# El User admin@demo (tenant 8) fue eclipsado sin ningún log de conflicto
```

**Confirma que:** en `MessageService.process_inbound()` líneas 64-69:

```python
responsible = await self.resp_repo.get_by_whatsapp(payload.from_number)
staff = None if responsible else await self.user_repo.get_by_whatsapp(payload.from_number)
sender = responsible or staff
is_staff = responsible is None and staff is not None
```

El código NUNCA busca staff si ya encontró un Responsible. **Un User con `whatsapp_number` que colisiona con un Responsible existente no puede usar el bot como staff**. Y peor: si el admin de un tenant crea un Responsible que "casualmente" tiene el mismo número que un User de otro tenant, secuestra la identidad del User en el bot.

**Fix:** o (a) prohibir que un número esté en las dos tablas al mismo tiempo (validación al crear en cualquiera de las dos), o (b) unificar la lógica en una sola tabla "Persona" con `has_login: bool` (recomendación de fondo, ver §7).

### 4.4 [Punto 4 — CONFIRMADO] No hay pantalla de directorio general de Responsibles

**Hipótesis:** no existe una pantalla de directorio global de Responsibles del tenant fuera del contexto de una obra. Para desactivar a alguien hay que entrar a una obra donde participe.

**Reproducción:**

- `EquipoPage.tsx` (línea 5): `import { fetchMembers, removeMember, updateMemberRole } from "../api/users";` — gestiona **Users** (staff), NO Responsibles.
- `App.tsx`: en `selectedObra === null` renderiza `PortfolioPage`; no hay ruta ni menú para directorio global de responsables. Grep del código: `grep -rn "GlobalTeam\|DirectorioResponsables\|/responsables" frontend/src/` → no matches.
- El endpoint backend `GET /api/v1/responsibles` **sí existe** y funciona (devuelve todos los del tenant), pero el frontend no lo consume desde ninguna pantalla global.
- El único acceso a Responsibles es desde una obra: `ObraDetailPage.tsx` → pestaña `ObraResponsablesTab.tsx` → llama `GET /obras/{id}/team`. Y también `ObraSetupWizard.tsx` en el paso "Responsables" al crear obra.

**Confirma que:** para desactivar/reactivar/editar un responsable, hay que:
1. Ir al Portfolio.
2. Abrir una obra donde ese responsable participe.
3. Ir al tab "Responsables".
4. Editar/desactivar.

Si el responsable ya no participa en ninguna obra activa (por haber sido removido con `DELETE /obras/{id}/team`), queda sin manera de gestionarlo desde la UI.

**Fix:** agregar `DirectorioResponsablesPage.tsx` en el sidebar (bajo "Organización" junto a "Gestión de equipo"). Consume `GET /responsibles` que ya existe. Bajo esfuerzo, alto valor UX.

### 4.5 [Punto 5 — CONFIRMADO que SÍ funciona] `plan_disciplines` filtra planos por WhatsApp

**Hipótesis:** confirmá que `plano_service` efectivamente filtra los documentos según la disciplina asignada cuando alguien los pide por WhatsApp, y no es un campo que se guarda pero no se usa.

**Reproducción:**

Setup: Ximena (Responsible tenant 2, whatsapp `+5493517066964`) en obra 17. Obra 17 tiene 1 plano cargado con `discipline=electricidad`. Antes de arrancar tuve que setear `send_hour_to=24` en `SystemSettings` porque el bot ignora mensajes fuera del `send_window` (finding lateral: §5.8).

**Test A — `plan_disciplines=["gas"]` + pedir electricidad:**

```
Body=PLANO ELECTRICIDAD
→ "No tenés acceso al plano de electricidad. Podés pedir: gas."   ✓
```

**Test B — `plan_disciplines=["gas"]` + pedir gas (no hay plano cargado):**

```
Body=PLANO GAS
→ "No encontré un plano de gas cargado."   ✓
```

**Test C — `plan_disciplines=null` (acceso total) + pedir electricidad:**

```
Body=PLANO ELECTRICIDAD
→ "📐 Plano de electricidad (v3, 21/06/2026)."   ← envía el plano
```

**Confirma que:** el filtro funciona en `message_service.py` líneas 292-295 (listado) y 339-344 (pedido puntual), llamando a `PlanoService.allowed_disciplines_for_responsible(responsible_id, obra_id)` que lee `ObraTeamMember.plan_disciplines`. Los tres valores del campo tienen semántica clara:

- `null` = acceso total (default de "equipo"/capataz).
- `[]` (lista vacía) = sin acceso.
- `["electricidad", "gas"]` = solo esas disciplinas.

**Estado:** este punto es **el único que funciona bien**. `plan_disciplines` no es cosmético.

---

## 5. Qué tiene sentido como está

- **`plan_disciplines` funciona end-to-end.** Filtro correcto en el listado (`PLANOS`), en el pedido puntual (`PLANO ELECTRICIDAD`), y en el caso de múltiples obras del mismo responsable (líneas 311-317 filtran las obras a las que tiene acceso a esa disciplina). La semántica `null | [] | list` está bien definida y consistente entre backend y frontend.

- **`ResponsibleService.get_or_raise(responsible_id, tenant_id)` valida aislamiento correctamente.** Los endpoints que lo usan (`GET /responsibles/{id}`, `PATCH`, `DELETE`, `PATCH .../reactivate`) rechazan cross-tenant con 404 sin revelar existencia. Es el mismo patrón consistente que las auditorías anteriores.

- **Soft-delete de Responsible + unassign de tareas activas.** `deactivate()` en `responsible_service.py:74-97` no solo marca `is_active=False` sino que quita al responsable de todas las tareas activas y loguea cada unassignment en historial. Correcto — cuando un obrero deja la empresa, sus tareas quedan sin asignar y el jefe sabe que hay que redistribuirlas. (Falta que también limpie `ObraTeamMember` — ver §6.7.)

- **Denormalización de `tenant_id` en `ObraTeamMember`.** La tabla tiene `tenant_id` propio (además de heredarlo por FK a la obra). Consistente con la política del proyecto (audit 01 §5 y audit 03) de evitar joins en filtros de aislamiento.

- **Guard `AdminUser` en operaciones de escritura sobre Responsibles y ObraTeamMember.** `POST /responsibles`, `PATCH`, `DELETE`, `POST /obras/{id}/team`, `PATCH`, `DELETE` — todos usan `AdminUser`. Un `collaborator` no puede modificar el equipo. (A diferencia de los bugs del audit 03 §7.1 en tasks, donde los guards no estaban.)

- **Endpoint `GET /responsibles` filtra por tenant.** El listado top-level es correcto — lo único que falla es el `lookup` puntual.

- **UI del selector de disciplinas** (`ObraResponsablesTab.tsx`). Tres estados visuales bien diferenciados: verde "Todos los planos" (null), naranja "Sin acceso a planos" ([]), azul "N disciplinas" (lista). El usuario no confunde los tres casos.

---

## 6. Qué no tiene sentido, está a medias o no funciona

### 6.1 [CRÍTICO] Fuga cross-tenant en `GET /responsibles/lookup`

Ver §4.2. El endpoint devuelve Responsable + tareas activas de otro tenant. `CurrentUserId` autentica pero no valida tenant. Reproducido con Carlos Méndez tenant 8 consultado desde token tenant 2.

### 6.2 [CRÍTICO] Cross-tenant injection en `POST /obras/{obra_id}/team`

**Qué pasa:** el endpoint recibe `responsible_id` y no valida que el `Responsible` sea del mismo tenant que la obra. Reproducido:

```bash
# Con TOKEN_T2 (facundo tenant 2), agregar Carlos Méndez (tenant 8) a obra 17 (tenant 2)
POST /api/v1/obras/17/team
Authorization: Bearer <TOKEN_T2>
  {"responsible_id":29,"member_type":"contratista"}

→ 201 {"responsible_id":29,"full_name":"Carlos Méndez","whatsapp_number":"+15005550001","member_type":"contratista",...}
```

En la DB, la fila de `obra_team_members` quedó con `tenant_id=2` (heredado de la obra), pero `responsibles.tenant_id=8`. Un **cross-tenant link persistido**.

**Consecuencias:**
- El nombre y whatsapp del responsable ajeno quedan expuestos en el UI del tenant atacante.
- Si el atacante después asigna una tarea de su obra a ese `responsible_id`, se crea el mismo patrón del bug 7.2 del audit 03: el responsable ajeno recibe mensajes del bot del tenant atacante (porque `_sender_obra_ids` en `message_service.py` es global).
- Si Carlos manda un mensaje al bot: el bot lo identifica como Carlos, ve sus obras del tenant 8 **más la obra 17 del tenant 2** que le acaban de inyectar → fuga total.

**Fix:** en `obra_team.py` (línea 69-72), validar `resp.tenant_id == current_user.tenant_id` antes de crear el `ObraTeamMember`. Mismo patrón que el fix de 7.2 del audit 03.

### 6.3 [ALTO] `Responsible.whatsapp_number` global unique impide multi-tenant real

Ver §4.1. Dos empresas no pueden tener el mismo carpintero cargado. El atacante puede "reservar" números conocidos de la competencia. Fix: `UniqueConstraint(tenant_id, whatsapp_number)`.

### 6.4 [ALTO] Ambigüedad silenciosa User vs Responsible con el mismo número

Ver §4.3. El bot decide implícitamente por Responsible. No hay log de conflicto. Fix: validar al crear que el número no esté en la otra tabla, o unificar.

### 6.5 [MEDIO] No hay pantalla de directorio global

Ver §4.4. El endpoint existe, el frontend no lo consume desde ninguna pantalla top-level. Fix: agregar `DirectorioResponsablesPage.tsx` bajo "Organización".

### 6.6 [MEDIO] `User.whatsapp_number` es unique global (sin scope de tenant)

`app/models/user.py:27` declara `whatsapp_number: Mapped[str | None] = mapped_column(String(20), unique=True, index=True, nullable=True)`. Igual que el bug 6.3 pero para Users. Dos admins de tenants distintos que usen la misma persona (mismo número real) no pueden cargarlo. Fix: mismo (`UniqueConstraint(tenant_id, whatsapp_number)`) o mejor eliminar el campo de User y unificar (§7).

### 6.7 [MEDIO] Soft-delete de Responsible deja `ObraTeamMember` huérfano

**Qué pasa:** al hacer `DELETE /responsibles/{id}`, el Responsible queda `is_active=False`, sus tareas activas se unassignea, pero las filas de `obra_team_members` **siguen existiendo**. Reproducido:

```bash
DELETE /api/v1/responsibles/10   → 200 (Ximena is_active=False)

# En DB:
SELECT * FROM obra_team_members WHERE responsible_id=10;
→ 2 filas: obra 16 (contratista) y obra 17 (equipo) — sin marcar como inactive
```

**Consecuencias:** el frontend muestra a Ximena en los equipos con badge "Inactivo" pero la fila sigue ahí. Si vuelvo a activar el responsable, aparece automáticamente en las obras — puede ser intencional o accidental. Además, el bot filtra tareas por responsible pero no chequea `is_active` del ObraTeamMember (no aplica hoy, pero es una capa de defensa perdida).

**Fix:** o (a) al desactivar el Responsible, marcar todas sus filas de `obra_team_members` como `is_active=False` (agregando esa columna), o (b) borrarlas explícitamente. La opción (a) preserva la historia; la (b) es más simple.

### 6.8 [MEDIO] Filtro `send_window` deja mensajes en "processed" sin reply — silencioso

**Qué pasa:** al testear el bot durante la auditoría (cerca de las 22 hs), el bot ignoraba mis webhooks porque estaban fuera del `send_window` (default `08-20`). El log dice `Message from +5493517066964 outside send window — ignoring`. El mensaje se guarda como inbound, se marca `processing_status=PROCESSED`, y **no se genera reply**.

Reproducido tres veces con SIDs distintos hasta que noté el log. Tuve que hacer `UPDATE SystemSettings SET send_hour_from=0, send_hour_to=24` para poder probar el punto 5.

**Consecuencias:** un responsable que mande un mensaje fuera del horario obtiene silencio total. No hay mensaje "Nuestro horario de atención es 08-20 hs, te respondemos mañana" ni nada. En un entorno de construcción real donde los obreros pueden mandar mensajes a cualquier hora, esto es UX pobre.

Es una decisión de producto (el nombre `send_window` sugiere que originalmente estaba pensado para _outbound_ recordatorios automáticos, no para bloquear _inbound_), y podría haber sido intencional. Pero el silencio absoluto es problemático.

**Fix:** o (a) responder con un mensaje de "estamos fuera de horario", o (b) permitir inbound siempre y aplicar el `send_window` solo a recordatorios outbound. La (b) es más alineada al nombre del campo y al comentario del código.

### 6.9 [BAJO] `DELETE /obras/{obra_id}/team/{responsible_id}` es hard delete

Inconsistente con el soft-delete del `Responsible`. Si borro a alguien del equipo, la fila desaparece; el historial no queda. Combinado con el soft-delete del Responsible mismo (que sí es "reversible"), es raro.

**Fix:** o cambiar a soft-delete (agregar `is_active`), o documentar el porqué de la asimetría.

### 6.10 [BAJO] Cobertura de tests casi nula del módulo

Baseline 72/72 tests verdes, pero **cero tests directos de**:
- Cross-tenant en `/responsibles/lookup`.
- Cross-tenant en `POST /obras/{id}/team`.
- `plan_disciplines` filter en el bot.
- Colisión User/Responsible con mismo número.
- Soft-delete de Responsible + estado de OTM.

Los tests de `test_tenant_isolation.py` cubren `role change` y `member delete` con guards de admin, pero no los específicos de este módulo.

---

## 7. Mejoras propuestas

### 7.1 Filtrar por tenant en `GET /responsibles/lookup` (cierra 6.1)

- **Qué:** en `ResponsibleService.lookup_by_whatsapp`, agregar filtro por `tenant_id=current_user.tenant_id`. Si el número no pertenece al tenant → 404 (no revela existencia).
- **Por qué:** cierra la fuga cross-tenant más grave.
- **Esfuerzo:** BAJO (3-5 líneas).
- **Riesgo:** MEDIO — n8n y otras integraciones pueden estar usando este endpoint asumiendo scope global. Verificar antes de aplicar. Si es solo para el bot y hoy siempre corresponde al tenant del sender, no rompe nada.

### 7.2 Validar tenant del responsible en `POST /obras/{obra_id}/team` (cierra 6.2)

- **Qué:** en `obra_team.py` línea 69-72, antes de crear el `ObraTeamMember`, comparar `resp.tenant_id == current_user.tenant_id`. Si no coincide → 422 "Responsable pertenece a otro tenant" (mismo patrón de mensajes que ya existe en tasks).
- **Por qué:** cierra la injection cross-tenant.
- **Esfuerzo:** BAJO (3 líneas).
- **Riesgo:** BAJO.

### 7.3 `whatsapp_number` unique por tenant en `Responsible` (cierra 6.3)

- **Qué:** dropear el `unique=True` de `responsibles.whatsapp_number`, agregar `UniqueConstraint(tenant_id, whatsapp_number)` en `__table_args__`. Migración: verificar antes que no haya duplicados dentro del mismo tenant (no debería, pero por prevención).
- **Por qué:** cierra 6.3 y habilita multi-tenant real.
- **Esfuerzo:** BAJO (migración + 2 líneas de modelo). Necesita un `SELECT tenant_id, whatsapp_number, COUNT(*) FROM responsibles GROUP BY 1,2 HAVING COUNT(*)>1` para verificar antes.
- **Riesgo:** BAJO. El cambio es aditivo (relaja restricción). Los tenants no se afectan entre sí.

### 7.4 Prohibir colisión User↔Responsible con mismo número (cierra 6.4, opción rápida)

- **Qué:** al crear un `User` con `whatsapp_number` (invite/update), buscar en `Responsible` si ese número ya existe → 409. Al crear un `Responsible`, buscar en `User` → 409.
- **Por qué:** cierra la ambigüedad silenciosa sin cambio de modelo.
- **Esfuerzo:** BAJO.
- **Riesgo:** BAJO. Solo agrega validaciones, no rompe.

### 7.5 [ESTRUCTURAL — opción de fondo] Unificar en tabla "Persona" con `has_login: bool`

- **Qué:** rediseñar el modelo. Una sola tabla `persons` con `email`, `whatsapp_number`, `hashed_password` (nullable), `is_login_enabled: bool`, `role`, `tenant_id`, `is_active`. `Responsible` sería `is_login_enabled=False`, `User` sería `is_login_enabled=True`. La unicidad de `whatsapp_number` sería `(tenant_id, whatsapp_number)`. La ambigüedad de identidad desaparece.
- **Por qué:** cierra 6.3, 6.4, 6.6 y una parte de 6.5 (el frontend puede compartir una sola pantalla "Personas" con filtros por rol). Elimina duplicación de campos comunes.
- **Esfuerzo:** ALTO. Migración compleja: crear tabla nueva, mover datos de ambas, actualizar FKs (`tasks.responsible_id`, `messages.responsible_id`, `obra_team_members.responsible_id`, `obras.manager_id`), reescribir gran parte de `UserRepository`, `ResponsibleRepository`, `MessageService`, `ConversationService`, `auth_service`. Todos los endpoints `/users/*` y `/responsibles/*` cambian. 3-5 días de trabajo.
- **Riesgo:** ALTO. Rompe API pública, requiere versionar. Recomendado solo si el producto va a crecer mucho y los tres tipos de bugs siguen apareciendo. Como alternativa, mantener separado y aplicar 7.1-7.4 y 7.6 (parche por parche).

### 7.6 Agregar directorio global de Responsibles en el frontend (cierra 6.5)

- **Qué:** crear `DirectorioResponsablesPage.tsx` en `frontend/src/pages/`, agregarlo en el sidebar bajo "Organización" (junto a "Gestión de equipo"). Consumir `GET /responsibles` que ya existe. Acciones: ver lista con filtros (activos/inactivos, por especialidad), editar (usar el mismo modal que `ObraResponsablesTab`), soft-delete, reactivar. Botón "Ver en qué obras participa" → modal con lista de obras del tenant donde tiene `ObraTeamMember`.
- **Por qué:** cierra 6.5. Elimina la dependencia "para gestionar a alguien, entrá a una obra".
- **Esfuerzo:** MEDIO (1-2 días de frontend; el backend ya está).
- **Riesgo:** BAJO. Solo agrega UI.

### 7.7 Al soft-deletear un Responsible, limpiar sus `ObraTeamMember` (cierra 6.7)

- **Qué:** en `ResponsibleService.deactivate()`, agregar un `UPDATE obra_team_members SET ... WHERE responsible_id=?`. Dos opciones: (a) agregar columna `is_active` a `obra_team_members` y marcarla, o (b) borrar las filas.
- **Por qué:** cierra 6.7.
- **Esfuerzo:** BAJO (opción b) a MEDIO (opción a, requiere migración).
- **Riesgo:** BAJO.

### 7.8 Enfoque distinto para `send_window` — permitir inbound siempre (cierra 6.8)

- **Qué:** en `MessageService.process_inbound()`, mover el chequeo de `send_window` del inbound al outbound (recordatorios automáticos). O responder con un mensaje "estamos fuera de horario" en vez de silencio.
- **Por qué:** cierra 6.8. El nombre `send_window` sugiere outbound, no bloqueo inbound.
- **Esfuerzo:** BAJO.
- **Riesgo:** BAJO. Requiere decisión de producto sobre qué hacer con inbound fuera de horario.

### 7.9 Consistencia: `DELETE /obras/{id}/team` soft-delete (cierra 6.9)

- **Qué:** cambiar el hard delete a soft-delete agregando `is_active` a `obra_team_members`, o al menos documentar el porqué. Alternativa: dejar como hard delete y hacer también hard delete al Responsible → simetría en el otro sentido.
- **Por qué:** consistencia entre las dos operaciones "quitar del equipo" (fila desaparece) y "desactivar responsable" (soft delete + reversible).
- **Esfuerzo:** MEDIO.
- **Riesgo:** BAJO.

### 7.10 Tests que faltan (cierra 6.10)

- **Qué:** agregar tests en `backend/tests/`:
  - `test_responsibles_cross_tenant.py`: lookup, POST /team, colisiones.
  - `test_plan_disciplines_filter.py`: filtro por WhatsApp con null/[]/lista.
  - `test_responsible_soft_delete.py`: efectos sobre OTM y tareas.
  - `test_user_vs_responsible_collision.py`: comportamiento cuando el número está en ambos.
- **Por qué:** los 6 bugs pasaron porque no había cobertura.
- **Esfuerzo:** MEDIO. ~150 líneas.
- **Riesgo:** NULO.

---

## 8. Riesgos

| # | Riesgo | Severidad | Vector | Estado |
|---|---|---|---|---|
| R1 | Fuga cross-tenant vía `GET /responsibles/lookup` — expone Responsables + tareas de otros tenants | **Alta** | Usuario legítimo con cuenta en el SaaS + iteración de números | **Abierto** (6.1, punto 2) |
| R2 | Cross-tenant injection vía `POST /obras/{id}/team` — inyectar responsibles ajenos al equipo propio | **Alta** | Admin de un tenant con curl/DevTools | **Abierto** (6.2, similar a 7.2 del audit 03) |
| R3 | Unicidad global de `Responsible.whatsapp_number` — competidor puede "reservar" números conocidos | **Alta** | Uso normal del signup + creación de responsibles | **Abierto** (6.3, punto 1) |
| R4 | Colisión User/Responsible con mismo número — Responsible eclipsa al User silenciosamente | **Alta** | Un admin de tenant B crea un Responsible con el número de un User staff de tenant A | **Abierto** (6.4, punto 3) |
| R5 | `User.whatsapp_number` unique global — misma persona no puede ser staff de dos empresas | **Media** | Uso normal | **Abierto** (6.6) |
| R6 | Sin directorio general de Responsibles — dificulta compliance y auditoría interna | **Media** operacional | Uso normal | **Abierto** (6.5, punto 4) |
| R7 | OTM huérfano tras soft-delete del Responsible — datos zombie | **Media** | Uso normal (desactivar responsable) | **Abierto** (6.7) |
| R8 | `send_window` filtra inbound silenciosamente — UX pobre para el responsable | **Baja** | Uso normal fuera de horario | **Abierto** (6.8) |
| R9 | Hard delete de `ObraTeamMember` inconsistente con soft delete de Responsible | **Baja** | Uso normal | **Abierto** (6.9) |
| R10 | Cobertura de tests del módulo muy escasa | **Media** ingeniería | Regresión futura | **Abierto** (6.10) |
| R11 | Guards `AdminUser` en escrituras de Responsibles y OTM | — | — | **Cerrado — funciona** (a diferencia de tasks del audit 03) |
| R12 | Filtro `plan_disciplines` en el bot | — | — | **Cerrado — funciona con null/[]/list** (§4.5) |
| R13 | Aislamiento tenant en CRUD de Responsibles (`GET/POST/PATCH/DELETE /responsibles/{id}`) | — | — | **Cerrado — `get_or_raise(tenant_id)` correcto** |

---

## Anexo A — Reproducciones concretas

### A.1 — Fuga cross-tenant `/responsibles/lookup` (6.1)

```bash
# Facundo (tenant 2) consulta un número de tenant 8 y ve sus tareas activas
curl -G "http://localhost:8000/api/v1/responsibles/lookup" \
     --data-urlencode "whatsapp=+15005550001" \
     -H "Authorization: Bearer <TOKEN_T2>"

→ 200 {
    "id":29,"full_name":"Carlos Méndez","whatsapp_number":"+15005550001",
    "role":"Jefe de Obra","is_active":true,
    "active_tasks":[
      {"id":285,"obra_id":31,"title":"Relevamiento del local existente","status":"pendiente","due_date":"2026-09-08"},
      {"id":271,"obra_id":30,"title":"2.4 Encofrado y hormigonado 1er piso","status":"bloqueada","due_date":"2026-09-14"},
      ...
    ]
  }
```

### A.2 — Cross-tenant injection en POST /obras/{id}/team (6.2)

```bash
curl -X POST "http://localhost:8000/api/v1/obras/17/team" \
     -H "Authorization: Bearer <TOKEN_T2>" \
     -H "Content-Type: application/json" \
     -d '{"responsible_id":29,"member_type":"contratista"}'

→ 201 {"responsible_id":29,"full_name":"Carlos Méndez",..."member_type":"contratista",...}

# En DB:
SELECT tenant_id FROM responsibles WHERE id=29;       → 8
SELECT tenant_id FROM obra_team_members WHERE responsible_id=29 AND obra_id=17;   → 2
# Cross-tenant link persistido.
```

### A.3 — Unicidad global (6.3)

```bash
# Tenant 2 crea:
POST /api/v1/responsibles  {"full_name":"…","whatsapp_number":"+5491199888777",...}
→ 201

# Tenant 8 intenta el mismo número:
POST /api/v1/responsibles  {"full_name":"…","whatsapp_number":"+5491199888777",...}
→ 409 {"detail":"A responsible with number +5491199888777 already exists"}
```

### A.4 — Colisión User/Responsible con mismo número (6.4)

```bash
# En la DB:
# Responsible id=10 (tenant 2, Ximena, +5493517066964)
# User id=34 (tenant 8, admin@demo.constructa.com, +5493517066964)

# Webhook desde ese número:
POST /api/v1/webhooks/twilio  From=whatsapp:+5493517066964  Body=HOLA

# Backend loguea:
# app.services.message_service: [Ximena, Responsible tenant 2]
# El admin@demo del tenant 8 NUNCA se identifica.
```

### A.5 — `plan_disciplines` filter (funciona) (§4.5)

```bash
# Setup: Ximena en obra 17, plan_disciplines=["gas"]. Obra 17 tiene solo plano de electricidad.

Body=PLANO ELECTRICIDAD  → "No tenés acceso al plano de electricidad. Podés pedir: gas."   ✓
Body=PLANO GAS           → "No encontré un plano de gas cargado."                        ✓

# Con plan_disciplines=null:
Body=PLANO ELECTRICIDAD  → "📐 Plano de electricidad (v3, 21/06/2026)."                  ← envía el archivo
```

### A.6 — OTM huérfano post soft-delete (6.7)

```bash
DELETE /api/v1/responsibles/10  → 200 (Ximena is_active=False)

# En DB:
SELECT is_active FROM responsibles WHERE id=10;              → False
SELECT obra_id FROM obra_team_members WHERE responsible_id=10;   → [16, 17] (siguen ahí)
```

---

## Anexo B — Datos del entorno al momento de la auditoría

- **Rama:** `audit/04-responsables` (desde `main` @ `6400cd7`, que ya incluye los 3 audits anteriores).
- **Backend:** uvicorn `:8000` (1 worker), Postgres local, `APP_DEBUG=true`.
- **Frontend:** Vite `:5173`.
- **Tenants usados:**
  - Tenant 2 "Empresa de facundo" (`facundograffigna466@gmail.com`, admin, plan básico).
  - Tenant 8 "CONSTRUCTA Demo SRL" (`admin@demo.constructa.com`, admin, plan enterprise; password reseteado a `12345678` para poder probar cross-tenant).
- **Responsibles usados:**
  - Ximena (id=10, tenant 2, +5493517066964) — el mismo número que `admin@demo` del tenant 8 (para probar §4.3).
  - Carlos Méndez (id=29, tenant 8, +15005550001) — usado como target de fuga en §4.2 y injection en §6.2.
  - Audit-P1-T2 (id=36, tenant 2, +5491199888777) — creado para probar §4.1, borrado al final.
- **Suite pytest:** 72/72 verdes en 31.4s (baseline al arrancar).
- **Configuración `send_window`:** todos los managers estaban en 08-20 al inicio; para probar §4.5 se cambió temporalmente el rango a 0-24 y se restauró (25=facundo) a 8-20 al final. Los otros 3 managers quedaron en 0-24 (menor, sin impacto en la app).

---

## Anexo C — Archivos y líneas clave

**Backend — modelos:**
- `app/models/user.py:27` — `whatsapp_number: unique=True global` (6.6)
- `app/models/responsible.py:13-14` — `whatsapp_number: unique=True global` (6.3)
- `app/models/responsible.py:18-19` — `tenant_id`, `is_active`
- `app/models/obra_team_member.py:9-18` — Unique `(obra_id, responsible_id)`, `member_type`, `plan_disciplines: JSON`

**Backend — endpoints:**
- `app/api/routes/users.py:16-93` — todo el CRUD de Users
- `app/api/routes/responsibles.py:20-25` (POST), `28-31` (GET listar), `36-45` (GET lookup — **sin filtro tenant, bug 6.1**), `57-62` (GET id), `65-85` (patch/delete)
- `app/api/routes/obra_team.py:69-72` — **cross-tenant injection, bug 6.2**

**Backend — servicios y repos:**
- `app/services/responsible_service.py:18-25` (create con check global unique), `27-34` (get_or_raise con tenant), `36-43` (lookup **sin tenant**, bug 6.1), `74-97` (deactivate)
- `app/repositories/responsible.py:11-16` (`get_by_whatsapp` **sin tenant**), `18-27` (list_active), `29-34` (list_all)
- `app/repositories/user.py:41-45` (`get_by_whatsapp` **sin tenant** ni check `is_active`)
- `app/services/message_service.py:64-69` — **ambigüedad User↔Responsible, bug 6.4**
- `app/services/message_service.py:169-179` — filtro send_window (bug 6.8)
- `app/services/message_service.py:266-363` — `_handle_plano_request` con filtro correcto de `plan_disciplines`
- `app/services/plano_service.py:182-192` — `allowed_disciplines_for_responsible`
- `app/services/conversation_service.py:_start_fresh` — lista tareas por responsible (sin filtro tenant explícito; en la práctica funciona porque `responsibles.tenant_id` matchea)

**Frontend:**
- `frontend/src/pages/EquipoPage.tsx` — solo Users, no Responsibles (bug 6.5)
- `frontend/src/components/ObraResponsablesTab.tsx` — único lugar donde se gestionan Responsibles
- `frontend/src/components/ObraResponsablesTab.tsx:29-63` — `MemberTypeSelector`
- `frontend/src/components/ObraResponsablesTab.tsx:65-110` — `PlanDisciplinesSelector` con los 3 estados

**Migraciones relevantes:**
- 0026 — agrega `responsibles.tenant_id`
- 0030 — agrega `users.whatsapp_number`
- 0033 — agrega `plan_disciplines` (JSON) a `obra_team_members`
- 0034 — agrega `member_type` a `obra_team_members`

**Tests:**
- `backend/tests/test_tenant_isolation.py` — cubre role change y member delete (users), pero **cero** para Responsibles cross-tenant, cross-tenant injection en team, plan_disciplines filter, colisión User/Responsible. Ver §6.10.
