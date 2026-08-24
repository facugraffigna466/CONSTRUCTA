# Fase 3 — Asignar obras y roles al invitar

> **Alcance:** que quien invita a un nuevo usuario pueda, en el mismo request, elegir a qué obras se asigna y con qué rol. Sin esta fase, todo invitado nuevo acepta la invitación y queda sin ver ninguna obra hasta que alguien lo asigne manualmente después — lo cual, después de Fase 2, es un mal onboarding.

**Fecha:** 2026-08-23
**Base:** cierra sobre [`fase-2-enforcement.md`](./fase-2-enforcement.md) (guards por-obra) y [`fase-1-modelo.md`](./fase-1-modelo.md) (tabla + matriz de roles).

Esta fase es **puramente backend**. El frontend sigue mandando el payload viejo (solo `email` + `role`) y todo funciona. Fase 4 extiende la UI del modal de invitación.

---

## 1. Nuevo payload de `POST /users/invite`

### 1.1 Antes

```json
{ "email": "juan@ejemplo.com", "role": "collaborator" }
```

### 1.2 Ahora

```json
{
  "email": "juan@ejemplo.com",
  "role": "collaborator",
  "obra_assignments": [
    { "obra_id": 12, "role": "jefe_obra" },
    { "obra_id": 15, "role": "colaborador" },
    { "obra_id": 18, "role": "solo_lectura" }
  ]
}
```

- `obra_assignments` es **opcional**. Si viene vacío o ausente, el invitado se activa sin obras (comportamiento previo).
- Cada item tiene `obra_id` (int) y `role` (enum: `jefe_obra` | `colaborador` | `solo_lectura`).
- `role` es el rol de empresa (admin / collaborator) del user. `obra_assignments[].role` es el rol **por-obra** — no confundir.

### 1.3 Respuesta

`InviteResponse` gana un campo `obra_assignments` que devuelve las asignaciones **efectivas** (después de descartar las inválidas — ver §2). Sirve al frontend para mostrar al admin "invitaste a Juan a estas 3 obras":

```json
{
  "invite_token": "…",
  "invite_url": "https://.../invite/…",
  "obra_assignments": [
    { "obra_id": 12, "role": "jefe_obra" },
    { "obra_id": 15, "role": "colaborador" }
  ]
}
```

Notar que si en el input el admin pidió 3 obras pero una era de otro tenant, la respuesta trae solo las 2 válidas.

### 1.4 Almacenamiento intermedio

Migración `0047_add_pending_obra_assignments`: agrega la columna `users.pending_obra_assignments JSON NULL`.

- Al invitar: las asignaciones efectivas se serializan como
  `[{"obra_id": 12, "role": "jefe_obra"}, ...]` y se guardan en esa columna.
- Al aceptar: se leen, se materializan como filas reales en `obra_user_roles` en la misma transacción, y la columna se limpia (setea a NULL).
- Si la invitación caduca sin aceptar, la columna queda huérfana. No es problema funcional (los datos son ephemeral y solo se leen desde `get_by_invitation_token`); si en el futuro se quiere ser prolijo, un job de limpieza de invitaciones vencidas puede borrarla junto con el user.

---

## 2. Comportamiento del edge case "obra inválida"

**Regla:** en el payload de `POST /users/invite`, cualquier `obra_id` que **no exista** o **pertenezca a otro tenant** se descarta silenciosamente. La invitación se emite igual con las asignaciones que sí son válidas. Motivo: no queremos que un typo o una obra recién borrada rompa el flujo de invitación completo.

**Detalles de implementación** (`AuthService._validate_assignments`):

- Una sola query por batch: `SELECT id FROM obras WHERE id IN (...) AND tenant_id = <tenant>` — evita N+1.
- Deduplicación por `obra_id` manteniendo la última aparición (si el frontend envía la misma obra dos veces con roles distintos, gana el último).
- Log `WARNING` por cada obra descartada, con formato `Invite dropped invalid obra_assignment: obra_id=<X> not in tenant_id=<Y>`.
- Si la lista queda vacía después de filtrar, la invitación se emite sin asignaciones (equivalente a payload viejo).

**Doble check en el accept.** Entre el momento en que se emite la invitación y el momento en que el invitado la acepta pueden pasar horas o días (`INVITE_TTL_HOURS = 72`). Si en ese intervalo un admin borra alguna obra, la asignación pendiente ya no aplica. Por eso `accept_invite` re-valida cada pendiente contra la base:

```python
rows = await session.execute(
    select(Obra.id).where(Obra.id.in_(obra_ids), Obra.tenant_id == user.tenant_id)
)
valid_ids = set(rows.scalars().all())
for a in pending:
    if a["obra_id"] not in valid_ids:
        logger.warning("Accept: dropped invalid pending assignment obra_id=%s for user_id=%s", ...)
        continue
    ...
```

Igual criterio: la asignación inválida se saltea silenciosamente, el accept sigue. Fue explícitamente testeado con `test_accept_ignora_obra_borrada_entre_invite_y_accept`.

**Rol malformado.** Además del check de obra, `accept_invite` intenta construir el `ObraUserRoleType(a["role"])`. Si el JSON pending tiene un rol que ya no existe (ej. porque cambiamos el enum), la conversión levanta `ValueError` que se atrapa y se loggea igual. Defensivo pero improbable — el enum es estable.

---

## 3. Contexto de invitación (`GET /auth/invite/{token}`)

`InviteContextResponse` ahora incluye la lista de obras que se van a asignar al aceptar, con el nombre de cada obra hidratado:

```json
{
  "email": "juan@ejemplo.com",
  "role": "collaborator",
  "company_name": "Constructora RODE",
  "obra_assignments": [
    { "obra_id": 12, "obra_name": "Edificio Norte", "role": "jefe_obra" },
    { "obra_id": 15, "obra_name": "Vivienda Sur", "role": "colaborador" }
  ]
}
```

El frontend (Fase 4) va a mostrar esto en la pantalla de "vas a entrar a estas obras como …" antes de que el usuario tipee la contraseña. Si `obra_assignments` viene vacío, la UI puede advertir "sin obras asignadas — pedile a tu admin que te agregue".

Hidratación del nombre: si la obra pendiente ya no existe en la BD, se omite del contexto (mismo criterio defensivo que en accept). El usuario ve solo lo que efectivamente va a recibir.

---

## 4. `UserRead` expone `obra_roles`

Los endpoints `GET /users/me` y `GET /users` ahora devuelven, además de los campos existentes, un array `obra_roles` con las asignaciones actuales del usuario:

```json
{
  "id": 42,
  "email": "juan@ejemplo.com",
  "role": "collaborator",
  ...
  "obra_roles": [
    { "obra_id": 12, "obra_name": "Edificio Norte", "role": "jefe_obra" },
    { "obra_id": 15, "obra_name": "Vivienda Sur", "role": "colaborador" }
  ]
}
```

Implementación (`app/api/routes/users.py::_obra_roles_for_users`): una sola query con JOIN `obra_user_roles ⋈ obras` para toda la lista de usuarios, agrupada en Python por `user_id`. Evita N+1 al listar el equipo del tenant.

Para admin de empresa (`users.role == "admin"`), la lista `obra_roles` va a estar vacía — porque el admin no tiene filas en `obra_user_roles` (es superset absoluto). La UI debe manejarlo mostrando "admin de empresa — acceso total" en vez de "sin obras asignadas".

---

## 5. Decisión pendiente — `solo_lectura` y el límite de plan

**No implementada.** Es una decisión de producto que no le corresponde tomar al backend en esta fase. Dejada como `TODO` explícito en `backend/app/core/plan_limits.py:65-88` para que el equipo decida antes de que el módulo de facturación empiece a hacer ruido.

### El problema

Cuando alguien invita a un `solo_lectura` (auditor, consultor externo, cliente que quiere ver el avance de la obra sin poder tocar nada), hoy ese user consume un slot del plan igual que un `jefe_obra`. Un plan "Pro" con `max_users=30` alcanza para 30 personas totales, sin importar si son 30 jefes de obra o 20 jefes y 10 auditores solo-vista.

Eso puede ser lo correcto o lo incorrecto — depende de la propuesta comercial.

### Camino A — mantener (comportamiento actual)

**Regla:** una fila en `users` = un slot del plan, sin importar el rol.

- **Pro:** simple de explicar y facturar. "Pro incluye 30 usuarios, punto."
- **Contra:** desincentiva la transparencia. El admin va a evitar invitar auditores o clientes para no gastar slots.
- **Cambio de código:** ninguno. `check_plan_limit` sigue como está.

### Camino B — excluir solo_lectura del conteo

**Regla:** los users cuyo rol máximo entre todas sus asignaciones es `solo_lectura` no consumen slot. Los admins de empresa y los users con al menos un rol > `solo_lectura` en alguna obra sí cuentan.

- **Pro:** habilita el modelo comercial "traé a tu cliente a ver la obra sin costo". Alinea el pricing con el valor entregado (los que solo ven, no cuentan).
- **Contra:** requiere una regla clara para users híbridos (los que tienen roles mixtos en varias obras — hoy la matriz numérica del enum lo resuelve: `max(role_level) > 1` cuenta, `== 1` no). También hay que decidir qué pasa mientras la invitación está pendiente (¿asumimos el rol máximo de las pendientes?).
- **Cambio de código:** en `check_plan_limit` (users branch), agregar un subquery contra `obra_user_roles` que excluya users cuyo `max(role_level)` sea `solo_lectura`. Los admin (`users.role == "admin"`) siempre cuentan porque no tienen filas en la tabla y por ende `max()` da NULL. Para las invitaciones pendientes, mirar `pending_obra_assignments`: si TODOS los roles pendientes son `solo_lectura`, no cuenta. Formalmente algo así:
  ```python
  # pseudo-SQL:
  WHERE users.tenant_id = :t
    AND (users.is_active = TRUE OR (invitation vivo))
    AND (
      users.role = 'admin'
      OR EXISTS (SELECT 1 FROM obra_user_roles
                 WHERE user_id = users.id AND role IN ('jefe_obra','colaborador'))
      OR EXISTS (JSON contiene un rol > solo_lectura en pending_obra_assignments)
    )
  ```
  Costo: un IN adicional por conteo — trivial en volumen esperado.

### Recomendación (para cuando se discuta)

El Camino B habilita un modelo comercial mejor pero necesita que el ARR/pricing esté decidido en paralelo. Si no está claro el mensaje comercial, mantener Camino A y explicitar en el marketing que "solo_lectura cuenta como user". Cuando exista claridad, se cambia con una migración chica (solo lógica, no schema).

**Estado actual del código:** Camino A. Sin cambios en `plan_limits.py` respecto a Fase 0 excepto el bloque de comentario TODO.

---

## 6. Compatibilidad hacia atrás

- Payload viejo (sin `obra_assignments`): funciona idéntico. `test_invite_sin_obra_assignments_sigue_funcionando` y `test_accept_sin_asignaciones_no_crea_filas` lo blindan.
- Respuesta de invite: agrega un campo nuevo (`obra_assignments`), no rompe consumers viejos.
- Respuesta de `GET /auth/invite/{token}`: agrega `obra_assignments`, con default `[]`.
- `UserRead`: agrega `obra_roles`, con default `[]`. Los tests existentes que hacen `assert body["email"] == ...` siguen pasando; solo cambia el volumen de datos, no la forma.
- El frontend actual sigue funcionando sin cambios hasta que Fase 4 extienda el modal de invitación con el selector de obras.

---

## 7. Archivos entregados

**Backend — producción (5 archivos):**

- `backend/app/models/user.py` — nueva columna `pending_obra_assignments`.
- `backend/app/schemas/user.py` — reescrito con `ObraAssignmentInvite`, `ObraRoleForUserRead`, `InviteRequest.obra_assignments`, `InviteResponse.obra_assignments`, `UserRead.obra_roles`, `InviteContextResponse.obra_assignments`.
- `backend/app/services/auth_service.py` — `invite` acepta y valida `obra_assignments`; `accept_invite` materializa; `get_invite_context` hidrata las pendientes con nombres.
- `backend/app/api/routes/users.py` — reescrito para exponer `obra_roles` en `/me`, `/users`, `/users/{id}/role`, y para propagar `obra_assignments` en la respuesta del invite.
- `backend/app/core/plan_limits.py` — bloque de comentario TODO sobre `solo_lectura`, sin cambio funcional.

**Migración:** `backend/alembic/versions/0047_add_pending_obra_assignments.py`.

**Backend — tests (1 archivo nuevo):**

- `backend/tests/test_invite_obra_assignments.py` — 11 tests. Cubre:
  1. Invite sin `obra_assignments` sigue funcionando (retrocompat).
  2. Accept sin pendientes no crea filas huérfanas.
  3. Invite con obras guarda pendientes; no materializa hasta el accept.
  4. Accept materializa las filas con los roles correctos.
  5. Invite ignora obra de otro tenant.
  6. Invite ignora obra inexistente.
  7. Accept ignora obra borrada entre invite y accept (defensive).
  8. `GET /auth/invite/{token}` incluye las obras pendientes con nombre.
  9. `GET /users/me` incluye `obra_roles`.
  10. `GET /users` lista con `obra_roles` batched (evita N+1).
  11. End-to-end: invitado recién aceptado ve solo su obra en `GET /obras`.

**Sin tocar:**

- Frontend (Fase 4 va a exponer el selector de obras en el modal de invitación).
- Flujo de reset password / verify email (fuera del scope).
- `check_plan_limit` (comportamiento, no comentario) — pendiente decisión producto.

---

## 8. Suite

Resultado tras los cambios: **150 passed, 0 failed** (`pytest --tb=short -q`). Los 11 tests nuevos y los 139 previos (fases 0/1/2) siguen verdes.

---

## 9. Notas para Fase 4 y adelante

- **UI del modal de invitación:** selector de obras multi con dropdown de rol por-obra. Debería usar `GET /obras` (ya filtra por lo que el admin ve) para armar las opciones.
- **UI de "Mi equipo" / gestión de usuarios:** cada fila puede mostrar los `obra_roles` como chips ("Jefe de obra: Edificio Norte", "Colaborador: Vivienda Sur", etc.). Fase 4 también debería exponer endpoints tipo `POST /obras/{id}/user-roles` para agregar/cambiar/quitar asignaciones **después** del alta — hoy solo se pueden setear al invitar.
- **Endpoint de "reasignar":** cuando exista `PATCH /users/{id}/obra-roles/{obra_id}` o similar, `jefe_obra` puede asignar `colaborador`/`solo_lectura` en su obra, pero no `jefe_obra` (matriz §2.4 fase-1-modelo). Este check ya está listo — solo hay que exponer los endpoints.
- **Decisión pendiente §5:** cuando se decida, la migración de código va acompañada de un test que reproduce ambos caminos.
- **Job de limpieza:** invitaciones caducadas dejan huérfanos en `pending_obra_assignments`. Un cron simple que borre users con `invitation_expires_at < NOW() - 30 days` los limpia junto con las filas. Bajo prioridad — el conteo del plan ya ignora las invitaciones vencidas (Fase 0), así que no genera bypass.
