import logging
from datetime import datetime, timezone, timedelta
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.twilio.client import send_whatsapp_message
from app.models.message import Message, MessageDirection, MessageProcessingStatus, MessageType
from app.repositories.message import MessageRepository
from app.repositories.responsible import ResponsibleRepository
from app.repositories.settings import SettingsRepository
from app.schemas.message import MessageCreateInternal, TwilioInboundPayload
from app.services.conversation_service import ConversationService

logger = logging.getLogger(__name__)

# Argentina standard time (UTC-3). The send-hour window configured by the
# user is interpreted in this offset so that "08:00–20:00" means local time.
_AR_OFFSET = timedelta(hours=-3)


def _current_ar_hour() -> int:
    return (datetime.now(timezone.utc) + _AR_OFFSET).hour


def _within_send_window(hour_from: int, hour_to: int) -> bool:
    """Return True if the current Argentina local hour is inside [hour_from, hour_to)."""
    h = _current_ar_hour()
    if hour_from <= hour_to:
        return hour_from <= h < hour_to
    # Overnight window (e.g. 22–06)
    return h >= hour_from or h < hour_to


class MessageService:
    def __init__(self, session: AsyncSession) -> None:
        self.db = session
        self.msg_repo = MessageRepository(session)
        self.resp_repo = ResponsibleRepository(session)
        self.settings_repo = SettingsRepository(session)

    async def process_inbound(
        self, payload: TwilioInboundPayload, raw_params: dict[str, Any]
    ) -> Message:
        """
        Full inbound flow:
          1. Idempotency check
          2. Identify responsible by WhatsApp number
          3. Save inbound message record
          4. Enforce chatbot_enabled and send-hour window from SystemSettings
          5. Route through ConversationService state machine
          6. Update message with result task_id
          7. Send reply via Twilio
          8. Save outbound message record
        """
        # ── 1. Idempotency ─────────────────────────────────────────────────────
        existing = await self.msg_repo.get_by_external_id(payload.MessageSid)
        if existing:
            logger.info("Duplicate webhook for MessageSid=%s — skipping", payload.MessageSid)
            return existing

        # ── 2. Identify responsible ────────────────────────────────────────────
        responsible = await self.resp_repo.get_by_whatsapp(payload.from_number)

        # ── 3. Save inbound message ────────────────────────────────────────────
        inbound = await self._save_message(
            MessageCreateInternal(
                direction=MessageDirection.INBOUND,
                message_type=payload.detected_type,
                from_number=payload.from_number,
                to_number=payload.to_number,
                body=payload.Body,
                media_url=payload.MediaUrl0,
                responsible_id=responsible.id if responsible else None,
                task_id=None,
                external_message_id=payload.MessageSid,
                raw_payload=raw_params,
                processing_status=MessageProcessingStatus.PENDING,
            )
        )

        # ── 4. Settings checks ─────────────────────────────────────────────────
        if responsible is None:
            reply = (
                "Este número no está registrado en el sistema CONSTRUCTA. "
                "Comunicáte con el encargado de tu obra."
            )
            task_id = None

        else:
            cfg = await self.settings_repo.get_for_responsible(responsible.id)

            if not cfg.chatbot_enabled:
                logger.info(
                    "Chatbot disabled — ignoring message from %s", payload.from_number
                )
                await self.msg_repo.update_fields(
                    inbound.id, processing_status=MessageProcessingStatus.PROCESSED
                )
                return inbound  # no reply sent

            if not _within_send_window(cfg.send_hour_from, cfg.send_hour_to):
                logger.info(
                    "Message from %s outside send window (%s–%s AR) — ignoring",
                    payload.from_number,
                    cfg.send_hour_from,
                    cfg.send_hour_to,
                )
                await self.msg_repo.update_fields(
                    inbound.id, processing_status=MessageProcessingStatus.PROCESSED
                )
                return inbound  # no reply sent outside hours

            # ── 5. Handle conversation ─────────────────────────────────────────
            if payload.detected_type != MessageType.TEXT:
                reply = (
                    f"Hola {responsible.full_name}. Recibimos tu mensaje. "
                    "Por favor respondé con el número de la opción deseada."
                )
                task_id = None
            else:
                reply, task_id = await ConversationService(self.db).handle_inbound(
                    responsible, payload.Body
                )

        # ── 6. Update inbound message ──────────────────────────────────────────
        await self.msg_repo.update_fields(
            inbound.id,
            processing_status=MessageProcessingStatus.PROCESSED,
            task_id=task_id,
        )

        # ── 7. Send reply ──────────────────────────────────────────────────────
        outbound_sid = await send_whatsapp_message(payload.from_number, reply)

        # ── 8. Save outbound ───────────────────────────────────────────────────
        await self._save_message(
            MessageCreateInternal(
                direction=MessageDirection.OUTBOUND,
                message_type=MessageType.TEXT,
                from_number=payload.to_number,
                to_number=payload.from_number,
                body=reply,
                responsible_id=responsible.id if responsible else None,
                task_id=task_id,
                external_message_id=outbound_sid,
                processing_status=MessageProcessingStatus.PROCESSED,
            )
        )

        return inbound

    async def _save_message(self, data: MessageCreateInternal) -> Message:
        msg = Message(**data.model_dump())
        return await self.msg_repo.create(msg)

    async def list_by_task(self, task_id: int) -> list[Message]:
        return await self.msg_repo.list_by_task(task_id)

    async def list_by_responsible(self, responsible_id: int) -> list[Message]:
        return await self.msg_repo.list_by_responsible(responsible_id)
