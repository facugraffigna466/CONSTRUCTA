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
        from app.repositories.user import UserRepository
        self.user_repo = UserRepository(session)

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

        # ── 2. Identificar al emisor: responsable (asignado a tareas) o staff
        #       (usuario arquitecto/jefe/admin con su número de WhatsApp cargado) ──
        responsible = await self.resp_repo.get_by_whatsapp(payload.from_number)
        staff = None if responsible else await self.user_repo.get_by_whatsapp(payload.from_number)
        sender = responsible or staff
        is_staff = responsible is None and staff is not None

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
        task_id = None

        # ── 4. Ruteo ───────────────────────────────────────────────────────────
        if sender is None:
            reply = (
                "Este número no está registrado en el sistema CONSTRUCTA. "
                "Comunicáte con el encargado de tu obra."
            )

        else:
            # La ventana horaria / chatbot_enabled aplican a los recordatorios a
            # responsables (evitar spam). El staff inicia la conversación, no se
            # filtra por horario.
            if responsible is not None:
                cfg = await self.settings_repo.get_for_responsible(responsible.id)
                if not cfg.chatbot_enabled:
                    logger.info("Chatbot disabled — ignoring message from %s", payload.from_number)
                    await self.msg_repo.update_fields(inbound.id, processing_status=MessageProcessingStatus.PROCESSED)
                    return inbound
                if not _within_send_window(cfg.send_hour_from, cfg.send_hour_to):
                    logger.info("Message from %s outside send window — ignoring", payload.from_number)
                    await self.msg_repo.update_fields(inbound.id, processing_status=MessageProcessingStatus.PROCESSED)
                    return inbound

            body = payload.Body or ""
            body_low = body.lower()

            # ── 5. Handle ──────────────────────────────────────────────────────
            if payload.detected_type == MessageType.AUDIO and payload.MediaUrl0:
                # Nota de voz de obra → bitácora con IA
                reply = await self._handle_bitacora_audio(payload, sender, is_staff)
            elif payload.detected_type == MessageType.TEXT and "plano" in body_low:
                reply, media_url = await self._handle_plano_request(sender, is_staff, body)
            elif payload.detected_type == MessageType.TEXT and await self._pending_bitacora_obra(sender, is_staff):
                # respuesta numérica eligiendo la obra de una nota de voz pendiente
                reply = await self._handle_obra_selection(sender, is_staff, body)
            elif responsible is not None and payload.detected_type == MessageType.TEXT:
                # responsable reportando estado → máquina de conversación existente
                reply, task_id = await ConversationService(self.db).handle_inbound(responsible, body)
            elif responsible is not None:
                reply = (
                    f"Hola {responsible.full_name}. Recibimos tu mensaje. "
                    "Respondé con el número de la opción, o mandame una nota de voz para la bitácora."
                )
            else:
                # staff escribió texto (o algo que no es audio/plano) → menú
                reply = self._staff_menu(staff)

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

    async def _sender_obra_ids(self, sender, is_staff: bool) -> list[int]:
        """Obras del emisor: para el staff, las que administra (manager); para un
        responsable, las de sus tareas. Si es admin sin obras propias, las del tenant."""
        if is_staff:
            from sqlalchemy import select
            from app.models.obra import Obra
            ids = (await self.db.execute(
                select(Obra.id).where(Obra.manager_id == sender.id)
            )).scalars().all()
            if not ids and getattr(sender, "role", None) == "admin" and sender.tenant_id is not None:
                ids = (await self.db.execute(
                    select(Obra.id).where(Obra.tenant_id == sender.tenant_id)
                )).scalars().all()
            return sorted(ids)
        from app.services.plano_service import PlanoService
        return sorted(await PlanoService(self.db).obra_ids_for_responsible(sender.id))

    def _staff_menu(self, staff) -> str:
        nombre = (staff.full_name or "").split(" ")[0] if staff.full_name else "👷"
        return (
            f"Hola {nombre} 👷. Soy el asistente de obra de CONSTRUCTA. Puedo:\n\n"
            "🎤 *Bitácora de obra*: mandame una nota de voz desde la obra y la registro "
            "(te resumo lo importante y te sugiero acciones).\n"
            "📐 *Planos*: escribime, por ejemplo, \"plano de electricidad\" y te mando la última versión.\n\n"
            "Si tenés varias obras, después de la nota de voz te pregunto a cuál va."
        )

    async def _handle_plano_request(self, sender, is_staff: bool, body: str) -> tuple[str, str | None]:
        """Responde un pedido de plano por WhatsApp con la última versión vigente.
        Devuelve (texto, media_url|None)."""
        from app.core.config import settings
        from app.services.plano_service import PlanoService, match_discipline_in_text

        svc = PlanoService(self.db)
        obra_ids = await self._sender_obra_ids(sender, is_staff)
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

    async def _handle_bitacora_audio(self, payload: TwilioInboundPayload, sender, is_staff: bool) -> str:
        """Nota de voz de WhatsApp → entrada de bitácora con IA. Sirve para
        responsables y para staff (arquitecto/jefe). Si el emisor tiene varias
        obras, la nota queda pendiente y el bot pregunta a cuál va."""
        import uuid as _uuid
        from pathlib import Path as _Path

        import requests as _requests

        from app.core.config import settings as _settings
        from app.services.bitacora_service import BitacoraService

        # 1. Descargar el audio de Twilio (basic auth SID:token)
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
            return "Recibimos tu nota de voz pero no pudimos descargarla. Probá mandarla de nuevo."

        ctype = (payload.MediaContentType0 or "audio/ogg").split(";")[0]
        ext = {"audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a",
               "audio/amr": "amr", "audio/wav": "wav"}.get(ctype, "ogg")
        uploads_dir = _Path(__file__).parent.parent.parent / "uploads"
        uploads_dir.mkdir(exist_ok=True)
        filename = f"bitacora_{_uuid.uuid4().hex}.{ext}"
        (uploads_dir / filename).write_bytes(audio_bytes)

        service = BitacoraService(self.db)
        responsible_id = None if is_staff else sender.id
        created_by = sender.id if is_staff else None

        # 2. ¿Qué obras tiene el emisor?
        obra_ids = await self._sender_obra_ids(sender, is_staff)
        if not obra_ids:
            return ("Recibí tu nota de voz, pero no tengo obras asociadas a tu número todavía. "
                    "Avisale al jefe de obra para que te vincule.")

        # 3a. Una sola obra → procesar directo
        if len(obra_ids) == 1:
            entry = await service.create_entry(
                obra_id=obra_ids[0], source="whatsapp", audio_path=f"/uploads/{filename}",
                responsible_id=responsible_id, created_by=created_by,
            )
            entry = await service.process_entry(entry, audio_bytes=audio_bytes, filename=f"audio.{ext}")
            return self._bitacora_reply(entry)

        # 3b. Varias obras → transcribir, dejar pendiente y preguntar
        transcript = await service.transcribe_audio(audio_bytes, f"audio.{ext}")
        entry = await service.create_entry(
            obra_id=None, source="whatsapp", audio_path=f"/uploads/{filename}",
            responsible_id=responsible_id, created_by=created_by, transcript=transcript,
        )
        entry.status = "pendiente_obra"
        await self.db.flush()
        return "🎤 Recibí tu nota de voz. ¿Para qué obra es?\n" + await self._obra_options(obra_ids) + "\n\nRespondé con el número."

    def _bitacora_reply(self, entry) -> str:
        if entry.status == "procesado":
            n = len([s for s in (entry.suggestions or []) if s.get("type") != "note"])
            base = f"📋 Nota registrada en la bitácora{' de la obra' if entry.obra_id else ''}. Resumen: {entry.summary}"
            if n:
                base += (f"\n\nDetecté {n} {'acciones sugeridas' if n != 1 else 'acción sugerida'} "
                         "(mover fechas, crear tareas o cambiar estados). Se revisan y aplican desde la app.")
            return base[:1500]
        if entry.status == "pendiente_transcripcion":
            return ("🎙️ Recibí tu nota y quedó guardada en la bitácora. La transcripción automática no está "
                    "habilitada todavía, pero el audio queda en la app.")
        return ("🎙️ Recibí tu nota y quedó guardada en la bitácora. Hubo un problema al procesarla con IA; "
                "se puede reintentar desde la app.")

    async def _obra_options(self, obra_ids: list[int]) -> str:
        from sqlalchemy import select
        from app.models.obra import Obra
        rows = (await self.db.execute(select(Obra.id, Obra.name).where(Obra.id.in_(obra_ids)))).all()
        names = {r[0]: r[1] for r in rows}
        return "\n".join(f"{i + 1}) {names.get(oid, f'Obra #{oid}')}" for i, oid in enumerate(obra_ids))

    async def _pending_bitacora_obra(self, sender, is_staff: bool):
        """Nota de voz reciente esperando que elijan la obra (None si no hay)."""
        from datetime import timedelta
        from sqlalchemy import select
        from app.models.bitacora import BitacoraEntry
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=30)
        cond = (BitacoraEntry.created_by == sender.id) if is_staff else (BitacoraEntry.responsible_id == sender.id)
        return (await self.db.execute(
            select(BitacoraEntry)
            .where(BitacoraEntry.status == "pendiente_obra", cond, BitacoraEntry.created_at >= cutoff)
            .order_by(BitacoraEntry.created_at.desc()).limit(1)
        )).scalars().first()

    async def _handle_obra_selection(self, sender, is_staff: bool, body: str) -> str:
        import re
        entry = await self._pending_bitacora_obra(sender, is_staff)
        if not entry:
            return self._staff_menu(sender) if is_staff else "No tengo ninguna nota de voz pendiente."
        obra_ids = await self._sender_obra_ids(sender, is_staff)
        m = re.search(r"\d+", body)
        if not m or not (1 <= int(m.group()) <= len(obra_ids)):
            return "No entendí. ¿Para qué obra es la nota?\n" + await self._obra_options(obra_ids)
        entry.obra_id = obra_ids[int(m.group()) - 1]
        entry.status = "pendiente_analisis" if entry.transcript else "pendiente_transcripcion"
        from app.services.bitacora_service import BitacoraService
        if entry.transcript:
            entry = await BitacoraService(self.db).process_entry(entry)
        else:
            await self.db.flush()
        return self._bitacora_reply(entry)

    async def _save_message(self, data: MessageCreateInternal) -> Message:
        msg = Message(**data.model_dump())
        return await self.msg_repo.create(msg)

    async def list_by_task(self, task_id: int) -> list[Message]:
        return await self.msg_repo.list_by_task(task_id)

    async def list_by_responsible(self, responsible_id: int) -> list[Message]:
        return await self.msg_repo.list_by_responsible(responsible_id)
