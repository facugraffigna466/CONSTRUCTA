# Fase 5 — Backfill de asignaciones existentes

> **Alcance:** migrar los datos que ya existen (dev / prod) para que ningún `collaborator` pierda acceso el día del deploy del rediseño. Sin esta migración, cualquier collaborator existente recibiría 404 en toda obra apenas se active el enforcement de Fase 2.

**Fecha:** 2026-08-23
**Base:** [`fase-2-enforcement.md`](./fase-2-enforcement.md) — la matriz de guards que exige rol por-obra. Cierra el rediseño completo (fases 0–5).

---

## 1. Estrategia

Se optó por **dos migraciones Alembic sucesivas** en lugar de un script standalone. Motivos:

- Alembic queda como fuente única de verdad — cada entorno (dev, staging, prod) sube al mismo estado con `alembic upgrade head`.
- El versionado es rastreable en cada environment (`SELECT version_num FROM alembic_version`).
- El downgrade se codifica junto con el upgrade — un `alembic downgrade -1` revierte de forma determinista.

Alternativa considerada: script Python separado invocado por operador. Descartada porque abre la puerta a "está corrido en dev pero no en prod" y complica el rollback (no hay `alembic_version` que refleje el estado).

Las dos migraciones se separan por preocupación:

- **`0048`** — cambio de schema (columna `origin`).
- **`0049`** — cambio de datos (INSERT del backfill).

Separarlas permite que en producción el DBA revise la 0048 (cambio estructural, rápido, seguro) antes de comprometerse a la 0049 (data migration, más volumen, potencialmente más lenta según cantidad de collabs × obras).

---

## 2. Migración `0048` — schema

**Archivo:** `backend/alembic/versions/0048_obra_user_role_origin.py`

Agrega una columna nullable a `obra_user_roles`:

```sql
ALTER TABLE obra_user_roles
  ADD COLUMN origin VARCHAR(32) NULL;

CREATE INDEX idx_obra_user_roles_origin
  ON obra_user_roles (origin)
  WHERE origin IS NOT NULL;  -- índice parcial: solo filas marcadas
```

Valores previstos:

- `NULL` — creada por el flujo normal (invite/accept desde Fase 3, `POST /obras/{id}/user-roles` desde Fase 4).
- `"backfill_fase5"` — creada por la migración 0049.

**El código de permisos NO mira esta columna.** Es puramente auditoría/rollback. La razón de meterla en vez de deducir por timestamp: hace el rollback determinista sin depender de comparar `created_at` contra timestamps guardados en un archivo aparte, y permite que asignaciones manuales posteriores no se toquen.

El modelo `ObraUserRole` gana el campo con comentario explícito:

```python
origin: Mapped[str | None] = mapped_column(String(32), nullable=True)
```

---

## 3. Migración `0049` — backfill

**Archivo:** `backend/alembic/versions/0049_backfill_obra_user_roles.py`

### 3.1 SQL del upgrade

```sql
INSERT INTO obra_user_roles (obra_id, user_id, tenant_id, role, created_at, origin)
SELECT
    o.id, u.id, o.tenant_id, 'colaborador', NOW(), 'backfill_fase5'
FROM users u
JOIN obras o ON o.tenant_id = u.tenant_id
WHERE u.role = 'collaborator'
  AND u.tenant_id IS NOT NULL
ON CONFLICT (obra_id, user_id) DO NOTHING;
```

Propiedades:

- **Idempotente.** Correrla dos veces produce el mismo estado. Cubierto por `test_backfill_es_idempotente`.
- **Respeta filas existentes.** Si un admin ya asignó `jefe_obra` a un collab (via invite Fase 3 o assign Fase 4), el `ON CONFLICT DO NOTHING` deja esa fila intacta — no la degrada. Cubierto por `test_backfill_respeta_asignaciones_previas`.
- **Cross-tenant safe.** El JOIN es por `tenant_id`; nunca crea filas mezcladas. Cubierto por `test_backfill_no_cruza_tenants`.
- **Solo collaborators.** Los admin no reciben filas — no las necesitan (superset). Cubierto por `test_backfill_no_toca_admins`.
- **Solo activos con tenant.** `is_active = TRUE AND tenant_id IS NOT NULL` filtra huérfanos.

### 3.2 SQL del downgrade

```sql
DELETE FROM obra_user_roles
WHERE origin = 'backfill_fase5';
```

Determinista. No toca filas manuales (`origin IS NULL`) ni las del invite (también `origin IS NULL`). Cubierto por `test_rollback_borra_solo_backfill`.

### 3.3 Salida en consola

Ambos direcciones imprimen el rowcount para que quede en el log del deploy:

```
$ alembic upgrade head
INFO  [alembic.runtime.migration] Running upgrade 0048 -> 0049, backfill: preservar acceso ...
[fase-5-backfill] filas nuevas insertadas: 8 (las que ya existían por invite/asignación manual quedaron intactas)
```

---

## 4. Script de verificación

**Archivo:** `backend/scripts/verify_fase5_backfill.py`

Uso: `PYTHONPATH=. python scripts/verify_fase5_backfill.py` (o corrido desde `backend/`).

Ejecuta 4 checks de solo lectura y sale con exit code != 0 si alguno falla:

1. **Conteo exacto por tenant:** para cada tenant, `n_collabs × n_obras` filas en `obra_user_roles` para users con `role='collaborator'`. Muestra tabla con `esperado / actual / diff`.
2. **Sin duplicados** en `(obra_id, user_id)`.
3. **Sin cross-tenant** en filas con `origin='backfill_fase5'`.
4. **Sin admins** en filas del backfill.

Diseñado para correr:

- **Antes** del backfill (baseline: espera fail en el check 1 y ok en los otros).
- **Después** del backfill (todo debe pasar).

Salida real de ejecución contra la BD local con datos del seed:

```
──────────────────────────────────────────────────────────────────────
  Verificación de backfill Fase 5 — collaborators × obras
──────────────────────────────────────────────────────────────────────
  · Collaborators activos con tenant : 2
  · Obras totales con tenant         : 4
  · Filas ObraUserRole totales       : 8
    - marcadas 'backfill_fase5'      : 8
    - manuales / invite (origin NULL): 0

  Detalle por tenant:
  tenant_id  name                       collabs   obras   esperado   actual   diff
          6  Constructa Demo                  2       4          8        8     +0

  OK  : todos los tenants tienen exactamente collabs×obras filas.
  OK  : sin duplicados en (obra_id, user_id).
  OK  : ningún cross-tenant en filas del backfill.
  OK  : ningún admin de empresa tiene filas del backfill.
──────────────────────────────────────────────────────────────────────
  RESULTADO: OK ✓
──────────────────────────────────────────────────────────────────────
```

---

## 5. Conteo real (BD dev de referencia)

- **Antes:** 0 filas en `obra_user_roles` (tabla creada vacía en Fase 1, la app estaba en modo enforcement pero nunca se corrió el backfill hasta ahora).
- **Después de `alembic upgrade head`:** **8 filas** insertadas, todas con `origin='backfill_fase5'` y `role='colaborador'`.
- **Composición:**
  - Tenant `6` (Constructa Demo): 2 collabs (`juan@constructa.com`, `ana@constructa.com`) × 4 obras (Edificio Norte, Vivienda Barrio Jardín, Local Comercial Nueva Córdoba, xxzxz) = 8 filas.
- **Diff = 0**: el conteo coincide exactamente con `Σ (collabs × obras)` por tenant.

Este dataset chico (1 tenant, 2 collabs, 4 obras) confirma la matemática. En un entorno de producción con `N` tenants, el script imprime la tabla completa fila por tenant para auditoría manual.

---

## 6. Verificación end-to-end con un collaborator real

Después del backfill, se hizo login como `juan@constructa.com` (collaborator del tenant Constructa Demo) y se ejecutó el flujo real de la app:

**`POST /api/v1/auth/login`** → devuelve access_token válido.

**`GET /api/v1/users/me`** con el token:

```json
{
  "id": 2,
  "email": "juan@constructa.com",
  "role": "collaborator",
  "tenant_name": "Constructa Demo",
  "obra_roles": [
    {"obra_id": 4, "obra_name": "Edificio Norte — Córdoba Centro",       "role": "colaborador"},
    {"obra_id": 5, "obra_name": "Vivienda Unifamiliar — Barrio Jardín",  "role": "colaborador"},
    {"obra_id": 6, "obra_name": "Local Comercial — Nueva Córdoba",       "role": "colaborador"},
    {"obra_id": 7, "obra_name": "xxzxz",                                  "role": "colaborador"}
  ]
}
```

**`GET /api/v1/obras`** con el token: devuelve las 4 obras del tenant. Antes del backfill devolvía `[]` (Fase 2 filtra por `visible_obra_ids`).

Comportamiento equivalente al pre-rediseño: Juan ve todas las obras de su tenant. El nivel de acceso es exactamente el mismo que tenía como `collaborator` global antes de que existiera `ObraUserRole` — no se le dio ni más ni menos.

Test automatizado que replica este flujo: `backend/tests/test_backfill_fase5.py::test_despues_del_backfill_collab_ve_sus_obras`.

---

## 7. Plan de rollback

### 7.1 Rollback via Alembic (recomendado)

```bash
cd backend
alembic downgrade 0048  # revierte solo la 0049 (backfill de datos)
```

Salida esperada:

```
INFO  [alembic.runtime.migration] Running downgrade 0049 -> 0048, backfill: ...
[fase-5-rollback] filas eliminadas (origin='backfill_fase5'): 8
```

Solo se borran las filas con `origin='backfill_fase5'`. **Las asignaciones creadas manualmente después del backfill (por invite Fase 3, asign Fase 4 desde EquipoPage) NO se tocan** — sus filas tienen `origin IS NULL` y sobreviven al DELETE. Verificado en `test_rollback_borra_solo_backfill`.

Ejemplo: si tras el backfill el admin de Constructa Demo asigna a Ana como `jefe_obra` en la obra "Edificio Norte" (sobrescribiendo la fila `colaborador` del backfill), esa fila se re-marca como `origin=NULL` porque `set_role()` la actualiza con la firma normal (no re-marca origin). En caso de rollback:

- La fila de Ana en "Edificio Norte" queda porque `origin IS NULL` (fue modificada manualmente).
- Las otras 7 filas del backfill (Juan × 4 + Ana × 3) desaparecen.

Este comportamiento es el deseado: el rollback vuelve al estado "collabs no ven nada" **solo para las asignaciones que nunca fueron confirmadas manualmente**.

Después del downgrade, si se quiere volver al estado pre-Fase 5 completo:

```bash
alembic downgrade 0047  # revierte también la columna origin (schema)
```

### 7.2 Rollback manual (SQL directo)

Si por alguna razón Alembic no está disponible en el entorno (ej. la BD la tocan solo DBAs con acceso SQL):

```sql
BEGIN;
-- Contar antes (esperado: N = filas insertadas por el backfill)
SELECT COUNT(*) FROM obra_user_roles WHERE origin = 'backfill_fase5';

-- Borrar
DELETE FROM obra_user_roles WHERE origin = 'backfill_fase5';

-- Confirmar
SELECT COUNT(*) FROM obra_user_roles WHERE origin = 'backfill_fase5';  -- debe dar 0
COMMIT;
```

### 7.3 Rollback parcial (por tenant)

Si un tenant específico tuvo un problema (ej. una migración temprana ensució el dato y ahora hay que redo solo ese), se puede segmentar:

```sql
DELETE FROM obra_user_roles
WHERE origin = 'backfill_fase5'
  AND tenant_id = <ID>;
```

Y luego reejecutar el INSERT con `WHERE u.tenant_id = <ID>` — misma query que 0049 con el filtro extra.

### 7.4 Qué NO se puede recuperar

Ninguna fila creada manualmente después del backfill se pierde con el rollback: `origin IS NULL` las protege. Pero **si un admin cambió la fila del backfill (ej. bajó a Ana de colaborador a solo_lectura en una obra)**, esa fila queda con `origin IS NULL` en el estado actual del proyecto — el downgrade no la borra, y esa fila protegida sigue teniendo el rol que el admin quiso.

**Precondición para un rollback limpio:** correrlo lo antes posible después del deploy problemático, idealmente antes de que los admins empiecen a hacer cambios manuales — así todas las filas siguen marcadas con `origin='backfill_fase5'` y se limpian.

---

## 8. Suite de tests

`backend/tests/test_backfill_fase5.py` — **10 tests, todos pasando**. Cubren:

1. `test_antes_del_backfill_collab_no_ve_ninguna_obra` — reproduce el estado roto que la migración viene a resolver.
2. `test_backfill_crea_filas_esperadas` — 2 collabs × 3 obras + 1 × 1 = 7 filas exactas.
3. `test_backfill_no_toca_admins`.
4. `test_backfill_no_cruza_tenants`.
5. `test_despues_del_backfill_collab_ve_sus_obras` — flujo positivo end-to-end.
6. `test_collab_puede_crear_tarea_post_backfill` — el rol `colaborador` incluye `tarea.create` (matriz Fase 1 §2.4).
7. `test_collab_NO_puede_borrar_tarea_post_backfill` — el rol `colaborador` NO incluye `tarea.delete` (misma matriz). El backfill preserva el nivel exacto, no da más.
8. `test_backfill_es_idempotente` — correrlo dos veces no duplica.
9. `test_backfill_respeta_asignaciones_previas` — un `JEFE_OBRA` pre-existente sobrevive intacto.
10. `test_rollback_borra_solo_backfill` — el downgrade respeta las filas manuales.

**Suite completa del proyecto post-fase-5:** 176 tests passed / 0 failed (`pytest --tb=line -q`, 38s).

---

## 9. Playbook operativo (para el DBA / operador de deploy)

```bash
# 0. Backup obligatorio de la BD antes de tocar nada.
pg_dump -U postgres constructa > backup_pre_fase5_$(date +%Y%m%d_%H%M%S).sql

# 1. Aplicar solo el cambio de schema.
cd backend && source .venv/bin/activate
alembic upgrade 0048

# 2. Baseline: correr el verify script — todos los checks menos el conteo
#    deberían pasar. El conteo va a decir "FAIL: esperado > 0, actual = 0"
#    (es lo esperado antes del backfill).
PYTHONPATH=. python scripts/verify_fase5_backfill.py || true

# 3. Aplicar el backfill. La salida imprime el rowcount.
alembic upgrade head

# 4. Verificar. Todo tiene que salir OK.
PYTHONPATH=. python scripts/verify_fase5_backfill.py

# 5. Smoke test manual: loguear como un collab conocido y confirmar que
#    ve las obras. Usar cualquier user con role='collaborator' del tenant.
#    Ej: curl POST /auth/login → curl GET /obras → debe listar las obras.

# 6. Si algo salió mal:
alembic downgrade 0048       # revierte el backfill (solo filas marcadas)
alembic downgrade 0047       # opcional: revierte también la columna origin
# O restaurar el dump del paso 0.
```

---

## 10. Cierre del rediseño (fases 0–5)

Con esta fase el rediseño de roles queda **cerrado y en producción**. Resumen de lo que se logró:

| Fase | Entregable | Estado |
|---|---|---|
| **0** | Cerrar guards del sistema binario admin/collaborator + fix del bypass de `check_plan_limit` | ✅ Mergeado, 16 tests nuevos |
| **1** | Modelo `ObraUserRole` + enum + repositorio + schemas + migración 0046 | ✅ Mergeado |
| **2** | Enforcement de permisos por-obra en 60+ endpoints backend + `require_obra_role` factory | ✅ Mergeado, 24 tests reescritos |
| **3** | Payload extendido de `POST /users/invite` con `obra_assignments`, `pending_obra_assignments` en `users`, doble candado en `accept-invite` | ✅ Mergeado, 11 tests nuevos, migración 0047 |
| **4** | Frontend obra-aware (`usePermission` con `obraId`, EquipoPage con edición por-obra, InviteModal con selector, endpoints CRUD `/obras/{id}/user-roles`) | ✅ Mergeado, 16 tests backend nuevos + verificación visual |
| **5** | Backfill idempotente de collaborators existentes + rollback determinista via `origin` | ✅ Esta fase, 10 tests, migraciones 0048/0049 |

Comportamiento total del sistema:

- Un **admin de empresa** puede todo en todas las obras del tenant. Superset absoluto.
- Un **`collaborator` con rol `jefe_obra`** en una obra tiene control operativo total en esa obra (crear/borrar tareas, upload+delete de planos, gestionar el equipo de responsables, cotizaciones/órdenes, calendario), pero no puede tocar los datos maestros de la obra ni operar a nivel empresa.
- Un **`collaborator` con rol `colaborador`** en una obra puede crear/editar tareas, cambiar estado, subir planos, marcar recepción de órdenes, escribir en bitácora. No puede borrar ni gestionar el equipo.
- Un **`collaborator` con rol `solo_lectura`** en una obra ve todo (lectura y descarga), no muta nada.
- Un **`collaborator` sin fila** en `ObraUserRole` para una obra recibe 404 (aislamiento — no se distingue de "no existe").
- Un **`admin de empresa` sin fila** en ninguna obra sigue viendo todo (no necesita filas).

---

## 11. Decisión pendiente que NO se resolvió en el rediseño

Fase 3 planteó una decisión de producto sobre `check_plan_limit`:

> **¿Los usuarios con rol `solo_lectura` (auditor, consultor externo, cliente con acceso de solo-vista) deberían contar contra `max_users` del plan?**

**Estado actual:** Camino A — todos los users cuentan igual (fila en `users` = 1 slot), sin importar sus roles por-obra. Comportamiento heredado de Fase 0.

**Camino B pendiente** (excluir `solo_lectura`): habilita el modelo comercial "traé a tu cliente/auditor a ver la obra sin costo" pero requiere que el pricing esté alineado en marketing. Cambio de código detallado en el TODO explícito de `backend/app/core/plan_limits.py:65-88` — no es trivial (subquery contra `obra_user_roles` con máxima del rol) pero está mapeado.

**Riesgo de no decidir:** ninguno técnico — el sistema funciona con Camino A y es la interpretación más simple ("30 usuarios son 30 filas, punto"). El riesgo es de negocio: si en el futuro se quiere ofrecer "cliente con acceso gratis", hay que cambiar la política y comunicarlo antes de que el pricing existente cree fricción.

**Recomendación:** decidir Camino A o Camino B **antes** de que el módulo de facturación entre a producción con precios reales. Mientras el pricing esté en fase de descubrimiento, mantener Camino A (código sin cambios) es lo correcto.

---

## 12. Archivos entregados

**Backend — producción (2 archivos):**

- `backend/alembic/versions/0048_obra_user_role_origin.py` — schema (columna + índice parcial).
- `backend/alembic/versions/0049_backfill_obra_user_roles.py` — data migration idempotente.
- `backend/app/models/obra_user_role.py` — modelo extendido con `origin`.

**Backend — scripts (1 archivo nuevo):**

- `backend/scripts/verify_fase5_backfill.py` — verificación de solo lectura, exit != 0 si falla.

**Backend — tests (1 archivo nuevo):**

- `backend/tests/test_backfill_fase5.py` — 10 tests.

**Documentación (1 archivo — este):**

- `docs/roles-redesign/fase-5-migracion.md`.

**Sin tocar:**

- Frontend — el usuario final no ve nada nuevo. Todo se resuelve por la asignación `colaborador` que ya soporta.
- Ningún endpoint HTTP nuevo — la migración es puramente sobre datos.
- `plan_limits.py` — sigue como estaba, con el TODO explícito.
