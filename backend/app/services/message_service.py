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


def _match_numbered_option(body: str, names: list[str]) -> int | None:
    """Índice (0-based) de la opción elegida en un menú tipo "1) Nombre A\n2)
    Nombre B". Acepta el número (el caso normal) o el nombre de la opción en
    texto libre — alguien puede contestar "Edificio Norte" en vez de "1"
    porque el propio mensaje se lo mostró como opción; antes eso caía en un
    loop de "No entendí" para siempre."""
    import re
    m = re.search(r"\d+", body)
    if m and 1 <= int(m.group()) <= len(names):
        return int(m.group()) - 1
    from app.services.plano_service import _norm
    body_n = _norm(body).strip()
    if not body_n:
        return None
    # Match exacto primero: si un nombre es prefijo de otro (p. ej. "Edificio
    # Norte" y "Edificio Norte — Demo"), contestar el nombre exacto no debe
    # volverse ambiguo solo porque también es substring del otro.
    exact = [i for i, name in enumerate(names) if body_n == _norm(name)]
    if len(exact) == 1:
        return exact[0]
    if len(exact) > 1:
        return None
    partial = [
        i for i, name in enumerate(names)
        if body_n in _norm(name) or _norm(name) in body_n
    ]
    return partial[0] if len(partial) == 1 else None


def _sanitize_for_caption(text: str, max_len: int = 120) -> str:
    """Limpia un string generado por el usuario (ej. el `name` de un plano) antes de
    interpolarlo en un mensaje que el bot manda como si fuera propio. Sin esto, un
    `name` con `\\n` podía inyectar líneas extra al caption — vector de phishing vía
    el canal de confianza del bot."""
    cleaned = "".join(ch for ch in text if ch.isprintable() and ch not in "\r\n")
    cleaned = " ".join(cleaned.split())
    return cleaned[:max_len].strip()

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
        from app.repositories.whatsapp_tenant_context import WhatsappTenantContextRepository
        self.user_repo = UserRepository(session)
        self.wa_ctx_repo = WhatsappTenantContextRepository(session)

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
        # `get_by_whatsapp` ahora filtra por is_active (rediseño identidad
        # WhatsApp — parte A.1). Si no encuentra activo, hacemos un lookup
        # extra sin filtrar para distinguir "desactivado" (mensaje específico)
        # de "no registrado" (mensaje genérico). Solo pagamos la query extra
        # en el path menos común.
        responsible = await self.resp_repo.get_by_whatsapp(payload.from_number)
        deactivated_responsible = None
        staff = None
        forced_reply: str | None = None
        if responsible is None:
            any_resp = await self.resp_repo.get_by_whatsapp_any(payload.from_number)
            if any_resp is not None and not any_resp.is_active:
                deactivated_responsible = any_resp
            else:
                staff, forced_reply = await self._resolve_staff(payload.from_number, payload.Body or "")
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

        # ── 3b. Ambigüedad de tenant sin resolver (Fase 3) ─────────────────────
        # El número quedó en más de una empresa y hay que preguntar (o ya
        # preguntamos y esto es la confirmación) — no seguimos con el flujo
        # normal, el mensaje original se pide reenviar después de elegir.
        if forced_reply is not None:
            await self.msg_repo.update_fields(
                inbound.id, processing_status=MessageProcessingStatus.PROCESSED,
            )
            outbound_sid = await send_whatsapp_message(payload.from_number, forced_reply)
            await self._save_message(
                MessageCreateInternal(
                    direction=MessageDirection.OUTBOUND,
                    message_type=MessageType.TEXT,
                    from_number=payload.to_number,
                    to_number=payload.from_number,
                    body=forced_reply,
                    external_message_id=outbound_sid,
                    processing_status=MessageProcessingStatus.PROCESSED,
                )
            )
            return inbound

        # ── 4a. Proveedor enviando PDF de cotización ───────────────────────────
        # detected_type devuelve UNKNOWN para application/pdf y otros docs
        _is_document = (
            payload.MediaUrl0
            and payload.detected_type == MessageType.UNKNOWN
            and (payload.MediaContentType0 or "").lower() in (
                "application/pdf", "application/vnd.openxmlformats-officedocument"
                ".spreadsheetml.sheet", "application/vnd.ms-excel",
            )
        )
        if _is_document:
            # Caso 1: proveedor formal (número no registrado como responsable/staff)
            if sender is None:
                supplier = await self._find_supplier_by_phone(payload.from_number)
                if supplier:
                    reply = await self._handle_supplier_pdf(
                        supplier=supplier,
                        media_url=payload.MediaUrl0,
                        content_type=payload.MediaContentType0,
                    )
                    await self.msg_repo.update_fields(
                        inbound.id,
                        processing_status=MessageProcessingStatus.PROCESSED,
                    )
                    await send_whatsapp_message(payload.from_number, reply)
                    await self._save_message(
                        MessageCreateInternal(
                            direction=MessageDirection.OUTBOUND,
                            message_type=MessageType.TEXT,
                            from_number=payload.to_number,
                            to_number=payload.from_number,
                            body=reply,
                            processing_status=MessageProcessingStatus.PROCESSED,
                        )
                    )
                    return inbound
            # Caso 2: contratista registrado (responsable/staff con solicitud enviada a su número)
            else:
                from app.services.solicitud_service import SolicitudService
                solicitud = await SolicitudService(self.db).get_pending_for_phone(payload.from_number)
                if solicitud:
                    sender_name = (
                        responsible.full_name if responsible else
                        (staff.full_name if staff else "Contratista")
                    )
                    reply = await self._handle_contratista_pdf(
                        sender_name=sender_name,
                        solicitud=solicitud,
                        media_url=payload.MediaUrl0,
                        content_type=payload.MediaContentType0,
                    )
                    await self.msg_repo.update_fields(
                        inbound.id,
                        processing_status=MessageProcessingStatus.PROCESSED,
                    )
                    await send_whatsapp_message(payload.from_number, reply)
                    await self._save_message(
                        MessageCreateInternal(
                            direction=MessageDirection.OUTBOUND,
                            message_type=MessageType.TEXT,
                            from_number=payload.to_number,
                            to_number=payload.from_number,
                            body=reply,
                            processing_status=MessageProcessingStatus.PROCESSED,
                        )
                    )
                    return inbound

        # ── 4. Ruteo ───────────────────────────────────────────────────────────
        if deactivated_responsible is not None:
            # Rediseño identidad WhatsApp — parte A.1: un responsable dado de
            # baja no debe seguir siendo tratado normalmente. Mensaje distinto
            # al de "no registrado" para no confundir al usuario.
            reply = (
                "Ya no tenés acceso al sistema CONSTRUCTA. "
                "Consultá con tu jefe de obra."
            )
        elif sender is None:
            reply = (
                "Este número no está registrado en el sistema CONSTRUCTA. "
                "Comunicáte con el encargado de tu obra."
            )
        elif responsible is not None and responsible.confirmed_at is None:
            # Rediseño identidad WhatsApp — parte C: hasta que el responsable
            # no confirme (respondiendo "SI" al mensaje de bienvenida), el bot
            # solo maneja el propio flujo de confirmación. Cualquier otro
            # comando queda bloqueado con el mismo pedido.
            reply = await self._handle_pending_confirmation(responsible, payload.Body or "")
        else:
            # `chatbot_enabled` sigue bloqueando (es un opt-out explícito del jefe
            # sobre ese responsable en particular).
            #
            # Hallazgo 6.8 auditoría 04: `send_window` YA NO bloquea inbound. Antes
            # un obrero que mandaba un mensaje fuera de horario recibía silencio
            # total (el mensaje se guardaba pero no había reply). El nombre del
            # campo (send_*) y su uso natural es outbound — recordatorios
            # programados. Los mensajes iniciados por el responsable se responden
            # siempre. La ventana sigue aplicándose al outbound (líneas 698, 705).
            if responsible is not None:
                cfg = await self.settings_repo.get_for_responsible(responsible.id)
                if not cfg.chatbot_enabled:
                    logger.info("Chatbot disabled — ignoring message from %s", payload.from_number)
                    await self.msg_repo.update_fields(inbound.id, processing_status=MessageProcessingStatus.PROCESSED)
                    return inbound

            body = payload.Body or ""
            body_low = body.lower()

            # pre-compute discipline match for routing (without importing heavy stuff)
            from app.services.plano_service import match_discipline_in_text as _match_disc
            _disc_keyword = _match_disc(body_low) if payload.detected_type == MessageType.TEXT else None

            # ── 5. Handle ──────────────────────────────────────────────────────
            if payload.detected_type == MessageType.AUDIO and payload.MediaUrl0:
                # Nota de voz de obra → bitácora con IA
                reply = await self._handle_bitacora_audio(payload, sender, is_staff)
            elif payload.detected_type == MessageType.TEXT and await self._pending_plano_obra(sender, is_staff):
                # eligiendo obra para un pedido de plano pendiente
                reply, media_url = await self._handle_plano_obra_selection(sender, is_staff, body)
            elif payload.detected_type == MessageType.TEXT and ("plano" in body_low or _disc_keyword):
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
                media_url=media_url,
                responsible_id=responsible.id if responsible else None,
                task_id=task_id,
                external_message_id=outbound_sid,
                processing_status=MessageProcessingStatus.PROCESSED,
            )
        )

        return inbound

    async def _resolve_staff(self, from_number: str, body: str):
        """Resuelve el (los) User dueño(s) de este whatsapp_number. Devuelve
        `(sender, forced_reply)`:

          - `(AuthenticatedUser, None)` — resuelto sin ambigüedad (0 o 1
            match, o ya había un tenant elegido de una desambiguación previa).
          - `(None, None)` — el número no es de ningún staff.
          - `(None, texto)` — hay que mandar `texto` (menú o confirmación) y
            cortar el procesamiento normal de este mensaje.

        Constructa usa un único número de Twilio para toda la plataforma
        (`settings.TWILIO_WHATSAPP_NUMBER`) — no hay señal de infraestructura
        para saber "a qué empresa le están escribiendo", así que cuando el
        mismo número tiene membership activa en más de un tenant (una
        identidad, dos empresas, ambas con este whatsapp cargado) se
        desambigua preguntando una vez y recordando la respuesta en
        `whatsapp_tenant_context`."""
        from app.core.membership_context import AuthenticatedUser

        matches = await self.user_repo.get_memberships_by_whatsapp(from_number)
        if not matches:
            return None, None
        if len(matches) == 1:
            user, membership = matches[0]
            return AuthenticatedUser(user, membership), None

        by_tenant = {m.tenant_id: (u, m) for u, m in matches}
        ctx = await self.wa_ctx_repo.get(from_number)

        if ctx and ctx.active_tenant_id in by_tenant:
            user, membership = by_tenant[ctx.active_tenant_id]
            return AuthenticatedUser(user, membership), None

        if ctx and ctx.pending_options:
            choice = self._match_menu_choice(body, ctx.pending_options)
            if choice is not None:
                await self.wa_ctx_repo.upsert(
                    from_number, active_tenant_id=choice["tenant_id"], pending_options=None,
                )
                return None, (
                    f"Listo, quedaste en {choice['tenant_name']}. "
                    "Reenviá tu mensaje para continuar."
                )
            return None, self._render_tenant_menu(ctx.pending_options)

        # Primera vez que este número resulta ambiguo: armamos el menú.
        from sqlalchemy import select
        from app.models.tenant import Tenant
        tenant_rows = (await self.db.execute(
            select(Tenant.id, Tenant.name).where(Tenant.id.in_(by_tenant.keys()))
        )).all()
        options = [
            {"idx": i + 1, "tenant_id": tid, "tenant_name": name}
            for i, (tid, name) in enumerate(tenant_rows)
        ]
        await self.wa_ctx_repo.upsert(from_number, pending_options=options, active_tenant_id=None)
        return None, self._render_tenant_menu(options)

    def _render_tenant_menu(self, options: list[dict]) -> str:
        lines = "\n".join(f"{o['idx']}) {o['tenant_name']}" for o in options)
        return (
            "Tu número de WhatsApp está registrado en más de una empresa de Constructa:\n"
            f"{lines}\n"
            "Respondé con el número de la empresa para continuar."
        )

    def _match_menu_choice(self, body: str, options: list[dict]) -> dict | None:
        body = (body or "").strip()
        if not body.isdigit():
            return None
        idx = int(body)
        return next((o for o in options if o["idx"] == idx), None)

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
        """Responde un pedido de plano. Si el responsable trabaja en múltiples obras,
        pide que elija una antes de enviar el archivo."""
        from sqlalchemy import select
        from app.core.config import settings
        from app.models.obra import Obra
        from app.models.conversation_session import ConversationStep
        from app.repositories.conversation_session import ConversationSessionRepository
        from app.services.plano_service import PlanoService, match_discipline_in_text

        svc = PlanoService(self.db)
        obra_ids = await self._sender_obra_ids(sender, is_staff)
        if not obra_ids:
            return ("No tengo obras asociadas a tu número. Avisale al jefe de obra.", None)

        body_low = body.lower()
        _LIST_KWS = {"qué", "que", "cuál", "cual", "listar", "disponible", "disponibles", "hay", "tengo", "ver"}

        # ── Comando "listar planos" ────────────────────────────────────────────
        if any(kw in body_low for kw in _LIST_KWS) or (not match_discipline_in_text(body) and "plano" in body_low and not body_low.replace("planos", "").replace("plano", "").strip()):
            disponibles = await svc.available_disciplines_by_obra(obra_ids)
            if not disponibles:
                return ("No hay planos cargados en el sistema todavía. Pedíselo al jefe de obra.", None)
            lineas = []
            for obra_id, discs in disponibles.items():
                # filtrar por disciplinas permitidas para este responsable
                if not is_staff:
                    allowed = await svc.allowed_disciplines_for_responsible(sender.id, obra_id)
                    if allowed is not None:
                        discs = [d for d in discs if d in allowed]
                if not discs:
                    continue
                obra_row = (await self.db.execute(select(Obra).where(Obra.id == obra_id))).scalar_one_or_none()
                nombre = obra_row.name if obra_row else f"Obra #{obra_id}"
                lineas.append(f"📐 *{nombre}*: {', '.join(discs)}")
            if not lineas:
                return ("No tenés acceso a ningún plano en este momento. Consultale al jefe de obra.", None)
            return ("Planos disponibles:\n\n" + "\n".join(lineas) + "\n\nEscribí el nombre de la disciplina para que te lo mande. Por ej: «electricidad» o «plano de gas».", None)

        disc = match_discipline_in_text(body)

        # ── Si trabaja en varias obras, pedir cuál ───────────────────────────
        if not is_staff and len(obra_ids) > 1:
            obras_con_planos = await svc.obras_with_planos(obra_ids, disc)
            # filtrar obras donde el responsable tiene permiso para la disciplina pedida
            if disc:
                obras_permitidas = []
                for oid in obras_con_planos:
                    allowed = await svc.allowed_disciplines_for_responsible(sender.id, oid)
                    if allowed is None or disc in allowed:
                        obras_permitidas.append(oid)
                obras_con_planos = obras_permitidas
            if len(obras_con_planos) == 0:
                tipo = f"de {disc} " if disc else ""
                return (f"No tenés acceso a planos {tipo}en ninguna de tus obras.", None)
            if len(obras_con_planos) > 1:
                # guardar contexto en la sesión del responsable
                sess_repo = ConversationSessionRepository(self.db)
                obras_rows = (await self.db.execute(select(Obra.id, Obra.name).where(Obra.id.in_(obras_con_planos)))).all()
                obra_map = {r.id: r.name for r in obras_rows}
                opts = [{"obra_id": oid, "name": obra_map.get(oid, f"Obra #{oid}")} for oid in obras_con_planos]
                await sess_repo.upsert(
                    sender.id,
                    ConversationStep.PLANO_OBRA_SELECT,
                    task_options=[{"type": "plano", "discipline": disc, "options": opts}],
                )
                lineas = "\n".join(f"{i+1}) {o['name']}" for i, o in enumerate(opts))
                tipo = f"de {disc} " if disc else ""
                return (f"Tenés planos {tipo}en varias obras. ¿De cuál?\n\n{lineas}\n\nRespondé con el número.", None)
            # una sola obra con acceso → usar esa
            obra_ids = obras_con_planos

        # ── Verificar permisos por disciplina ──────────────────────────────────
        if not is_staff and disc and len(obra_ids) == 1:
            allowed = await svc.allowed_disciplines_for_responsible(sender.id, obra_ids[0])
            if allowed is not None and disc not in allowed:
                if allowed:
                    return (f"No tenés acceso al plano de {disc}.\nPodés pedir: {', '.join(allowed)}.", None)
                return ("No tenés acceso a los planos de esta obra. Consultale al jefe de obra.", None)

        # ── Obra única (o staff) → enviar directo ────────────────────────────
        plano = await svc.find_latest_for_disciplines(obra_ids, disc)
        if not plano:
            if not is_staff and len(obra_ids) == 1:
                allowed = await svc.allowed_disciplines_for_responsible(sender.id, obra_ids[0])
                todas = await svc.available_disciplines(obra_ids)
                disponibles = [d for d in todas if allowed is None or d in allowed]
            else:
                disponibles = await svc.available_disciplines(obra_ids)
            if disc:
                msg = f"No encontré un plano de {disc} cargado."
            else:
                msg = "¿De qué plano necesitás? Por ejemplo: electricidad, sanitarios o estructura."
            if disponibles:
                msg += f"\nPlanos disponibles: {', '.join(disponibles)}."
            return (msg, None)

        # Re-chequeo final por disciplina del plano YA resuelto — cubre el pedido
        # ambiguo ("mandame el plano", sin decir cuál) que antes se saltaba el filtro
        # de arriba porque ese solo corría cuando `disc` venía explícito.
        if not is_staff:
            allowed = await svc.allowed_disciplines_for_responsible(sender.id, obra_ids[0])
            if allowed is not None and plano.discipline not in allowed:
                return ("No tenés acceso a ese plano en esta obra. Consultale al jefe de obra.", None)

        return self._format_plano_reply(plano, settings)

    async def _pending_plano_obra(self, sender, is_staff: bool) -> bool:
        """True si el responsable tiene una sesión pendiente de elección de obra para un plano."""
        if is_staff:
            return False
        from app.models.conversation_session import ConversationStep
        from app.repositories.conversation_session import ConversationSessionRepository
        sess = await ConversationSessionRepository(self.db).get_by_responsible(sender.id)
        if not sess or sess.step != ConversationStep.PLANO_OBRA_SELECT:
            return False
        if sess.expires_at.tzinfo is None:
            from datetime import timezone as _tz
            expires = sess.expires_at.replace(tzinfo=_tz.utc)
        else:
            expires = sess.expires_at
        return datetime.now(timezone.utc) < expires

    async def _handle_plano_obra_selection(self, sender, is_staff: bool, body: str) -> tuple[str, str | None]:
        """El responsable eligió una obra del menú de desambiguación de planos."""
        from app.core.config import settings
        from app.models.conversation_session import ConversationStep
        from app.repositories.conversation_session import ConversationSessionRepository
        from app.services.plano_service import PlanoService

        sess_repo = ConversationSessionRepository(self.db)
        sess = await sess_repo.get_by_responsible(sender.id)
        if not sess or not sess.task_options:
            await sess_repo.upsert(sender.id, ConversationStep.IDLE)
            return ("Sesión expirada. Volvé a pedirme el plano.", None)

        ctx = sess.task_options[0]
        opts = ctx.get("options", [])
        disc = ctx.get("discipline")

        idx = _match_numbered_option(body, [o["name"] for o in opts])
        if idx is None:
            lineas = "\n".join(f"{i+1}) {o['name']}" for i, o in enumerate(opts))
            return (f"No entendí. ¿De cuál obra?\n\n{lineas}", None)

        elegida = opts[idx]
        await sess_repo.upsert(sender.id, ConversationStep.IDLE)

        svc = PlanoService(self.db)

        # re-check permissions for chosen obra (defensive: shouldn't fail if opts were pre-filtered)
        if disc and not is_staff:
            allowed = await svc.allowed_disciplines_for_responsible(sender.id, elegida["obra_id"])
            if allowed is not None and disc not in allowed:
                accessible = ", ".join(allowed) if allowed else "ninguno"
                return (f"No tenés acceso al plano de {disc} en {elegida['name']}.\nPodés pedir: {accessible}.", None)

        plano = await svc.find_latest_for_disciplines([elegida["obra_id"]], disc)
        if not plano:
            tipo = f"de {disc} " if disc else ""
            return (f"No hay planos {tipo}cargados en {elegida['name']}.", None)

        # Mismo re-chequeo que en _handle_plano_request: cubre el pedido ambiguo.
        if not is_staff:
            allowed = await svc.allowed_disciplines_for_responsible(sender.id, elegida["obra_id"])
            if allowed is not None and plano.discipline not in allowed:
                return (f"No tenés acceso a ese plano en {elegida['name']}.", None)

        return self._format_plano_reply(plano, settings)

    def _format_plano_reply(self, plano, settings) -> tuple[str, str | None]:
        from app.core.signing import BOT_TTL, signed_upload_url

        base_url = (settings.PUBLIC_BASE_URL or "").rstrip("/")
        # Firmada (antes: URL cruda sin exp/sig → /uploads la rechazaba con 403 y
        # Twilio nunca podía bajar el archivo). TTL largo porque Twilio archiva el
        # media unos días y puede reintentar la descarga más tarde.
        url = signed_upload_url(plano.file_path, plano.tenant_id, ttl=BOT_TTL) if base_url else None
        fecha = plano.created_at.strftime("%d/%m/%Y")
        nombre = _sanitize_for_caption(plano.name) if plano.name else ""
        detalle = f" — {nombre}" if nombre else ""
        caption = f"📐 Plano de {plano.discipline}{detalle} (v{plano.version}, {fecha})."
        if not url:
            caption += "\nNo puedo adjuntar el archivo todavía (falta configurar la URL pública)."
        return (caption, url)

    async def _handle_bitacora_audio(self, payload: TwilioInboundPayload, sender, is_staff: bool) -> str:
        """Nota de voz de WhatsApp → entrada de bitácora con IA.

        **Gate: solo staff.** La bitácora puede contener información sensible
        de toda la obra. Se restringe a users con login (arquitecto/jefe/admin
        del tenant, autenticados con contraseña). Los responsables (sin login)
        NO pueden mandar audios a la bitácora; para reportar novedades usan el
        menú de estados de tarea o hablan con su jefe."""
        import asyncio as _asyncio
        import uuid as _uuid
        from pathlib import Path as _Path

        import requests as _requests

        from app.core.config import settings as _settings
        from app.services.bitacora_service import BitacoraService

        if not is_staff:
            return (
                "La bitácora por audio es solo para el equipo administrativo. "
                "Si necesitás dejar constancia de una novedad, avisale a tu "
                "jefe de obra."
            )

        # 1. Descargar el audio de Twilio (basic auth SID:token).
        #    En un thread para no bloquear el event loop con I/O síncrono.
        try:
            resp = await _asyncio.to_thread(
                lambda: _requests.get(
                    payload.MediaUrl0,
                    auth=(_settings.TWILIO_ACCOUNT_SID, _settings.TWILIO_AUTH_TOKEN),
                    timeout=60,
                )
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

        # Control de costo de IA: cota mensual por tenant, antes de gastar en
        # Whisper/Claude. El chatbot no tenía este chequeo — era el canal que
        # más quedaba afuera del control de costo (audit 08-bitácora §8.1).
        from fastapi import HTTPException as _HTTPException
        from sqlalchemy import select as _select
        from app.models.obra import Obra as _Obra
        obra_tenant_id = (await self.db.execute(
            _select(_Obra.tenant_id).where(_Obra.id == obra_ids[0])
        )).scalar_one_or_none()
        try:
            await service.assert_within_ai_quota(obra_tenant_id)
        except _HTTPException:
            return ("Este mes ya se alcanzó el límite de análisis de bitácora con IA del plan. "
                    "Podés seguir dejando la novedad por escrito desde la app, o subir de plan para más.")

        # 3a. Una sola obra → guardar y procesar IA en background para no exceder
        #     el timeout de 15 s del webhook de Twilio (Whisper + Claude ~ 30-40 s).
        if len(obra_ids) == 1:
            entry = await service.create_entry(
                obra_id=obra_ids[0], source="whatsapp", audio_path=f"/uploads/{filename}",
                responsible_id=responsible_id, created_by=created_by,
            )
            await self.db.flush()  # persistir antes de lanzar el task

            entry_id = entry.id
            sender_phone = payload.from_number
            audio_snapshot = audio_bytes
            audio_fname = f"audio.{ext}"

            async def _bg_process_entry():
                import asyncio
                import logging
                from app.core.database import AsyncSessionLocal
                from app.models.bitacora import BitacoraEntry as _BE
                from app.services.bitacora_service import BitacoraService as _BS
                from sqlalchemy import select

                _log = logging.getLogger(__name__)
                await asyncio.sleep(2)  # esperar commit de la tx padre
                try:
                    async with AsyncSessionLocal() as bg_session:
                        bg_entry = (await bg_session.execute(
                            select(_BE).where(_BE.id == entry_id)
                        )).scalar_one_or_none()
                        if not bg_entry:
                            _log.error("BitacoraEntry %s no encontrada en bg task", entry_id)
                            return
                        await _BS(bg_session).process_entry(
                            bg_entry, audio_bytes=audio_snapshot, filename=audio_fname
                        )
                        await bg_session.commit()
                        # Notificar al usuario por WhatsApp con el resultado
                        from app.integrations.twilio.client import send_whatsapp_message
                        if bg_entry.status == "procesado":
                            n = len([s for s in (bg_entry.suggestions or []) if s.get("type") != "note"])
                            msg = f"📋 Nota procesada. Resumen: {bg_entry.summary}"
                            if n:
                                msg += (
                                    f"\n\nDetecté {n} "
                                    f"{'acciones sugeridas' if n != 1 else 'acción sugerida'}. "
                                    "Revisalas en la app."
                                )
                        else:
                            msg = (
                                "🎙️ Tu nota quedó guardada en la bitácora. "
                                "Hubo un problema al analizarla con IA; podés reintentarlo desde la app."
                            )
                        await send_whatsapp_message(sender_phone, msg[:1500])
                except Exception:
                    _log.exception("Error en bg processing de BitacoraEntry %s", entry_id)

            _asyncio.create_task(_bg_process_entry())
            return "🎙️ Nota de voz recibida. La estoy procesando con IA — te aviso enseguida."

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
        """Nota de voz esperando que elijan la obra (None si no hay). Ventana amplia
        (7 días) para que la respuesta siga asignando aunque el emisor conteste tarde,
        tras recibir los recordatorios automáticos."""
        from datetime import timedelta
        from sqlalchemy import select
        from app.models.bitacora import BitacoraEntry
        cutoff = datetime.now(timezone.utc) - timedelta(days=7)
        cond = (BitacoraEntry.created_by == sender.id) if is_staff else (BitacoraEntry.responsible_id == sender.id)
        return (await self.db.execute(
            select(BitacoraEntry)
            .where(BitacoraEntry.status == "pendiente_obra", cond, BitacoraEntry.created_at >= cutoff)
            .order_by(BitacoraEntry.created_at.desc()).limit(1)
        )).scalars().first()

    async def remind_pending_bitacora_obra(self) -> int:
        """Recordatorio automático: cada 30 min le avisa a quien mandó una nota de voz
        que todavía no asignó a una obra, hasta que responda. Respeta el horario laboral
        y se rinde a las 48 h (la nota queda guardada igual, sin perder trazabilidad).
        Devuelve cuántos recordatorios envió. Lo dispara el scheduler."""
        from datetime import timedelta
        from sqlalchemy import func, select
        from app.models.bitacora import BitacoraEntry
        from app.models.responsible import Responsible
        from app.models.user import User

        now = datetime.now(timezone.utc)
        cap = now - timedelta(hours=48)          # tope: no recordar pasadas 48 h
        due_before = now - timedelta(minutes=30)  # cadencia: cada 30 min

        entries = (await self.db.execute(
            select(BitacoraEntry).where(
                BitacoraEntry.status == "pendiente_obra",
                BitacoraEntry.obra_id.is_(None),
                BitacoraEntry.created_at >= cap,
                func.coalesce(BitacoraEntry.reminded_at, BitacoraEntry.created_at) <= due_before,
            )
        )).scalars().all()

        sent = 0
        for entry in entries:
            # Resolver al emisor (responsable o staff) y respetar su horario.
            if entry.responsible_id is not None:
                sender = (await self.db.execute(
                    select(Responsible).where(Responsible.id == entry.responsible_id)
                )).scalar_one_or_none()
                is_staff = False
                if sender is None:
                    continue
                cfg = await self.settings_repo.get_for_responsible(sender.id)
                if not (cfg.chatbot_enabled and _within_send_window(cfg.send_hour_from, cfg.send_hour_to)):
                    continue
            elif entry.created_by is not None:
                sender = (await self.db.execute(
                    select(User).where(User.id == entry.created_by)
                )).scalar_one_or_none()
                is_staff = True
                if sender is None or not _within_send_window(8, 20):  # franja por defecto del staff
                    continue
            else:
                continue

            number = getattr(sender, "whatsapp_number", None)
            obra_ids = await self._sender_obra_ids(sender, is_staff)
            if not number or not obra_ids:
                continue

            msg = (
                "🎤 Tenés una nota de voz sin asignar a una obra. ¿Para qué obra es?\n"
                + await self._obra_options(obra_ids)
                + "\n\nRespondé con el número."
            )
            try:
                await send_whatsapp_message(number, msg)
                entry.reminded_at = now
                sent += 1
            except Exception:
                logger.exception("No se pudo enviar recordatorio de bitácora %s", entry.id)

        await self.db.flush()
        return sent

    async def _handle_obra_selection(self, sender, is_staff: bool, body: str) -> str:
        entry = await self._pending_bitacora_obra(sender, is_staff)
        if not entry:
            return self._staff_menu(sender) if is_staff else "No tengo ninguna nota de voz pendiente."
        obra_ids = await self._sender_obra_ids(sender, is_staff)
        from sqlalchemy import select as _select
        from app.models.obra import Obra as _Obra
        _rows = (await self.db.execute(_select(_Obra.id, _Obra.name).where(_Obra.id.in_(obra_ids)))).all()
        _names_map = {r[0]: r[1] for r in _rows}
        idx = _match_numbered_option(body, [_names_map.get(oid, f"Obra #{oid}") for oid in obra_ids])
        if idx is None:
            return "No entendí. ¿Para qué obra es la nota?\n" + await self._obra_options(obra_ids)
        entry.obra_id = obra_ids[idx]
        entry.status = "pendiente_analisis" if entry.transcript else "pendiente_transcripcion"
        from app.services.bitacora_service import BitacoraService
        from app.core.tenant_denorm import tenant_for_obra
        entry.tenant_id = await tenant_for_obra(self.db, entry.obra_id)
        if entry.transcript:
            # Recién acá se sabe a qué obra (y tenant) pertenece la nota — es
            # el punto donde se dispara el análisis con Claude, así que es acá
            # donde corresponde chequear la cota de IA (audit 08-bitácora §8.1).
            from fastapi import HTTPException as _HTTPException
            try:
                await BitacoraService(self.db).assert_within_ai_quota(entry.tenant_id)
            except _HTTPException:
                entry.status = "pendiente_analisis"
                await self.db.flush()
                return ("Este mes ya se alcanzó el límite de análisis de bitácora con IA del plan. "
                        "Tu nota quedó guardada — la podés revisar por escrito desde la app.")
            await self.db.flush()
            entry_id = entry.id
            sender_phone = sender.whatsapp_number if hasattr(sender, "whatsapp_number") else None

            async def _bg_analyze():
                import asyncio
                import logging
                from app.core.database import AsyncSessionLocal
                from app.models.bitacora import BitacoraEntry as _BE
                from app.services.bitacora_service import BitacoraService as _BS
                from sqlalchemy import select

                _log = logging.getLogger(__name__)
                await asyncio.sleep(2)
                try:
                    async with AsyncSessionLocal() as bg_session:
                        bg_entry = (await bg_session.execute(
                            select(_BE).where(_BE.id == entry_id)
                        )).scalar_one_or_none()
                        if not bg_entry:
                            return
                        await _BS(bg_session).process_entry(bg_entry)
                        await bg_session.commit()
                        if sender_phone:
                            from app.integrations.twilio.client import send_whatsapp_message
                            if bg_entry.status == "procesado":
                                n = len([s for s in (bg_entry.suggestions or []) if s.get("type") != "note"])
                                msg = f"📋 Nota procesada. Resumen: {bg_entry.summary}"
                                if n:
                                    msg += f"\n\n{n} {'acciones sugeridas' if n != 1 else 'acción sugerida'} en la app."
                            else:
                                msg = "🎙️ Nota guardada. Hubo un error al analizar con IA; reintentalo desde la app."
                            await send_whatsapp_message(sender_phone, msg[:1500])
                except Exception:
                    _log.exception("Error en bg análisis de BitacoraEntry %s", entry_id)

            import asyncio as _aio
            _aio.create_task(_bg_analyze())
            return "Procesando la nota con IA — te aviso en un momento."
        else:
            await self.db.flush()
        return self._bitacora_reply(entry)

    async def _find_supplier_by_phone(self, phone: str):
        from sqlalchemy import select
        from app.models.supplier import Supplier
        # Normalize: strip whatsapp: prefix if present
        normalized = phone.replace("whatsapp:", "").strip()
        return (await self.db.execute(
            select(Supplier).where(Supplier.phone == normalized)
        )).scalar_one_or_none()

    async def _handle_supplier_pdf(
        self,
        supplier,
        media_url: str,
        content_type: str | None,
    ) -> str:
        from app.services.solicitud_service import SolicitudService
        svc = SolicitudService(self.db)
        solicitud = await svc.get_pending_for_supplier(supplier.id)
        if not solicitud:
            return (
                f"Hola {supplier.name}, recibimos tu archivo, pero no tenemos ninguna "
                "solicitud de cotización pendiente para tu empresa en este momento."
            )
        try:
            budget = await svc.receive_supplier_pdf(
                supplier_id=supplier.id,
                supplier_name=supplier.name,
                solicitud=solicitud,
                media_url=media_url,
                media_content_type=content_type,
            )
            total_txt = f" Total detectado: ${float(budget.total):,.0f}." if budget.total else ""
            return (
                f"Gracias {supplier.name}, recibimos tu cotización para la solicitud "
                f"{solicitud.ref_code}.{total_txt} "
                "La estamos procesando y te avisamos si necesitamos algo más."
            )
        except Exception as exc:
            logger.error("Error procesando PDF de proveedor %s: %s", supplier.name, exc)
            return (
                f"Gracias {supplier.name}, recibimos tu archivo para la solicitud "
                f"{solicitud.ref_code}, pero hubo un problema al procesarlo. "
                "El equipo lo revisará manualmente."
            )

    async def _handle_contratista_pdf(
        self,
        sender_name: str,
        solicitud,
        media_url: str,
        content_type: str | None,
    ) -> str:
        from app.services.solicitud_service import SolicitudService
        svc = SolicitudService(self.db)
        try:
            budget = await svc.receive_supplier_pdf(
                supplier_id=None,
                supplier_name=sender_name,
                solicitud=solicitud,
                media_url=media_url,
                media_content_type=content_type,
            )
            total_txt = f" Total detectado: ${float(budget.total):,.0f}." if budget.total else ""
            return (
                f"Gracias {sender_name}, recibimos tu cotización para la solicitud "
                f"{solicitud.ref_code}.{total_txt} "
                "La estamos revisando y te avisamos cuando tengamos una respuesta."
            )
        except Exception as exc:
            logger.error("Error procesando PDF de contratista %s: %s", sender_name, exc)
            return (
                f"Gracias {sender_name}, recibimos tu archivo para la solicitud "
                f"{solicitud.ref_code}, pero hubo un problema al procesarlo. "
                "El equipo lo revisará manualmente."
            )

    async def _handle_pending_confirmation(self, responsible, body: str) -> str:
        """Flujo de confirmación (rediseño identidad WhatsApp — parte C).

        Mientras `responsible.confirmed_at` sea NULL, este handler intercepta
        TODOS los mensajes entrantes. Solo hay dos salidas:
          - El body es una afirmación reconocida ("SI", "SÍ", "OK",
            "CONFIRMAR", "CONFIRMO", "S") → seteamos confirmed_at y damos
            la bienvenida.
          - Cualquier otro → repetimos el pedido de confirmación.

        La decisión de aceptar variantes ampliadas ("OK", "S") es una concesión
        de UX — un obrero con teclado touch puede tipear cualquiera de esas y
        entender que aceptó. Si en el futuro se quiere ser más estricto (solo
        "SI"), acotar el set.
        """
        norm = (body or "").strip().upper().rstrip(".!?¡¿").replace("Í", "I")
        if norm in {"SI", "OK", "CONFIRMAR", "CONFIRMO", "S", "SIP", "DALE"}:
            responsible.confirmed_at = datetime.now(timezone.utc)
            await self.resp_repo.session.flush()
            nombre = (responsible.full_name or "").split(" ")[0] or "👷"
            return (
                f"¡Listo {nombre}! Tu acceso a CONSTRUCTA está confirmado. "
                "Ya podés reportar avances, pedir planos y mandarme notas de voz."
            )
        return (
            "Todavía no confirmaste tu acceso al sistema CONSTRUCTA. "
            "Respondé *SI* para activar tu cuenta."
        )

    async def _save_message(self, data: MessageCreateInternal) -> Message:
        msg = Message(**data.model_dump())
        return await self.msg_repo.create(msg)

    async def list_by_task(self, task_id: int) -> list[Message]:
        return await self.msg_repo.list_by_task(task_id)

    async def list_by_responsible(self, responsible_id: int) -> list[Message]:
        return await self.msg_repo.list_by_responsible(responsible_id)
