# Rediseño de identidad y permisos del canal de WhatsApp

> **Alcance:** todo lo relacionado a `Responsible` — la entidad que representa a un obrero / contratista que interactúa con CONSTRUCTA por WhatsApp sin login. Independiente del rediseño de roles web (fases 0-6): esta rama trabaja el lado `Responsible`, el otro trabajó el lado `User`. No hay dependencia cruzada.
>
> **Bugs de partida** ya diagnosticados en `docs/auditoria/04-responsables.md`, `05-planos.md` y `08-bitacora.md`. Este documento no los redescubre — los cierra.

**Fecha:** 2026-08-24
**Migración:** 0051.
**Suite backend post-cambio:** 223 passed / 0 failed (48s).

---

## Parte A — `ObraTeamMember` como fuente de verdad + respetar `is_active`

### A.1 — `Responsible` desactivado ya no es reconocido por el bot

**Antes:** `ResponsibleRepository.get_by_whatsapp(number)` devolvía la fila ignorando `is_active`. Consecuencia: un responsable dado de baja seguía siendo atendido normalmente por el webhook.

**Ahora:**

- `get_by_whatsapp()` filtra `is_active=True`. Un responsable inactivo devuelve `None`, indistinguible desde ahí de un número no registrado.
- Nuevo helper `get_by_whatsapp_any()` para casos que necesitan la fila aunque esté inactiva (chequeo de conflicto al crear/actualizar, y el webhook para dar mensaje diferenciado).
- `MessageService.process_inbound` hace un lookup extra con `get_by_whatsapp_any` **solo si** no encontró un responsable activo — para poder distinguir "desactivado" de "no registrado" con mensajes específicos:
  - **Desactivado:** *"Ya no tenés acceso al sistema CONSTRUCTA. Consultá con tu jefe de obra."*
  - **No registrado:** el mensaje anterior *"Este número no está registrado en el sistema CONSTRUCTA…"* (sin cambios).
- Se corrigió también `ResponsibleService.create()` y `update()` para usar `get_by_whatsapp_any` en el chequeo de conflicto — antes, si había un responsable inactivo con el mismo número, un `create` "nuevo" con ese número lo hubiera dejado pasar y creado un duplicado (rompiendo el `unique` de la columna con IntegrityError).

### A.2 — `ObraTeamMember` reemplaza al historial de tareas como fuente de verdad

**Antes:** `PlanoService.obra_ids_for_responsible()` derivaba las obras accesibles de `Task.responsible_id` — cualquier tarea histórica, sin filtro de estado ni fecha. Consecuencia: un responsable con tareas viejas en obras donde ya no participaba mantenía acceso indefinidamente.

**Ahora:**

- Nuevo `ObraTeamMemberRepository` con tres helpers reutilizables:
  - `list_obra_ids_for_responsible(responsible_id)` — obras donde el responsable tiene fila vigente.
  - `get_for_pair(obra_id, responsible_id)` — la fila `(obra, responsible)` completa (o `None`).
  - `list_member_types_for_responsible(responsible_id)` — usado para gating global (bitácora, ver §B).
- `PlanoService.obra_ids_for_responsible()` reescrito para delegar en el repo nuevo. Un thin-wrapper — mantiene la firma pública para compat con `MessageService._sender_obra_ids` que sigue llamándolo tal cual.
- Toda la lógica queda centralizada en el repo: cualquier futuro handler que necesite "en qué obras puede ver X responsable" sale del mismo lugar. No hay dos queries divergentes.

### A.3 — `allowed_disciplines_for_responsible` desambigua el `None`

**El bug del audit 05:** la función devolvía `None` para dos casos semánticamente opuestos:
1. No está en el equipo (`ObraTeamMember` no existe) → debería ser "sin acceso".
2. En el equipo con `plan_disciplines=NULL` → semántica documentada = "acceso total".

Los call sites del bot interpretaban `allowed is None` como "acceso total" → un responsable que llegaba a esa función sin estar en el team recibía acceso irrestricto a todos los planos.

**Ahora:**

- Nueva API explícita `PlanoService.resolve_plan_access(responsible_id, obra_id) -> tuple[bool, list[str] | None]` que devuelve `(is_member, disciplines)` sin ambigüedad.
- `allowed_disciplines_for_responsible()` **compat wrapper** con cambio semántico: cuando el responsable no está en el team, ahora devuelve `[]` (sin acceso), no `None`. Los call sites del `MessageService` no se tocaron — la corrección se propaga sola:

  ```python
  # Antes: allowed=None → interpretado como acceso total (BUG)
  # Ahora: allowed=[] → cae en la rama de "sin acceso" (CORRECTO)
  if allowed is not None and disc not in allowed:
      return "No tenés acceso..."
  ```

- Además el wrapper respeta `member_type` (ver §B).

**Confirmación explícita:** el bug de `allowed_disciplines_for_responsible` documentado en audit 05 **quedó cerrado como efecto colateral** del rediseño. La ambigüedad `None` estaba en el retorno de la función; ahora ese caso devuelve `[]`. Los call sites que interpretaban `None = acceso total` siguen interpretándolo correctamente, pero solo se llega a esa rama cuando el responsable EFECTIVAMENTE está en el equipo. El test `test_allowed_disciplinas_no_en_team_devuelve_vacio` en la suite nueva blinda este contrato.

### A.4 — `task_service` exige membership antes de asignar

**Antes:** `TaskService._ensure_team_member()` **creaba silenciosamente** un `ObraTeamMember` con `member_type='equipo'` y `plan_disciplines=NULL` (acceso total) cada vez que se asignaba una tarea a un responsable no-miembro. Es el hueco por el que el problema de fondo se colaba: un jefe de obra creaba tarea con "responsable X" desde el TaskFormModal y X terminaba con acceso completo a la obra sin ninguna decisión explícita.

**Ahora:** el método valida que la fila exista y lanza `UnprocessableError` con mensaje claro:

> *"El responsable no está en el equipo de esta obra — agregalo desde el tab Responsables antes de asignarle tareas."*

**Impacto UX en el frontend:** el flujo actual del `TaskFormModal` deja al user seleccionar cualquier `Responsible` del tenant en el dropdown de responsable. Con este cambio, si el user elige uno que no está en el equipo de la obra actual, el POST/PATCH de tarea va a fallar con 422. El frontend debería:
1. Filtrar el dropdown a solo los responsables del team de la obra (preferido — evita la fricción).
2. O manejar el 422 con un dialog "¿Agregarlo al equipo primero?" que llame al `POST /obras/{id}/team` antes.

Ninguno de esos ajustes se implementó en esta rama — el cambio del backend prioriza cerrar el agujero. El comportamiento actual (dropdown que muestra todo, backend que rechaza) funciona: solo agrega un pop-up de error si el usuario elige a alguien que no está en el team.

---

## Parte B — `member_type` gatea capacidades reales

Matriz implementada (recomendación del pedido, aplicada tal cual):

### Bitácora audio

- **`equipo`:** flujo completo — audio libre → IA transcribe + analiza + genera sugerencias.
- **`contratista` puro:** **bloqueado**. El bot responde: *"La bitácora por audio no está disponible para tu tipo de acceso. Consultá con tu jefe de obra si necesitás registrar novedades."*

**Regla exacta:** se bloquea si el responsable NO es `equipo` en ninguna de sus obras — un contratista que también es equipo en alguna otra obra queda habilitado (raro en la práctica; el criterio conservador es "si tiene UN `equipo`, se le permite"). Implementado con `ObraTeamMemberRepository.list_member_types_for_responsible(...)` — sale del mismo repo centralizado de la Parte A.

### Planos por disciplina

Semántica final de `plan_disciplines`:

| `member_type` | `plan_disciplines`    | Resultado |
|---|---|---|
| — (no en el team) | — | Sin acceso |
| `equipo`          | `NULL`                | Acceso total (default histórico) |
| `equipo`          | `[]`                  | Sin acceso (explícitamente bloqueado por el admin) |
| `equipo`          | `["electricidad"]`    | Solo esas |
| `contratista`     | `NULL`                | **Sin acceso** (semántica nueva — invertida respecto a `equipo`) |
| `contratista`     | `[]`                  | Sin acceso |
| `contratista`     | `["electricidad"]`    | Solo esas |

Lo nuevo respecto a la semántica anterior es la fila del contratista con `NULL`: antes se interpretaba como "acceso total"; ahora es "sin acceso hasta que se le asignen disciplinas explícitas". Es el default seguro para externos.

Implementado en `PlanoService.resolve_plan_access()`. El helper viejo `allowed_disciplines_for_responsible()` colapsa el resultado para no romper call sites — devuelve `list[str] | None`, donde `None` significa "acceso total efectivo" (que solo puede pasar si es miembro y equipo y sin restricción), y `[]` significa "sin acceso" (colapsa "no está en el team", "contratista sin disciplinas", "equipo con `[]` explícito").

Los call sites del bot funcionan sin modificar porque el patrón que ya usaban (`if allowed is not None and X not in allowed`) hace exactamente lo correcto con la nueva semántica.

---

## Parte C — Confirmación al agregar un responsable nuevo

### Decisión: alcance de la confirmación — **por persona**, no por obra

**Recomendación implementada:** una única confirmación por persona, la primera vez que se registra. Sumarlo a más obras después NO requiere volver a confirmar.

**Por qué:**

- **Fricción baja.** Un obrero típico está en 1-2 obras a la vez pero puede rotar. Pedirle confirmación cada vez es tedioso y erosiona la percepción de "el sistema funciona" — si el jefe lo agrega a otra obra el lunes, el bot debería responderle inmediatamente ese lunes, no esperar a que confirme algo por segunda vez algo que ya confirmó.
- **WhatsApp ya autentica.** Que el mensaje llegue del número correcto es prueba de identidad suficiente para agregar acceso a una obra más — el consentimiento inicial (respondió "SI" la primera vez) es el "sí, quiero usar CONSTRUCTA" a nivel plataforma, no a nivel obra.
- **El caso adverso (contratista pierde vinculación con la empresa)** ya está cubierto por otro camino: el admin lo desactiva (`is_active=False`), y a partir de ese momento el bot lo rechaza automáticamente (Parte A.1) sin importar si estaba confirmado.

**Opción alternativa descartada:** confirmación por obra (una vez cada vez que se lo suma a una obra nueva). Ventaja: cada vinculación explícita queda con consentimiento fresco. Contra: fricción alta en el uso real; los obreros de una empresa constructora rotan mucho entre obras. Si en el futuro un cliente enterprise pide "consentimiento por obra por compliance" — se puede implementar sumando una tabla `ObraTeamMemberConfirmation` sin tocar la existente, sin romper este flujo.

### Implementación

**Campo nuevo:** `Responsible.confirmed_at: DateTime(timezone=True) | None`. Migración `0051` con backfill defensivo (`UPDATE responsibles SET confirmed_at = created_at WHERE confirmed_at IS NULL`) para que los responsables ya existentes al momento del deploy no queden en limbo.

**Mensaje de bienvenida (`app/services/responsible_confirmation.py`):**

- Se dispara desde:
  - `POST /users/../responsibles` (creación directa) — `create_responsible` en `routes/responsibles.py`.
  - `POST /obras/{id}/team` — `add_team_member` en `routes/obra_team.py`. Contextualiza el mensaje con el nombre de la obra.
- **Idempotente:** si el responsable ya tiene `confirmed_at != None`, es no-op — no molesta con un mensaje redundante al sumarlo a la obra 5ta.
- **Fire-and-forget:** cualquier error del cliente Twilio se loguea y se descarta. Un fallo del proveedor de WhatsApp NUNCA debe hacer fallar el POST del endpoint.
- **Texto del mensaje contextualizado:**
  > *"Hola Juan 👷. Te agregaron al equipo de la obra **Edificio Norte** en CONSTRUCTA (asistente de gestión de obras por WhatsApp). Respondé **SI** para confirmar tu acceso y empezar a usar el sistema."*
- **Texto genérico** (sin obra, para creación directa):
  > *"Hola Juan 👷. Te registraron en CONSTRUCTA, el asistente de gestión de obras por WhatsApp. Respondé **SI** para confirmar tu acceso y empezar a usar el sistema."*

**Gate en el webhook (`MessageService.process_inbound`):**

- Si `responsible.confirmed_at is None`, el mensaje entrante NO se procesa por ninguno de los handlers normales (bitácora, planos, tareas). En su lugar, se responde con el flujo de confirmación:
  - Body normalizado (uppercase, sin punto/! final) matchea uno de `{"SI", "SÍ", "OK", "CONFIRMAR", "CONFIRMO", "S", "SIP", "DALE"}` → se setea `confirmed_at = NOW()` y se responde con la bienvenida:
    > *"¡Listo Juan! Tu acceso a CONSTRUCTA está confirmado. Ya podés reportar avances, pedir planos y mandarme notas de voz."*
  - Cualquier otro body → se repite el pedido:
    > *"Todavía no confirmaste tu acceso al sistema CONSTRUCTA. Respondé **SI** para activar tu cuenta."*
- El set de aceptación de "SI" es amplio a propósito (concesión de UX — un obrero con teclado touch puede tipear cualquiera de esas variantes). Si en el futuro se quiere ser más estricto, acotar el set en `_handle_pending_confirmation`.

**Sin mecanismo de expiración** (por diseño, ver enunciado): si un responsable nunca confirma, la fila queda pendiente indefinidamente. No hay job de limpieza. Es aceptable — el volumen esperado es chico y no genera bypass de nada (el bot lo bloquea).

---

## Tests

**Suite nueva:** `tests/test_whatsapp_identity_permissions.py` — **23 tests**, todos pasando. Cubre:

**Parte A:**
- `get_by_whatsapp` no devuelve inactivos; `get_by_whatsapp_any` sí.
- Número vacío → `None`.
- `obra_ids_for_responsible` sale del team, no de tareas (caso canary: Juan con tarea vieja en obra B pero sin `ObraTeamMember` → NO ve B).
- Repo helper devuelve lo mismo que `PlanoService`.
- Todos los casos de `allowed_disciplines_for_responsible` (no team, equipo NULL, contratista NULL, contratista lista, equipo `[]`).
- `resolve_plan_access` devuelve la tupla esperada en los 3 casos límite.
- `task_service.create` rechaza responsible fuera del team con mensaje claro.
- Task sin responsible pasa (nada que validar).

**Parte B:**
- Contratista puro bloqueado en bitácora audio (verifica el body del reply outbound).
- Equipo no bloqueado (el reply NO contiene el mensaje de bloqueo).

**Parte A.1 en webhook (mensajes diferenciados):**
- Número desactivado recibe mensaje específico *"Ya no tenés acceso"* (NO el de "no está registrado").
- Número desconocido sigue con el mensaje genérico.

**Parte C:**
- Pending confirmación + cualquier body ≠ "SI" → repite pedido, no procesa.
- Pending + "SI" → setea `confirmed_at`.
- Variantes ("ok.", "sí!") también aceptan.
- `send_welcome_confirmation` es no-op si `confirmed_at` ya está seteado.
- `send_welcome_confirmation` manda WhatsApp si `confirmed_at is None` — verifica `to_number` y contenido del body.

**Suite backend completa: 223 passed / 0 failed.** El resto (200 tests previos) sigue verde sin cambios — ningún test existente asumía el comportamiento roto.

---

## Casos borde encontrados en el camino (no estaban en el prompt)

1. **Chequeo de conflicto en `ResponsibleService.create/update`.** Antes usaba `get_by_whatsapp` — que ahora filtra por `is_active`. Consecuencia sutil: si un admin daba de baja a un responsable y después intentaba crear otro con el mismo número, el chequeo devolvía `None` (porque el filtro nuevo lo excluye), el service intentaba insertar, y la BD rechazaba con `IntegrityError` (el `unique=True` global de `whatsapp_number` no filtra por is_active). Cambiado a `get_by_whatsapp_any` para chequear contra activos + inactivos. Ahora devuelve el `ConflictError` limpio con mensaje esperable.

2. **`add_team_member` con `responsible_id` pre-existente vs `full_name + whatsapp_number`.** Cuando el endpoint recibe `full_name + whatsapp_number`, antes reusaba solo activos (`get_by_whatsapp`). Cambio: reusa cualquiera (`get_by_whatsapp_any`) — así se evita duplicar responsables cuando el número ya existía aunque estuviera desactivado. El admin puede reactivarlo aparte con `PATCH /responsibles/{id}/reactivate`, y ya se queda con la fila del team recién creada.

3. **Backfill de `confirmed_at`.** Sin el backfill del migration 0051, todos los responsables existentes al momento del deploy quedaban con `confirmed_at=NULL` y el bot les pediría reconfirmar (fricción operacional grande). El backfill los da por confirmados con `confirmed_at = created_at`, preservando su acceso.

4. **`task_service._ensure_team_member` era llamado también desde `update()` y `bulk_create()`.** El cambio de comportamiento se propaga a los 3 call sites — cambiar el responsible de una tarea vía PATCH ahora también exige que el nuevo esté en el team. Bulk import de tareas también. Consistente por diseño, pero es un cambio de superficie más ancho que el `create()` puntual: si el frontend permite reasignar en una vista de listado, hay que manejar el 422.

5. **`_handle_bitacora_audio` con staff (User).** El staff (User con `whatsapp_number`) nunca tiene `ObraTeamMember` — es del sistema de roles web, otra rama. El chequeo de `member_type` solo aplica cuando `is_staff=False`. Los tests cubren ambos caminos.

---

## Decisiones técnicas que quedaron documentadas en el código (no de producto)

- **Set de aceptación de "SI"** — amplio a propósito por UX (`{"SI", "SÍ", "OK", "CONFIRMAR", "CONFIRMO", "S", "SIP", "DALE"}`). Documentado en `_handle_pending_confirmation` con nota "si se quiere ser más estricto, acotar el set". No es decisión de producto — es UX defensivo mientras nadie diga lo contrario.
- **Regla del contratista puro** — se bloquea la bitácora si el responsable NO es `equipo` en NINGUNA obra. Alternativa considerada: exigir que sea `equipo` en al menos la obra actual (más estricta pero requiere obra_id que en bitácora es ambigua hasta que responde). Elegí la versión más permisiva porque el flujo actual de bitácora no conoce la obra al inicio.

---

## Archivos entregados

**Backend — producción (7 archivos):**

- `backend/app/models/responsible.py` — campo `confirmed_at`.
- `backend/app/repositories/responsible.py` — `get_by_whatsapp` filtra activos + nuevo `get_by_whatsapp_any`.
- `backend/app/repositories/obra_team_member.py` — **nuevo** repo con 3 helpers (`list_obra_ids_for_responsible`, `get_for_pair`, `list_member_types_for_responsible`).
- `backend/app/services/plano_service.py` — `obra_ids_for_responsible` delega al nuevo repo. `resolve_plan_access` nuevo (API sin ambigüedad). `allowed_disciplines_for_responsible` respetando `member_type`.
- `backend/app/services/task_service.py` — `_ensure_team_member` exige membership.
- `backend/app/services/message_service.py` — mensaje diferenciado para desactivados, gate de confirmación, bloqueo bitácora audio para contratistas, helper `_handle_pending_confirmation`.
- `backend/app/services/responsible_service.py` — chequeo de conflicto con `get_by_whatsapp_any`.
- `backend/app/services/responsible_confirmation.py` — **nuevo** módulo con `send_welcome_confirmation` (idempotente, fire-and-forget).
- `backend/app/api/routes/obra_team.py` — dispara el WhatsApp de bienvenida al `POST /obras/{id}/team`.
- `backend/app/api/routes/responsibles.py` — dispara el WhatsApp al `POST /responsibles`.

**Migración:**

- `backend/alembic/versions/0051_responsible_confirmed_at.py`.

**Tests (1 archivo nuevo):**

- `backend/tests/test_whatsapp_identity_permissions.py` — 23 tests cubriendo Partes A, B y C.

**Sin tocar:**

- Frontend — la validación nueva de `task_service` puede requerir un ajuste en `TaskFormModal` (ver §A.4). Queda como trabajo separado si el UX del pop-up de 422 no alcanza.
- `ConversationService` — el menú rígido de estados sigue disponible para contratistas confirmados; su restricción es "solo reporta estado de sus tareas asignadas", que ya se cumple por diseño (`task_repo.list_by_responsible` filtra al que llama, no expone más).

---

## Verificación end-to-end resumida

- ✅ Backfill 0051 aplicado en dev local.
- ✅ Bug de `allowed_disciplines_for_responsible` (audit 05) — **cerrado**. Test regressional en la suite.
- ✅ Responsable desactivado ya no recibe respuesta del bot como si fuera activo — recibe mensaje diferenciado.
- ✅ Responsable con tarea vieja pero sin `ObraTeamMember` ya no ve esa obra en `obra_ids_for_responsible`.
- ✅ Crear tarea con responsible fuera del team → 422 con mensaje claro.
- ✅ Contratista puro no puede mandar audio a bitácora.
- ✅ Contratista con `plan_disciplines=NULL` no accede a ningún plano; con lista, solo a las que le asignaron.
- ✅ Responsable pendiente confirmación bloqueado en todo excepto en el flujo de "SI".
- ✅ Confirmación por persona: sumarlo a otra obra no repite el pedido.
- ✅ Suite backend: **223 passed / 0 failed**.
