# Auditoría 05 — Planos (PDFs técnicos por obra)

> **Fecha:** 2026-08-18
> **Auditor:** Claude Sonnet 4.6 (con supervisión de Facundo)
> **Alcance:** módulo de planos técnicos (PDFs de electricidad, gas, sanitarios, estructura, arquitectura, etc.) por obra: modelo, upload, versionado con `is_latest`, disciplinas canónicas + sinónimos, storage en disco, URLs firmadas HMAC (`8b77b67 fix(security): servir planos y audios de bitácora con URLs firmadas`), download desde web y bot WhatsApp, permisos, aislamiento tenant. **No cubre** el filtro `plan_disciplines` en `ObraTeamMember` — eso ya está en la auditoría 04.
> **Metodología:** lectura de código + ejecución local (backend `:8000`, frontend `:5173`) + suite `pytest` (72/72 verdes al arrancar) + `curl` para probar upload/download con MIME variados, cross-tenant, race conditions, signed URLs. Se usaron tokens de 3 usuarios (facundo admin tenant 2, admin@demo admin tenant 8, Invitado Test collaborator tenant 2). Los PDFs de prueba se subieron a la obra 17 del tenant 2 y se limpiaron al final.

---

## 1. Resumen ejecutivo

El módulo **funciona en el flujo happy path web** (upload desde `PlanosTab.tsx`, listado con URLs firmadas, versionado atómico dentro de una sola request) y el aislamiento tenant en `GET /obras/{id}/planos` está OK (cross-tenant → 404). La firma HMAC-SHA256 con TTL 1h y validación en tiempo constante está bien implementada. Suite pytest 72/72 verdes.

Pero **no está production-ready**. Se reprodujeron 5 bugs concretos, y el más grave rompe silenciosamente el uso principal del módulo por WhatsApp:

1. **[CRÍTICO — feature core rota]** `MessageService._format_plano_reply()` (`message_service.py:425`) genera la URL del media que le pasa a Twilio **sin firma** (`f"{base_url}/uploads/{plano.file_path}"`), pero el endpoint `/uploads/{filename}` **exige firma para PDFs**. Reproducido: la URL sin firma responde 403 con `"Enlace inválido o expirado."`. Osea, cuando un responsable pide `PLANO ELECTRICIDAD` por WhatsApp, el bot **manda solo el caption** (`"📐 Plano de electricidad (v2, ...)"`) **sin el archivo adjunto**. La feature entera del pedido de planos por bot no entrega nada.

2. **[CRÍTICO — bypass de rol admin]** `POST /obras/{obra_id}/planos` y `DELETE /planos/{plano_id}` solo tienen `CurrentUser` como guard. Reproducido: con token del `Invitado Test` (collaborator tenant 2), **subí un PDF (201)** y **borré la versión latest de un plano existente (204)**. El frontend oculta los botones a collaborators via `usePermission`, pero el backend acepta. Mismo patrón que el bug 7.1 del audit 03 (tareas).

3. **[ALTO — sin validación de MIME]** El endpoint acepta cualquier `content_type` que venga del cliente y lo persiste tal cual. Reproducido: subí un `.pdf` cuyo contenido era `<html><script>alert('xss')</script>...` con `content_type=text/html`; el sistema respondió 201 y guardó `content_type: "text/html"` en la DB. No hay sniffing del contenido ni whitelist de MIMEs; el `accept` del `<input>` en frontend es la única barrera (evadible). Si un usuario descarga esa "PDF" (via URL firmada), el browser renderiza el HTML/JS → **XSS potencial**.

4. **[ALTO — URL firmada sin scope de tenant ni de usuario]** La firma es `HMAC-SHA256(SECRET_KEY, f"{name}:{exp}")` — no incluye tenant, no incluye usuario. Reproducido: con la URL firmada de un plano del tenant 2, hice GET con **token del tenant 8** → 200 con el PDF completo. Y **sin ningún token** → también 200 con el PDF. La URL firmada es un "bearer" completo: cualquiera con acceso a esa string puede descargar durante 1h. Si un link se filtra en un log, un email reenviado, un mensaje de WhatsApp compartido, o alguien se lo copia del `Network` del DevTools de otra sesión abierta, hay fuga.

5. **[MEDIO — race condition en versionado]** `PlanoService.create()` calcula `next_version = max(existing) + 1` y marca los anteriores como `is_latest=False` dentro de la misma tx (líneas 80-102 de `plano_service.py`). Sin lock ni unique constraint sobre `(obra_id, discipline, name, is_latest=True)`. Reproducido: dos uploads simultáneos con el mismo `(obra_id, discipline, name)` crearon **dos filas ambas con `version=1` y `is_latest=True`**. `find_latest_for_disciplines` usa `is_latest=True + order by created_at DESC LIMIT 1` así que sirve el último, pero el otro queda como "fantasma latest" que aparece en listados.

Además: (a) el `DELETE` de un plano **hace hard-delete en DB pero no borra el archivo del disco** — reproducido, quedaron 4 PDFs huérfanos en `uploads/` durante la auditoría, además del `a199a1fa6ae844ad881bfede3660d0e9.pdf` que ya estaba huérfano antes; (b) el `CASCADE` del FK `obra_id` borra los planos de la DB al borrar una obra, pero también deja los archivos huérfanos; (c) **no hay ningún evento de historial** al subir o borrar planos (ni en `historial_service` ni en `bitacora`); (d) el `Message.media_url` **no se persiste** en las filas OUTBOUND del bot, así que perdés traceability de qué archivo se intentó mandar.

---

## 2. Inventario de funcionalidad

| Función | Implementado | Probado y funciona | Archivo(s) |
|---|---|---|---|
| **Modelo `Plano`** con `tenant_id`, `obra_id`, `discipline`, `version`, `is_latest`, `file_path`, `original_filename`, `content_type`, `file_size`, `notes`, `uploaded_by`, `created_at` | Sí | Sí | `app/models/plano.py` |
| Schema `PlanoRead` con `file_url` (firmada al leer) | Sí | Sí | `app/schemas/plano.py` |
| `PlanoCreate`/`Update` como schema Pydantic | **No** | Se usan Form fields directos en el endpoint | (falta) |
| Migración `0028_add_planos.py` | Sí | Sí | `alembic/versions/0028_add_planos.py` |
| **POST `/obras/{obra_id}/planos`** (upload multipart) | Sí | Sí — **pero sin guard admin (7.2)** y **sin MIME validation (7.3)** | `app/api/routes/planos.py:21-47` |
| Validación tamaño máx 25 MB | Sí | Sí (400 con mensaje claro) | `app/services/plano_service.py:17`, `app/api/routes/planos.py:32` |
| Validación archivo no vacío | Sí | Sí | `app/api/routes/planos.py` |
| **GET `/obras/{obra_id}/planos`** (list) | Sí | Sí — con URLs firmadas + aislamiento tenant 404 cross-tenant | `app/api/routes/planos.py:50-54` |
| **DELETE `/planos/{plano_id}`** | Sí | Sí — **pero sin guard admin (7.2)** y **deja archivo huérfano en disco (7.6)** | `app/api/routes/planos.py:57-59`, `app/services/plano_service.py:121-137` |
| Versionado atómico con `is_latest` en misma tx | Sí | Sí en el happy path (upload secuencial) — **race condition confirmada en concurrentes (7.5)** | `app/services/plano_service.py:80-102` |
| Al borrar el latest, herencia al anterior | Sí | Sí — probado con id=3 borrado → id=2 pasó a `is_latest=True` | `app/services/plano_service.py:132-137` |
| **URL firmada HMAC-SHA256 + TTL 1h** | Sí | Sí (validación en tiempo constante) | `app/core/signing.py:38-41,59-69` |
| Path traversal en `/uploads/{filename}` | Protegido | Sí — `Path(filename).name` normaliza (`../.env` → 404) | `app/main.py:102` |
| Imágenes públicas sin firma | Sí | Sí | `app/core/signing.py:19,33-35` |
| PDFs/DWG/OGG requieren firma → 403 sin firma | Sí | Sí | `app/main.py:98-111` |
| **URL sin auth con firma válida** — anyone con URL descarga | Sí (por diseño) | **Confirmado 7.4** — cualquier token (o ninguno) descarga | `app/main.py:106` |
| Disciplinas canónicas + sinónimos | Sí | Sí (10 disciplinas + variantes) | `app/services/plano_service.py:20-45` |
| `match_discipline_in_text` para chatbot | Sí | Sí (probado en audit 04) | `app/services/plano_service.py:48-54` |
| `find_latest_for_disciplines` | Sí | Sí | `app/services/plano_service.py:141-146` |
| `_format_plano_reply` para bot | Sí | **BUG CRÍTICO: URL sin firma → 403 → archivo no adjunta (7.1)** | `app/services/message_service.py:423-431` |
| `_handle_plano_obra_selection` (desambiguación multi-obra) | Sí | No forzado esta ronda (cubierto en audit 04) | `app/services/message_service.py:381-421` |
| Frontend `PlanosTab` — upload, list, download, delete | Sí | Sí (visualmente OK, cliente API `frontend/src/api/planos.ts`) | `frontend/src/components/PlanosTab.tsx:212-403` |
| Frontend agrupa por disciplina + expande versiones viejas | Sí | Sí | `frontend/src/components/PlanosTab.tsx:340-396` |
| Guards `usePermission` en frontend | **Parcial** | El botón no aparece a collab, pero el endpoint permite | `frontend/src/components/PlanosTab.tsx` |
| Historial al subir/borrar plano | **No** | **No se registra ningún evento** | (falta) |
| Persistencia de `Message.media_url` en OUTBOUND del bot | **No** | **`media_url=NONE`** en las filas de reply del bot | `app/services/message_service.py:223-235` |
| **Tests** de `signing` (8 tests) | Sí | Sí | `backend/tests/test_upload_signing.py` |
| **Tests** de endpoints de planos, versionado, guards, MIME | **No** | **Cero cobertura** | (gap) |

---

## 3. Cómo funciona hoy (breve)

### Upload

1. Frontend hace `POST /obras/{obra_id}/planos` con multipart: `file` + `discipline` + `name` + `notes` (Form fields).
2. Backend valida tamaño ≤ 25 MB y que no esté vacío.
3. `PlanoService.create()`:
   - Busca todas las filas del grupo `(obra_id, discipline, name)` — puede ser 0 (primera versión) o N (nueva versión).
   - Calcula `next_version = max(versiones) + 1`.
   - Marca los anteriores como `is_latest=False`.
   - Genera nombre en disco: `f"{uuid.uuid4().hex}.{ext}"` (con `ext` derivado del `original_filename`).
   - Escribe bytes a `backend/uploads/{uuid_hex}.{ext}`.
   - Inserta nueva fila con `is_latest=True` y `version=next_version`.
   - `session.flush()` para obtener el `id` (el commit es a nivel de request en `get_db()`).
4. Retorna `PlanoRead` con `file_url` = URL firmada absoluta (`PUBLIC_BASE_URL + /uploads/{name}?exp=…&sig=…`).

### Download (web)

1. Frontend recibe el `file_url` (ya firmado) en el listado.
2. Al hacer click, abre en ventana nueva.
3. El endpoint `/uploads/{filename}` (en `main.py:98-111`) valida:
   - `Path(filename).name` (protege path traversal).
   - Si es imagen (`.jpg/.png/…`): sirve sin firma.
   - Si no: `verify_download(safe, exp, sig)` → 403 si falla, 200 con `FileResponse` si pasa.

### Download (bot WhatsApp)

1. Responsable manda `PLANO ELECTRICIDAD`.
2. `MessageService._handle_plano_request()` → filtra por `plan_disciplines`, busca el latest.
3. `_format_plano_reply(plano, settings)`:
   - Caption: `f"📐 Plano de {discipline} — {name} (v{version}, {fecha})."`
   - **URL (sin firma):** `f"{PUBLIC_BASE_URL}/uploads/{plano.file_path}"`.
4. `send_whatsapp_message(from_number, reply, media_url=url)`:
   - Twilio hace GET a `media_url`.
   - Como el endpoint exige firma para PDFs → **403** → Twilio no puede bajar el archivo → el mensaje sale solo con caption, sin adjunto.

### Aislamiento tenant

- `GET /obras/{id}/planos` valida obra en `ObraService.get_or_raise(obra_id, tenant_id)` → 404 cross-tenant. ✓
- `POST /obras/{id}/planos` valida obra igual y asigna `tenant_id=current_user.tenant_id` al plano. ✓
- `DELETE /planos/{id}` valida en `get_or_raise(plano_id, tenant_id)` → 404 cross-tenant. ✓
- **La URL firmada NO tiene scope de tenant** (ver 7.4).

---

## 4. Qué tiene sentido como está

- **HMAC-SHA256 + TTL para servir archivos sensibles.** Es el approach correcto para archivos que se abren desde `<a href>` (sin poder mandar el `Authorization` header). La firma se verifica en tiempo constante con `hmac.compare_digest` (bien) y `exp` corta si vence. Los tests de signing (8) cubren tampering, expiración, roundtrip. La única cosa mal pensada es el scope de la firma (ver 7.4).

- **Excepción de firma para imágenes** (`PUBLIC_IMAGE_EXTS = {.jpg, .jpeg, .png, .webp, .gif}`). Portadas y avatares se cachean por el browser sin problemas y no son sensibles. Buen trade-off pragmático.

- **Path traversal protegido** con `Path(filename).name`. `../.env`, `%2E%2E%2Fetc%2Fpasswd`, etc. — todos limpian. Verificado con `curl`.

- **Naming en disco con UUID** (`uuid.uuid4().hex + ext`). Evita colisiones entre uploads del mismo o distinto tenant, no expone el nombre original, no permite adivinar rutas por enumeración.

- **`ondelete=CASCADE` en `Plano.obra_id`.** Correcto — si se borra la obra, no querés dejar planos zombie en la DB. (El problema es que los archivos quedan, ver 7.7.)

- **`ondelete=SET NULL` en `Plano.uploaded_by`.** Correcto — el plano no debería desaparecer solo porque el usuario que lo subió se dio de baja. Preserva la historia.

- **Versionado dentro de la misma tx** (`_calcular next_version + marcar viejos como is_latest=False + insertar nuevo`). Bien pensado en un mundo secuencial. El problema es que no está bien pensado para uploads concurrentes (ver 7.5).

- **Aislamiento tenant en los tres endpoints (`GET`, `POST`, `DELETE`)** vía `ObraService.get_or_raise(obra_id, tenant_id)` y `PlanoService.get_or_raise(plano_id, tenant_id)`. Devuelve 404 cross-tenant. Consistente con el resto del proyecto.

- **Frontend agrupa por disciplina y separa vigentes/viejas.** Buen UX — el usuario ve rápido "electricidad v3 (vigente)" con las v1 y v2 colapsadas debajo. `PlanosTab.tsx:340-396`.

- **Disciplinas canónicas con sinónimos** (`DISCIPLINE_SYNONYMS`). Cubre "electrico"/"electricidad", "sanit"/"sanitarios", etc. Permite que el responsable mande cualquier variante y el bot la matchee. Bien.

- **`_format_plano_reply` degrada con gracia si `PUBLIC_BASE_URL` no está.** Devuelve caption + "No puedo adjuntar el archivo todavía (falta configurar la URL pública)." — mejor que crashear. (Aunque la URL que sí genera está mal formada — ver 7.1.)

---

## 5. Qué no tiene sentido, está a medias o no funciona

### 5.1 [CRÍTICO] URL del bot sin firma → 403 → el bot no adjunta archivos

**Qué pasa:** `MessageService._format_plano_reply()` en `message_service.py:425`:

```python
url = f"{base_url}/uploads/{plano.file_path}" if base_url else None
```

Concatena `PUBLIC_BASE_URL + /uploads/ + nombre_archivo`. **No llama a `signed_upload_url()` ni agrega `exp` ni `sig`.** El endpoint `/uploads/{filename}` en `main.py:98-111` exige firma para todo lo que no sea imagen (los PDFs son la mayoría del uso), así que la URL que le pasa a Twilio es rechazada con 403.

**Reproducido:**

```bash
# URL cruda que genera _format_plano_reply para un plano PDF:
curl -sw "%{http_code}\n" "http://localhost:8000/uploads/7720de70966a456d9cbc872915ce2bd0.pdf"
→ 403 {"detail":"Enlace inválido o expirado."}

# Y en las filas outbound del bot (audit 04 + audit 05), Message.media_url = NONE
# porque nada se persiste; pero incluso si se persistiera, Twilio no podría bajar el archivo.
```

**Consecuencia:** cuando un responsable manda `PLANO ELECTRICIDAD` al bot, recibe:

> 📐 Plano de electricidad (v2, 21/06/2026).

Sin adjunto. La funcionalidad entera de "planos por WhatsApp" está rota en producción. En dev nadie lo detectó porque el caption sí llega. Este es probablemente **el bug más caro del audit 05** porque anula el caso de uso principal del módulo por el canal principal.

**Fix:** en `_format_plano_reply`, reemplazar la concatenación por `signed_upload_url(plano.file_path, ttl=<algo largo>)`. Nota: Twilio guarda el media en su lado durante 30 días para reenviarlo — si la firma expira antes de que el responsable la abra, se rompe. Sugerido TTL de 48-72h para media del bot (más largo que el default 1h de la web).

### 5.2 [CRÍTICO] Guards admin ausentes en upload y delete

**Qué pasa:** `POST /obras/{obra_id}/planos` (línea 21-47 de `planos.py`) y `DELETE /planos/{plano_id}` (línea 57-59) usan `CurrentUser`, no `AdminUser`. El frontend (`PlanosTab.tsx`) oculta los botones a collaborators con `usePermission`, pero el backend no lo enforce.

**Reproducido con token de `Invitado Test` (collaborator, tenant 2):**

```bash
# Upload como collab
curl -X POST "http://localhost:8000/api/v1/obras/17/planos" \
     -H "Authorization: Bearer $COLLAB_TOK" \
     -F "file=@/tmp/audit.pdf" -F "discipline=gas" -F "name=AUDIT-collab-test"
→ 201 {"id":24, "discipline":"gas", ..., "is_latest":true, "file_url":"..."}

# Delete latest como collab
curl -X DELETE "http://localhost:8000/api/v1/planos/3" -H "Authorization: Bearer $COLLAB_TOK"
→ 204
# En DB, el plano id=3 (v3, latest) desapareció; el id=2 (v2) pasó a is_latest=True
```

**Consecuencia:** cualquier colaborador con acceso a la app puede subir planos falsos (posibles vectores XSS via 5.3) o borrar planos aprobados sin dejar rastro (no hay historial, ver 5.9). Mismo patrón que el bug 5.1/7.1 del audit 03.

**Fix:** cambiar `CurrentUser` → `AdminUser` en los dos endpoints, o al menos exigir un rol específico (`arquitecto`/`jefe`) si en el futuro los roles se granularizan.

### 5.3 [ALTO] Sin validación de MIME → XSS potencial

**Qué pasa:** el endpoint acepta cualquier `content_type` que envía el cliente y lo persiste tal cual en `Plano.content_type`. No hay sniffing del contenido (`python-magic` o similar), ni whitelist de MIMEs. El `accept` del `<input>` en el frontend (`accept=".pdf, .png, .jpg, .jpeg, .webp, .dwg, .dxf, image/*"`) es evadible con curl/DevTools.

**Reproducido:**

```bash
# Subir un HTML como .pdf con content_type=text/html
cat > /tmp/audit_evil.pdf <<'EOF'
<html><script>alert('xss')</script><h1>Not a PDF</h1></html>
EOF

curl -X POST "http://localhost:8000/api/v1/obras/17/planos" \
     -H "Authorization: Bearer $TOKEN_T2" \
     -F "file=@/tmp/audit_evil.pdf;type=text/html" \
     -F "discipline=arquitectura" -F "name=AUDIT-html-as-pdf"
→ 201 {"id":25, "content_type":"text/html", "original_filename":"audit_evil.pdf", ...}
```

**Consecuencia:** cuando el archivo se descarga (por URL firmada web o por bot vía Twilio si se corrige 5.1), el browser mira el `Content-Type` que el server manda con el `FileResponse` (que respeta lo que hay en disco/DB). Si el server manda `text/html`, el browser renderiza el HTML/JS **en el origen de la app**. XSS potencial con acceso a cookies, tokens, etc.

**Fix:** (a) validar el MIME real con `python-magic` (sniffing del contenido, no del header enviado), (b) whitelist de tipos permitidos (`application/pdf`, `image/*`, `application/dwg`, etc.), (c) al servir, forzar `Content-Disposition: attachment` para todo lo que no sea imagen (fuerza download en vez de render).

### 5.4 [ALTO] URL firmada sin scope de tenant ni de usuario

**Qué pasa:** la firma es `HMAC-SHA256(SECRET_KEY, f"{name}:{exp}")`. Solo firma el nombre del archivo + expiración. **No incluye el tenant del usuario que pidió la URL, ni el user_id, ni una nonce/JTI**. Y el endpoint `/uploads/{filename}` **no requiere token** — pasa por HTTPBearer si tiene, pero no lo exige.

Consecuencia: la URL firmada es un "bearer token completo" para ese archivo durante 1h. Cualquiera que la vea puede descargar.

**Reproducido:**

```bash
# facundo (tenant 2) obtiene la URL firmada del plano id=2
GET /api/v1/obras/17/planos con TOKEN_T2
→ file_url = "https://.../uploads/7720de70966a456d9cbc872915ce2bd0.pdf?exp=…&sig=…"

# Uso esa misma URL con TOKEN_T8 (tenant ajeno)
curl -o /dev/null -w "%{http_code}" "$URL" -H "Authorization: Bearer $TOKEN_T8"
→ 200 (descarga el PDF completo)

# Y sin token alguno
curl -o /dev/null -w "%{http_code}" "$URL"
→ 200 (idem, anónimo)
```

**Vectores de fuga:** logs (URLs completas suelen loguearse en accesos), mails, WhatsApp reenviado, `Network` del DevTools de otra sesión abierta, captura de pantalla, historial del browser, cache del proxy corporativo.

**Fix:** (a) incluir `tenant_id` (y opcionalmente `user_id`) en el mensaje HMAC — `f"{tenant_id}:{name}:{exp}"` — y validarlo contra el token/tenant del solicitante en el endpoint; (b) TTL más corto (5-15 min para web); (c) para bot, mantener 48-72h pero con scope de tenant. Trade-off: TTL más corto rompe la UX cuando el usuario deja abierto y vuelve mañana.

### 5.5 [MEDIO] Race condition en versionado

**Qué pasa:** `PlanoService.create()` (líneas 80-102) hace `SELECT WHERE (obra_id, discipline, name)`, calcula `next_version`, marca `is_latest=False` los viejos, e inserta el nuevo. Todo dentro de la misma request. Sin lock (SELECT FOR UPDATE), sin unique constraint sobre `(obra_id, discipline, name, is_latest=True)`.

Si dos requests llegan en paralelo, ambas ven "0 filas existentes", ambas calculan `next_version = 1`, ambas insertan con `is_latest=True`. Race window pequeña pero real.

**Reproducido:**

```bash
# Dos POST en paralelo con mismo (obra_id, discipline, name)
( curl -X POST .../obras/17/planos -F file=@a.pdf -F discipline=incendio -F name=AUDIT-conc &
  curl -X POST .../obras/17/planos -F file=@b.pdf -F discipline=incendio -F name=AUDIT-conc & wait )
→ Ambos 201

# En DB:
SELECT id, version, is_latest FROM planos WHERE name='AUDIT-conc' AND obra_id=17;
→ id=26 v=1 latest=True
→ id=27 v=1 latest=True   ← DOS latest simultáneos, misma versión
```

**Consecuencia:** `find_latest_for_disciplines` hace `WHERE is_latest=True ORDER BY created_at DESC LIMIT 1` así que sirve un solo plano (el último por timestamp). El otro queda como "fantasma latest" que aparece en el listado del frontend (que muestra todos los `is_latest=True`) y confunde. Nadie sabe qué se subió realmente.

**Fix:** o (a) `UniqueConstraint((obra_id, discipline, name), where='is_latest = TRUE')` en Postgres, o (b) `SELECT FOR UPDATE` dentro de la tx, o (c) advisory lock por `(obra_id, discipline, name)`. La (a) es la más limpia si Postgres tiene índices parciales activados.

### 5.6 [MEDIO] DELETE deja archivos huérfanos en disco

**Qué pasa:** `PlanoService.delete()` (líneas 121-137) hace hard-delete en DB y actualiza herencia de `is_latest`, pero **no llama a `os.remove(file_path)`**. Reproducido: borré el plano id=3 (que apuntaba a `3bd0f9d011d9483ebae330358f643f16.pdf`, 1.4 MB); la fila desapareció, el archivo sigue en `backend/uploads/`.

Además ya había un archivo huérfano preexistente (`a199a1fa6ae844ad881bfede3660d0e9.pdf`, 2.8 MB, sin fila en `planos`) — indicativo de que este bug ya generó basura en el pasado.

**Consecuencia:** el disco crece indefinidamente. Un tenant que sube 100 versiones nuevas de sus planos y va borrando las viejas deja 100 archivos huérfanos. En unos meses, GB de basura no accesible por la app. Además hay riesgo de PII residual si alguien tiene acceso al filesystem.

**Fix:** o (a) en `PlanoService.delete()`, `os.remove(file_path)` con try/except (el archivo puede no existir si ya se limpió), o (b) hacer soft-delete y un job nocturno que limpie los archivos de las filas con `is_deleted=True + deleted_at > 30d`. La (b) preserva historial y da margen para recovery.

### 5.7 [MEDIO] CASCADE de obra deja archivos huérfanos

**Qué pasa:** `Plano.obra_id` tiene `ondelete="CASCADE"`. Al borrar una obra (via `DELETE /obras/{id}` del audit 03), Postgres borra automáticamente todas las filas de `planos`. Pero **los archivos en disco no se tocan**. Igual patrón que 5.6.

No pude reproducir esto porque borrar una obra elimina todo su ecosistema (tareas, alertas, historial, presupuesto…) y hubiera contaminado la data del tenant. Lo dejo confirmado por lectura de código.

**Fix:** cambiar el CASCADE por un método explícito en `ObraService.delete()` que itere los planos y limpie los archivos antes del delete de la obra. O mover la lógica al mismo job nocturno de limpieza de huérfanos.

### 5.8 [BAJO] `Message.media_url` no se persiste en OUTBOUND del bot

**Qué pasa:** cuando el bot manda un plano (o cualquier media), `MessageService.process_inbound()` pasa `media_url=url` a `send_whatsapp_message`, pero al armar la fila OUTBOUND con `_save_message` (líneas 223-235), **no incluye `media_url`**. En la DB queda `NULL`.

Reproducido: la fila OUTBOUND del `PLANO ELECTRICIDAD` del audit tiene `body='📐 Plano de electricidad (v2, 21/06/2026).'` pero `media_url=NULL`.

**Consecuencia:** perdés auditoría de qué archivo se intentó mandar. Si mañana un cliente se queja "no me llegó el plano", no podés saber si el bot le mandó una URL rota, si Twilio falló al bajarla, o si el usuario no la abrió. Menor pero relevante para debugging del bug 5.1 en producción.

**Fix:** trivial — en `_save_message` del OUTBOUND, pasar el `media_url` variable local.

### 5.9 [MEDIO] No hay eventos de historial al subir/borrar planos

**Qué pasa:** `PlanoService.create()` y `delete()` no llaman a `historial_service.append_event()` ni a nada equivalente. El grep de "historial|Bitacora|plano_uploaded" en `plano_service.py` y `planos.py` no devuelve nada.

**Consecuencia:** si un collaborator borra un plano (bug 5.2), no queda registro de quién, cuándo, qué. El admin del tenant no puede rastrear cambios en los planos como sí puede con tareas y alertas. Y en compliance (algunas empresas exigen trazabilidad de documentos técnicos), es un vacío.

**Fix:** agregar eventos `plano_uploaded` y `plano_deleted` en `historial_eventos` con `actor_id`, `actor_name`, `obra_id`, `discipline`, `version`, `file_size`. Bajo esfuerzo.

### 5.10 [BAJO] `canonical_discipline` cae silenciosamente a `"general"` para strings desconocidos

**Qué pasa:** `plano_service.py:40-45`:

```python
def canonical_discipline(value: str) -> str:
    normalized = _norm(value)
    for canonical, synonyms in DISCIPLINE_SYNONYMS.items():
        if normalized in synonyms:
            return canonical
    return "general"
```

Si alguien manda `discipline=obscure_stuff` en el POST, se guarda como `"general"` sin error. En el frontend, no aparece en ninguna de las 10 disciplinas canónicas → queda en "otros" o directamente invisible. Y el bot no lo puede matchear (`match_discipline_in_text` solo busca las canónicas).

**Consecuencia:** menor. Permite basura en la DB (`SELECT discipline, COUNT(*) FROM planos WHERE discipline='general' GROUP BY 1` puede tener planos accidentales). No es explotable pero es sucio.

**Fix:** o (a) enum estricto con `Literal[...]` en el schema del POST (rechaza el valor con 422), o (b) mantener el fallback pero loguear un warning.

### 5.11 [BAJO] `PlanoCreate`/`PlanoUpdate` como Form fields sin schema Pydantic

**Qué pasa:** el POST recibe `file: UploadFile = File(...), obra_id: int = Path(...), discipline: str = Form(...), name: str | None = Form(None), notes: str | None = Form(None)`. No hay validaciones de longitud (`name` puede ser un string de 10.000 chars), no hay validación de contenido malicioso (SQL injection no aplica pero XSS via `name` sí — el frontend lo pinta), no hay validación estricta del `discipline`.

**Consecuencia:** menor. El frontend hoy no permite inputs largos, pero un curl sí. `name` largo → columna `String(255)` corta silenciosamente (mala UX). `name` con HTML → renderiza en el frontend si no se escapa.

**Fix:** crear un `PlanoUploadPayload` Pydantic con `name: constr(max_length=255)`, `notes: constr(max_length=500)`, `discipline: Literal[...] | None`. Mucho más limpio.

### 5.12 [BAJO] Cobertura de tests muy limitada

**Qué pasa:** los 72 tests actuales incluyen 8 tests de signing (`test_upload_signing.py`) que están muy bien. **Pero cero tests directos de**:

- POST /obras/{id}/planos (upload happy path, size limit, MIME validation, guards)
- DELETE /planos/{id} (guards, herencia de is_latest, archivo huérfano)
- GET /obras/{id}/planos (aislamiento tenant)
- Versionado (secuencial + race condition)
- `_format_plano_reply` (con y sin PUBLIC_BASE_URL, con firma correcta)
- Cascade obra → planos

Los seis bugs del audit pasaron porque no hay cobertura.

---

## 6. Mejoras propuestas

### 6.1 Fix del bot: firmar la URL antes de mandarla (cierra 5.1)

- **Qué:** en `MessageService._format_plano_reply()`, reemplazar `f"{base_url}/uploads/{plano.file_path}"` por `signed_upload_url(plano.file_path, ttl=48*3600)`. Nota: `signed_upload_url` ya usa `PUBLIC_BASE_URL` internamente (`app/core/signing.py:53-56`), así que se puede simplificar el manejo del `base_url` en `_format_plano_reply`.
- **Por qué:** cierra el bug más crítico del módulo. Sin este fix, la feature entera está rota en producción.
- **Esfuerzo:** TRIVIAL (2 líneas + import).
- **Riesgo:** BAJO. Si Twilio archiva el media durante 30 días, un TTL de 48h alcanza. Verificar que `PUBLIC_BASE_URL` esté seteado en prod (cross-check con el bug E2 del audit 01 §8.3).

### 6.2 Guards admin en upload y delete (cierra 5.2)

- **Qué:** cambiar `CurrentUser` → `AdminUser` en `planos.py:21` (POST) y `planos.py:57` (DELETE). Alternativa: introducir un rol `arquitecto` que puede subir y borrar planos pero no tocar otros módulos administrativos.
- **Por qué:** cierra el bypass de rol, alinea backend con lo que ya asume el frontend.
- **Esfuerzo:** BAJO (2 líneas).
- **Riesgo:** BAJO. Verificar que ningún flujo automatizado (n8n) suba planos con token de collaborator (no debería, pero cross-check).

### 6.3 Validación de MIME real (cierra 5.3)

- **Qué:** agregar `python-magic` (o `filetype`) al backend. En `PlanoService.create()`, después de leer los bytes, hacer `mime = magic.from_buffer(content, mime=True)`. Whitelist: `application/pdf`, `image/*`, `application/dwg`, `application/dxf`, `application/vnd.ms-excel`. Si `mime` no está en whitelist → 400. Persistir el MIME real (sniffing) en `Plano.content_type`, no el que envió el cliente.
  Adicionalmente: al servir en `main.py:98-111`, forzar `Content-Disposition: attachment` para PDFs y DWG (evita render inline si algo se coló).
- **Por qué:** cierra el vector XSS de 5.3 y mejora la higiene general.
- **Esfuerzo:** MEDIO (agregar dep + tests).
- **Riesgo:** BAJO. Los tests actuales de upload no se rompen porque los PDFs de prueba son válidos.

### 6.4 URL firmada con scope de tenant (cierra 5.4)

- **Qué:** cambiar el mensaje HMAC de `f"{name}:{exp}"` a `f"{tenant_id}:{name}:{exp}"`. En `verify_download`, exigir que el request incluya el `tenant_id` del solicitante (via token o query param) y compararlo con el que se firmó. Alternativa más simple: incluir `user_id` para que el link solo funcione con la sesión del que lo generó. TTL más corto para web (15 min) y más largo para bot (48h) con scope diferente.
- **Por qué:** cierra la fuga de "link es bearer" del 5.4.
- **Esfuerzo:** MEDIO (cambio de firma + endpoint + tests).
- **Riesgo:** MEDIO — invalida todas las URLs firmadas que ya se generaron (aunque expiran en 1h de todas formas, así que no es un problema real). Los 8 tests de signing existentes hay que actualizarlos.

### 6.5 Fix race condition en versionado (cierra 5.5)

- **Qué:** agregar en una migración:
  ```sql
  CREATE UNIQUE INDEX idx_plano_latest_per_group
  ON planos (obra_id, discipline, name)
  WHERE is_latest = TRUE;
  ```
  En `PlanoService.create()`, hacer `SELECT ... FOR UPDATE` sobre las filas existentes del grupo antes de calcular `next_version`. Con el unique constraint parcial, la segunda tx que intente insertar con `is_latest=True` fallará y hará rollback.
- **Por qué:** cierra el race condition. Postgres soporta índices parciales.
- **Esfuerzo:** BAJO (migración + `.with_for_update()` en la query).
- **Riesgo:** BAJO. Verificar que no haya data existente con duplicados antes de la migración (probablemente hay ya, con los 2 planos AUDIT-conc que subí en la auditoría — se limpiaron).

### 6.6 Fix del archivo huérfano en DELETE (cierra 5.6)

- **Qué:** en `PlanoService.delete()`, después del hard-delete de la fila, `try: os.remove(full_path); except FileNotFoundError: pass`. Ideal: mover a soft-delete (`is_deleted: bool` + `deleted_at`) y un job nocturno que limpie los archivos con `deleted_at > 30d`.
- **Por qué:** cierra el crecimiento indefinido del disco.
- **Esfuerzo:** BAJO (opción a: 3 líneas). MEDIO (opción b: migración + job).
- **Riesgo:** BAJO.

### 6.7 Fix del CASCADE de obra + archivos (cierra 5.7)

- **Qué:** en `ObraService.delete()`, antes del `DELETE FROM obras WHERE id=?`, iterar los planos y limpiar los archivos. O centralizar en el job nocturno de 6.6.
- **Por qué:** cierra la fuga de archivos al borrar obras completas.
- **Esfuerzo:** BAJO.
- **Riesgo:** BAJO.

### 6.8 Persistir `Message.media_url` en OUTBOUND del bot (cierra 5.8)

- **Qué:** en `MessageService.process_inbound()` línea 223-235, pasar `media_url=media_url` al `_save_message` del OUTBOUND. La variable local ya existe.
- **Por qué:** cierra el gap de auditoría.
- **Esfuerzo:** TRIVIAL (1 línea).
- **Riesgo:** NULO.

### 6.9 Eventos de historial para upload/delete de plano (cierra 5.9)

- **Qué:** en `PlanoService.create()` y `delete()`, llamar a `historial_service.append_event(obra_id, event_type="plano_uploaded" | "plano_deleted", actor_id=..., details={discipline, version, name, file_size})`. Ver cómo lo hace `TaskService` como referencia.
- **Por qué:** cierra el gap de trazabilidad.
- **Esfuerzo:** BAJO.
- **Riesgo:** NULO. Es aditivo.

### 6.10 Schema estricto de disciplinas + PlanoUploadPayload (cierra 5.10 y 5.11)

- **Qué:** crear `PlanoUploadPayload` Pydantic con `discipline: Literal["electricidad","sanitarios","gas","estructura","arquitectura","incendio","termomecanica","pluviales","instalaciones","replanteo"]`, `name: constr(max_length=255) | None`, `notes: constr(max_length=500) | None`. Usar `Depends(PlanoUploadPayload)` en el POST.
- **Por qué:** cierra 5.10 y 5.11, mejora la higiene de la API.
- **Esfuerzo:** BAJO.
- **Riesgo:** MEDIO — si el frontend hoy manda una disciplina no listada, se rompe. Verificar antes.

### 6.11 Tests que faltan (cierra 5.12)

- **Qué:** agregar en `backend/tests/`:
  - `test_planos_upload.py`: happy path, size limit, MIME whitelist (cuando se implemente 6.3), collab bloqueado con 6.2, tenant isolation.
  - `test_planos_versionado.py`: v1 → v2 → v3, herencia de is_latest al delete, race condition (con `pytest-asyncio` + `asyncio.gather` para forzar concurrencia).
  - `test_planos_bot_url.py`: verificar que `_format_plano_reply` genera URL firmada (cierra 6.1).
  - `test_planos_download_scope.py`: URL firmada sin scope de tenant (probar cross-tenant sin y con fix 6.4).
- **Por qué:** los seis bugs pasaron porque no hay cobertura.
- **Esfuerzo:** MEDIO. ~200 líneas.
- **Riesgo:** NULO.

---

## 7. Riesgos

| # | Riesgo | Severidad | Vector | Estado |
|---|---|---|---|---|
| P1 | El bot manda URL sin firma → Twilio 403 → archivo no adjunta → feature de planos por WhatsApp rota | **Alta** funcional | Uso normal | **Abierto** (5.1) |
| P2 | Collab sube/borra planos vía curl | **Alta** | Usuario interno legítimo con curl/DevTools | **Abierto** (5.2) |
| P3 | XSS por MIME arbitrario aceptado + servido inline | **Alta** seguridad | Admin sube HTML como PDF; luego cualquiera con la URL firmada renderiza | **Abierto** (5.3) |
| P4 | URL firmada sin scope de tenant/usuario = bearer para el archivo durante 1h | **Alta** seguridad | Fuga de link (logs, mails, WhatsApp reenviado, DevTools, cache) | **Abierto** (5.4) |
| P5 | Race condition versionado → dos `is_latest=True` simultáneos | **Media** integridad | Concurrencia real (dos personas suben la misma disciplina/name a la vez) | **Abierto** (5.5) |
| P6 | Archivos huérfanos en disco (DELETE de plano + CASCADE de obra) | **Media** ops | Uso normal → disco crece indefinido | **Abierto** (5.6, 5.7) |
| P7 | Sin historial de subida/borrado de planos | **Media** compliance | Compliance interna, disputas de trazabilidad | **Abierto** (5.9) |
| P8 | `Message.media_url` OUTBOUND no se persiste | **Baja** debug | Debugging del bot en producción | **Abierto** (5.8) |
| P9 | Disciplina desconocida cae a `"general"` sin error | **Baja** higiene | Curl con typo, integración externa mal armada | **Abierto** (5.10) |
| P10 | `name`/`notes` sin límite en Pydantic | **Baja** | Curl con strings largos | **Abierto** (5.11) |
| P11 | Cobertura tests del módulo casi nula | **Media** ingeniería | Regresión futura | **Abierto** (5.12) |
| P12 | Path traversal en `/uploads/{filename}` | — | — | **Cerrado — funciona** (`Path(filename).name` normaliza) |
| P13 | Aislamiento tenant en CRUD de `/obras/{id}/planos` | — | — | **Cerrado — 404 cross-tenant en los 3 endpoints** |
| P14 | Firma HMAC tampering-resistant y expiración validada | — | — | **Cerrado — 8 tests + comparación `hmac.compare_digest`** |
| P15 | Naming en disco con UUID (no colisiona, no enumera) | — | — | **Cerrado — `uuid.uuid4().hex + ext`** |

---

## Anexo A — Reproducciones concretas

### A.1 — Bot manda URL sin firma → 403 → sin archivo (5.1)

```bash
# Ver el código:
grep -n "uploads/" backend/app/services/message_service.py | grep -v import
→ 425:        url = f"{base_url}/uploads/{plano.file_path}" if base_url else None

# Verificar el 403:
curl -sw "%{http_code}\n" "http://localhost:8000/uploads/7720de70966a456d9cbc872915ce2bd0.pdf"
→ 403 {"detail":"Enlace inválido o expirado."}

# La respuesta del bot al pedir plano por WhatsApp (audit 04 y 05):
# body: "📐 Plano de electricidad (v2, 21/06/2026)."   ← llega
# media_url: NULL en Message OUTBOUND                   ← nunca se persiste
# En Twilio: caption OK, adjunto vacío                  ← lo que ve el responsable
```

### A.2 — Collaborator sube y borra planos (5.2)

```bash
COLLAB_TOK=$(curl -sX POST http://localhost:8000/api/v1/auth/login -d '{"email":"invite-ui-test@example.com","password":"TestPass123!"}' | jq -r .access_token)

# Subir
curl -X POST http://localhost:8000/api/v1/obras/17/planos \
     -H "Authorization: Bearer $COLLAB_TOK" \
     -F "file=@/tmp/audit.pdf" -F "discipline=gas" -F "name=AUDIT-collab"
→ 201 (id=24)

# Borrar la latest
curl -X DELETE http://localhost:8000/api/v1/planos/3 -H "Authorization: Bearer $COLLAB_TOK"
→ 204
# DB: id=3 desapareció, id=2 pasó a is_latest=True (herencia OK, pero borrado ilegítimo)
```

### A.3 — MIME arbitrario aceptado (5.3)

```bash
cat > /tmp/evil.pdf <<'EOF'
<html><script>alert('xss')</script></html>
EOF

curl -X POST http://localhost:8000/api/v1/obras/17/planos \
     -H "Authorization: Bearer $TOKEN_T2" \
     -F "file=@/tmp/evil.pdf;type=text/html" \
     -F "discipline=arquitectura" -F "name=AUDIT-html"
→ 201 {"id":25, "content_type":"text/html", ...}
# El sistema persistió content_type=text/html en la DB.
```

### A.4 — URL firmada sin auth (5.4)

```bash
# facundo (tenant 2) obtiene URL firmada del plano id=2
URL=$(curl -s http://localhost:8000/api/v1/obras/17/planos -H "Authorization: Bearer $TOKEN_T2" | jq -r '.[] | select(.id==2) | .file_url')

# Con token de tenant ajeno
curl -sw "%{http_code}\n" "$URL" -H "Authorization: Bearer $TOKEN_T8"
→ 200 (descarga el PDF completo, 166925 bytes)

# Sin ningún token
curl -sw "%{http_code}\n" "$URL"
→ 200 (idem)
```

### A.5 — Race condition versionado (5.5)

```bash
( curl -X POST http://localhost:8000/api/v1/obras/17/planos \
       -F file=@a.pdf -F discipline=incendio -F name=AUDIT-conc \
       -H "Authorization: Bearer $TOKEN_T2" &
  curl -X POST http://localhost:8000/api/v1/obras/17/planos \
       -F file=@b.pdf -F discipline=incendio -F name=AUDIT-conc \
       -H "Authorization: Bearer $TOKEN_T2" & wait )
→ Ambos 201

# En DB:
SELECT id, version, is_latest FROM planos WHERE name='AUDIT-conc' AND obra_id=17;
→ id=26 v=1 is_latest=True
→ id=27 v=1 is_latest=True   ← duplicado
```

### A.6 — Archivo huérfano (5.6)

```bash
# Antes del DELETE:
SELECT file_path FROM planos WHERE id=3;
→ 3bd0f9d011d9483ebae330358f643f16.pdf
ls uploads/3bd0f9d011d9483ebae330358f643f16.pdf   → existe (1.4 MB)

# DELETE
curl -X DELETE http://localhost:8000/api/v1/planos/3 -H "Authorization: Bearer $TOKEN_T2"

# Después:
SELECT * FROM planos WHERE id=3;   → 0 rows
ls uploads/3bd0f9d011d9483ebae330358f643f16.pdf   → sigue existiendo, huérfano

# Además, del ls original de uploads/: a199a1fa6ae844ad881bfede3660d0e9.pdf (2.8 MB)
# ya estaba huérfano de sesiones previas.
```

---

## Anexo B — Datos del entorno al momento de la auditoría

- **Rama:** `audit/05-planos` (desde `main` @ `c913635`, con audit 04 mergeada).
- **Backend:** uvicorn `:8000` (1 worker), Postgres local, `APP_DEBUG=true`.
- **Frontend:** Vite `:5173`.
- **Tenant usado:** tenant 2 "Empresa de facundo" (plan básico). Obra 17 tenía 3 planos de electricidad (v1, v2, v3=latest) al arrancar.
- **Otros tenants inspeccionados:** tenant 3 (18: electricidad, incendio), tenant 4 (20: estructura), tenant 8 (30: estructura×2, electricidad, sanitarios).
- **Uploads/:** 4 archivos huérfanos generados por AUDIT-* + `a199a1fa6ae844ad881bfede3660d0e9.pdf` preexistente. Los AUDIT-* se limpiaron al final (4 rows DB + 4 archivos disco).
- **Config `PUBLIC_BASE_URL`:** `https://banknote-tractor-zen.ngrok-free.dev` (ngrok, para el webhook de Twilio). Consecuencia: las URLs firmadas web funcionan; el link crudo del bot (bug 5.1) apunta al mismo dominio pero da 403.
- **Suite pytest:** 72/72 verdes en 17s.

---

## Anexo C — Archivos y líneas clave

**Backend — modelos y schemas:**
- `app/models/plano.py` — todos los campos, indexes, FKs con CASCADE/SET NULL
- `app/schemas/plano.py` — solo `PlanoRead` con `file_url` firmada
- `alembic/versions/0028_add_planos.py` — creación de la tabla
- `alembic/versions/0032_add_plano_obra_select_step.py` — enum de conversation_step

**Backend — servicio:**
- `app/services/plano_service.py`
  - `MAX_BYTES = 25 * 1024 * 1024` (línea 17)
  - `DISCIPLINE_SYNONYMS` (línea 20-31) — 10 disciplinas + variantes
  - `_norm` (línea 36-38) — normalización unicode
  - `canonical_discipline` (línea 40-45) — **cae a "general" para desconocidos** (bug 5.10)
  - `match_discipline_in_text` (línea 48-54) — matcher del bot
  - `create()` (línea 63-106) — **race condition (bug 5.5)**
  - `delete()` (línea 121-137) — **hard delete, no borra archivo (bug 5.6)**
  - `find_latest_for_disciplines` (línea 141-146)
  - `available_disciplines*` (línea 148-166)
  - `allowed_disciplines_for_responsible` (línea 182-192) — cubierto en audit 04

**Backend — endpoints:**
- `app/api/routes/planos.py`
  - `POST /obras/{obra_id}/planos` (línea 21-47) — **guard `CurrentUser` (bug 5.2), sin MIME (bug 5.3)**
  - `GET /obras/{obra_id}/planos` (línea 50-54)
  - `DELETE /planos/{plano_id}` (línea 57-59) — **guard `CurrentUser` (bug 5.2)**
- `app/main.py:98-111` — endpoint `/uploads/{filename}` con firma
- `app/api/routes/uploads.py` — endpoint separado para uploads generales (MAX 5MB)

**Backend — signing:**
- `app/core/signing.py`
  - `PUBLIC_IMAGE_EXTS` (línea 19)
  - `DEFAULT_TTL = 3600` (línea 21)
  - `_digest` (línea 28-30) — **HMAC-SHA256 sin scope de tenant (bug 5.4)**
  - `requires_signature` (línea 33-35)
  - `sign_query`, `signed_upload_path`, `signed_upload_url` (línea 38-56)
  - `verify_download` (línea 59-69) — comparación en tiempo constante

**Backend — uso desde el bot:**
- `app/services/message_service.py:423-431` — **`_format_plano_reply` con URL sin firma (bug 5.1)**
- `app/services/message_service.py:220-235` — **`_save_message` OUTBOUND sin `media_url` (bug 5.8)**
- `app/services/message_service.py:381-421` — `_handle_plano_obra_selection` (desambiguación)

**Frontend:**
- `frontend/src/components/PlanosTab.tsx:212-403` — UI de planos
- `frontend/src/components/PlanosTab.tsx:45-209` — UploadModal (10 disciplinas + accept HTML input)
- `frontend/src/api/planos.ts:1-28` — cliente API

**Tests existentes:**
- `backend/tests/test_upload_signing.py:1-79` — 8 tests de signing (tampering, expiración, imágenes vs sensibles, roundtrip)
- **Faltan** tests de endpoints de planos, versionado, MIME, guards, bot URL — ver §6.11.

---

## Anexo D — Segunda ronda: hallazgos de la prueba en producción (2026-08-28)

Los 15 riesgos de la tabla §7 quedaron cerrados el 21/08 (`#78`) y el 24/08 (`#80`, el botón "Nueva versión" que no respetaba el permiso de subida). Este anexo registra lo que apareció **después**, al ejercitar el flujo contra Twilio real con datos de producción — ninguno de estos tres defectos era detectable leyendo el código ni con la suite automatizada.

### D.1 — El menú de desambiguación no aceptaba el nombre de la obra `#91`

**Síntoma reportado:** pedir un plano de una disciplina presente en dos obras del responsable no entregaba nada; la misma disciplina en una sola obra funcionaba bien.

**Causa:** `_handle_plano_obra_selection` parseaba la respuesta con `re.search(r"\d+", body)`. El bot lista las opciones por nombre ("1) Edificio Norte"), así que responder con el nombre —lo natural— no matcheaba y se repetía la pregunta indefinidamente. El mismo patrón estaba en el flujo de selección de obra para bitácora.

**Corrección:** `_match_numbered_option()` acepta número o nombre (insensible a mayúsculas/acentos, exacto o parcial si es inequívoco), con prioridad al match exacto. Esa prioridad no es cosmética: "Edificio Norte" es substring literal de "Edificio Norte — Demo", y sin ella el nombre exacto quedaba ambiguo. El caso borde apareció al verificar contra los datos reales del tenant, no en el diseño.

**Cobertura:** `test_whatsapp_planos_desambiguacion.py`, 11 casos, incluida la regresión del prefijo compartido.

### D.2 — Alta de responsable sin acceso a planos guardaba acceso total `#91`

**Causa:** el POST de `obra_team` hacía `plan_disciplines=payload.plan_disciplines or None`. Como `[]` es *falsy* en Python, pedir explícitamente "sin acceso" (`[]`) se guardaba como `None`, que es acceso total — **el resultado opuesto al solicitado**. El PATCH ya lo manejaba correctamente.

**Por qué no se detectó antes:** ninguna interfaz mandaba `[]` en el alta. El defecto estaba latente desde que existe el campo y solo se manifestó al agregar el checkbox de acceso en el formulario de alta.

**Cobertura:** `test_obra_team_plan_disciplines.py`, 5 casos sobre la semántica del campo (`None` = todas, `[]` = ninguna, `[..]` = solo esas) en alta y edición. Se verificó que el caso `[]` falla si se reintroduce el `or None`.

### D.3 — Planos de más de 16 MB: silencio total en el campo `#99`

**Síntoma:** un plano se entregaba y otro no, sin diferencia de permisos ni de configuración.

**Causa:** WhatsApp/Twilio no admite adjuntos de más de 16 MB. El plano que fallaba pesaba 19,5 MB. Twilio **acepta** el mensaje (devuelve SID) y falla después, al descargar el media, con `error_code=63019` — por eso `send_whatsapp_message` tampoco registraba nada: su `except` nunca se dispara. Confirmado consultando el estado del mensaje en la API de Twilio.

**Corrección:** el tope de carga sigue en 25 MB (el plano se descarga bien desde la web), pero el sistema ahora lo advierte al elegir el archivo, al subir una versión nueva y con un badge permanente en la fila. El umbral vive en el backend (`WHATSAPP_MAX_BYTES`) y se expone como campo calculado `too_big_for_whatsapp`.

**Cierre de la brecha (2026-08-28, misma jornada).** En una primera pasada solo se avisaba a quien cargaba el plano, de modo que el responsable que lo pedía desde la obra seguía sin recibir nada. Se cerró: `_format_plano_reply` verifica el tamaño **antes** de construir la URL y, si excede el límite, responde con el nombre y la versión del plano más la explicación de por qué no puede adjuntarlo, sin `media_url`.

El texto no deriva a la aplicación web deliberadamente —quien pide un plano por WhatsApp es, por definición, alguien que no tiene acceso a ella—; la única salida accionable desde la obra es pedírselo a quien sí lo tiene. Hay un test que verifica esa restricción explícitamente, además de que no se intente adjuntar el archivo.

Lo que permanece fuera de alcance es **entregar** el plano igualmente, es decir la compresión automática: viable para imágenes (Pillow) pero riesgosa para PDF vectorial, donde una compresión agresiva compromete la legibilidad de las cotas.

### D.4 — Nota metodológica

Los tres defectos comparten un rasgo: **son invisibles para la lectura de código y para la suite de tests**, porque dependen del comportamiento de una integración externa o de un camino que ninguna interfaz ejercitaba. La conclusión operativa es que, para un módulo cuya interfaz principal es un canal de terceros, la prueba de integración real no es un complemento opcional de la auditoría estática sino una técnica de verificación distinta y no sustituible.

De paso se detectó una brecha de tooling que afecta a todo el repositorio: `npx tsc --noEmit` no verifica nada, porque el `tsconfig.json` raíz declara `"files": []` y las referencias no se siguen sin `--build`. El comando correcto es `npx tsc -b`.
