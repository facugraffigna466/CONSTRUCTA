"""Firma de URLs de descarga para archivos sensibles (planos, audios de bitácora).

Los `<img>`/`<audio>`/`<a href>` del navegador no pueden mandar el header
`Authorization`, así que los archivos sensibles no se pueden proteger con el bearer
de siempre. En su lugar se sirven con una **URL firmada** (HMAC-SHA256 + expiración)
en la query string, generada al leer por un endpoint ya autenticado y con scope de
tenant. La ruta pública `/uploads/{filename}` exige esa firma para todo lo que no sea
una imagen (portadas/avatares, de baja sensibilidad).

La firma incluye el `tenant_id` del recurso: la URL sigue siendo un "bearer" para
quien la tenga (inherente a este patrón — igual que un link de S3 presignado o de
Google Drive), pero ya no sirve para que una sesión válida de OTRO tenant la use con
su propio token — eso ahora da 403 en vez de 200. El TTL corto para web acota además
la ventana de exposición si un link se filtra (logs, capturas, WhatsApp reenviado).
"""
import hashlib
import hmac
import time
from pathlib import Path

from app.core.config import settings

# Extensiones consideradas públicas (imágenes de portada / avatares). El resto
# (pdf, dwg, ogg, mp3, …) requiere firma para servirse.
PUBLIC_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}

DEFAULT_TTL = 3600      # 1 hora — default genérico (bitácora, compatibilidad)
WEB_TTL = 15 * 60       # 15 min — links que abre la web app (ventana corta de fuga)
BOT_TTL = 48 * 3600     # 48 h — Twilio archiva el media unos días; necesita más margen

_ANON_TENANT = "anon"  # tenant_id de recursos sin tenant (legacy / sistema)


def _now() -> int:
    return int(time.time())


def _digest(name: str, tenant_id: int | str | None, exp: int) -> str:
    msg = f"{tenant_id if tenant_id is not None else _ANON_TENANT}:{name}:{exp}".encode()
    return hmac.new(settings.SECRET_KEY.encode(), msg, hashlib.sha256).hexdigest()


def requires_signature(name: str) -> bool:
    """True si el archivo NO es una imagen pública → debe servirse firmado."""
    return Path(name).suffix.lower() not in PUBLIC_IMAGE_EXTS


def sign_query(name: str, tenant_id: int | str | None, ttl: int = DEFAULT_TTL) -> str:
    """Query string firmada: `exp=<ts>&tid=<tenant>&sig=<hmac>` para un archivo."""
    exp = _now() + ttl
    tid = tenant_id if tenant_id is not None else _ANON_TENANT
    return f"exp={exp}&tid={tid}&sig={_digest(name, tenant_id, exp)}"


def signed_upload_path(name: str, tenant_id: int | str | None, ttl: int = DEFAULT_TTL) -> str:
    """Ruta relativa firmada: `/uploads/<name>?exp=..&tid=..&sig=..`.

    Relativa a propósito: el frontend le antepone su propia base de API (útil en
    dev, donde front y back están en orígenes distintos).
    """
    return f"/uploads/{name}?{sign_query(name, tenant_id, ttl)}"


def signed_upload_url(name: str, tenant_id: int | str | None, ttl: int = DEFAULT_TTL) -> str:
    """URL absoluta firmada usando `PUBLIC_BASE_URL` (para `<a href>` directos)."""
    base = (settings.PUBLIC_BASE_URL or "").rstrip("/")
    return f"{base}{signed_upload_path(name, tenant_id, ttl)}"


def verify_download(
    name: str, tenant_id: str | None, exp: str | None, sig: str | None,
    requester_tenant_id: int | str | None = None,
) -> bool:
    """Valida la firma, que no haya expirado, y — si quien pide el archivo está
    autenticado — que su tenant coincida con el que se firmó. Comparación en
    tiempo constante contra timing attacks."""
    if not exp or not sig or not tenant_id:
        return False
    try:
        exp_i = int(exp)
    except (TypeError, ValueError):
        return False
    if exp_i < _now():
        return False
    if not hmac.compare_digest(sig, _digest(name, tenant_id, exp_i)):
        return False
    if requester_tenant_id is not None and str(requester_tenant_id) != str(tenant_id):
        return False
    return True
