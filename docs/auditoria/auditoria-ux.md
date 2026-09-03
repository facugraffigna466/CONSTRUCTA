# Auditoría UX/UI — CONSTRUCTA (fecha 2026-06-12)

**Auditor:** revisión de código frontend completo (`frontend/src/`), con foco en el flujo de creación de tareas.
**Usuario objetivo:** jefe de obra / arquitecto. Vive en Excel y WhatsApp. Cero tolerancia a fricción. La mitad del tiempo está en la obra con el teléfono.
**Lentes aplicadas:** calidad visual (frontend-design) + fricción/conversión/claridad de CTAs (page-cro).

---

## Resumen ejecutivo

1. **🔴 La carga "tipo Excel" ya existe pero está enterrada.** La vista Planilla (`TaskSheetView.tsx`) es exactamente lo que el cliente pidió ("que se cargue ahí la info, como en Excel") y hasta tiene paste masivo desde el portapapeles con parser de columnas… pero la vista por defecto es "tabla" (`ObraDetailPage.tsx:81`), el toggle es un ícono de 32px sin texto, y el paste **solo funciona si el foco está en una zona muerta de la grilla** (`TaskSheetView.tsx:337-352`). No hay un solo texto en toda la UI que diga "podés pegar desde Excel". La feature estrella es indescubrible.
2. **🔴 Cero soporte mobile.** No hay **ni una media query** en todo el frontend (solo 4 archivos usan clases responsive de Tailwind; el resto es inline fijo). Portfolio fuerza `repeat(3, 1fr)` (`PortfolioPage.tsx:511`), KPIs `repeat(4, 1fr)` (`:399`), sidebar fija de 260px (`AppLayout.tsx:91`), el Gantt y el resize de columnas usan solo eventos de mouse (sin touch). El jefe de obra en la obra con el teléfono **no puede usar la app**.
3. **🔴 Pérdida de datos silenciosa en el wizard de obra.** Click en el backdrop o en la X cierra `ObraSetupWizard` sin confirmación (`ObraSetupWizard.tsx:896-898`): se pierden obra + responsables + tareas cargadas a mano. Para un usuario que tipeó 15 tareas, es fatal.
4. **🟠 La "duración" significa cosas distintas según dónde mires.** El modal calcula exclusivo: `due = start + d` (`TaskFormModal.tsx:441,480`), la planilla calcula inclusivo: `due = start + d - 1` (`TaskSheetView.tsx:61-65,694`). La misma tarea de lunes a viernes muestra "4 días" en el modal y "5d" en la planilla. Para gente que vive de cronogramas, esto destruye confianza.
5. **🟠 Datos inventados en la UI.** Portfolio muestra "avance medio **50%**" hardcodeado (`PortfolioPage.tsx:414`), sparklines decorativas fijas y "actualizado hace un momento" siempre (`:356`). El login muestra stats de marketing inventadas ("85% de obras mejoran su puntualidad"). En B2B de construcción, un número falso detectado = producto descartado.
6. **🟠 El paste masivo descarta la mitad de lo que parsea.** `clipboardParser.ts` detecta responsable y predecesoras, pero `confirmPaste` los tira: crea todo con `responsible_id: null` y sin dependencias (`TaskSheetView.tsx:396-417`). Además crea las tareas en serie (un `await` por fila, sin barra de progreso) y no maneja el límite de plan (402) ni fallas parciales.
7. **🟡 Accesibilidad floja transversal:** labels no asociados a inputs (los `FieldLabel` son `<span>`, no `<label htmlFor>`), botones icon-only sin `aria-label`, textos de 10–11.5px en `#8E97A0`/`#ADAAA4` (contraste ~3.5:1 y ~2.5:1, falla WCAG AA), modales sin focus-trap ni cierre con Esc (`TaskFormModal` ni siquiera cierra con click afuera).
8. **🟢 Lo bueno:** el sistema visual es consistente y cuidado en desktop (pills de estado unificadas en Gantt/Tabla/Planilla/Alertas, paleta respetada, jerarquía tipográfica clara, estados vacíos que en general guían con CTA). La base de diseño es sólida; el problema es de **arquitectura de flujo**, no de estética.

---

## Flujo de creación de tareas — análisis profundo y propuesta

### Estado actual: tres caminos, ninguno es "el camino"

**Costo de llegar a crear la primera tarea (camino feliz hoy):**
Login → Portfolio → click en obra → cae en tab **Resumen** (no Tareas) → click tab "Tareas" → click "Nueva tarea" → **modal de ~12 campos** → completar → "Crear tarea". Son **5 clicks + un modal denso** para una tarea. Para 20 tareas: 20 ciclos de modal.

#### a) `TaskFormModal.tsx` (modal)
- Es el destino del botón "Nueva tarea" en vista tabla y en el header del Resumen (`ObraDetailPage.tsx:497-501, 780`).
- Mezcla en un solo formulario: título, descripción, padre WBS, responsable, fecha+**hora** de inicio, duración, fecha+hora de fin, dependencias con tipo FS/SS/FF/SF y lag, hito, % avance y materiales. Para crear "Hormigonado platea — 5 días" sobran 8 campos.
- Las horas de inicio/fin (`:447-455`) son ruido para el 99% de tareas de obra; ocupan una columna de 120px cada una.
- La jerga FS/SS/FF/SF tiene leyenda (`:593-601`), bien, pero sigue siendo lenguaje MS Project, no de obra ("no puede empezar hasta que termine X" sería más claro).
- **Bug de duración exclusiva vs inclusiva** (ver resumen, punto 4).
- No cierra con Esc ni con click en backdrop; el de wizard sí cierra con backdrop (y pierde datos). Inconsistencia exactamente al revés de lo deseable.
- Lo bueno: validación inline clara, manejo del 402 con `UpgradeModal`, cascade preview excelente (`:761-854`), materiales en borrador al crear.

#### b) `TaskSheetView.tsx` (planilla) — el diamante escondido
Lo que ya hace bien:
- Edición celda por celda con click, Tab entre campos, Enter = guardar y nueva fila, Esc cancela. Hint visible en la save bar (`:836`).
- Duración ↔ fecha fin bidireccional (como Project).
- Combobox de responsable con búsqueda (`ResponsableCombobox`).
- Paste TSV desde Excel/Project con detección de encabezados ES/EN, preview con confirmación (`:908-943`), resize de columnas persistido, zebra, footer de totales. Es un trabajo serio.

Lo que la mata como camino principal:
1. **Descubribilidad cero del paste.** El handler exige que `document.activeElement` sea el contenedor (que tiene `tabIndex={-1}`) y **no** un input (`:338-341`). Si el usuario clickeó una celda (lo primero que hace cualquiera), el paste no dispara. No hay hint, ni botón "Pegar desde Excel", ni mención en el empty state. Probabilidad de descubrimiento orgánico: ~0.
2. **Está detrás de un toggle icon-only** (`ObraDetailPage.tsx:407-441`): dos iconitos de 14px con `title`. Un jefe de obra no hace hover buscando tooltips.
3. **Sin empty state.** Con 0 tareas la planilla muestra header + "Agregar fila" y nada más. Es el momento exacto donde habría que decir "pegá tu listado desde Excel".
4. **Navegación incompleta de teclado:** no hay Shift+Tab hacia atrás, ni flechas ↑/↓ entre filas, ni "Enter baja en la misma columna" (comportamiento Excel). Tab desde la última celda guarda en vez de pasar a la siguiente fila editando.
5. **No se puede borrar una tarea** desde la planilla: la prop `onTaskDeleted` se declara (`:126`) pero nunca se usa ni se renderiza un botón. Hay que volver a la tabla para borrar.
6. **Fila nueva castrada:** % avance y estado no editables (`:886-891`), razonable, pero ocupan espacio mostrando "—".
7. **Sin manejo de 402** (límite de plan): error genérico "No se pudo guardar la tarea" (`:464`), cuando el modal sí muestra el `UpgradeModal`.
8. **Paste pierde responsable y dependencias** que el parser sí extrae, crea en serie sin progreso y sin recuperación de fallas parciales (`:396-417`).
9. El header "sticky" no funciona: `position: sticky` (`:567`) dentro de un contenedor con `overflow: clip` (`:561`) nunca se pega, porque el contenedor no es el scrollport.
10. No crea subtareas ni hitos (la indentación WBS se muestra, pero no se puede asignar padre desde la planilla).

#### c) `ImportModal.tsx` (archivo)
- Flujo de 3 pasos correcto, drag&drop, plantilla descargable, preview con errores/advertencias por fila, badge MS Project. De lo mejor del producto.
- Falta: **remapeo manual de columnas** — si la detección falla, los chips verdes (`:139-148`) solo muestran qué detectó; no hay paso "esta columna es el título". Callejón sin salida con planillas no estándar.
- Los chips muestran el nombre de la columna pero no a qué campo se mapeó ("Comienzo" → ¿inicio o fin?).

### ¿La planilla cumple lo que pidió el cliente?

**El motor sí; la experiencia no.** El cliente dijo: *"integrar una hoja de excel y que directamente se cargue ahí la info, que es a lo que están acostumbrados"*. Hoy eso existe técnicamente pero el producto lo trata como una vista secundaria. La respuesta no es construir algo nuevo: es **promover y completar lo que ya está**.

### Propuesta concreta: rediseño "Excel-first"

**Principio:** la planilla es EL lugar donde se cargan y editan tareas. El modal queda para lo avanzado (dependencias, materiales, descripción, WBS). El import por archivo queda como tercera puerta para quien ya tiene el .xlsx.

| # | Cambio | Archivos | Esfuerzo |
|---|--------|----------|----------|
| 1 | **Planilla como vista por defecto** del tab Tareas (`useState<"tabla"\|"planilla">("planilla")`), persistir elección en `localStorage` por usuario. "Nueva tarea" en planilla ya abre fila inline (eso está bien hoy). | `ObraDetailPage.tsx:81` | **S** |
| 2 | **Toggle con texto**: "Tabla" / "Planilla" como segmented control con label, no iconos de 14px. | `ObraDetailPage.tsx:407-441` | **S** |
| 3 | **Empty state de la planilla** con dos CTAs: "➕ Agregar primera fila" y "📋 Pegar desde Excel". El segundo usa `navigator.clipboard.readText()` → mismo preview actual, sin depender del foco. Agregar también hint permanente discreto en el footer ("Tip: pegá filas copiadas de Excel con Ctrl+V"). | `TaskSheetView.tsx` (nuevo bloque tras `:584`) | **S** |
| 4 | **Paste robusto**: escuchar paste aunque el foco esté en un input de la planilla, si el texto tiene ≥1 tab o ≥2 líneas (eso lo distingue de pegar texto en una celda). | `TaskSheetView.tsx:337-352` | **S** |
| 5 | **Aprovechar todo lo parseado**: en `confirmPaste`, matchear `responsibleName` contra `responsibles` activos (case-insensitive, por inclusión) y crear la dependencia FS desde `dependsOnRow` en una segunda pasada. Mostrar responsable matcheado en el preview (hoy dice "Sin asignar" fijo, `:931`). | `TaskSheetView.tsx:396-417`, `clipboardParser.ts` (ya listo) | **M** |
| 6 | **Endpoint bulk** `POST /obras/{id}/tasks/bulk` (una transacción, un evento de historial "Se importaron N tareas") + barra de progreso/spinner con conteo en el preview. Elimina la creación en serie y las fallas parciales. | backend `tasks` router/service + `TaskSheetView.tsx`, `api/tasks.ts` | **M** |
| 7 | **Teclado nivel Excel**: Enter = guardar y editar la fila siguiente **misma columna**; Shift+Tab hacia atrás; ↑/↓ cambian de fila; Esc cancela la celda (revierte valor) y un segundo Esc cancela la fila. | `TaskSheetView.tsx:472-486` | **M** |
| 8 | **Borrar fila** desde la planilla (ícono basurita al hover al final de la fila, o tecla Supr con fila seleccionada) usando la prop `onTaskDeleted` ya existente. | `TaskSheetView.tsx`, `ObraDetailPage.tsx:525` | **S** |
| 9 | **Manejo de 402 en planilla**: capturar `getPlanLimitError` como hace el modal y mostrar `UpgradeModal`. | `TaskSheetView.tsx:463-465` | **S** |
| 10 | **Unificar la semántica de duración** (inclusiva, como la planilla y como Project): en el modal usar `addDays(start, d-1)` y `diffDays+1`. | `TaskFormModal.tsx:144-146,441,480,501` | **S** |
| 11 | **Wizard paso 3 Excel-first**: arriba del form de alta manual, zona "Pegá tu listado desde Excel" que reutiliza `parseClipboardRows` y llena la lista de draft tasks. Es el momento de mayor motivación para carga masiva y hoy obliga a tipear de a una. | `ObraSetupWizard.tsx` (Step3, `:494-603`) | **M** |
| 12 | **Adelgazar el modal**: colapsar "Avanzado" (descripción, horas, WBS, dependencias, hito, % avance) detrás de un acordeón; arriba quedan título, responsable, inicio, duración. El modal pasa de ~12 campos visibles a 4. | `TaskFormModal.tsx:330-710` | **M** |
| 13 | (Opcional, fase 2) **Columna "Predecesora" en la planilla** (número de fila, estilo Project) para cerrar el círculo de paridad Excel/Project sin abrir el modal. | `TaskSheetView.tsx` | **L** |

Con 1–4 + 8 (todo S, ~1 día) la planilla ya se convierte en el camino principal percibido. Con 5–7 + 11 queda a la altura de la promesa "como Excel".

---

## Hallazgos por flujo

Severidad: **P0** = bloquea/destruye confianza del usuario objetivo · **P1** = fricción alta o inconsistencia seria · **P2** = pulido.

| Sev | Flujo | Problema | Recomendación concreta | Archivo |
|-----|-------|----------|------------------------|---------|
| P0 | Tareas/Planilla | Paste desde Excel indescubrible: solo dispara con foco en zona muerta; cero hints en UI | Botón "Pegar desde Excel" + hint + paste con foco en inputs (ver propuesta #3–4) | `TaskSheetView.tsx:337-352` |
| P0 | Tareas | La vista planilla (lo que el cliente pidió) está escondida tras toggle icon-only y la default es "tabla" | Default "planilla" + toggle con texto (propuesta #1–2) | `ObraDetailPage.tsx:81,407-441` |
| P0 | Mobile (todos) | Sin una sola media query; grids fijos de 3–4 columnas, sidebar 260px fija, drag/resize solo mouse | Pasada responsive mínima: grids `auto-fit/minmax`, sidebar off-canvas <1024px, scroll horizontal explícito en planilla/Gantt, touch events en Gantt | `PortfolioPage.tsx:399,511`, `AppLayout.tsx:91`, `GanttTimeline.tsx`, `TaskSheetView.tsx:296-321` |
| P0 | Creación de obra | Click en backdrop o X cierra el wizard y pierde todo lo cargado sin confirmar | Confirmación "¿Descartar la obra y las N tareas cargadas?" si hay datos; idealmente draft en `localStorage` | `ObraSetupWizard.tsx:896-898,947-959` |
| P1 | Tareas | Duración exclusiva en modal vs inclusiva en planilla: misma tarea muestra valores distintos | Unificar a inclusiva (propuesta #10) | `TaskFormModal.tsx:441,480` vs `TaskSheetView.tsx:61-65` |
| P1 | Tareas/Planilla | `confirmPaste` descarta responsable y dependencias parseadas; crea en serie sin progreso; sin manejo de 402 ni fallas parciales | Propuestas #5, #6, #9 | `TaskSheetView.tsx:396-417` |
| P1 | Tareas/Planilla | No se puede eliminar tarea desde la planilla (prop `onTaskDeleted` muerta) | Botón eliminar al hover por fila (propuesta #8) | `TaskSheetView.tsx:126` |
| P1 | Portfolio | KPI con dato hardcodeado ("avance medio 50%"), sparklines fake, "actualizado hace un momento" fijo | Calcular avance real desde `completed_tasks/total_tasks`; quitar sparklines o alimentarlas con datos; quitar el "hace un momento" | `PortfolioPage.tsx:356,407-435` |
| P1 | Login | Stats de marketing inventadas en pantalla interna de un sistema de gestión; sin "olvidé mi contraseña" | Reemplazar stat-pills por bullets de features reales; agregar recuperación de contraseña (o al menos "contactá a tu admin") | `LoginPage.tsx:96-123` |
| P1 | Tareas/Modal | Modal de creación con ~12 campos visibles para el caso simple | Acordeón "Avanzado" (propuesta #12) | `TaskFormModal.tsx:330-710` |
| P1 | Import | Sin remapeo manual de columnas si la detección falla; chips no dicen a qué campo se mapeó cada columna | Paso opcional de mapeo con selects "Columna X → Campo Y"; chips formato "Título ← `Nombre`" | `ImportModal.tsx:139-148` |
| P1 | Wizard | Paso 3 obliga a cargar tareas de a una con form de 5 campos; sin paste masivo justo donde más se necesita | Propuesta #11 | `ObraSetupWizard.tsx:494-603` |
| P1 | Accesibilidad | Labels no asociados (`FieldLabel` es span), icon-buttons sin `aria-label`, modales sin Esc ni focus-trap, `<article onClick>` sin rol/teclado en cards de obra | `<label htmlFor>`, `aria-label` en toda botonera icon-only, handler global Esc en modales, `role="button"`+`tabIndex` o `<button>` en cards | `TaskFormModal.tsx:71-88`, `PortfolioPage.tsx:71`, `ObraDetailPage.tsx:407-441` |
| P1 | Accesibilidad | Texto 10–11.5px en `#8E97A0`/`#ADAAA4`/`#C4C9C6` sobre blanco — contraste insuficiente (2.5–3.5:1) en labels, hints y metadatos por toda la app | Subir grises de texto secundario a ≥ `#6B7580` (4.6:1) y mínimos de 11px; reservar los grises claros para bordes/decoración | transversal (ej. `TaskSheetView.tsx:503-516`, `PresupuestoTab.tsx:499-501`) |
| P1 | Gantt | Drag, resize de barras y resize de columnas solo con mouse (mousedown/mousemove); inutilizable en tablet/teléfono | Pointer Events (`pointerdown/move/up` + `touch-action: none`) en vez de mouse events | `GanttTimeline.tsx` (handlers de drag), `TaskSheetView.tsx:296-321` |
| P2 | Tareas/Planilla | Header `position: sticky` nunca se pega (`overflow: clip` en el contenedor) | Mover el sticky al scrollport real o dar `maxHeight + overflow:auto` al contenedor | `TaskSheetView.tsx:561,567` |
| P2 | Alertas | `AlertBell` usa emojis (🔴⏰⚠️💬📅📦) mientras el resto del sistema usa SVG/lucide; inconsistencia visual | Reemplazar por los mismos íconos del `AlertasTab` | `AlertBell.tsx:4-11` |
| P2 | Alertas | "Marcar todas leídas" dispara N requests individuales (`Promise.all` de `markAlertRead`) | Endpoint `PATCH /alerts/mark-all-read` | `ObraDetailPage.tsx:203-210` |
| P2 | Presupuesto | Errores con `alert()` nativo del navegador, rompe con el lenguaje visual del resto | Banner de error inline como en el resto de la app | `PresupuestoTab.tsx:405,417` |
| P2 | Presupuesto | Botón "Generar pedido" deshabilitado usa `#F0A882` (naranja lavado) — parece habilitado a medias | Estado disabled gris estándar (`#E6E7E5` + texto `#8E97A0`), patrón ya usado en otros lados | `PresupuestoTab.tsx:482` |
| P2 | Materiales | En `TaskMaterialsSection` la columna de precio mezcla subtotal y precio unitario según haya cantidad (`(qty*price) \|\| price`) sin indicar cuál es | Dos columnas o prefijo "subt./unit."; hoy el número es ambiguo | `TaskMaterialsSection.tsx:203-207` |
| P2 | Onboarding | El modal de 3 pasos cuenta pero no lleva a la acción: "¡Empezar!" solo cierra | El CTA final debería abrir el wizard de obra (si no hay obras) — conectar `onClose` con `setShowWizard(true)` | `OnboardingModal.tsx:127-137`, `App.tsx` |
| P2 | Configuración | Página de 1.496 líneas con sistema + calendario + plan + proveedores en un solo scroll sin anclas | Sub-tabs o índice lateral de secciones | `ConfiguracionPage.tsx` |
| P2 | Tareas/Tabla | Empty state correcto pero sin CTA accionable ("Creá la primera tarea" es texto, no botón) | Botón "Nueva tarea" + link "o importá desde Excel" en el empty state | `TaskTable.tsx:335-357` |
| P2 | Obra detalle | Al entrar a una obra cae en "Resumen"; quien viene a cargar/chequear tareas siempre paga un click extra | Recordar último tab visitado por obra en `localStorage` | `App.tsx:107`, `ObraDetailPage.tsx` |
| P2 | Wizard | El form de responsable exige formato E.164 crudo ("+5491112345678") con error técnico | Normalizar input (aceptar espacios/guiones, autoprefijo +54) y mostrar ejemplo en el placeholder ya está — sumar máscara suave | `ObraSetupWizard.tsx:812` |
| P2 | Login | Code-style: usa Tailwind classes cuando la convención del proyecto es inline styles (CLAUDE.md); el hover scale de la card (`hover:scale-[1.018]`) es un gesto de landing, raro en un form de login diario | Unificar criterio; quitar el scale | `LoginPage.tsx:140` |

---

## Quick wins (<1h cada uno)

1. **Default a planilla** en el tab Tareas + persistencia en `localStorage` — `ObraDetailPage.tsx:81` (15 min).
2. **Hint de paste**: línea en el footer de la planilla y en el empty state: "Tip: copiá filas en Excel y pegalas acá (Ctrl+V)" — `TaskSheetView.tsx` (30 min).
3. **Texto en el toggle** "Tabla / Planilla" — `ObraDetailPage.tsx:407-441` (20 min).
4. **Fix duración inclusiva** en el modal — `TaskFormModal.tsx:441,480,501,144-146` (30 min).
5. **Quitar el "50%" hardcodeado** y calcular avance real; quitar "actualizado hace un momento" — `PortfolioPage.tsx:356,414` (20 min).
6. **Confirmar antes de cerrar el wizard** con datos cargados — `ObraSetupWizard.tsx:896` (30 min).
7. **Esc cierra `TaskFormModal`** (y el resto de modales) — (20 min).
8. **CTA en empty state de TaskTable** ("Nueva tarea" / "Importar") — `TaskTable.tsx:335-357` (30 min).
9. **Manejo de 402 en planilla** reutilizando `getPlanLimitError` — `TaskSheetView.tsx:463` (30 min).
10. **Reemplazar emojis del AlertBell** por íconos lucide — `AlertBell.tsx:4-11` (30 min).
11. **`alert()` → banner inline** en Presupuesto — `PresupuestoTab.tsx:405,417` (30 min).
12. **Estado disabled gris** para "Generar pedido" — `PresupuestoTab.tsx:482` (10 min).

---

## Roadmap UX sugerido (orden de ataque)

**Sprint 1 — "La planilla ES el producto" (impacto máximo en la promesa al cliente)**
Quick wins 1–4 + 9 → propuesta Excel-first #3, #4, #5, #8. Resultado: el usuario entra al tab Tareas, ve una grilla tipo Excel, pega su listado y queda cargado con responsables. Es la demo que vende.

**Sprint 2 — Bulk + teclado + wizard**
Endpoint bulk con progreso (#6), navegación teclado nivel Excel (#7), paste en wizard paso 3 (#11), remapeo de columnas en ImportModal. Cierra el ciclo de carga masiva por las tres puertas.

**Sprint 3 — Mobile mínimo viable**
El jefe de obra en campo necesita: ver sus obras, ver/marcar estado de tareas, ver alertas. No necesita el Gantt en el teléfono. Plan: sidebar off-canvas + grids responsive en Portfolio/Resumen + vista tabla colapsada a cards en <768px + touch en lo crítico. Aceptar que planilla/Gantt sean "mejor en desktop" con scroll horizontal honesto.

**Sprint 4 — Confianza y consistencia**
Eliminar todo dato fake (Portfolio, Login), confirmación de cierre del wizard, modal adelgazado con acordeón "Avanzado" (#12), unificación de patrones de error, recuperación de contraseña.

**Sprint 5 — Accesibilidad y pulido**
Contraste de grises secundarios, labels asociados, aria-labels, focus-trap + Esc en modales, sticky header real en planilla y Gantt, pointer events en drag, sub-tabs en Configuración, onboarding accionable.

---

*Nota final: no se modificó ningún archivo de código; este informe es el único entregable escrito.*
