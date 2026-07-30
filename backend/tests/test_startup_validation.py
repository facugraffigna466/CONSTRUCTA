"""Validación de secretos al arranque: secret débil → sys.exit(1); secreto fuerte → ok."""
import sys
from unittest.mock import patch

import pytest

from app.core.config import Settings, validate_startup


def _make_settings(**overrides) -> Settings:
    base = dict(
        SECRET_KEY="x" * 32,
        DATABASE_URL="sqlite+aiosqlite:///:memory:",
        APP_DEBUG=False,
    )
    base.update(overrides)
    return Settings(**base)


def test_secret_key_fuerte_no_falla():
    s = _make_settings(SECRET_KEY="a" * 32, APP_DEBUG=True)
    # No debe lanzar ni salir
    validate_startup(s)


def test_secret_key_debil_en_prod_llama_exit():
    s = _make_settings(SECRET_KEY="changeme", APP_DEBUG=False)
    with pytest.raises(SystemExit) as exc:
        validate_startup(s)
    assert exc.value.code == 1


def test_secret_key_corta_en_prod_llama_exit():
    s = _make_settings(SECRET_KEY="corta", APP_DEBUG=False)
    with pytest.raises(SystemExit) as exc:
        validate_startup(s)
    assert exc.value.code == 1


def test_secret_key_debil_en_debug_solo_advierte(capsys):
    s = _make_settings(SECRET_KEY="changeme", APP_DEBUG=True)
    # En debug no debe salir, solo advertir
    validate_startup(s)
    captured = capsys.readouterr()
    assert "débil" in captured.err


def test_allowed_origins_list_parsea_correctamente():
    s = _make_settings(
        SECRET_KEY="a" * 32,
        ALLOWED_ORIGINS="https://app.example.com,https://staging.example.com",
    )
    assert s.allowed_origins_list == ["https://app.example.com", "https://staging.example.com"]


def test_allowed_origins_list_default_incluye_localhost():
    s = _make_settings(SECRET_KEY="a" * 32)
    origins = s.allowed_origins_list
    assert any("localhost" in o for o in origins)
