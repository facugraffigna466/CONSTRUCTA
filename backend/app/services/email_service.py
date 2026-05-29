"""
Email service — sends transactional emails via Brevo (brevo.com).

Requires in .env:
  BREVO_API_KEY=xkeysib-...
  BREVO_SENDER_EMAIL=tu@email.com   (must be verified in Brevo dashboard)
  BREVO_SENDER_NAME=Constructa
"""
import logging

import requests

from app.core.config import settings

logger = logging.getLogger(__name__)

BREVO_URL = "https://api.brevo.com/v3/smtp/email"


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


async def send_invite_email(to_email: str, invite_url: str, role: str) -> None:
    if not settings.BREVO_API_KEY:
        logger.warning("BREVO_API_KEY not configured — skipping email send")
        return

    role_label = "Administrador" if role == "admin" else "Colaborador"

    payload = {
        "sender": {
            "name": settings.BREVO_SENDER_NAME,
            "email": settings.BREVO_SENDER_EMAIL,
        },
        "to": [{"email": to_email}],
        "subject": "Te invitaron a Constructa",
        "htmlContent": _build_invite_html(invite_url, role),
        "textContent": (
            f"Fuiste invitado a Constructa como {role_label}.\n\n"
            f"Aceptá la invitación en: {invite_url}\n\n"
            "Este link expira en 72 horas."
        ),
    }

    try:
        response = requests.post(
            BREVO_URL,
            json=payload,
            headers={
                "api-key": settings.BREVO_API_KEY,
                "Content-Type": "application/json",
            },
            timeout=10,
        )
        response.raise_for_status()
        logger.info("Invite email sent to %s via Brevo (messageId=%s)", to_email, response.json().get("messageId"))
    except requests.HTTPError as exc:
        logger.error("Brevo API error sending to %s: %s — %s", to_email, exc, exc.response.text)
    except Exception as exc:
        logger.error("Failed to send invite email to %s: %s", to_email, exc)
