#!/bin/bash
set -e

echo "[entrypoint] Aplicando migraciones (alembic upgrade head)..."
attempt=0
until alembic upgrade head; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo "[entrypoint] La base de datos no respondió tras 30 intentos. Abortando." >&2
    exit 1
  fi
  echo "[entrypoint] Migración falló (intento $attempt/30) — reintentando en 2s..."
  sleep 2
done

echo "[entrypoint] Migraciones OK. Iniciando servidor en el puerto ${PORT:-8000}..."
# Un solo worker a propósito: APScheduler corre in-process (app/core/scheduler.py)
# y con >1 worker cada uno dispararía los mismos jobs por duplicado.
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
