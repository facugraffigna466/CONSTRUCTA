"""Firma de URLs de descarga para archivos sensibles (planos, audios de bitácora).

Los `<img>`/`<audio>`/`<a href>` del navegador no pueden mandar el header
`Authorization`, así que los archivos sensibles no se pueden proteger con el bearer
de siempre. En su lugar se sirven con una **URL firmada** (HMAC-SHA256 + expiración)
en la query string, generada al leer por un endpoint ya autenticado y con scope de
tenant. La ruta pública `/uploads/{filename}` exige esa firma para todo lo que no sea
una imagen (portadas/avatares, de baja sensibilidad).
"""
import hashlib
import hmac
import time
from pathlib import Path

from app.core.config import settings

# Extensiones consideradas públicas (imágenes de portada / avatares). El resto
# (pdf, dwg, ogg, mp3, …) requiere firma para servirse.
PUBLIC_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}

DEFAULT_TTL = 3600  # segundos (1 hora)


def _now() -> int:
    return int(time.time())


def _digest(name: str, exp: int) -> str:
    msg = f"{name}:{exp}".encode()
    return hmac.new(settings.SECRET_KEY.encode(), msg, hashlib.sha256).hexdigest()


def requires_signature(name: str) -> bool:
    """True si el archivo NO es una imagen pública → debe servirse firmado."""
    return Path(name).suffix.lower() not in PUBLIC_IMAGE_EXTS


def sign_query(name: str, ttl: int = DEFAULT_TTL) -> str:
    """Query string firmada: `exp=<ts>&sig=<hmac>` para un nombre de archivo."""
    exp = _now() + ttl
    return f"exp={exp}&sig={_digest(name, exp)}"


def signed_upload_path(name: str, ttl: int = DEFAULT_TTL) -> str:
    """Ruta relativa firmada: `/uploads/<name>?exp=..&sig=..`.

    Relativa a propósito: el frontend le antepone su propia base de API (útil en
    dev, donde front y back están en orígenes distintos).
    """
    return f"/uploads/{name}?{sign_query(name, ttl)}"


def signed_upload_url(name: str, ttl: int = DEFAULT_TTL) -> str:
    """URL absoluta firmada usando `PUBLIC_BASE_URL` (para `<a href>` directos)."""
    base = (settings.PUBLIC_BASE_URL or "").rstrip("/")
    return f"{base}{signed_upload_path(name, ttl)}"


def verify_download(name: str, exp: str | None, sig: str | None) -> bool:
    """Valida la firma y que no haya expirado. Comparación en tiempo constante."""
    if not exp or not sig:
        return False
    try:
        exp_i = int(exp)
    except (TypeError, ValueError):
        return False
    if exp_i < _now():
        return False
    return hmac.compare_digest(sig, _digest(name, exp_i))
