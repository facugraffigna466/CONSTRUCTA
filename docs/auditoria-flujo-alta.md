# Auditoría del flujo de alta — "Soy jefe de obra y quiero crear mi proyecto"

**Fecha:** 2026-06-12 · **Método:** recorrido real en navegador (registro → login → onboarding → wizard 4 pasos → obra creada), midiendo cada paso como un usuario nuevo sin contexto.

## Resumen ejecutivo

El wizard en sí está **bien diseñado**: 4 pasos claros, campos opcionales bien marcados, paste desde Excel, el responsable creado en el paso 2 ya aparece asignable en el paso 3. Un jefe de obra crea su proyecto en ~3-4 minutos sin ayuda. **Pero** hay 3 bloqueantes de negocio/seguridad antes de producción y 5 bugs de experiencia que hacen que el final del flujo se sienta roto (creás la obra y "no pasa nada", el checklist te dice que falta lo que ya cargaste).

## Hallazgos

### Bloqueantes para producción (lógica de negocio)

| # | Hallazgo | Detalle |
|---|----------|---------|
| 1 | **No hay registro self-service** | El login dice "pedile al administrador". `POST /auth/register` existe en backend pero no hay UI. Un cliente nuevo no puede empezar a usar el producto solo. |
| 2 | **El registrado nace `collaborator`** | Sin botón "Nueva obra", sin configuración. El primer usuario de una empresa debería crear su propio espacio y ser admin de él. |
| 3 | **Multi-tenant roto en el registro** | Usuario nuevo registrado por API (Raúl, jefe@obrasur.com, id 3) **ve las 7 obras de Estudio Velar** y su equipo. Las queries no aíslan por tenant para usuarios sin tenant. Es una fuga de datos entre empresas. |

**Flujo objetivo:** "Crear cuenta" en el login → registra empresa + usuario admin → crea tenant propio con plan Básico → cae en portfolio vacío → onboarding → "Crear mi primera obra" abre el wizard. Todo lo demás ya existe.

### Bugs de experiencia (el flujo funciona pero se siente roto)

| # | Hallazgo | Detalle | Causa probable |
|---|----------|---------|----------------|
| 4 | CTA final del onboarding miente | "Crear mi primera obra" solo cierra el modal | `onClose` sin conectar a `setShowWizard(true)` |
| 5 | Validación E.164 cruda en WhatsApp | "2494 555888" → "Formato inválido — usá E.164". Es EL campo crítico del producto y rechaza el formato natural | Falta normalización (strip espacios/guiones, autoprefijo +54 9) |
| 6 | **Crear obra termina en la nada** | POST /obras → 201 OK, pero la UI vuelve al portfolio sin la obra nueva (contador viejo) y sin navegar al detalle. Parece que falló; invita a crearla de nuevo | El wizard del Portfolio no refresca la lista ni navega al detalle tras crear |
| 7a | Responsable del wizard no queda en el equipo de la obra | Jorge quedó global (id 12) y asignado a las tareas, pero `/obras/8/team` = vacío → tab Responsables vacío + checklist en rojo, aunque sus tareas existen | El wizard no llama a `POST /obras/{id}/team/{responsible_id}` |
| 7b | Checklist marca comitente incompleto aunque se cargó | `GET /obras` (lista) devuelve `client_name: null` mientras `GET /obras/8` devuelve "Familia Pérez" — el schema del listado omite los campos de comitente y el checklist evalúa sobre el objeto de la lista | `ObraRead` del listado vs detalle inconsistentes |
| 8 | Bitácora dice "PRONTO" pero está terminada | Sidebar la muestra bajo "PRÓXIMAMENTE" con badge PRONTO; nadie entra a una feature que dice "pronto". Ídem "Presupuestos" (el tab Presupuesto de la obra ya existe) | Sección del Sidebar quedó del diseño original |

### Lo que está bien (no tocar)

- Wizard de 4 pasos: progresión clara, "podés omitir este paso", resumen final correcto.
- Paste desde Excel en el paso de tareas.
- El responsable creado en paso 2 aparece inmediatamente asignable en paso 3.
- Onboarding de 3 pasos con buen copy ("El plan conecta con el campo").
- Checklist de completitud como guía post-creación (cuando evalúe bien).

## Orden de corrección propuesto

1. **#6 + #7a + #7b** (el final del wizard) — es lo que más daño hace por sesión de uso y son fixes chicos.
2. **#4, #5, #8** — quick wins de una sesión.
3. **#1 + #2 + #3** (signup + tenant del primer usuario + aislamiento) — es UNA sola feature: "alta de empresa". Migración pequeña + pantalla de registro + filtro por tenant en queries de obras/equipo/alertas.

## Datos de prueba creados durante la auditoría

- Usuario `jefe@obrasur.com` (id 3, collaborator) — **borrar o desactivar antes de producción** (demuestra el hallazgo #3).
- Obra #008 "Casa Pérez — Ampliación" con 2 tareas y responsable Jorge Galarza (id 12).

---

## Resolución (2026-06-12, misma sesión — rama feature/alta-empresa-wizard-fixes)

**Correcciones al informe:** los hallazgos #4 (CTA del onboarding) y la parte principal del #6 (no navega tras crear) eran **falsos positivos** de la metodología de testeo: los asserts buscaban texto en minúsculas que el CSS muestra en `text-transform: uppercase`, y el slice de `innerText` cortaba antes del modal. El CTA del onboarding sí abre el wizard, y el wizard sí tiene pantalla de éxito con "Ir a la obra". Lo único real del #6: cerrar el éxito con la X dejaba el portfolio sin refrescar.

**Todo lo demás, implementado y verificado end-to-end en navegador:**

| # | Fix | Verificación |
|---|-----|--------------|
| 1+2+3 | **Alta de empresa**: "Creá la cuenta de tu empresa" en el login → rol `admin` con tenant propio en plan Básico → login automático. **Aislamiento por tenant** en obras (list + get 404), responsables (migration 0026), alertas, usuarios. Sidebar muestra la empresa real. | Usuario registrado desde la UI: ve SU empresa, 0 datos ajenos; obra ajena por id → 404 |
| 5 | `normalizePhone`: acepta "2494 555888", "0223 15 444 5566", etc. → +549; error sin jerga | "0223 15 444 5566" → `+5492234445566` aceptado |
| 6 | X tras crear obra = "Ir a la obra" | code review |
| 7a | Wizard vincula responsables al equipo de la obra | checklist "Responsables asignados" ✅ |
| 7b | `ObraSummary` incluye comitente | checklist "Datos del comitente" ✅ |
| 8 | Bitácora como item real del sidebar | visual |

**Bonus deploy:** `VITE_API_URL` configurable en client.ts y socket.ts.

Datos de prueba de la auditoría eliminados de la BD. La obra #008 "Casa Pérez — Ampliación" quedó como demo válida, con Jorge Galarza en el equipo.
