# CONSTRUCTA — Guía para correr el proyecto en local

Esta guía resume cómo levantar **backend (FastAPI + Socket.IO)** y **frontend (React + Vite)** del monorepo CONSTRUCTA.

---

## Estructura del repositorio

| Carpeta | Rol |
|---------|-----|
| `backend/` | API REST (`/api/v1`), Socket.IO, PostgreSQL (SQLAlchemy + asyncpg), Alembic |
| `frontend/` | SPA React 19 + TypeScript + Vite + Tailwind |
| `docs/` | Documentación adicional (`database.md`, `documentacion.md`, etc.) |

El frontend está configurado para hablar con el backend en **`http://localhost:8000`** (API en `/api/v1` y WebSocket/Socket.IO en la misma base).

---

## Requisitos previos

Instalá en tu máquina:

1. **Node.js** (recomendado: LTS actual, p. ej. 20.x o 22.x) y **npm**.
2. **Python 3.11+** (3.12 suele funcionar bien con las dependencias listadas en `backend/requirements.txt`).
3. **PostgreSQL** (14+ recomendado) accesible en `localhost`.

Opcional pero útil:

- **Git** para clonar o actualizar el repo.

---

## 1. Base de datos PostgreSQL

El backend espera una URL con driver **asyncpg**, por ejemplo:

```text
postgresql+asyncpg://postgres:password@localhost:5432/constructa
```

Pasos típicos (ajustá usuario/clave a tu instalación):

```bash
# Entrar a psql como superusuario (el comando puede variar según tu OS)
psql -U postgres
```

Dentro de `psql`:

```sql
CREATE DATABASE constructa;
```

Si tu usuario/contraseña/puerto no coinciden con el ejemplo, actualizá `DATABASE_URL` en el `.env` del backend (paso 2) para que refleje tu PostgreSQL real.

---

## 2. Configuración del backend (`.env`)

Desde la raíz del monorepo (`ConstructaDev/`):

```bash
cd backend
cp .env.example .env
```

Editá `backend/.env` y como mínimo definí:

- **`SECRET_KEY`**: una cadena larga y aleatoria (en producción no uses el valor de ejemplo).
- **`DATABASE_URL`**: debe apuntar a tu base `constructa` con el formato `postgresql+asyncpg://...`.

Referencia completa de variables: `backend/.env.example`. **Twilio** y **IA (Anthropic)** son opcionales para solo usar el dashboard; si querés WhatsApp real, seguí la [sección 10 — Twilio y WhatsApp](#10-twilio-y-whatsapp-fase-2).

Generar un `SECRET_KEY` rápido:

```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```

---

## 3. Instalar dependencias y migraciones (backend)

Todo desde `backend/`:

```bash
cd backend

# Entorno virtual (recomendado)
python3 -m venv .venv
source .venv/bin/activate          # macOS / Linux
# .venv\Scripts\activate           # Windows (cmd/PowerShell)

pip install -r requirements.txt

# Aplicar esquema de base de datos
alembic upgrade head
```

Comprobar que la base está al día (opcional):

```bash
alembic current
alembic heads
```

Si no coinciden, `alembic upgrade head` aplica lo pendiente.

---

## 4. Levantar el servidor de desarrollo (backend)

Seguís dentro de `backend/` con el venv activado:

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

- **API y documentación interactiva:** [http://localhost:8000/docs](http://localhost:8000/docs)
- **Healthcheck:** [http://localhost:8000/health](http://localhost:8000/health)

Dejá esta terminal abierta mientras desarrollás.

---

## 5. Instalar dependencias y levantar el frontend

Abrí **otra** terminal. Desde la raíz del monorepo:

```bash
cd frontend
npm install
npm run dev
```

Por defecto Vite suele servir en **[http://localhost:5173](http://localhost:5173)** (la consola de Vite muestra la URL exacta).

---

## 6. Resumen de URLs y puertos

| Servicio | URL típica |
|----------|------------|
| Frontend (Vite) | `http://localhost:5173` |
| Backend HTTP + Socket.IO | `http://localhost:8000` |
| Swagger del backend | `http://localhost:8000/docs` |

El código del frontend fija la API y el socket contra `localhost:8000`:

- `frontend/src/api/client.ts` → `http://localhost:8000/api/v1`
- `frontend/src/lib/socket.ts` → `http://localhost:8000`

Si cambiás el puerto del backend, tendrás que actualizar esas rutas o parametrizarlas (hoy no usan variables `VITE_*`).

---

## 7. Otros comandos útiles

**Frontend**

```bash
cd frontend
npm run build      # Compilación de producción (TypeScript + Vite)
npm run preview    # Servir el build localmente
npm run lint       # ESLint
```

**Backend**

```bash
cd backend
source .venv/bin/activate   # si usás venv
pytest                      # Tests (si existen y están configurados)
```

**Nueva migración (solo si cambiás modelos)**

```bash
cd backend
alembic revision --autogenerate -m "descripcion_del_cambio"
alembic upgrade head
```

---

## 8. Orden recomendado al arrancar cada día

1. Asegurar que **PostgreSQL** está corriendo.
2. Terminal 1: `cd backend` → activar venv → `uvicorn app.main:app --reload --host 0.0.0.0 --port 8000`
3. Terminal 2: `cd frontend` → `npm run dev`
4. Abrir el navegador en la URL que indique Vite (normalmente `http://localhost:5173`).

---

## 9. Problemas frecuentes

| Síntoma | Qué revisar |
|---------|-------------|
| Error de conexión a la base | `DATABASE_URL`, que PostgreSQL esté levantado y que exista la DB `constructa`. |
| `alembic upgrade head` falla | Misma `DATABASE_URL` que usa la app; permisos del usuario SQL. |
| El frontend no carga datos | Que el backend esté en **8000** y sin errores en consola; probá `/health` y `/docs`. |
| Puerto 8000 ocupado | Cambiá el puerto en `uvicorn` y actualizá `client.ts` y `socket.ts` del frontend para que coincidan. |

---

## 10. Twilio y WhatsApp (Fase 2)

El backend recibe mensajes entrantes de WhatsApp vía **webhook HTTP** y puede enviar respuestas con la **API REST de Twilio**. El código relevante está en `backend/app/api/routes/webhooks.py`, `backend/app/integrations/twilio/` y `backend/app/services/message_service.py`.

### 10.1 Variables en `backend/.env`

| Variable | Uso |
|----------|-----|
| `TWILIO_ACCOUNT_SID` | Credencial de la cuenta Twilio (empieza con `AC…`). |
| `TWILIO_AUTH_TOKEN` | Token secreto de la API; también sirve para validar la firma `X-Twilio-Signature` del webhook. |
| `TWILIO_WHATSAPP_NUMBER` | Número de WhatsApp **de envío** en Twilio, con prefijo `whatsapp:` (ej. `whatsapp:+14155238886` en sandbox). |
| `PUBLIC_BASE_URL` | URL **pública** base del backend (sin barra final), ej. `https://abc123.ngrok.io`. Twilio firma contra esta URL cuando validás el webhook detrás de un túnel o proxy. |

Valores de ejemplo: `backend/.env.example`.

### 10.2 URL del webhook (configuración en Twilio)

Twilio debe enviar los POST de mensajes entrantes a:

```text
POST {PUBLIC_BASE_URL}/api/v1/webhooks/twilio
```

Ejemplo con ngrok:

```text
https://tu-subdominio.ngrok.io/api/v1/webhooks/twilio
```

En consola Twilio: **Messaging** → tu número / sandbox de WhatsApp → **Webhook** para mensajes entrantes → método **HTTP POST** y esa URL.

### 10.3 Validación de firma (seguridad)

En `backend/app/integrations/twilio/security.py`, la validación HMAC del webhook **no se aplica** si:

- `DEBUG=true` en `.env`, **o**
- `TWILIO_AUTH_TOKEN` está vacío.

En esos casos el servidor registra un warning y acepta el POST (cómodo para pruebas locales sin túnel). En **producción**: `DEBUG=false`, token configurado y `PUBLIC_BASE_URL` exactamente igual a la URL que ve Twilio (incluido `https` y dominio), para que la firma coincida.

### 10.4 Desarrollo local: túnel (ngrok u otro)

Twilio no puede llamar a `http://localhost:8000` desde internet. Para probar el webhook real:

1. Levantá el backend en el puerto **8000** (como en la guía).
2. Abrí un túnel hacia ese puerto, por ejemplo:

   ```bash
   ngrok http 8000
   ```

3. Copiá la URL HTTPS que te da ngrok (ej. `https://xxxx.ngrok-free.app`).
4. En `backend/.env` poné:

   ```env
   PUBLIC_BASE_URL=https://xxxx.ngrok-free.app
   ```

   Si querés validación estricta de firma, usá `DEBUG=false` y completá `TWILIO_AUTH_TOKEN` (y las demás variables Twilio).

5. En la consola de Twilio, configurá el webhook con `https://xxxx.ngrok-free.app/api/v1/webhooks/twilio`.

Cada vez que reinicies ngrok, la URL suele cambiar: actualizá Twilio y `PUBLIC_BASE_URL`.

### 10.5 Envío de mensajes (saliente)

`send_whatsapp_message` en `backend/app/integrations/twilio/client.py` usa `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` y `TWILIO_WHATSAPP_NUMBER`. Si faltan SID o token, **no envía** (solo log de advertencia) y el resto del flujo sigue; sirve para desarrollo sin Twilio.

Para **sandbox de WhatsApp**, el destinatario tiene que haber unido el sandbox con el código que muestra Twilio; el “from” suele ser el número sandbox que te asignan.

### 10.6 Probar desde la API (con login JWT)

Con el backend en marcha y un usuario autenticado (token JWT como en el resto de la API):

- **`GET /api/v1/settings/system-health`** — indica si la base responde y si Twilio está “configurado” a nivel de SID + token (y expone el número configurado sin el prefijo `whatsapp:`).
- **`POST /api/v1/settings/test-whatsapp`** — cuerpo JSON, por ejemplo `{"phone_number": "+5491112345678"}` (E.164, sin prefijo `whatsapp:`). Envía un mensaje de prueba por WhatsApp si Twilio está bien configurado.

Todo esto está documentado en Swagger: [http://localhost:8000/docs](http://localhost:8000/docs) → sección **settings** y **webhooks**.

### 10.7 Twilio Console (recordatorio rápido)

1. Cuenta en [Twilio](https://www.twilio.com/) y activá **WhatsApp** (sandbox para desarrollo o número aprobado para producción).
2. Copiá **Account SID** y **Auth Token** desde el dashboard.
3. Configurá el webhook de mensajes entrantes con la URL de la sección 10.2.
4. Ajustá `TWILIO_WHATSAPP_NUMBER` al “from” que Twilio te indique para WhatsApp.

### 10.8 Otras variables del `.env` (IA — no activo aún)

`ANTHROPIC_API_KEY`, `CLAUDE_MODEL` y `WHISPER_MODEL` están preparados para fases posteriores; no son necesarios para Twilio ni para el dashboard básico. El paquete `anthropic` en `requirements.txt` puede seguir comentado hasta que se implemente esa fase.

---

## 11. Qué es CONSTRUCTA (contexto breve)

Sistema de gestión de obras: dashboard web para obras, tareas, responsables y alertas, con backend preparado para integración WhatsApp (Twilio) y fases de IA documentadas en `docs/documentacion.md`.

---

*Última revisión: frontend `package.json`, backend `requirements.txt`, `app/main.py`, `app/api/routes/webhooks.py`, `app/integrations/twilio/*`, y `frontend/src/api/client.ts`.*
