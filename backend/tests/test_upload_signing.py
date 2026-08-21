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
    q = sign_query("plano.pdf", tenant_id=7)
    parts = dict(kv.split("=") for kv in q.split("&"))
    assert verify_download("plano.pdf", parts["tid"], parts["exp"], parts["sig"]) is True


def test_signature_rejects_tampering():
    q = sign_query("plano.pdf", tenant_id=7)
    parts = dict(kv.split("=") for kv in q.split("&"))
    # firma de OTRO archivo no sirve para este
    assert verify_download("otro.pdf", parts["tid"], parts["exp"], parts["sig"]) is False
    # firma corrupta — cambiar el último char por uno GARANTIZADO distinto
    # (antes usaba "0" fijo → flaky ~1/16 cuando la firma ya terminaba en "0").
    last = parts["sig"][-1]
    bad_sig = parts["sig"][:-1] + ("1" if last != "1" else "2")
    assert verify_download("plano.pdf", parts["tid"], parts["exp"], bad_sig) is False
    # sin firma
    assert verify_download("plano.pdf", parts["tid"], None, None) is False
    # sin tenant_id (falta el "tid" en la query) — antes era imposible de expresar
    assert verify_download("plano.pdf", None, parts["exp"], parts["sig"]) is False


def test_signature_rejects_wrong_tenant():
    """El link firmado para el tenant 7 no debe validar como si fuera del tenant 9 —
    ni siquiera con exp/sig intactos: cambiar el tid invalida la firma entera."""
    q = sign_query("plano.pdf", tenant_id=7)
    parts = dict(kv.split("=") for kv in q.split("&"))
    assert verify_download("plano.pdf", "9", parts["exp"], parts["sig"]) is False


def test_signature_rejects_requester_from_other_tenant():
    """Con firma y tid intactos, si quien pide el archivo está autenticado con OTRO
    tenant (requester_tenant_id), debe rechazarse — cierra el bug de "cualquier
    token ajeno funciona igual". Sin requester_tenant_id (nadie autenticado, caso de
    <a href> normal) sigue pasando, que es el trade-off inherente a un link firmado."""
    q = sign_query("plano.pdf", tenant_id=7)
    parts = dict(kv.split("=") for kv in q.split("&"))
    assert verify_download("plano.pdf", parts["tid"], parts["exp"], parts["sig"], requester_tenant_id=9) is False
    assert verify_download("plano.pdf", parts["tid"], parts["exp"], parts["sig"], requester_tenant_id=7) is True
    assert verify_download("plano.pdf", parts["tid"], parts["exp"], parts["sig"]) is True


def test_expired_signature_is_rejected():
    past = int(time.time()) - 10
    sig = _digest("plano.pdf", 7, past)
    assert verify_download("plano.pdf", "7", str(past), sig) is False


# ── Ruta: GET /uploads/{filename} ───────────────────────────────────────────────

async def test_sensitive_file_without_signature_is_403(client):
    """Un plano/audio sin firma → 403 (aunque no exista: no revela existencia)."""
    r = await client.get(f"{API_UPLOADS}/plano-secreto.pdf")
    assert r.status_code == 403, f"Archivo sensible servido sin firma: {r.status_code}"


async def test_sensitive_file_with_valid_signature_passes_gate(client):
    """Con firma válida pasa el gate (404 porque el archivo no existe en el test)."""
    r = await client.get(f"{API_UPLOADS}/plano-secreto.pdf?{sign_query('plano-secreto.pdf', tenant_id=7)}")
    assert r.status_code == 404, f"Firma válida no aceptada: {r.status_code}"


async def test_sensitive_file_with_expired_signature_is_403(client):
    past = int(time.time()) - 10
    sig = _digest("plano-secreto.pdf", 7, past)
    r = await client.get(f"{API_UPLOADS}/plano-secreto.pdf?exp={past}&tid=7&sig={sig}")
    assert r.status_code == 403, f"Firma expirada aceptada: {r.status_code}"


async def test_sensitive_file_with_wrong_tenant_in_query_is_403(client):
    """La query trae un tid distinto al que se firmó → la firma no valida."""
    q = sign_query("plano-secreto.pdf", tenant_id=7)
    parts = dict(kv.split("=") for kv in q.split("&"))
    r = await client.get(f"{API_UPLOADS}/plano-secreto.pdf?exp={parts['exp']}&tid=9&sig={parts['sig']}")
    assert r.status_code == 403, f"tid manipulado aceptado: {r.status_code}"


async def test_image_is_served_without_signature(client):
    """Las imágenes (portadas/avatares) siguen siendo públicas → no piden firma
    (404 porque no existe el archivo, no 403)."""
    r = await client.get(f"{API_UPLOADS}/portada.jpg")
    assert r.status_code == 404, f"La imagen pidió firma inesperadamente: {r.status_code}"
