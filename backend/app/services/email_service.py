"""
Email service — sends transactional emails via Brevo (brevo.com).

Requires in .env:
  BREVO_API_KEY=xkeysib-...
  BREVO_SENDER_EMAIL=tu@email.com   (must be verified in Brevo dashboard)
  BREVO_SENDER_NAME=Constructa

Notas de diseño (Fase 6 del rediseño de roles, sub-parte emails):

* **Cliente HTTP async real** (`httpx.AsyncClient`) en vez de `requests.post`
  sync — el envío ya NO bloquea el event loop del backend. Se resuelve la
  degradación de throughput documentada en `docs/auditoria/01-login-usuarios-planes.md`
  §8.10 hallazgo E4.

* **Retry con backoff exponencial** (`tenacity`) sobre fallos transitorios:
  429 (rate limit de Brevo), 503 (servicio caído), timeouts de conexión.
  3 intentos, esperas 1s → 2s → 4s. Los errores NO transitorios (400, 401,
  403, 422) NO se reintentan — son problemas de payload/config que reintentar
  no arregla y solo suma latencia.

* **Degradación silenciosa sin `BREVO_API_KEY`** — se mantiene el
  comportamiento previo: log WARNING + devolver `False`/`None`. Habilitado
  para dev sin credenciales; no bloquea el endpoint que invoca el envío.
"""
from __future__ import annotations

import logging

import httpx
from tenacity import (
    AsyncRetrying,
    RetryError,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from app.core.config import settings

logger = logging.getLogger(__name__)

BREVO_URL = "https://api.brevo.com/v3/smtp/email"
_HTTP_TIMEOUT = 10.0  # segundos por request
_MAX_ATTEMPTS = 3     # intentos totales (1 original + 2 retries)


class _RetryableEmailError(Exception):
    """Marcador interno para que tenacity reintente sobre respuestas 429/503
    o timeouts de conexión. Los demás errores (400/401/422) suben sin retry."""


async def _post_brevo(payload: dict) -> httpx.Response:
    """Ejecuta un POST único a Brevo. Levanta _RetryableEmailError si el
    problema es transitorio; deja subir cualquier otra excepción tal cual."""
    headers = {
        "api-key": settings.BREVO_API_KEY,
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
        try:
            response = await client.post(BREVO_URL, json=payload, headers=headers)
        except (httpx.TimeoutException, httpx.NetworkError) as exc:
            raise _RetryableEmailError(f"transport error: {exc}") from exc
    if response.status_code in (429, 503):
        raise _RetryableEmailError(
            f"brevo transient error {response.status_code}: {response.text[:200]}"
        )
    return response


async def _send_via_brevo(payload: dict, to_email: str) -> bool:
    """Envío con retry. Devuelve True si Brevo aceptó (2xx); False si:
      - la API key no está configurada;
      - Brevo devolvió un error NO transitorio (4xx distinto de 429);
      - se agotaron los retries sobre errores transitorios.
    Nunca levanta (fire-and-forget para el caller)."""
    if not settings.BREVO_API_KEY:
        logger.warning("BREVO_API_KEY not configured — skipping email to %s", to_email)
        return False

    try:
        async for attempt in AsyncRetrying(
            stop=stop_after_attempt(_MAX_ATTEMPTS),
            wait=wait_exponential(multiplier=1, min=1, max=8),
            retry=retry_if_exception_type(_RetryableEmailError),
            reraise=True,
        ):
            with attempt:
                response = await _post_brevo(payload)
    except _RetryableEmailError as exc:
        # Agotamos los retries en un error transitorio → log y devolver False.
        logger.error(
            "Brevo send to %s failed after %d attempts (transient): %s",
            to_email, _MAX_ATTEMPTS, exc,
        )
        return False
    except RetryError as exc:  # defensivo — tenacity con reraise=True no debería llegar acá
        logger.error("Brevo retry loop exhausted for %s: %s", to_email, exc)
        return False
    except Exception as exc:
        logger.error("Unexpected error sending email to %s: %s", to_email, exc)
        return False

    # Fuera del retry: si Brevo respondió con error no transitorio (400/401/422),
    # loggeamos y devolvemos False. Reintentar no lo va a arreglar.
    if response.status_code >= 400:
        logger.error(
            "Brevo API error sending to %s: HTTP %d — %s",
            to_email, response.status_code, response.text[:300],
        )
        return False

    try:
        msg_id = response.json().get("messageId")
    except Exception:
        msg_id = None
    logger.info("Email sent to %s via Brevo (messageId=%s)", to_email, msg_id)
    return True


# ─────────────────────────────────────────────────────────────────────
#  Templates HTML
# ─────────────────────────────────────────────────────────────────────


def _build_invite_html(invite_url: str, role: str) -> str:
    role_label = "Administrador" if role == "admin" else "Colaborador"
    return f"""
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#F5F3EF;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F3EF;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#1B2A34 0%,#243642 100%);padding:32px 40px;">
              <div style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-0.02em;">Constructa</div>
              <div style="font-size:12px;color:#8FA8B5;margin-top:4px;letter-spacing:0.06em;text-transform:uppercase;">
                Plataforma de gestión de obras
              </div>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 40px;">
              <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#FF6B35;text-transform:uppercase;letter-spacing:0.1em;">
                Invitación recibida
              </p>
              <h1 style="margin:0 0 16px;font-size:24px;font-weight:800;color:#1A2329;line-height:1.2;">
                Te invitaron a unirte al equipo
              </h1>
              <p style="margin:0 0 24px;font-size:15px;color:#5B6770;line-height:1.6;">
                Fuiste invitado a Constructa con el rol de
                <strong style="color:#1A2329;">{role_label}</strong>.
                Hacé click en el botón para crear tu cuenta y empezar a trabajar.
              </p>

              <div style="text-align:center;margin:32px 0;">
                <a href="{invite_url}"
                   style="display:inline-block;padding:14px 36px;background:#FF6B35;color:#ffffff;font-size:15px;font-weight:700;border-radius:10px;text-decoration:none;box-shadow:0 6px 20px -4px rgba(255,107,53,0.45);">
                  Aceptar invitación
                </a>
              </div>

              <div style="background:#F4F5F4;border-radius:10px;padding:16px 20px;margin-top:8px;">
                <p style="margin:0;font-size:12.5px;color:#8E97A0;line-height:1.6;">
                  Si el botón no funciona, copiá este link:<br>
                  <a href="{invite_url}" style="color:#FF6B35;word-break:break-all;">{invite_url}</a>
                </p>
                <p style="margin:10px 0 0;font-size:12px;color:#B0B8BF;">Este link expira en 72 horas.</p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px;border-top:1px solid #E6E7E5;">
              <p style="margin:0;font-size:11.5px;color:#B0B8BF;text-align:center;">
                Recibiste este email porque alguien te invitó a Constructa.<br>
                Si no esperabas esta invitación, podés ignorar este mensaje.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
"""


def _build_reset_html(reset_url: str) -> str:
    return f"""\
<div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1A2329;">
  <h1 style="font-size:20px;margin:0 0 8px;">Recuperá tu contraseña</h1>
  <p style="font-size:14px;line-height:1.5;color:#5B6770;margin:0 0 20px;">
    Recibimos un pedido para restablecer la contraseña de tu cuenta de Constructa.
    Hacé clic en el botón para elegir una nueva. Si no fuiste vos, ignorá este mensaje.
  </p>
  <a href="{reset_url}" style="display:inline-block;background:#FF6B35;color:#fff;text-decoration:none;
     font-weight:600;padding:12px 22px;border-radius:10px;font-size:14px;">Restablecer contraseña</a>
  <p style="font-size:12px;color:#8E97A0;margin:20px 0 0;">
    O copiá este enlace: <a href="{reset_url}" style="color:#FF6B35;word-break:break-all;">{reset_url}</a><br>
    El enlace expira en 1 hora.
  </p>
</div>"""


def _build_verification_html(verify_url: str) -> str:
    return f"""\
<div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1A2329;">
  <h1 style="font-size:20px;margin:0 0 8px;">Confirmá tu email</h1>
  <p style="font-size:14px;line-height:1.5;color:#5B6770;margin:0 0 20px;">
    ¡Bienvenido a Constructa! Confirmá tu dirección de email para activar del todo tu cuenta.
  </p>
  <a href="{verify_url}" style="display:inline-block;background:#FF6B35;color:#fff;text-decoration:none;
     font-weight:600;padding:12px 22px;border-radius:10px;font-size:14px;">Confirmar mi email</a>
  <p style="font-size:12px;color:#8E97A0;margin:20px 0 0;">
    O copiá este enlace: <a href="{verify_url}" style="color:#FF6B35;word-break:break-all;">{verify_url}</a><br>
    El enlace expira en 48 horas.
  </p>
</div>"""


def _build_plan_warning_html(
    admin_name: str, tenant_name: str, resource_label: str,
    current: int, limit: int, plan_label: str, cta_url: str,
) -> str:
    percent = int(round(100 * current / limit)) if limit else 0
    return f"""\
<div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1A2329;">
  <h1 style="font-size:20px;margin:0 0 8px;">Te estás acercando al límite de tu plan</h1>
  <p style="font-size:14px;line-height:1.5;color:#5B6770;margin:0 0 12px;">
    Hola {admin_name}, tu empresa <strong>{tenant_name}</strong> está usando
    <strong>{current} de {limit} {resource_label}</strong> disponibles en el plan <strong>{plan_label}</strong>
    ({percent}%).
  </p>
  <p style="font-size:14px;line-height:1.5;color:#5B6770;margin:0 0 20px;">
    Cuando llegues al límite, no vas a poder crear {resource_label} nuevos hasta actualizar el plan.
    Te avisamos con tiempo para que no te frene la operación.
  </p>
  <a href="{cta_url}" style="display:inline-block;background:#FF6B35;color:#fff;text-decoration:none;
     font-weight:600;padding:12px 22px;border-radius:10px;font-size:14px;">Ver planes disponibles</a>
  <p style="font-size:12px;color:#8E97A0;margin:20px 0 0;">
    Recibís este aviso porque sos el administrador de la empresa.
    Solo enviamos un email así cada 7 días para no ser insistentes.
  </p>
</div>"""


# ─────────────────────────────────────────────────────────────────────
#  API pública
# ─────────────────────────────────────────────────────────────────────


async def send_invite_email(to_email: str, invite_url: str, role: str) -> bool:
    role_label = "Administrador" if role == "admin" else "Colaborador"
    payload = {
        "sender": {"name": settings.BREVO_SENDER_NAME, "email": settings.BREVO_SENDER_EMAIL},
        "to": [{"email": to_email}],
        "subject": "Te invitaron a Constructa",
        "htmlContent": _build_invite_html(invite_url, role),
        "textContent": (
            f"Fuiste invitado a Constructa como {role_label}.\n\n"
            f"Aceptá la invitación en: {invite_url}\n\n"
            "Este link expira en 72 horas."
        ),
    }
    return await _send_via_brevo(payload, to_email)


async def send_email(to_email: str, subject: str, html: str, text: str = "") -> bool:
    """Envío genérico vía Brevo. Devuelve True si salió, False si no está
    configurado o falló (sin explotar en ambos casos)."""
    payload = {
        "sender": {"name": settings.BREVO_SENDER_NAME, "email": settings.BREVO_SENDER_EMAIL},
        "to": [{"email": to_email}],
        "subject": subject,
        "htmlContent": html,
        "textContent": text or subject,
    }
    return await _send_via_brevo(payload, to_email)


async def send_password_reset_email(to_email: str, reset_url: str) -> bool:
    return await send_email(
        to_email,
        subject="Recuperá tu contraseña — Constructa",
        html=_build_reset_html(reset_url),
        text=f"Restablecé tu contraseña de Constructa en: {reset_url}\n\nEl enlace expira en 1 hora.",
    )


async def send_verification_email(to_email: str, verify_url: str) -> bool:
    return await send_email(
        to_email,
        subject="Confirmá tu email — Constructa",
        html=_build_verification_html(verify_url),
        text=f"Confirmá tu email de Constructa en: {verify_url}\n\nEl enlace expira en 48 horas.",
    )


async def send_plan_warning_email(
    to_email: str,
    admin_name: str,
    tenant_name: str,
    resource_label: str,
    current: int,
    limit: int,
    plan_label: str,
) -> bool:
    """Aviso preventivo al admin de que su tenant está cerca del límite del plan.
    `resource_label` es el nombre humano del recurso ('obras', 'usuarios',
    'tareas por obra'). El CTA apunta al frontend a la pantalla de planes."""
    cta_url = f"{settings.FRONTEND_URL.rstrip('/')}/configuracion#plan"
    subject = f"Estás usando {current} de {limit} {resource_label} — Constructa"
    text = (
        f"Hola {admin_name},\n\n"
        f"Tu empresa {tenant_name} está usando {current} de {limit} {resource_label} "
        f"en el plan {plan_label}.\n\n"
        f"Cuando llegues al límite, no vas a poder crear {resource_label} nuevos hasta "
        f"actualizar el plan. Podés ver los planes disponibles en:\n{cta_url}\n\n"
        "— Equipo Constructa"
    )
    return await send_email(
        to_email,
        subject=subject,
        html=_build_plan_warning_html(
            admin_name, tenant_name, resource_label, current, limit, plan_label, cta_url,
        ),
        text=text,
    )
