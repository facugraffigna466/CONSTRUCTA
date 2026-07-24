"""Rate limiting simple en memoria (ventana deslizante) por IP.

Pensado para endpoints sensibles a fuerza bruta / abuso (login, recuperación de
contraseña). Es **por proceso**: con múltiples workers cada uno tiene su propia
cuenta (misma limitación que la presencia en memoria). Para producción a escala
conviene un backend compartido (Redis); esto ya sube la barra frente al ataque básico.
"""
import time
from collections import defaultdict

from fastapi import HTTPException, Request, status

# key -> lista de timestamps (segundos) de los hits recientes
_hits: dict[str, list[float]] = defaultdict(list)


def _client_ip(request: Request) -> str:
    # Respeta X-Forwarded-For (primer valor) si la app está detrás de un proxy.
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def rate_limit(bucket: str, max_hits: int, window_secs: int):
    """Devuelve una dependencia FastAPI que limita a `max_hits` por `window_secs` por IP."""

    async def dependency(request: Request) -> None:
        key = f"{bucket}:{_client_ip(request)}"
        now = time.time()
        cutoff = now - window_secs
        hits = _hits[key]
        # Descarta los hits fuera de la ventana.
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

    return dependency
