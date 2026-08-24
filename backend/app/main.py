from contextlib import asynccontextmanager

import socketio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import admin as admin_router
from app.api.routes import alerts, auth, notifications, obras, presence, responsibles, tasks, uploads, users, webhooks
from app.api.routes import settings as settings_router
from app.api.routes import calendar as calendar_router
from app.api.routes import imports as imports_router
from app.api.routes import exports as exports_router
from app.api.routes import critical_path as critical_path_router
from app.api.routes import baseline as baseline_router
from app.api.routes import obra_team as obra_team_router
from app.api.routes import obra_user_roles as obra_user_roles_router
from app.api.routes import suppliers as suppliers_router
from app.api.routes import task_materials as task_materials_router
from app.api.routes import purchase_orders as purchase_orders_router
from app.api.routes import bitacora as bitacora_router
from app.api.routes import budgets as budgets_router
from app.api.routes import planos as planos_router
from app.api.routes import solicitudes as solicitudes_router
from app.core.config import settings
from app.core.logging_config import setup_logging, setup_sentry
from app.core.scheduler import start_scheduler, stop_scheduler
from app.core.socket_manager import sio

# Logging estructurado: JSON en producción, legible en dev. Se configura antes
# de crear la app para que los loggers de FastAPI/SQLAlchemy ya usen este formato.
setup_logging(debug=settings.APP_DEBUG)
setup_sentry(dsn=settings.SENTRY_DSN, app_name=settings.APP_NAME, debug=settings.APP_DEBUG)


@asynccontextmanager
async def lifespan(_: FastAPI):
    from app.core.config import validate_startup
    validate_startup(settings)
    start_scheduler()
    yield
    stop_scheduler()


# ── FastAPI app (HTTP routes) ──────────────────────────────────────────────────
fastapi_app = FastAPI(
    title=settings.APP_NAME,
    version="0.1.0",
    docs_url="/docs",
    redoc_url=None,
    lifespan=lifespan,
)

fastapi_app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

API_PREFIX = "/api/v1"

fastapi_app.include_router(auth.router, prefix=API_PREFIX)
fastapi_app.include_router(users.router, prefix=API_PREFIX)
fastapi_app.include_router(obras.router, prefix=API_PREFIX)
fastapi_app.include_router(responsibles.router, prefix=API_PREFIX)
fastapi_app.include_router(tasks.router, prefix=API_PREFIX)
fastapi_app.include_router(webhooks.router, prefix=API_PREFIX)
fastapi_app.include_router(alerts.router, prefix=API_PREFIX)
fastapi_app.include_router(notifications.router, prefix=API_PREFIX)
fastapi_app.include_router(settings_router.router, prefix=API_PREFIX)
fastapi_app.include_router(uploads.router, prefix=API_PREFIX)
fastapi_app.include_router(presence.router, prefix=API_PREFIX)
fastapi_app.include_router(calendar_router.router, prefix=API_PREFIX)
fastapi_app.include_router(imports_router.router, prefix=API_PREFIX)
fastapi_app.include_router(exports_router.router, prefix=API_PREFIX)
fastapi_app.include_router(critical_path_router.router, prefix=API_PREFIX)
fastapi_app.include_router(baseline_router.router, prefix=API_PREFIX)
fastapi_app.include_router(obra_team_router.router, prefix=API_PREFIX)
fastapi_app.include_router(obra_user_roles_router.router, prefix=API_PREFIX)
fastapi_app.include_router(admin_router.router, prefix=API_PREFIX)
fastapi_app.include_router(suppliers_router.router, prefix=API_PREFIX)
fastapi_app.include_router(task_materials_router.router, prefix=API_PREFIX)
fastapi_app.include_router(purchase_orders_router.router, prefix=API_PREFIX)
fastapi_app.include_router(bitacora_router.router, prefix=API_PREFIX)
fastapi_app.include_router(budgets_router.router, prefix=API_PREFIX)
fastapi_app.include_router(planos_router.router, prefix=API_PREFIX)
fastapi_app.include_router(solicitudes_router.router, prefix=API_PREFIX)


# Serve uploaded images — must be a proper route (not StaticFiles) to work
# correctly when wrapped by the Socket.IO ASGI app.
from pathlib import Path as _Path
from fastapi import HTTPException as _HTTPException, Request as _Request
from fastapi.responses import FileResponse as _FileResponse

_UPLOADS_DIR = _Path(__file__).parent.parent / "uploads"

# Content-Type explícito por extensión — nunca inferido de un nombre de archivo
# atacante-controlado (Starlette adivina por extensión y eso es lo que permitía que
# un .html/.svg subido como "plano" se sirviera y ejecutara como tal). Lo que no está
# en esta tabla (no debería poder llegar, dado el whitelist de planos/bitácora) se
# sirve como octet-stream, que fuerza descarga en vez de ejecutar/renderizar.
_MEDIA_TYPES = {
    "pdf": "application/pdf",
    "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
    "webp": "image/webp", "gif": "image/gif",
    "dwg": "application/acad", "dxf": "application/dxf",
    "ogg": "audio/ogg", "oga": "audio/ogg", "mp3": "audio/mpeg", "mpeg": "audio/mpeg",
    "m4a": "audio/mp4", "mp4": "audio/mp4", "wav": "audio/wav", "webm": "audio/webm", "aac": "audio/aac",
}
# Sin uso de previsualización inline (CAD binario) → forzar descarga.
_FORCE_ATTACHMENT_EXTS = {"dwg", "dxf"}


async def _requester_tenant_id(request: "_Request") -> int | None:
    """Best-effort: si viene un Bearer JWT válido, devuelve su tenant_id. Si no hay
    header, o es inválido/expirado, devuelve None sin fallar — la ruta sigue siendo
    accesible por link directo (así es como <a href> y Twilio la consumen, no pueden
    mandar headers custom). Cuando SÍ hay un token, exigimos que su tenant coincida
    con el firmado en la URL — cierra el caso de una sesión válida de OTRO tenant
    reusando un link ajeno."""
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        return None
    from app.core.database import AsyncSessionLocal
    from app.core.security import decode_access_token
    try:
        payload = decode_access_token(auth.split(" ", 1)[1])
        user_id = int(payload["sub"])
    except Exception:
        return None
    try:
        async with AsyncSessionLocal() as session:
            from app.repositories.user import UserRepository
            user = await UserRepository(session).get(user_id)
            return user.tenant_id if user else None
    except Exception:
        return None


@fastapi_app.get("/uploads/{filename}", tags=["upload"])
async def serve_uploaded_file(
    request: _Request, filename: str,
    exp: str | None = None, sig: str | None = None, tid: str | None = None,
):
    from app.core.signing import requires_signature, verify_download

    safe = _Path(filename).name
    # Archivos sensibles (planos, audios): requieren firma válida (HMAC + expiración +
    # scope de tenant). Se valida ANTES de tocar el disco para no revelar existencia
    # sin autorización. Las imágenes (portadas/avatares) siguen siendo públicas.
    if requires_signature(safe):
        requester_tid = await _requester_tenant_id(request)
        if not verify_download(safe, tid, exp, sig, requester_tenant_id=requester_tid):
            raise _HTTPException(403, "Enlace inválido o expirado.")
    fp = _UPLOADS_DIR / safe
    if not fp.is_file():
        raise _HTTPException(404, "Archivo no encontrado.")

    ext = safe.rsplit(".", 1)[-1].lower() if "." in safe else ""
    media_type = _MEDIA_TYPES.get(ext, "application/octet-stream")
    headers = {}
    if ext in _FORCE_ATTACHMENT_EXTS or ext not in _MEDIA_TYPES:
        headers["Content-Disposition"] = f'attachment; filename="{safe}"'
    return _FileResponse(str(fp), media_type=media_type, headers=headers)


import logging as _logging
from fastapi.responses import JSONResponse as _JSONResponse
from sqlalchemy import text as _sql_text
from app.core.deps import DbSession as _DbSession

_logger = _logging.getLogger("constructa")


@fastapi_app.get("/health", tags=["health"])
async def health(db: _DbSession):
    """Liveness + readiness: verifica que la base de datos responde."""
    try:
        await db.execute(_sql_text("SELECT 1"))
        db_ok = True
    except Exception:
        _logger.exception("Health check: la base de datos no responde")
        db_ok = False
    return _JSONResponse(
        status_code=200 if db_ok else 503,
        content={"status": "ok" if db_ok else "degraded", "app": settings.APP_NAME, "db": "ok" if db_ok else "down"},
    )


@fastapi_app.exception_handler(Exception)
async def _unhandled_exception_handler(request: _Request, exc: Exception):
    """Última red ante errores inesperados: loguea con contexto y devuelve un 500 limpio
    (sin filtrar stack traces ni internals al cliente). Las HTTPException se manejan aparte."""
    _logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return _JSONResponse(status_code=500, content={"detail": "Error interno del servidor"})



# ── Top-level ASGI app: Socket.IO wraps FastAPI ────────────────────────────────
# uvicorn must run `app.main:app` (this variable).
app = socketio.ASGIApp(sio, other_asgi_app=fastapi_app)
