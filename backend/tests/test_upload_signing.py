"""Serving de archivos sensibles: /uploads exige firma (HMAC + expiración) para
todo lo que no sea una imagen. Cubre el P0 de "documentos servidos sin auth".
"""
import time

from app.core.signing import (
    _digest,
    requires_signature,
    sign_query,
    verify_download,
)

API_UPLOADS = "/uploads"


# ── Unit: la lógica de firma ────────────────────────────────────────────────────

def test_images_are_public_others_need_signature():
    assert requires_signature("plano.pdf") is True
    assert requires_signature("nota.ogg") is True
    assert requires_signature("plano.DWG") is True
    assert requires_signature("foto.jpg") is False
    assert requires_signature("portada.PNG") is False
    assert requires_signature("avatar.webp") is False


def test_sign_verify_roundtrip():
    q = sign_query("plano.pdf")
    exp = dict(kv.split("=") for kv in q.split("&"))
    assert verify_download("plano.pdf", exp["exp"], exp["sig"]) is True


def test_signature_rejects_tampering():
    q = sign_query("plano.pdf")
    parts = dict(kv.split("=") for kv in q.split("&"))
    # firma de OTRO archivo no sirve para este
    assert verify_download("otro.pdf", parts["exp"], parts["sig"]) is False
    # firma corrupta
    assert verify_download("plano.pdf", parts["exp"], parts["sig"][:-1] + "0") is False
    # sin firma
    assert verify_download("plano.pdf", None, None) is False


def test_expired_signature_is_rejected():
    past = int(time.time()) - 10
    sig = _digest("plano.pdf", past)
    assert verify_download("plano.pdf", str(past), sig) is False


# ── Ruta: GET /uploads/{filename} ───────────────────────────────────────────────

async def test_sensitive_file_without_signature_is_403(client):
    """Un plano/audio sin firma → 403 (aunque no exista: no revela existencia)."""
    r = await client.get(f"{API_UPLOADS}/plano-secreto.pdf")
    assert r.status_code == 403, f"Archivo sensible servido sin firma: {r.status_code}"


async def test_sensitive_file_with_valid_signature_passes_gate(client):
    """Con firma válida pasa el gate (404 porque el archivo no existe en el test)."""
    r = await client.get(f"{API_UPLOADS}/plano-secreto.pdf?{sign_query('plano-secreto.pdf')}")
    assert r.status_code == 404, f"Firma válida no aceptada: {r.status_code}"


async def test_sensitive_file_with_expired_signature_is_403(client):
    past = int(time.time()) - 10
    sig = _digest("plano-secreto.pdf", past)
    r = await client.get(f"{API_UPLOADS}/plano-secreto.pdf?exp={past}&sig={sig}")
    assert r.status_code == 403, f"Firma expirada aceptada: {r.status_code}"


async def test_image_is_served_without_signature(client):
    """Las imágenes (portadas/avatares) siguen siendo públicas → no piden firma
    (404 porque no existe el archivo, no 403)."""
    r = await client.get(f"{API_UPLOADS}/portada.jpg")
    assert r.status_code == 404, f"La imagen pidió firma inesperadamente: {r.status_code}"
