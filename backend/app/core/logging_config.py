"""Configuración de logging para CONSTRUCTA.

- En desarrollo (APP_DEBUG=True): formato legible por humanos, nivel DEBUG.
- En producción (APP_DEBUG=False): formato JSON estructurado, nivel INFO.
  Facilita la búsqueda en Datadog, CloudWatch, etc.

Usar en main.py antes de crear la app:
    from app.core.logging_config import setup_logging
    setup_logging()
"""
import json
import logging
import sys
from datetime import datetime, timezone


class _JsonFormatter(logging.Formatter):
    """Formatea cada log record como una línea JSON."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        if record.stack_info:
            payload["stack"] = self.formatStack(record.stack_info)
        return json.dumps(payload, ensure_ascii=False)


def setup_logging(debug: bool = False) -> None:
    """Configura el logging raíz. Llamar una sola vez al arrancar la app."""
    level = logging.DEBUG if debug else logging.INFO
    handler = logging.StreamHandler(sys.stdout)

    if debug:
        handler.setFormatter(
            logging.Formatter(
                fmt="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
                datefmt="%H:%M:%S",
            )
        )
    else:
        handler.setFormatter(_JsonFormatter())

    root = logging.getLogger()
    root.setLevel(level)
    root.handlers.clear()
    root.addHandler(handler)

    # Silenciar loggers ruidosos de librerías
    for noisy in ("uvicorn.access", "apscheduler.executors.default"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def setup_sentry(dsn: str, app_name: str, debug: bool) -> None:
    """Inicializa Sentry si hay DSN configurado. No-op si dsn está vacío."""
    if not dsn:
        return
    try:
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastApiIntegration
        from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration

        sentry_sdk.init(
            dsn=dsn,
            environment="development" if debug else "production",
            traces_sample_rate=0.2,   # 20% de requests trackeados
            profiles_sample_rate=0.1,
            integrations=[FastApiIntegration(), SqlalchemyIntegration()],
            send_default_pii=False,    # No enviar datos personales automáticamente
        )
        logging.getLogger("constructa").info("Sentry inicializado (env=%s)", "development" if debug else "production")
    except ImportError:
        logging.getLogger("constructa").warning(
            "sentry-sdk no instalado — ignorando SENTRY_DSN. "
            "Instalá con: pip install sentry-sdk[fastapi]"
        )
