# Análisis: Frontend (capa de presentación) — arquitectura, estado, UX, accesibilidad y performance

> Módulo auditado: el frontend como sistema — enrutamiento, manejo de estado, capa de API, accesibilidad, responsive/mobile, performance y consistencia visual. Complementa los audits de backend (que ya cubrieron las 26 rutas).
> Fecha: 2026-07-02 | Rama: `main`

---

## TL;DR

El frontend está **bien construido en lo funcional**: TypeScript en todo, `ErrorBoundary` real, manejo extensivo de estados de carga y error (128/284 puntos), botones reales (no divs), interceptor de auth con redirección en 401. Las debilidades son de **arquitectura y alcance**, no de bugs: la app **no tiene enrutamiento por URL** (todo es estado en `App.tsx`), lo que impide compartir/bookmarkear/usar back-forward; la **accesibilidad es mínima** (casi sin `aria`/`role`); **no hay responsive** (0 media queries, es desktop-first); y los componentes pesados (Gantt, planilla) **no están memoizados** (`React.memo` = 0), lo que puede causar jank en obras grandes.

---

## 1. Arquitectura y enrutamiento

### Qué funciona

| Aspecto | Estado |
|---------|--------|
| TypeScript estricto en todo el código | ✅ |
| Separación clara: `pages/`, `components/`, `api/`, `hooks/`, `context/`, `types/` | ✅ |
| Un archivo de API por recurso; tipos centralizados en `types/index.ts` | ✅ |
| Vite + React 19 | ✅ |

### Gaps detectados y cómo resolverlos

---

#### Gap 1 — No hay enrutamiento por URL (todo es estado en `App.tsx`)

**Impacto:** Medio-Alto — producto

La navegación se maneja con estado (`activePage: Page`, `selectedObra: Obra | null`, `activeTab: ObraTab`); `window.location` solo se lee para `/invite/{token}`. Consecuencias:

- **No se puede compartir/bookmarkear** un link a una obra o pestaña (`/obras/123/tareas` no existe).
- **El back/forward del navegador no funciona** como espera el usuario (volver cierra sesión o no hace nada).
- **No hay deep links** para campañas, emails de alerta ("ver la tarea X") ni para el propio producto.
- Ligado a esto: no hay `/login` ni `/register` propios (ya notado en el audit de auth).

**Solución profesional:** adoptar un router (React Router o TanStack Router) con rutas reales:
```
/                       → portfolio
/obras/:id/:tab?        → detalle de obra (tab opcional)
/bitacora, /equipo, /configuracion, /admin
/login, /register, /invite/:token, /reset-password/:token
```
Migrar el estado de navegación a la URL desbloquea deep links, back/forward y compartir. Es un refactor acotado (el estado ya existe, solo hay que sincronizarlo con la URL).

**Esfuerzo estimado:** 1-2 días

---

#### Gap 2 — Estado de navegación centralizado con prop-drilling desde `App.tsx`

**Impacto:** Bajo-Medio — mantenibilidad

`App.tsx` (239 líneas) concentra ~9 piezas de estado (`authed`, `activePage`, `selectedObra`, `activeTab`, `obraCounts`, `bitacoraPending`, `showWizard`, `focusAlert`, `pinnedObras`) que se bajan por props. Solo hay un context (`UserContext`). A medida que crece, el prop-drilling y el re-render de todo desde `App` se vuelven costosos.

**Solución profesional:** con el router (Gap 1), parte del estado se va a la URL. El resto (counts, pending, pinned) puede vivir en contexts pequeños o un store liviano (Zustand). No hace falta Redux.

**Esfuerzo estimado:** incluido en el refactor de routing

---

## 2. Capa de API y manejo de errores

### Qué funciona

| Aspecto | Estado |
|---------|--------|
| `baseURL` por variable de entorno (`VITE_API_URL`) | ✅ |
| Interceptor de request agrega `Authorization: Bearer` | ✅ |
| Interceptor de response: en 401 / 403-"Not authenticated" limpia token y redirige | ✅ |
| **`ErrorBoundary`** real (montado en `main.tsx`) → un throw no tira toda la app | ✅ |
| Manejo extensivo de loading/error en páginas (Spinner/Skeleton, catch) | ✅ |

### Gaps detectados y cómo resolverlos

---

#### Gap 1 — El 402 (límite de plan) no está centralizado

**Impacto:** Medio

(Cross-ref audit de auth, Sección 3, Gap 5.) El interceptor maneja 401/403 pero no 402. Cada pantalla lo maneja (o no) por su cuenta: en `EquipoPage` está manejado, pero al crear la 4ta obra el 402 cae en un catch genérico.

**Solución profesional:** en el interceptor, emitir un evento global en 402 y que un `PlanLimitModal` a nivel `App` lo muestre siempre igual (patrón Linear).

**Esfuerzo estimado:** 2h

---

#### Gap 2 — Sin retry con refresh token

**Impacto:** Medio

(Cross-ref audit de auth, Sección 1, Gap 1.) Al vencer el JWT (24h), el interceptor limpia y redirige a login sin intentar renovar. Con refresh token, el interceptor debería reintentar la request original.

**Esfuerzo estimado:** incluido en la implementación de refresh token (backend)

---

## 3. Accesibilidad (a11y)

### Estado actual

| Métrica | Valor |
|---------|-------|
| Botones reales (`<button>`) | 262 ✅ |
| `aria-*` | 16 (muy pocos para 262 botones) |
| `role=` | 1 |
| `alt=` en imágenes | 7 |
| `<div onClick>` (no accesible por teclado) | 11 |

### Gaps detectados y cómo resolverlos

---

#### Gap 1 — Accesibilidad mínima

**Impacto:** Medio (Alto si hay requisito de accesibilidad/compliance)

Se usan botones reales (bien), pero casi no hay `aria-label` en botones-ícono (los 262 botones, muchos son solo un SVG sin texto → un lector de pantalla dice "botón" sin más), casi no hay `role`, y hay 11 `div` clickeables sin soporte de teclado. No se observa manejo de foco en modales/menús (trap de foco, restaurar foco al cerrar).

**Solución profesional:**
- `aria-label` en todo botón-ícono; `alt` en toda imagen.
- Convertir `div onClick` en `button` o agregar `role="button"` + `tabIndex` + `onKeyDown`.
- Focus trap + retorno de foco en modales/menús (los del portal de estado, TaskFormModal, etc.).
- Correr `axe` (extensión o Playwright + axe-core) para un baseline.

**Esfuerzo estimado:** 1-2 días (barrido) + integrar axe en CI

---

## 4. Mobile / responsive

### Estado actual

| Métrica | Valor |
|---------|-------|
| `@media` (CSS) | 0 |
| Detección JS (`matchMedia`/`innerWidth`) | 6 (puntual) |

### Gaps detectados y cómo resolverlos

---

#### Gap 1 — Es desktop-first, sin responsive real

**Impacto:** Medio

Con estilos inline y sin media queries, el layout no se adapta a pantallas chicas. Componentes como el Gantt y la planilla asumen ancho de escritorio. El jefe de obra, que muchas veces revisa desde el teléfono, tendría una experiencia pobre en móvil.

**Contexto que lo atenúa:** el personal de campo usa **WhatsApp**, no la webapp; la webapp es para el jefe en escritorio. Aún así, un jefe querría ver el portfolio y alertas desde el celular.

**Solución profesional:** priorizar responsive en las vistas de consulta (portfolio, detalle de obra, alertas, bitácora) — no necesariamente en la edición pesada (Gantt/planilla, que son inherentemente de escritorio). Como los estilos son inline, conviene un hook `useIsMobile()` + variantes de layout, o migrar esas vistas a clases con breakpoints.

**Esfuerzo estimado:** 2-3 días (vistas de consulta)

---

## 5. Performance

### Estado actual

| Métrica | Valor |
|---------|-------|
| `React.memo` (memoización de componentes) | **0** |
| `useMemo` | 10 |
| `useCallback` | 46 |

### Gaps detectados y cómo resolverlos

---

#### Gap 1 — Componentes pesados sin memoizar

**Impacto:** Medio

Se usan `useCallback`/`useMemo` en varios lados, pero **ningún componente está envuelto en `React.memo`**. En el Gantt (cientos de barras + flechas SVG) y la planilla (grilla con cientos de celdas), cualquier cambio de estado en un ancestro re-renderiza todo el árbol. En obras grandes esto se siente (jank al escribir, al hacer hover, al mover el mouse).

**Solución profesional:** memoizar las filas/celdas de la planilla y las barras/flechas del Gantt (`React.memo` con comparación por props relevantes), y virtualizar las listas largas (ya hay virtualización parcial). Medir con el React Profiler antes/después.

**Esfuerzo estimado:** 1-2 días (Gantt + planilla)

---

## 6. Estilos y consistencia visual

### Qué funciona

| Aspecto | Estado |
|---------|--------|
| Estilos inline con la paleta del producto (naranja `#FF6B35`, texto `#1A2329`, etc.) | ✅ (decisión de diseño) |
| Tipografías definidas (Plus Jakarta Sans / JetBrains Mono) | ✅ |

### Gaps detectados

- **Gap 1 (Bajo-Medio, mantenibilidad):** los colores y medidas están **repetidos inline** en decenas de archivos (`#FF6B35`, `#1A2329`, radios, sombras). Un cambio de marca implica buscar-y-reemplazar en todo el código. Conviene un módulo de **tokens** (`theme.ts` con colores/espaciados/radios) importado, manteniendo el estilo inline pero con una única fuente de verdad. Hay skills de design-system instaladas que apuntan a esto.
- **Gap 2 (Bajo):** conviven algunas clases tipo Tailwind (`lg:`/`md:`, 9 casos) con los estilos inline, pese a que el estándar del proyecto es inline. Conviene unificar.

**Esfuerzo estimado:** 1 día (extraer tokens)

---

## 7. Resumen: Fortalezas vs Debilidades

### Fortalezas

1. **TypeScript en todo** — tipos centralizados, `tsc` como red de seguridad.
2. **`ErrorBoundary`** real — un componente que falla no tumba la app.
3. **Manejo de loading/error extensivo** (128/284) con Spinner/Skeleton.
4. **Botones reales** (262) en vez de divs clickeables.
5. **Capa de API limpia** (un archivo por recurso, interceptores, env-driven).
6. **`useCallback`/`useMemo`** usados donde importa (aunque falta `React.memo`).

### Debilidades (ordenadas por impacto)

| # | Debilidad | Categoría |
|---|-----------|-----------|
| 1 | Sin enrutamiento por URL (no deep links, no back/forward, no compartir) | Arquitectura / Producto |
| 2 | Accesibilidad mínima (casi sin aria/role, botones-ícono sin label) | A11y |
| 3 | Desktop-first, sin responsive (0 media queries) | Mobile |
| 4 | Componentes pesados sin `React.memo` (jank en obras grandes) | Performance |
| 5 | 402 no centralizado + sin retry de refresh en el interceptor | UX / Auth |
| 6 | Prop-drilling desde `App.tsx` (239 líneas, ~9 estados) | Mantenibilidad |
| 7 | Colores/medidas inline repetidos, sin tokens | Mantenibilidad |
| 8 | Cero tests de componentes (cross-ref audit transversal) | Calidad |

---

## 8. Prioridad de correcciones

### P1 — Producto y UX

| Tarea | Qué cambiar | Esfuerzo |
|-------|-------------|---------|
| Enrutamiento por URL (React/TanStack Router) | `App.tsx`, `main.tsx`, páginas | 1-2 días |
| 402 centralizado + `PlanLimitModal` global | `api/client.ts`, `App.tsx` | 2h |
| `aria-label` en botones-ícono + `alt` + `div onClick`→button | barrido de componentes | 1-2 días |

### P2 — Calidad y performance

| Tarea | Qué cambiar | Esfuerzo |
|-------|-------------|---------|
| `React.memo` + virtualización en Gantt/planilla | `GanttTimeline.tsx`, `TaskSheetView.tsx` | 1-2 días |
| Responsive en vistas de consulta (portfolio, obra, alertas) | páginas + `useIsMobile()` | 2-3 días |
| Tokens de diseño (`theme.ts`) | nuevo `theme.ts` + reemplazos | 1 día |
| Tests de componentes (Vitest + Testing Library) | `frontend/**/*.test.tsx` | 1-2 días |
| Focus trap + axe en CI | modales, `.github/workflows` | 1 día |

---

## 9. Archivos clave por corrección

| Corrección | Ubicación |
|-----------|-----------|
| Routing por URL | `App.tsx`, `main.tsx`, `pages/*` |
| 402 centralizado | `api/client.ts`, `App.tsx`, nuevo `PlanLimitModal.tsx` |
| A11y | barrido en `components/*` y `pages/*` |
| Memoización | `components/GanttTimeline.tsx`, `components/TaskSheetView.tsx` |
| Responsive | `pages/PortfolioPage.tsx`, `pages/ObraDetailPage.tsx`, nuevo hook `useIsMobile` |
| Tokens | nuevo `frontend/src/theme.ts` |
| Tests de componentes | `frontend/src/**/*.test.tsx` (Vitest) |

---

## 10. Cierre

Con este documento, la auditoría cubre **backend (26 rutas) + frontend (capa de presentación)**. El frontend no tiene deuda de seguridad propia relevante (esa vive en el backend), sino deuda de **arquitectura (routing), alcance (a11y, mobile) y performance (memoización)**. Ninguna es bloqueante para una demo; todas importan para un producto pulido y accesible. La prioridad #1 del frontend es el **enrutamiento por URL**, porque desbloquea compartir, deep-linkear y una navegación que el usuario espera — y es prerrequisito de varias mejoras de producto del audit de auth (landing, `/pricing`, `/reset-password`).
