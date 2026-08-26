import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
import jwt

from app.core.config import settings


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def create_access_token(
    subject: Any, tenant_id: int | None = None, expires_delta: timedelta | None = None
) -> str:
    """`tenant_id` identifica la membership activa de esta sesión (Fase 3
    rediseño multi-tenant). Se omite (None) en los pocos call sites que
    todavía no conocen el tenant explícito — `get_current_user` cae de
    vuelta a `User.tenant_id` (última empresa activa) en ese caso, ver
    deps.py."""
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    payload: dict[str, Any] = {"sub": str(subject), "exp": expire}
    if tenant_id is not None:
        payload["tenant_id"] = tenant_id
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def create_pre_auth_token(subject: Any) -> str:
    """Token de vida corta emitido cuando el login resuelve más de una
    empresa para el mismo email: no sirve como Bearer de sesión (deps.py lo
    rechaza), solo para canjear en `/auth/select-tenant`."""
    expire = datetime.now(timezone.utc) + timedelta(minutes=5)
    return jwt.encode(
        {"sub": str(subject), "exp": expire, "typ": "pre_auth"},
        settings.SECRET_KEY,
        algorithm=settings.ALGORITHM,
    )


def decode_access_token(token: str) -> dict:
    return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])


def create_refresh_token() -> tuple[str, datetime]:
    """Devuelve (token_opaco, expires_at). El token se almacena en DB, no es un JWT."""
    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    return token, expires_at
