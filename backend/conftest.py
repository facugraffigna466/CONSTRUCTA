"""Infra de tests: SQLite async en memoria + override de get_db + cliente httpx.

Los modelos no usan tipos PG-específicos, así que corren en SQLite. Se usa
StaticPool para compartir la misma conexión en memoria entre sesiones.
"""
import os

# DATABASE_URL apunta a un Postgres dummy: el engine de la app se crea lazy (no
# conecta) y NUNCA se usa en tests — el override de get_db usa el engine SQLite de abajo.
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost/test")
os.environ.setdefault("SECRET_KEY", "test-secret-key-para-tests")

import tempfile

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import Base, get_db
from app.main import fastapi_app  # noqa: E402  (registra modelos + rutas)

# Motor de test: SQLite basado en ARCHIVO (permite conexiones concurrentes — la
# sesión de setup y la del endpoint son conexiones distintas, sin deadlock).
_DB_FILE = os.path.join(tempfile.gettempdir(), "constructa_test.db")
if os.path.exists(_DB_FILE):
    os.remove(_DB_FILE)
test_engine = create_async_engine(f"sqlite+aiosqlite:///{_DB_FILE}")
TestSession = async_sessionmaker(test_engine, expire_on_commit=False, class_=AsyncSession)


async def _override_get_db():
    async with TestSession() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


fastapi_app.dependency_overrides[get_db] = _override_get_db


@pytest_asyncio.fixture
async def db():
    """Sesión de test con esquema fresco por test."""
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with TestSession() as session:
        yield session
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest_asyncio.fixture
async def client():
    transport = ASGITransport(app=fastapi_app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.fixture(autouse=True)
def _reset_rate_limit():
    """Limpia el estado del rate limiter (in-memory) antes de cada test para aislarlos."""
    from app.core.rate_limit import _hits
    _hits.clear()
    yield
