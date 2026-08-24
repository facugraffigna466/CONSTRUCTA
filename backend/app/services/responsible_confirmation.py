"""Envío del mensaje de bienvenida + gate de confirmación de un Responsible.

Rediseño identidad WhatsApp — parte C
(docs/roles-redesign/whatsapp-identidad-permisos.md).

**Decisión de alcance:** la confirmación es POR PERSONA, no por obra. Se
pide una única vez, la primera vez que un `Responsible` se conecta con el
sistema. Sumarlo al equipo de más obras después NO requiere volver a
confirmar. Ver §"Alcance de la confirmación" del reporte para el razonamiento
(fricción vs. estrictitud) y la opción alternativa que se descartó.

Este módulo expone una función pura `send_welcome_confirmation(...)` que:
  1. Envía el WhatsApp de bienvenida al responsable.
  2. Es idempotente: si el responsable ya está confirmado, no manda nada.
  3. Es fire-and-forget: cualquier error del cliente HTTP se atrapa y loguea,
     no bloquea al caller (crear un `Responsible` o sumarlo a un team NO debe
     fallar porque Twilio no responde).
"""
from __future__ import annotations

import logging

from app.integrations.twilio.client import send_whatsapp_message
from app.models.responsible import Responsible

logger = logging.getLogger(__name__)


def build_welcome_body(responsible: Responsible, obra_name: str | None = None) -> str:
    """Cuerpo del WhatsApp de bienvenida. Si se pasa `obra_name`, se
    contextualiza en esa obra (típico cuando el disparo viene desde
    `POST /obras/{id}/team`); si no, mensaje genérico (creación directa
    del responsible)."""
    nombre = (responsible.full_name or "").split(" ")[0] or "👷"
    if obra_name:
        return (
            f"Hola {nombre} 👷. Te agregaron al equipo de la obra *{obra_name}* "
            "en CONSTRUCTA (asistente de gestión de obras por WhatsApp).\n\n"
            "Respondé *SI* para confirmar tu acceso y empezar a usar el sistema."
        )
    return (
        f"Hola {nombre} 👷. Te registraron en CONSTRUCTA, el asistente de "
        "gestión de obras por WhatsApp.\n\n"
        "Respondé *SI* para confirmar tu acceso y empezar a usar el sistema."
    )


async def send_welcome_confirmation(
    responsible: Responsible, obra_name: str | None = None
) -> None:
    """Manda el WhatsApp de bienvenida SI corresponde.

    Corresponde cuando:
      - El responsable existe (es un objeto no-None).
      - Tiene `whatsapp_number` (siempre lo tiene por schema).
      - Y **NO** está confirmado todavía (`confirmed_at is None`).

    Si ya está confirmado, es un no-op — no queremos molestar al obrero
    que ya está usando el bot con un "confirmá tu acceso" cada vez que
    se lo agrega a una obra nueva. La confirmación es por-persona.

    Nunca lanza — cualquier error del cliente WhatsApp se loguea y se
    descarta. El caller no debe fallar por esto."""
    if responsible is None:
        return
    if responsible.confirmed_at is not None:
        return
    if not responsible.whatsapp_number:
        return
    try:
        await send_whatsapp_message(
            to_number=responsible.whatsapp_number,
            body=build_welcome_body(responsible, obra_name),
        )
    except Exception as exc:
        logger.warning(
            "welcome-confirmation WhatsApp to %s failed: %s",
            responsible.whatsapp_number, exc,
        )
