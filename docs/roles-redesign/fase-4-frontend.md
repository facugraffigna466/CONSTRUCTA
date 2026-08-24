# Fase 4 — Frontend obra-aware

> **Alcance:** hacer que el frontend refleje la realidad del backend post-Fase 2/3 — el copy "todos acceden a todas las obras" era mentira, la UI de invitación no dejaba elegir asignaciones, y el hook `usePermission` resolvía todo con el rol de empresa aunque el backend responde por-obra. Esta fase alinea las tres cosas y agrega la pantalla para editar asignaciones después del alta. Incluye también un router backend nuevo (`obra_user_roles.py`) porque sin él el frontend no podía materializar la operación "editar equipo por obra" (Fase 3 solo cubrió el flujo del invite).

**Fecha:** 2026-08-23
**Base:** [`fase-3-invitacion.md`](./fase-3-invitacion.md) (payload del invite y `pending_obra_assignments`) y [`fase-1-modelo.md`](./fase-1-modelo.md) (matriz de capacidades por rol).

---

## 1. Backend — piezas nuevas necesarias

### 1.1 Router `obra_user_roles.py`

Fase 3 dejó el mecanismo para setear asignaciones **al invitar**, pero no para modificarlas después. El frontend necesita ambas operaciones para que EquipoPage sea funcional. Se agregó `backend/app/api/routes/obra_user_roles.py` con:

| Método | Path | Rol mínimo | Detalle |
|---|---|---|---|
| `GET` | `/obras/{obra_id}/user-roles` | SL | Lista asignaciones de la obra con nombre y email del user. |
| `POST` | `/obras/{obra_id}/user-roles` | JO | Upsert: asigna rol; si ya había fila para (obra, user), actualiza. |
| `PATCH` | `/obras/{obra_id}/user-roles/{user_id}` | JO | Cambia el rol de una asignación existente. 404 si no había fila. |
| `DELETE` | `/obras/{obra_id}/user-roles/{user_id}` | JO | Idempotente (204 aunque no hubiera fila — así el frontend no tiene que sincronizar). |

**Regla de escalación** en el guard, no en el rol mínimo: solo `admin` de empresa puede setear rol `jefe_obra`. Si un JO intenta promover a otro user a JO → 403 con detalle explícito. Implementado en `_assert_can_assign_role()`.

**No se puede asignar rol al admin de empresa**: 400 con "el admin tiene acceso total". Cubre el caso de un jefe_obra intentando degradarlo desde la UI.

Registrado en `backend/app/main.py:79` (junto a los demás routers).

### 1.2 Tests backend (16 nuevos)

`backend/tests/test_obra_user_roles.py` — cubre:

- POST: admin puede JO; JO puede COL/SL; JO NO puede JO (403); collab sin fila → 404; no se puede asignar al admin de empresa (400); es upsert.
- PATCH: actualiza rol; escalación reservada al admin; 404 sin fila previa.
- DELETE: quita, es idempotente, respeta aislamiento.
- GET: admin lista, SL puede ver el equipo, sin fila → 404.

**Suite backend final:** 166 passed / 0 failed.

---

## 2. Frontend — capa de datos y tipos

### 2.1 `frontend/src/types/index.ts`

Agregado:

```ts
export type ObraUserRoleType = "jefe_obra" | "colaborador" | "solo_lectura";
export interface ObraRoleForUser {
  obra_id: number;
  obra_name: string;
  role: ObraUserRoleType;
}
```

`CurrentUser` gana `obra_roles: ObraRoleForUser[]`. Se pobla desde `/users/me` (Fase 3 lo agregó al schema del backend).

### 2.2 `frontend/src/api/users.ts`

- `ApiUser` gana `obra_roles: ObraRoleForUser[]`.
- `inviteMember(email, role, obraAssignments?)` acepta un tercer arg opcional con la lista `[{obra_id, role}]`. Si viene vacío o null, el POST omite `obra_assignments` (payload viejo → retrocompat con Fase 3).
- Se exporta `InviteResponse` con el campo nuevo `obra_assignments` que devuelve el backend (asignaciones EFECTIVAS después del filtrado cross-tenant).
- `InviteContext` gana `obra_assignments` (con nombre de la obra hidratado).

### 2.3 `frontend/src/api/obraUserRoles.ts` (nuevo)

Cliente para los endpoints §1.1:

- `fetchObraUserRoles(obraId)`
- `assignObraUserRole(obraId, userId, role)`
- `updateObraUserRole(obraId, userId, role)`
- `removeObraUserRole(obraId, userId)`

---

## 3. `usePermission` obra-aware

`frontend/src/hooks/usePermission.ts` — reescrito.

### 3.1 Nueva firma

```ts
usePermission(permission, obraId?)
useCan()  // devuelve (permission, obraId?) => boolean
useObraRole(obraId)  // "admin" | ObraUserRoleType | null
```

### 3.2 Semántica

- **Sin `obraId`:** funciona como antes (matriz global `ROLE_PERMISSIONS`). Retrocompat 100% — pantallas org-level (PortfolioPage, ConfiguracionPage, EquipoPage, InviteModal) NO cambian su lógica.
- **Con `obraId`:** resuelve contra la matriz por-obra:
  - Admin de empresa → true siempre (superset absoluto).
  - Non-admin con permiso "company-level" (miembro.invite, obra.create, obra.edit, obra.delete, configuracion.edit, miembro.remove) → false, sin importar el `obraId`.
  - Non-admin: busca su `obra_roles.find(r => r.obra_id === obraId)`. Si no hay fila → false. Si hay, chequea contra `OBRA_ROLE_PERMISSIONS[row.role]`.

### 3.3 Matriz por-obra (`OBRA_ROLE_PERMISSIONS`)

Deriva de `fase-1-modelo.md §2.4`:

- `jefe_obra`: `tarea.create/edit/delete/move`, `documentos.upload/delete`.
- `colaborador`: `tarea.create/edit/move`, `documentos.upload` (sin delete, sin marcar vigente).
- `solo_lectura`: `[]` (nada de mutación).

### 3.4 Uso en componentes actualizados

| Componente | Antes | Ahora |
|---|---|---|
| `ObraDetailPage.tsx` (7 llamadas) | `can("tarea.edit")` | `can("tarea.edit", obra.id)` |
| `PlanosTab.tsx` | `can("documentos.delete")` + botón "Plano nuevo" sin gate | `can("documentos.delete", obraId)` + `canUpload = can("documentos.upload", obraId)` — botón "Plano nuevo" ahora se **oculta** para SL |
| `ObraResponsablesTab.tsx` | `can("configuracion.edit")` (global admin) | `can("tarea.delete", obraId)` — proxy de "acción JO en la obra", que es lo que corresponde según matriz §2.1 (jefe_obra gestiona su equipo, no requiere ser admin de empresa) |

**Componentes que quedan igual:** `PortfolioPage`, `ConfiguracionPage`, `EquipoPage`, `InviteModal` — son pantallas de nivel empresa, no de una obra puntual. `TaskFormModal`/`AlertasTab`/`HistorialPanel`/`GanttTimeline` reciben las callbacks (`onEdit`, `onDelete`, etc.) del parent, que ya las condiciona con el permiso por-obra → gating funcional sin cambios directos en esos hijos.

---

## 4. Pantalla `EquipoPage` — reemplazo del copy engañoso + edición por obra

### 4.1 Cambios visibles

- **Header:** el copy `"· todos acceden a todas las obras de la organización"` fue reemplazado por `"· el acceso a cada obra se configura por miembro"`.
- **Cada miembro** ahora muestra una segunda línea con chips por obra (formato `NombreObra · Rol`, hasta 4 chips + un `+N más` si excede). Los chips usan un color por rol:
  - `jefe_obra` — naranja pastel.
  - `colaborador` — verde pastel.
  - `solo_lectura` — gris pastel.
  - Admin de empresa → chip en cursiva: `"Acceso total a todas las obras"` (no muestra la lista porque no tiene filas — es superset).
  - Non-admin sin asignaciones → `"Sin obras asignadas"` con botón `Asignar…`.
- **Botón "Editar"** al final de esa línea de chips (solo se muestra al admin de empresa; verificado con `canRemove` que ya se usaba para gating de acciones sobre miembros).

### 4.2 Modal `MemberObraRolesModal`

Nuevo componente en `frontend/src/components/MemberObraRolesModal.tsx`. Patrón visual copiado directamente de `EditMemberModal` (dentro de `ObraResponsablesTab`):

- Backdrop `rgba(15,22,28,0.45)` + `backdropFilter: blur(3px)`, card 520px, `borderRadius: 16`.
- Header: título + nombre del miembro + chip "Admin de empresa" si aplica.
- Input de búsqueda tipo `background: #F4F5F4`.
- Lista de todas las obras del tenant con un `<select>` por fila (`Sin acceso` / `Solo lectura` / `Colaborador` / `Jefe de obra`).
  - La opción `Jefe de obra` **se oculta si el user actual no es admin de empresa** — el backend rechaza esa promoción con 403, ocultarla evita el trámite frustrante.
- Fila cambiada resalta con background `#FFF7F0` + borde `#F5CBAB` para indicar la diff.
- Footer: `Cancelar` + `Guardar (N)` — botón deshabilitado (gris) si no hay cambios; se muestra el contador de cambios pendientes.

Cuando se guarda, aplica las diffs una por una contra el backend (`POST` para nueva asignación, `PATCH` para cambio, `DELETE` para "sin acceso"). Si el backend devuelve 403 (por regla de escalación u otra), el modal muestra el detalle y para — no dejamos estado inconsistente. Al terminar OK, llama `onSaved()` que dispara refetch del listado en `EquipoPage`.

**Nota de reutilización:** originalmente pensé reusar directamente `EditMemberModal` — no aplica porque ese modal trabaja con `Responsible`/`ObraTeamMember` (contactos de WhatsApp sin login) y este trabaja con `User` × `ObraUserRole`. Son ejes conceptuales distintos (fase-1-modelo §4). Lo que sí replicamos es el layout/estilo, para consistencia visual.

### 4.3 Captura

Ver `docs/roles-redesign/screenshots/equipo-page-fase4.png` y `invite-modal-*-fase4.png` (adjuntas al PR).

---

## 5. `InviteModal` — selector de obras integrado

### 5.1 Cambios

- Acepta prop nueva `obras?: Obra[]`. `EquipoPage` la pasa cargada; otros callers pueden omitirla (el selector no se muestra).
- Copy del header: `"El acceso a cada obra se configura al invitar (o después, desde la lista de equipo)."` — reemplaza el viejo `"Los miembros acceden a todas las obras..."` que era mentira.
- Nuevo bloque **colapsable** debajo del email+rol+botón: `> Asignar a obras (opcional — también se puede asignar después)`. Se expande a click y muestra la lista completa de obras del tenant con un `<select>` por obra (`Sin acceso` / `Solo lectura` / `Colaborador` / `Jefe de obra`).
- Contador al lado del label cuando hay obras elegidas: chip naranja `N`.
- **Solo se muestra si el rol de empresa elegido es `collaborator`** — para `admin` no tiene sentido (el backend ignora las asignaciones del admin, es superset). Si el usuario cambia el rol a `admin` con el selector expandido, el bloque desaparece; si vuelve a `collaborator`, reaparece con el estado que había.

### 5.2 Serialización

Al enviar, `handleSend` construye `pickedAssignments = obraRoles → [{obra_id, role}]` filtrando los que quedaron en `""` (sin acceso). Si el rol de empresa es `admin`, se manda `null` (backend ignora igual, pero es más limpio no mandar). Después del envío exitoso, se limpia el estado local `obraRoles = {}` — así invitaciones sucesivas empiezan de cero.

---

## 6. Decisiones: ocultar vs. deshabilitar

Criterio general: **ocultar** cuando el control es una llamada a la acción y verlo sin poder usarlo genera fricción; **deshabilitar** cuando el control es referencial y el usuario espera que exista aunque no lo pueda mover.

| Control | Decisión | Motivo |
|---|---|---|
| Botón "Plano nuevo" en `PlanosTab` (SL en la obra) | **Ocultar** | Botón primario CTA. Verlo deshabilitado sugiere un bug ("¿por qué está gris?"). |
| Botón "Editar" (lápiz) en `MemberObraRolesModal` sobre otros miembros | **Ocultar** (solo lo muestra `canRemove`) | Consistente con cómo `EquipoPage` maneja los otros controles admin-only (dropdown de rol, botón X). |
| Opción `jefe_obra` en el `<select>` del modal cuando el user actual es JO (no admin) | **Ocultar** | El backend responde 403. Mostrarla y dejar que el user intente sería trámite frustrante. Documentado con comentario en el código. |
| Botón "Guardar" en `MemberObraRolesModal` cuando no hay cambios pendientes | **Deshabilitar** (background gris + `cursor: not-allowed` + label `"Sin cambios"`) | El botón es referencial (siempre está ahí como pareja de "Cancelar"). Deshabilitarlo comunica el estado sin desaparecer/reaparecer. |
| Selector expandible "Asignar a obras" en `InviteModal` cuando el rol es admin | **Ocultar** | Solo aplica a `collaborator`. Mostrarlo con la opción irrelevante confunde. |
| Botones `onEdit`/`onDelete` de tareas en `TaskTable`/`GanttTimeline` (SL en la obra) | **Ocultar** (el parent pasa la prop como `undefined`) | Patrón preexistente: el hijo solo renderiza el botón si recibe el handler. Mantiene el diff mínimo. |
| Drag/resize de barras en `GanttTimeline` para SL | **Deshabilitado por el backend** (403 al guardar); UI no bloquea el drag inicial. | Trade-off consciente: gate en el widget de Gantt sería costoso (drags dispersos por el archivo grande). El botón de "Editar tarea" ya está oculto, así que el único vector es drag directo. Si es un problema real en dogfooding, se agrega el gate. |
| Modal de tarea (`TaskFormModal`) — si un SL lograra abrirlo | **Backend gate + botón submit gateado por rol** | Los puntos de apertura ya están ocultos (`can("tarea.create/edit")` en el parent), así que en la práctica no se abre para SL. |

---

## 7. Verificación

- **`npx tsc -b` — exit 0.** Sin errores de tipo.
- **`npx eslint`** — mismo número de errores que en `main` **antes** de Fase 4 (verificado con `git stash` → lint → `stash pop`). Los 8 errores en archivos que toqué (`InviteModal`, `EquipoPage`, `UserContext`) son patterns preexistentes (`react-refresh/only-export-components`, `react-hooks/set-state-in-effect` en `useEffect(() => loadX(), [])`) — Fase 4 no introdujo ninguno nuevo.
- **Backend suite — 166 passed / 0 failed** en 39s (`pytest --tb=line -q`).
- **Verificación visual con Playwright**:
  1. Login con `facundograffigna466@gmail.com` (admin de empresa del seed).
  2. Naveegar a "Gestión de equipo" — se ve el copy nuevo `· el acceso a cada obra se configura por miembro` y el chip `Acceso total a todas las obras` para el admin.
  3. Abrir "Invitar miembro" — el modal muestra el copy nuevo y el selector expandible "Asignar a obras (opcional)". Expandido lista las 4 obras del tenant con dropdown `Sin acceso` por defecto.
- **Test de `solo_lectura`**: sin usuario `solo_lectura` en la base local en este momento (el seed no crea uno). Se puede reproducir invitando a un nuevo email con rol `Solo lectura` en una obra puntual y aceptando la invitación desde otra sesión — el flujo backend está cubierto por tests (`test_invite_obra_assignments.py::test_invitado_recien_aceptado_ve_solo_su_obra`).

---

## 8. Archivos entregados

**Backend — producción (3 archivos):**

- `backend/app/api/routes/obra_user_roles.py` — nuevo router.
- `backend/app/main.py` — registrar el router.
- (Ya de Fase 3): `backend/app/schemas/user.py` con `obra_roles` en `UserRead` — se consume desde el frontend.

**Backend — tests (1 archivo nuevo):**

- `backend/tests/test_obra_user_roles.py` — 16 tests.

**Frontend — código productivo (10 archivos):**

- **Nuevos:** `src/api/obraUserRoles.ts`, `src/components/MemberObraRolesModal.tsx`.
- **Extendidos:** `src/api/users.ts` (tipos + `inviteMember` con `obra_assignments`), `src/types/index.ts` (`ObraUserRoleType`, `ObraRoleForUser`, `CurrentUser.obra_roles`), `src/context/UserContext.tsx` (`buildUser` incluye `obra_roles`).
- **Refactorizados:** `src/hooks/usePermission.ts` (firma nueva + matriz por-obra), `src/pages/EquipoPage.tsx` (chips + modal edición), `src/components/InviteModal.tsx` (selector de obras).
- **Toques puntuales:** `src/components/PlanosTab.tsx` (gate por-obra en upload y delete), `src/components/ObraResponsablesTab.tsx` (gate por-obra en gestión de responsables), `src/pages/ObraDetailPage.tsx` (todas las llamadas `can(...)` pasan `obra.id`).

**Sin tocar (a propósito):**

- `TaskTable`, `TaskFormModal`, `AlertasTab`, `HistorialPanel`, `GanttTimeline` — reciben los handlers del parent, que ya se condicionan con el hook. El gating funcional queda cubierto sin tocarlos.
- Frontend fuera del scope de roles: sin cambios.

---

## 9. Notas para Fase 5+

- **Backfill de datos existentes:** sigue pendiente (Fase 5). Sugerencia de fase-3 §9 sigue vigente: para cada obra existente, crear `ObraUserRole(user_id=obra.manager_id, role=jefe_obra)`. Los demás collaborators del tenant quedan sin acceso hasta que un admin los asigne (política estricta) — ahora con la UI de EquipoPage la migración es menos disruptiva.
- **Gate del drag/resize en `GanttTimeline` para SL:** dejado explícitamente fuera por costo/beneficio (ver §6). Reevaluar tras dogfooding si aparece como problema real.
- **Endpoint para el propio user cambiando su rol:** no existe (a propósito — la promoción/democión la hace admin/JO desde EquipoPage). Si en el futuro se quiere permitir que un JO se auto-baje a colaborador, hay que agregar el endpoint con guard adicional.
- **`AcceptInvitePage` mostrando `obra_assignments`:** el backend ya devuelve `InviteContext.obra_assignments` (Fase 3). La página `AcceptInvitePage` de frontend no fue actualizada en esta fase — quedaría como Fase 5 chica: hidratar y mostrar "vas a entrar a estas obras como {rol}" antes de tipear la contraseña, para dar feedback al invitado.
- **Socket manager por-obra:** `socket_manager.connect` sigue suscribiendo al user a todas las rooms `obra_{id}` del tenant. Filtrar a `visible_obra_ids(user)` es coherente y no urgente (los eventos ya son informativos y el filtrado real de datos está en los endpoints REST).
- **Decisión pendiente §5 de fase-3 (`solo_lectura` vs `max_users`):** sigue sin resolverse. El `TODO` en `plan_limits.py` sigue vigente.
