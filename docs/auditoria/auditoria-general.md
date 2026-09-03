# Auditoría general de la app — 2026-06-13

**Método:** recorrido en navegador con datos reales (tenant "Empresa por defecto", 8 obras), revisando consola/red, interacciones y consistencia. **Excluido** lo construido y verificado en esta etapa: alta de empresa / onboarding / wizard, planilla con gestos de Excel + Gantt, módulo de Presupuestos y módulo de Planos.

**Estado general: sano.** Cero errores de consola en todo el recorrido. Todas las páginas cargan y las interacciones núcleo funcionan (portfolio, tabs de obra, Gantt en Resumen, Presupuesto/materiales, Configuración con su índice, Equipo, Admin, campana de alertas, menú de perfil). Los hallazgos son de consistencia y pulido, no de cosas rotas.

Severidad: **P1** = fricción alta / inconsistencia seria · **P2** = pulido / copy.

---

## P1

| # | Hallazgo | Detalle | Dónde |
|---|----------|---------|-------|
| 1 | **El equipo de la obra está desacoplado de los responsables de las tareas** | La obra "3feffe" tiene 30 tareas con responsable asignado, pero el tab **Responsables dice "Sin responsables en esta obra todavía"**. Una tarea puede tener un `responsible_id` sin que esa persona esté en `obra_team_members`. Resultado: el tab Responsables y el checklist marcan "sin equipo" mientras las tareas muestran gente asignada. Además el chatbot (`obra_ids_for_responsible` usa tareas, ok) y las alertas dependen de esta relación. | Tab Responsables vs TaskTable. Afecta obras viejas (el wizard nuevo ya vincula al equipo). Conviene: al asignar un responsable a una tarea, vincularlo al equipo de la obra automáticamente; o que el tab Responsables muestre también a los asignados-a-tareas que no están en el equipo. |
| 2 | **Overflow horizontal en mobile** | A 380px el header (breadcrumb "Constructa / Panel / Vista general de obras" + campana + avatar) **no se achica y se sale de la pantalla** (`scrollWidth` 581 vs viewport 380); el avatar queda cortado a la derecha. El resto de la página stackea bien. | `AppLayout` header en pantallas angostas. Truncar el breadcrumb / ocultar el subtítulo en mobile. |

---

## P2

| # | Hallazgo | Detalle | Dónde |
|---|----------|---------|-------|
| 3 | **El banner de completitud aparece en TODOS los tabs** | "Completá la configuración de tu obra" (2 de 5 pasos) se muestra arriba de Resumen, Tareas, Responsables, Presupuesto, etc. En la **planilla de Tareas** roba mucho espacio vertical justo donde más se necesita. | `ObraDetailPage` — el `ObraCompletenessChecklist` se renderiza fuera del switch de tabs. Mostrarlo solo en Resumen, o hacerlo colapsado por defecto en el resto. |
| 4 | **"TOTAL OBRAS 08" dice subtítulo "8 activas" pero hay 0 activas** | La card de stats hardcodea "{n} activas" cuando en realidad es el total (las 8 están "Planificada"). El propio filtro de abajo dice "Activas 0". Copy engañoso. | `PortfolioPage` stat card TOTAL OBRAS. Debería decir "8 obras" o "8 en total". |
| 5 | **Definición inconsistente de "activa"** | Panel Admin muestra "Obras activas 8/20" (cuenta TODAS las obras), mientras el portfolio dice "Activas 0" (por estado). La misma palabra significa dos cosas distintas en dos pantallas. | `AdminPage` vs `PortfolioPage`. Unificar: "obras" en Admin, o aplicar el mismo criterio de estado. |
| 6 | **Breadcrumb equivocado en Panel Admin** | Navegando a Panel Admin, el breadcrumb del header dice **"Configuración / Ajustes del sistema"** en vez de "Panel Admin". Falta el caso `admin` en la lógica de breadcrumb, cae al `else` de Configuración. | `App.tsx` (pageTitle/pageSubtitle). Agregar el caso `activePage === "admin"`. |
| 7 | **Sección "Herramientas de testing" expuesta en Configuración** | "Simular alerta vencida" / "Test WhatsApp" son útiles en desarrollo, pero quedan visibles para cualquier admin. En producción deberían ocultarse (o detrás de un flag de entorno). | `ConfiguracionPage` sección Testing. |

---

## Lo que se revisó y está OK

- **Portfolio**: stats, filtros por estado, búsqueda, cards, botón Nueva obra. Sin errores.
- **Tabs de obra**: Resumen (con checklist + Gantt de 29 barras drag-able), Responsables (form + empty state), Alertas (~53 ítems + "marcar todas leídas"), Historial, Presupuesto/materiales (stats estimado/comprometido/real, agregar ítem, exportar, generar pedido).
- **Configuración**: índice de secciones sticky, todas las secciones cargan.
- **Equipo**: invitar, roles admin/colaborador.
- **Panel Admin**: plan, uso (obras/usuarios/tareas), barras, CTA de upgrade.
- **Header**: campana con dropdown de alertas, menú de perfil con "Cerrar sesión".
- **Mobile**: el contenido stackea bien; solo el header desborda (P1 #2).
- **Consola**: 0 errores, 0 warnings en todo el recorrido.

## Orden sugerido de corrección

1. **#6, #4, #5** (copy/breadcrumb) — 15 minutos, cero riesgo.
2. **#2** (header mobile) — chico, mejora real en celular.
3. **#3** (banner solo en Resumen) — chico.
4. **#7** (ocultar Testing en prod) — chico, pero atado a definir el flag de producción.
5. **#1** (equipo ↔ responsables de tareas) — el más de fondo; decisión de producto sobre cómo unificar.

---

## Resolución (2026-06-13, misma sesión)

Los 7 hallazgos corregidos y verificados en navegador:

| # | Fix | Verificación |
|---|-----|--------------|
| 1 | Asignar un responsable a una tarea lo vincula al equipo de la obra (`task_service._ensure_team_member` en create/update/bulk) + backfill de obras viejas (migration 0029) | Obra 4: tab Responsables ya muestra los 5 asignados (antes "sin responsables") |
| 2 | Header mobile: breadcrumb se reduce a ícono+título y se encoge. Barra de filtros del portfolio scrolleable en mobile | A 380px: scrollWidth = viewport (sin overflow) |
| 3 | Checklist de completitud solo en el tab Resumen | Banner ausente en Tareas, presente en Resumen |
| 4 | "TOTAL OBRAS · 8 activas" → "8 vigentes" | Visual |
| 5 | Admin "Obras activas"/"Usuarios activos" → "Obras"/"Usuarios" | Visual |
| 6 | Breadcrumb de Panel Admin (caso `admin` en App.tsx) | Header dice "Panel Admin" |
| 7 | "Herramientas de testing" detrás de `import.meta.env.DEV` (oculto en build de producción) | Build de producción OK |

`tsc` ✓ · `npm run build` ✓ · migración 0029 aplicada (backfill).
