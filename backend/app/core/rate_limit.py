"""Rate limiting simple en memoria (ventana deslizante).

Dos sabores:
- rate_limit()      → por IP, para endpoints HTTP (login, forgot-password, etc.)
- check_wa_limit()  → por número de WhatsApp, llamado inline en el webhook de Twilio.

Es **por proceso**: con múltiples workers cada uno tiene su propia cuenta.
Para producción a escala conviene un backend compartido (Redis).
"""
import logging
import time
from collections import defaultdict

from fastapi import HTTPException, Request, status

logger = logging.getLogger(__name__)

# key -> lista de timestamps (segundos) de los hits recientes
_hits: dict[str, list[float]] = defaultdict(list)

# Límite del webhook de WhatsApp: 10 mensajes por número por minuto.
_WA_MAX_HITS = 10
_WA_WINDOW_SECS = 60


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _check(bucket: str, key_value: str, max_hits: int, window_secs: int) -> None:
    """Núcleo del rate-limit: registra el hit y lanza 429 si se supera el límite."""
    key = f"{bucket}:{key_value}"
    now = time.time()
    cutoff = now - window_secs
    hits = _hits[key]
    while hits and hits[0] < cutoff:
        hits.pop(0)
    if len(hits) >= max_hits:
        retry = int(window_secs - (now - hits[0])) + 1
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Demasiados intentos. Probá de nuevo en unos minutos.",
            headers={"Retry-After": str(max(retry, 1))},
        )
    hits.append(now)


def rate_limit(bucket: str, max_hits: int, window_secs: int):
    """Devuelve una dependencia FastAPI que limita a `max_hits` por `window_secs` por IP."""

    async def dependency(request: Request) -> None:
        _check(bucket, _client_ip(request), max_hits, window_secs)

    return dependency


def check_wa_limit(from_number: str) -> None:
    """Verifica el rate-limit para un número de WhatsApp entrante.

    Llamar inline en el webhook tras extraer el campo `From` del payload de Twilio.
    Lanza HTTP 429 si el número supera _WA_MAX_HITS mensajes en _WA_WINDOW_SECS segundos.
    """
    if not from_number:
        return
    try:
        _check("wa", from_number, _WA_MAX_HITS, _WA_WINDOW_SECS)
    except HTTPException:
        logger.warning("WhatsApp rate-limit superado para %s", from_number)
        raise
