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

        media_url: str | None = None

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
            if payload.detected_type == MessageType.AUDIO and payload.MediaUrl0:
                # Audio de obra → bitácora con IA (no pasa por el chatbot)
                reply = await self._handle_bitacora_audio(payload, responsible)
                task_id = None
            elif payload.detected_type != MessageType.TEXT:
                reply = (
                    f"Hola {responsible.full_name}. Recibimos tu mensaje. "
                    "Por favor respondé con el número de la opción deseada."
                )
                task_id = None
            elif "plano" in (payload.Body or "").lower():
                # "mandame el plano de electricidad" → última versión vigente
                reply, media_url = await self._handle_plano_request(responsible, payload.Body)
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
        outbound_sid = await send_whatsapp_message(payload.from_number, reply, media_url=media_url)

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

    async def _handle_plano_request(self, responsible, body: str) -> tuple[str, str | None]:
        """Responde un pedido de plano por WhatsApp con la última versión vigente.
        Devuelve (texto, media_url|None)."""
        from app.core.config import settings
        from app.services.plano_service import PlanoService, match_discipline_in_text

        svc = PlanoService(self.db)
        obra_ids = await svc.obra_ids_for_responsible(responsible.id)
        if not obra_ids:
            return ("No tengo obras asociadas a tu número todavía. Avisale al jefe de obra.", None)

        disc = match_discipline_in_text(body)
        plano = await svc.find_latest_for_disciplines(obra_ids, disc)

        if not plano:
            disponibles = await svc.available_disciplines(obra_ids)
            lista = ", ".join(disponibles) if disponibles else None
            if disc:
                msg = f"No encontré un plano de {disc} cargado para tu obra."
            else:
                msg = "¿De qué plano necesitás? Por ejemplo: electricidad, sanitarios o estructura."
            if lista:
                msg += f"\nPlanos disponibles: {lista}."
            elif disc:
                msg += " Todavía no hay planos cargados en el sistema."
            return (msg, None)

        base_url = (settings.PUBLIC_BASE_URL or "").rstrip("/")
        url = f"{base_url}/uploads/{plano.file_path}" if base_url else None
        fecha = plano.created_at.strftime("%d/%m/%Y")
        detalle = f" — {plano.name}" if plano.name else ""
        caption = f"\U0001F4D0 Plano de {plano.discipline}{detalle} (v{plano.version}, cargado {fecha})."
        if not url:
            caption += "\nNo puedo adjuntar el archivo todavía (falta configurar la URL pública del sistema)."
        return (caption, url)

    async def _handle_bitacora_audio(self, payload: TwilioInboundPayload, responsible) -> str:
        """Audio de WhatsApp → entrada de bitácora procesada con IA.
        Devuelve el texto de respuesta para el responsable."""
        import uuid as _uuid
        from pathlib import Path as _Path

        import requests as _requests
        from sqlalchemy import func, select

        from app.core.config import settings as _settings
        from app.models.obra_team_member import ObraTeamMember
        from app.models.task import Task, TaskStatus
        from app.services.bitacora_service import BitacoraService

        # 1. Descargar el audio de Twilio (basic auth SID:token)
        audio_bytes: bytes | None = None
        try:
            resp = _requests.get(
                payload.MediaUrl0,
                auth=(_settings.TWILIO_ACCOUNT_SID, _settings.TWILIO_AUTH_TOKEN),
                timeout=60,
            )
            resp.raise_for_status()
            audio_bytes = resp.content
        except Exception:
            logger.exception("No se pudo descargar el audio de Twilio")
            return (
                f"Hola {responsible.full_name}. Recibimos tu audio pero no pudimos descargarlo. "
                "Probá mandarlo de nuevo."
            )

        ctype = (payload.MediaContentType0 or "audio/ogg").split(";")[0]
        ext = {"audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a",
               "audio/amr": "amr", "audio/wav": "wav"}.get(ctype, "ogg")
        uploads_dir = _Path(__file__).parent.parent.parent / "uploads"
        uploads_dir.mkdir(exist_ok=True)
        filename = f"bitacora_{_uuid.uuid4().hex}.{ext}"
        (uploads_dir / filename).write_bytes(audio_bytes)

        # 2. Inferir la obra: la de más tareas activas del responsable;
        #    si no tiene, su única obra del equipo; si es ambiguo, queda sin asignar.
        obra_id: int | None = None
        top = (await self.db.execute(
            select(Task.obra_id, func.count(Task.id).label("n"))
            .where(
                Task.responsible_id == responsible.id,
                Task.status.notin_([TaskStatus.COMPLETADA, TaskStatus.CANCELADA]),
            )
            .group_by(Task.obra_id)
            .order_by(func.count(Task.id).desc())
        )).first()
        if top:
            obra_id = top[0]
        else:
            obras = (await self.db.execute(
                select(ObraTeamMember.obra_id).where(ObraTeamMember.responsible_id == responsible.id)
            )).scalars().all()
            if len(obras) == 1:
                obra_id = obras[0]

        # 3. Crear y procesar la entrada
        service = BitacoraService(self.db)
        entry = await service.create_entry(
            obra_id=obra_id,
            source="whatsapp",
            audio_path=f"/uploads/{filename}",
            responsible_id=responsible.id,
        )
        entry = await service.process_entry(entry, audio_bytes=audio_bytes, filename=f"audio.{ext}")

        # 4. Respuesta según resultado
        if entry.status == "procesado":
            n = len([s for s in (entry.suggestions or []) if s.get("type") != "note"])
            base = f"📋 Audio registrado en la bitácora{' de la obra' if obra_id else ''}. Resumen: {entry.summary}"
            if n:
                base += f"\n\nDetectamos {n} acción{'es' if n != 1 else ''} sugerida{'s' if n != 1 else ''} (mover fechas, tareas o estados). El jefe de obra puede revisarlas y aplicarlas desde la app."
            return base[:1500]
        if entry.status == "pendiente_transcripcion":
            return (
                "🎙️ Recibimos tu audio y quedó guardado en la bitácora. "
                "La transcripción automática no está habilitada todavía, pero el audio queda disponible en la app."
            )
        return (
            "🎙️ Recibimos tu audio y quedó guardado en la bitácora. "
            "Hubo un problema al procesarlo con IA; se puede reintentar desde la app."
        )

    async def _save_message(self, data: MessageCreateInternal) -> Message:
        msg = Message(**data.model_dump())
        return await self.msg_repo.create(msg)

    async def list_by_task(self, task_id: int) -> list[Message]:
        return await self.msg_repo.list_by_task(task_id)

    async def list_by_responsible(self, responsible_id: int) -> list[Message]:
        return await self.msg_repo.list_by_responsible(responsible_id)
