---
name: constructa-frontend-module
description: Use when adding a new page, tab, component, form, or API integration to the CONSTRUCTA React/TypeScript frontend.
---

## When to use this skill

- Adding a new tab to `ObraDetailPage`
- Creating a new reusable component
- Adding a new form or modal
- Wiring a new API endpoint to the UI
- Adding a new section to `ResumenTab`
- Any change to `frontend/src/`

Do NOT use this skill for backend-only changes. Use `constructa-backend-feature` for those.

---

## Files to read first

Before writing any code, read:

```
frontend/src/types/index.ts                    — all domain types (Obra, Task, Responsible, Alert, etc.)
frontend/src/api/<relevant>.ts                 — existing API functions for the domain
frontend/src/pages/ObraDetailPage.tsx          — data ownership, loadData(), tab structure
frontend/src/components/ResumenTab.tsx         — how tabs receive props
frontend/src/<component to modify>.tsx         — current implementation before changing
docs/skills.md                                 — FS-01 through FS-07 and UX/DC rules
```

---

## Rules to respect

### No direct HTTP calls in components (FS-04)
All HTTP calls must live in `frontend/src/api/*.ts`.
Components call typed async functions, never `axios` or `fetch` directly.
API functions return domain types from `src/types/index.ts`, not raw Axios responses.

### Type-only imports (FS-03)
`tsconfig.json` has `verbatimModuleSyntax: true`. Violating this fails the build.
```tsx
// CORRECT
import { useState, type FormEvent } from "react";
import type { Task, Responsible } from "../types";

// WRONG — build error
import { Task } from "../types";
```

### ObraDetailPage owns all obra state (FS-02, DC-01)
Tabs receive data as props. They never fetch independently.
If a tab needs data not currently fetched in `loadData()`, add the fetch to `loadData()` in `ObraDetailPage.tsx`.
After any mutation: call `onRefresh()` which calls `loadData(true)` in the parent.
Never update `tasks`, `alerts`, `responsibles`, or `historial` state locally inside a tab.

### Design tokens only (FS-07)
Never use hardcoded hex colors. Use `constructa-*` Tailwind tokens:
| Token | Color | Use |
|---|---|---|
| `constructa-primary` | #FF6B35 | Primary actions, active states |
| `constructa-dark` | #37474F | Sidebar, modal headers |
| `constructa-warning` | #FFA726 | Warning badges |
| `constructa-danger` | #E53935 | Errors, destructive actions |
| `constructa-success` | #43A047 | Completed states |
| `constructa-info` | #1E88E5 | Info badges |
| `constructa-bg` | #FAFAFA | Page background |
| `constructa-surface` | #ECEFF1 | Card/table headers |
| `constructa-border` | #B0BEC5 | Borders, dividers |
| `constructa-text` | #263238 | Primary text |
| `constructa-secondaryText` | #607D8B | Labels, subtitles |

### Modal height (FS-05)
Modals with dynamic content must use fixed height to prevent layout shift:
```tsx
<div className="h-[90vh] flex flex-col overflow-hidden">
  <header className="flex-shrink-0">...</header>
  <main className="flex-1 overflow-y-auto min-h-0">...</main>
  <footer className="flex-shrink-0">...</footer>
</div>
```
Dynamic list containers: `min-h-[220px] max-h-[220px] overflow-y-auto`

### Inactive responsible guard (FS-06)
Every form that assigns a responsible must:
1. Filter to `responsibles.filter(r => r.is_active)` for the dropdown
2. When editing a task with an inactive responsible, initialize field as `""` and show amber warning
3. Never allow selecting an inactive responsible

### Task status is read-only (DR-01)
Never add a status field to any form or `TaskUpdatePayload`.
Display note: "El estado de la tarea es gestionado por el sistema de chatbot."

### Responsive state routing (FS-01)
No React Router. Navigation is state in `App.tsx`.
`selectedObra !== null` → renders `ObraDetailPage`.
Never introduce routing libraries without explicit decision.

### Empty states are required (UX-03)
Every list and filtered view needs an empty state message:
- "No hay [items] para esta obra." — when dataset is empty
- "No hay [items] con este filtro." — when filtered result is empty

### SectionTitle pattern (UX-06)
Every content section uses `<SectionTitle>` for the orange left bar:
```tsx
<SectionTitle aside={<Button variant="primary">Acción</Button>}>
  Título de sección
</SectionTitle>
```

### Destructive actions require confirmation (UX-05)
Deactivate/delete flows must show a confirmation modal that describes side effects.

---

## Step-by-step process

### Adding a new tab to ObraDetailPage

1. Add tab ID to `ObraTab` type and `TABS` array in `ObraDetailPage.tsx`
2. Create `frontend/src/components/<NuevaTab>.tsx`
   - Props: only what `ObraDetailPage` already has in state
   - Never fetch inside the tab component
3. Add the `case` to `renderTab()` in `ObraDetailPage.tsx`
4. After mutation: call `onRefresh()` → `loadData(true)` in parent
5. If new data is needed: add the fetch call to `loadData()` in `ObraDetailPage.tsx`

### Adding a new component

1. Read the parent component to understand what props are available
2. Define the `interface <ComponentName>Props` clearly
3. Use `import type` for all type-only imports
4. Use `constructa-*` tokens for all colors
5. Add empty state if component can render an empty list
6. Export the component: `export function <ComponentName>(...)`
7. Wire it in the parent

### Adding a new API function

1. Add to the appropriate `frontend/src/api/<entity>.ts` file
2. Define the payload interface in the same file if needed
3. Return the domain type from `src/types/index.ts`
4. Handle errors by letting them throw — components catch and set `apiError` state

---

## Validation commands

```bash
# TypeScript build check — must pass with zero errors
cd frontend && npm run build

# Dev server for manual testing
cd frontend && npm run dev
```

---

## Common mistakes to avoid

| Mistake | Consequence | Fix |
|---|---|---|
| `import { Task }` instead of `import type { Task }` | Build fails with `verbatimModuleSyntax` error | Always use `import type` for type-only imports |
| Fetching inside a tab component | Data goes stale, bypasses `loadData` sync | Move fetch to `loadData()` in `ObraDetailPage` |
| Setting local state after mutation instead of calling `onRefresh()` | Other tabs see stale data | Call `onRefresh()` which calls `loadData(true)` |
| Hardcoded hex color | Breaks design consistency | Use `constructa-*` token |
| Missing empty state | Users see blank when list is empty | Always add empty state message |
| Adding `status` to `TaskUpdatePayload` | DR-01 violation | Remove it — status is chatbot-controlled |
| Using `max-h` alone on modal | Modal shrinks/grows unexpectedly | Use `h-[90vh] flex flex-col overflow-hidden` |
| Showing inactive responsibles in dropdown | FS-06 violation | Filter with `.filter(r => r.is_active)` |

---

## End-of-task documentation requirement

At the end of every frontend task, update `documentacion.md` with a new entry:

```markdown
## YYYY-MM-DD — <Short title>

### Objective
What was implemented and why.

### Changes made
- New/modified component files
- API functions added/modified
- Types added/modified

### Files modified
- `frontend/src/components/<Name>.tsx`
- `frontend/src/api/<name>.ts`
- etc.

### Problems found
Any TypeScript errors, prop mismatches, build failures, or UX issues encountered.

### Solutions applied
How problems were resolved. Reference specific skills (FS-03, DC-01, etc.) if applicable.

### Validation
- `npm run build` — passed with zero TypeScript errors
- Manual test: describe the flow tested and result

### Pending / next steps
What remains to be done.
```

If no code was changed, still document the analysis and reasoning.
