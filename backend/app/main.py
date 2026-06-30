from contextlib import asynccontextmanager

import socketio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import admin as admin_router
from app.api.routes import alerts, auth, events, notifications, obras, presence, responsibles, tasks, uploads, users, webhooks
from app.api.routes import settings as settings_router
from app.api.routes import calendar as calendar_router
from app.api.routes import imports as imports_router
from app.api.routes import exports as exports_router
from app.api.routes import critical_path as critical_path_router
from app.api.routes import baseline as baseline_router
from app.api.routes import obra_team as obra_team_router
from app.api.routes import suppliers as suppliers_router
from app.api.routes import task_materials as task_materials_router
from app.api.routes import purchase_orders as purchase_orders_router
from app.api.routes import bitacora as bitacora_router
from app.api.routes import budgets as budgets_router
from app.api.routes import planos as planos_router
from app.api.routes import solicitudes as solicitudes_router
from app.core.config import settings
from app.core.scheduler import start_scheduler, stop_scheduler
from app.core.socket_manager import sio


@asynccontextmanager
async def lifespan(_: FastAPI):
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
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
    ],
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
fastapi_app.include_router(events.router, prefix=API_PREFIX)
fastapi_app.include_router(uploads.router, prefix=API_PREFIX)
fastapi_app.include_router(presence.router, prefix=API_PREFIX)
fastapi_app.include_router(calendar_router.router, prefix=API_PREFIX)
fastapi_app.include_router(imports_router.router, prefix=API_PREFIX)
fastapi_app.include_router(exports_router.router, prefix=API_PREFIX)
fastapi_app.include_router(critical_path_router.router, prefix=API_PREFIX)
fastapi_app.include_router(baseline_router.router, prefix=API_PREFIX)
fastapi_app.include_router(obra_team_router.router, prefix=API_PREFIX)
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
from fastapi import HTTPException as _HTTPException
from fastapi.responses import FileResponse as _FileResponse

_UPLOADS_DIR = _Path(__file__).parent.parent / "uploads"


@fastapi_app.get("/uploads/{filename}", tags=["upload"])
async def serve_uploaded_file(filename: str):
    safe = _Path(filename).name
    fp = _UPLOADS_DIR / safe
    if not fp.is_file():
        raise _HTTPException(404, "Archivo no encontrado.")
    return _FileResponse(str(fp))


@fastapi_app.get("/health", tags=["health"])
async def health():
    return {"status": "ok", "app": settings.APP_NAME}



# ── Top-level ASGI app: Socket.IO wraps FastAPI ────────────────────────────────
# uvicorn must run `app.main:app` (this variable).
app = socketio.ASGIApp(sio, other_asgi_app=fastapi_app)
