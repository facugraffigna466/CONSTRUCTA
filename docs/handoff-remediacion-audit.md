# Handoff — Cómo continuar la remediación del audit de CONSTRUCTA

> **Para el próximo agente (Codex u otro).** Este documento describe **exactamente** el
> trabajo en curso, **el proceso paso a paso** que se sigue en cada cambio, las
> convenciones, los errores típicos ("gotchas") ya aprendidos, el **estado actual** y
> el **backlog pendiente**. Seguí esto al pie de la letra para continuar idéntico.
>
> Fecha del handoff: 2026-07-18.

---

## 0. Qué estás haciendo (en una frase)

Estás **remediando, uno por uno, los hallazgos del audit** del sistema, cada uno en
**su propio PR chico y verificado**. El audit completo (con severidades y estado de
resolución) es el documento maestro:

**`docs/auditoria-sistema-consolidada.md`** ← leelo primero, entero. Ahí está el mapa,
las 26 rutas del backend cubiertas, y el ranking P0/P1/P2. La §9 es la auditoría de
frontend pantalla por pantalla (hallazgos "F1", "F2", …).

Objetivo de calidad: **la respuesta más correcta y verificada posible**, no la más
rápida. Un PR por ítem, con tests y build en verde.

---

## 1. ⭐ EL PROCESO EXACTO (esto es lo que hay que repetir en CADA ítem)

Cada cambio sigue **estos 9 pasos, en este orden**. No te saltees ninguno.

### Paso 1 — Sincronizar `main` y limpiar la rama anterior
```bash
git fetch origin --quiet
git checkout main && git pull --ff-only origin main
# borrar la rama del PR anterior SOLO si de verdad se mergeó (verificar, no confiar):
git merge-base --is-ancestor <rama-anterior> origin/main && \
  git branch -d <rama-anterior> && git push origin --delete <rama-anterior>
```
**Crítico:** el usuario a veces dice "mergeado" pero mergeó otra cosa (o no creó el PR).
**Verificá siempre con `git merge-base --is-ancestor`** antes de borrar una rama. Si no
está en `main`, NO la borres (la rama es el único lugar donde vive ese trabajo).

### Paso 2 — Elegir el próximo ítem del backlog (§6 de este doc)
Priorizá por: (1) valor, (2) verificable con tests/build en este entorno, (3) riesgo
bajo. Si el ítem tiene una decisión de diseño con trade-off real (ej: URLs firmadas que
rompen datos guardados), **plantear las opciones al usuario ANTES de codear** (con
`AskUserQuestion`), no decidir solo.

### Paso 3 — Crear la rama desde `main`
```bash
git checkout -b <tipo>/<nombre-corto> main
# tipos usados: feature/  fix/  chore/  docs/  ci/  refactor/  security/
```

### Paso 4 — Investigar ANTES de escribir código
Leé el código real de lo que vas a tocar y **buscá un patrón existente para espejar**.
Ejemplos de patrones ya establecidos:
- Features de auth (recuperación de contraseña, verificación de email) → **espejan el
  flujo de invitación**: `secrets.token_urlsafe(32)` + campo token en `users` + email
  vía `email_service` + endpoint en `auth.py` + página de front interceptada por URL en
  `App.tsx` (como `/invite/{token}`).
- Modales → hook `useDialog` (`frontend/src/hooks/useDialog.ts`): Esc + foco atrapado +
  `role=dialog` + pila global de diálogos anidados.
- Confirmaciones/avisos → `useConfirm()` del `ConfirmProvider` (async, estilado).

### Paso 5 — Implementar espejando el patrón
Escribí código que **se lea como el que lo rodea** (mismos estilos inline, misma
densidad de comentarios, mismos idioms). El front es **inline styles** (hay algo de
Tailwind heredado, pero el idiom es CSS-in-JS). Colores: `#FF6B35` (naranja acción),
`#1A2329` (texto), `#1F8A5B`/`#D03A3A` (éxito/peligro). Tipografías: `Plus Jakarta Sans`
y `JetBrains Mono`.

### Paso 6 — Verificar (SIEMPRE, antes de commitear)
- **Backend:** `cd backend && .venv/bin/python -c "from app.main import app"` (import) +
  `.venv/bin/python -m pytest -q -p no:cacheprovider` (tests). Usar `backend/.venv`, NO
  `backend/venv`.
- **Frontend:** `cd frontend && npx tsc -b` (tipos) + `npm run build` (build de prod).
- Si tocaste algo con estado in-memory (rate limit, etc.), corré la suite **varias veces**
  para descartar flakiness.
- **Nota importante:** el **preview server del entorno NO funciona** (no bindea el puerto,
  probado varias veces). Por eso la verificación en navegador de flujos que requieren
  auth+datos **no es posible acá** — se declara honestamente y se ofrece hacerla si el
  usuario levanta el stack. La página de login SÍ es alcanzable sin backend, pero igual
  el preview no arranca en este entorno.

### Paso 7 — Commit con **staging quirúrgico**
```bash
git add <ruta/exacta/1> <ruta/exacta/2>   # ← SIEMPRE rutas explícitas
```
**NUNCA `git add backend/` ni `git add -A`.** El working tree suele tener **WIP del
usuario** que no es tuyo (ej. un rename `DEBUG→APP_DEBUG`, docs de la defensa). Un `add`
masivo lo barre a tu commit. Staggeá solo tus archivos y verificá con
`git diff --cached --stat`. Los commits terminan con:
```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```
**Excepción:** si commiteás WIP del usuario (que él escribió), NO le pongas la co-autoría
(sería atribución falsa).

### Paso 8 — Push y dar el link para crear el PR
```bash
git push -u origin <rama>
```
**El usuario crea el PR** desde GitHub (yo no tengo `gh` en este entorno). Dale el link:
`https://github.com/facugraffigna466/CONSTRUCTA/compare/main...<rama>`
> Ojo: si solo pusheás la rama, **no aparece PR** en la lista (GitHub lista PRs, no
> ramas). Recordale crear el PR desde ese link.

### Paso 9 — Reportar y esperar el merge
Resumen del PR: qué cambió (tabla), verificación (tests/build), honestidad sobre lo no
verificado, y el link. **No mergeás vos a `main`** (protocolo: rama → PR → el usuario
mergea → tag opcional). Esperá el "mergeado" y volvé al Paso 1.

---

## 2. Convenciones duras del proyecto

- **Backend:** nunca `session.commit()` en un service/repo (el commit lo hace `get_db()`).
  Capturar estado ANTES de mutar. Soft-delete (`is_active=False`), nunca borrar filas.
  `whatsapp_number` inmutable. `HistorialEvento` append-only. Deps: `CurrentUser` (con
  tenant), `CurrentUserId` (solo id — patrón que causó los IDOR), `AdminUser`, `DbSession`.
- **Frontend:** routing por **estado** en `App.tsx` (no hay router). Los datos de una obra
  se cargan una vez con `Promise.all` en `ObraDetailPage`. Inline styles.
- **Git:** una rama por ítem → PR → merge. Antes de pushear, explicar qué cambió +
  checklist de verificación + esperar confirmación.
- **Multi-tenant:** el aislamiento va por `tenant_id`. Ver §6 (Fase 2 ya hecha: columna
  denormalizada + NOT NULL + guard por columna en `task_materials`).

---

## 3. ⭐ Gotchas aprendidos en esta sesión (no repitas estos errores)

1. **`git add` masivo barre el WIP del usuario** → staging quirúrgico siempre (Paso 7).
2. **El usuario dice "mergeado" sin haber mergeado** (o mergeó otra rama). Verificá con
   `git merge-base --is-ancestor` (Paso 1). Pasó ~3 veces con el PR de infra.
3. **Datetimes naive vs aware en tests SQLite:** SQLite devuelve datetimes *naive*;
   comparar con `datetime.now(timezone.utc)` (aware) tira `TypeError`. Normalizá:
   `if exp.tzinfo is None: exp = exp.replace(tzinfo=timezone.utc)`.
4. **Tests que llaman endpoints necesitan el fixture `db`** (crea el esquema con
   `create_all`); sin él → `no such table: users`.
5. **Estado in-memory en tests** (rate limiter): agregá un fixture `autouse` en
   `conftest.py` que limpie el estado entre tests (`_hits.clear()`), o se contaminan.
6. **Health check testeable:** usa `Depends(get_db)` (que el test override manda a SQLite),
   NO el engine real (que en tests apunta a un Postgres dummy que no conecta).
7. **Detección de código muerto:** el grep de imports **subestima**; usá **alcanzabilidad
   transitiva desde el entry point** (`frontend/src/main.tsx`). Hay un script de ejemplo
   en el historial (BFS parseando imports estáticos y dinámicos). El primer barrido
   encontró 7 muertos; el de reachability encontró 8 más.
8. **Docs/skills stale:** varios skills (`.agents/skills/constructa-*`, `docs/skills.md`)
   describían como "vivo" código ya borrado (`AlertsPanel`, `message_interpreter`, el
   array `TABS` que no existe). Al borrar/renombrar código, **reconciliá los skills**.
9. **El preview server no arranca** en este entorno (no bindea el puerto). No pierdas
   tiempo peleándolo; verificá con tests/build y sé honesto sobre el walkthrough.

---

## 4. Estado actual (2026-07-18)

**Mergeado a `main` (todo verificado con tests/build):**
- **P0 de seguridad — TODO cerrado** (14/15): los 13 IDOR cross-tenant (guards de tenant),
  `/uploads` + planos/audios con **URLs firmadas** (`app/core/signing.py`), Socket.IO con
  scope de tenant, `INTERNAL_API_KEY` (ya fallaba cerrado), SSE muerto removido.
  Único P0 abierto por diseño: `#14` `whatsapp_number` per-tenant (necesita número de
  WhatsApp por tenant — decisión de producto, documentada como limitación).
- **Causa raíz — denormalización de `tenant_id`**: Fase 1 (columna+backfill+keep-in-sync,
  mig. 0040) + Fase 2 (`NOT NULL` + guard por columna, mig. 0041).
- **Tests + CI**: `backend/tests/` (aislamiento, firma, denorm, password reset, rate limit,
  email verification, health) + `.github/workflows/ci.yml` (pytest + build en cada push).
- **Frontend**: F1 (`AdminPage` dato incorrecto), F2 (`EquipoPage` errores en silencio +
  confirm inline), F3 (`BACKEND_URL` localhost → `PUBLIC_BASE_URL`), **código muerto
  eliminado** (16 módulos, ~2.875 líneas), **a11y de modales** (hook `useDialog` en los 10
  modales, con pila de anidados).
- **Auth**: recuperación de contraseña, **rate limiting** (login/forgot/reset), **verificación
  de email**.
- **Infra**: handler global de excepciones + health con ping a la DB.

**PR abierto (pusheado, SIN mergear):**
- **`fix/f6-confirm-dialog`** — F6: consolidar los 8 `confirm()`/`alert()` nativos en un
  `ConfirmProvider` estilado (`useConfirm`). Verificado (tsc+build). Falta que el usuario
  cree+mergee el PR:
  `https://github.com/facugraffigna466/CONSTRUCTA/compare/main...fix/f6-confirm-dialog`

---

## 5. ⭐ Backlog pendiente — "qué queda por corregir"

Ordenado por criterio sugerido (valor/verificabilidad/riesgo). Ninguno es un P0 de
seguridad (ya están todos cerrados); son P1/P2 de robustez, features y pulido.

| # | Ítem | Severidad | Notas para hacerlo |
|---|------|-----------|--------------------|
| 1 | **Mergear F6** (ver §4) | P2 | Ya está hecho y pusheado; solo falta el merge del usuario. |
| 2 | **`whatsapp_number` per-tenant (#14)** | P0 (diseño) | NO es bug de código: necesita número de WhatsApp por tenant. Requiere decisión de producto — **plantearla al usuario**, no implementar a ciegas (rompería el ruteo del chatbot). |
| 3 | **a11y Gantt/planilla (F4 fase 3)** | P1 | `GanttTimeline`/`TaskSheetView` tienen 0 `aria`. Agregar `role=grid/row/gridcell` + navegación por teclado. **DELICADO:** memoria del proyecto = *no romper el drag del Gantt*; verificar en navegador antes de mergear (y el preview no anda acá → coordinar con el usuario). |
| 4 | **Recuperación de cuenta — refresh token** | P1 | Sesión que no expira abruptamente. Backend (endpoint refresh) + interceptor axios en el front (reintento en 401). El interceptor es delicado (loops) y difícil de verificar sin navegador. |
| 5 | **Routing por URL** | P2 (grande) | Migrar el estado de navegación de `App.tsx` a un router (React Router/TanStack). Habilita deep-links, back/forward, compartir. Refactor grande pero acotado. |
| 6 | **Robustez de infra restante** | P1 | Rate limiting por número en el webhook de WhatsApp; limpieza de sesiones de conversación vencidas; tracking de errores (Sentry); logging estructurado; validar secretos en el arranque (fallar si faltan en prod); CORS por env (hoy hardcodeado a localhost). |
| 7 | **Presencia/edición colaborativa multi-worker** | P1 | Hoy es in-memory (se rompe con >1 worker). Necesita Redis/pub-sub. Infra. |
| 8 | **Monetización real** | P1 (grande) | Billing, verificar `active_until` (un plan vencido hoy no bloquea nada), trial, self-service upgrade, página de precios. |
| 9 | **Bitácora IA — control de costo** | P1 | Presupuesto de IA por tenant/plan; validación de tamaño/tipo del audio. |
| 10 | **P2 varios del front (§9)** | P2 | `fetchAlerts()` trae todas y filtra en cliente (pedir por obra); afford muertos del Sidebar (workspace switcher, % de "Fijadas" hardcodeado); `AcceptInvitePage` acepta a ciegas (mostrar quién invita); desglosar mega-componentes (`ComprasTab` 2578, `TaskSheetView`, `GanttTimeline`); reconciliar Tailwind vs regla del `CLAUDE.md`. |

Detalle de cada uno: `docs/auditoria-sistema-consolidada.md` (P1 §4, P2 §4, frontend §9)
y los `docs/analisis-modulo-*.md`.

---

## 6. Comandos útiles

```bash
# Backend (siempre con .venv, no venv)
cd backend && .venv/bin/python -m pytest -q -p no:cacheprovider
cd backend && .venv/bin/python -c "from app.main import app; print('OK')"

# Frontend
cd frontend && npx tsc -b && npm run build

# Ver el audit y su estado de resolución
sed -n '1,30p' docs/auditoria-sistema-consolidada.md

# Reachability de código muerto (front) — escribir un script Python que parsee
# imports desde frontend/src/main.tsx (BFS) y reporte los .tsx/.ts no alcanzables.
```

---

## 7. Regla de oro

**Honestidad y verificación sobre velocidad.** Si algo no se pudo probar (ej. navegador),
decilo. Si el usuario dice "mergeado", verificá. Si hay WIP ajeno en el working tree, no
lo toques. Un PR por ítem, chico, verde y explicado. Cuando el usuario dice "seguí",
volvé al **Paso 1**.
