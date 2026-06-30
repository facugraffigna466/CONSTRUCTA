"""Servicio de solicitudes de cotización.

Flujo completo:
  1. create()         → crea la solicitud, genera PDF, envía por WA/email
  2. receive_pdf()    → llamado desde message_service cuando proveedor envía PDF
  3. _run_ai_analysis → cuando hay 2+ respuestas, genera análisis comparativo con Claude
  4. list_for_obra()  → devuelve solicitudes con sus respuestas y análisis
  5. confirmar()      → proveedor elegido → crea PurchaseOrder y marca materiales como "pedido"
"""
from __future__ import annotations

import io
import json
import logging
from datetime import datetime, timezone
from typing import Any

import httpx
from sqlalchemy import func, insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.budget import Budget
from app.models.purchase_order import PurchaseOrder, PurchaseOrderItem
from app.models.solicitud_cotizacion import (
    SolicitudCotizacion,
    SolicitudSupplier,
    solicitud_materiales,
)
from app.models.supplier import Supplier
from app.models.task_material import TaskMaterial
from app.models.obra import Obra
from app.repositories.historial import HistorialRepository
from app.schemas.solicitud_cotizacion import (
    AnalisisComparativoRead,
    ComparacionItemRead,
    PrecioItemRead,
    RespuestaCotizacionRead,
    RespuestaItemRead,
    SolicitudCotizacionRead,
    SolicitudSupplierRead,
)

logger = logging.getLogger(__name__)

# ── Esquema JSON para el análisis comparativo ─────────────────────────────────

def _nullable(t: str) -> dict:
    return {"anyOf": [{"type": t}, {"type": "null"}]}


_ANALISIS_SCHEMA = {
    "type": "object",
    "properties": {
        "resumen": {"type": "string"},
        "comparacion_items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "nombre": {"type": "string"},
                    "precios": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "supplier_id": {"type": "integer"},
                                "supplier_name": {"type": "string"},
                                "precio_unitario": _nullable("number"),
                                "subtotal": _nullable("number"),
                            },
                            "required": ["supplier_id", "supplier_name", "precio_unitario", "subtotal"],
                            "additionalProperties": False,
                        },
                    },
                    "mas_barato_id": _nullable("integer"),
                    "diferencia": _nullable("number"),
                },
                "required": ["nombre", "precios", "mas_barato_id", "diferencia"],
                "additionalProperties": False,
            },
        },
        "donde_ganas": {"type": "array", "items": {"type": "string"}},
        "donde_pierdes": {"type": "array", "items": {"type": "string"}},
        "condiciones_pago": {"type": "string"},
        "plazos": {"type": "string"},
        "riesgos": {"type": "array", "items": {"type": "string"}},
        "recomendacion": {"type": "string"},
        "supplier_recomendado_id": _nullable("integer"),
    },
    "required": [
        "resumen", "comparacion_items", "donde_ganas", "donde_pierdes",
        "condiciones_pago", "plazos", "riesgos", "recomendacion", "supplier_recomendado_id",
    ],
    "additionalProperties": False,
}


class SolicitudService:
    def __init__(self, session: AsyncSession) -> None:
        self.db = session

    # ── helpers ───────────────────────────────────────────────────────────────

    async def _next_ref_code(self, obra_id: int) -> str:
        count = (await self.db.execute(
            select(func.count()).where(SolicitudCotizacion.obra_id == obra_id)
        )).scalar_one()
        return f"COT-{count + 1:02d}"

    async def _get_obra(self, obra_id: int) -> Obra:
        obra = await self.db.get(Obra, obra_id)
        if not obra:
            raise ValueError(f"Obra {obra_id} no encontrada")
        return obra

    # ── PDF de solicitud ──────────────────────────────────────────────────────

    @staticmethod
    def _build_pdf(
        ref_code: str,
        obra_name: str,
        materials: list[TaskMaterial],
        notes: str | None,
        supplier_name: str | None = None,
    ) -> bytes:
        """Genera un PDF simple de la solicitud de cotización.
        Usa reportlab si está disponible; devuelve texto plano en PDF stub si no.
        """
        try:
            from reportlab.lib.pagesizes import A4
            from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
            from reportlab.lib.units import cm
            from reportlab.lib import colors
            from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle

            buf = io.BytesIO()
            doc = SimpleDocTemplate(buf, pagesize=A4, rightMargin=2*cm, leftMargin=2*cm, topMargin=2*cm, bottomMargin=2*cm)
            styles = getSampleStyleSheet()
            story: list = []

            title_style = ParagraphStyle("title", parent=styles["Heading1"], fontSize=16, spaceAfter=4)
            sub_style   = ParagraphStyle("sub",   parent=styles["Normal"],   fontSize=10, textColor=colors.HexColor("#6B7580"), spaceAfter=12)
            label_style = ParagraphStyle("label", parent=styles["Normal"],   fontSize=9,  textColor=colors.HexColor("#7A7167"), spaceAfter=2)

            story.append(Paragraph(f"Solicitud de Cotización — {ref_code}", title_style))
            story.append(Paragraph(f"Obra: {obra_name}", sub_style))
            if supplier_name:
                story.append(Paragraph(f"Para: {supplier_name}", sub_style))

            story.append(Spacer(1, 0.3*cm))
            story.append(Paragraph("MATERIALES REQUERIDOS", label_style))

            headers = ["Descripción", "Cantidad", "Unidad"]
            rows: list[list[str]] = [headers]
            for m in materials:
                rows.append([
                    m.name,
                    str(float(m.quantity)) if m.quantity else "—",
                    m.unit or "—",
                ])

            t = Table(rows, colWidths=[10*cm, 3*cm, 3*cm])
            t.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1A2329")),
                ("TEXTCOLOR",  (0, 0), (-1, 0), colors.white),
                ("FONTSIZE",   (0, 0), (-1, 0), 9),
                ("FONTSIZE",   (0, 1), (-1, -1), 9),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#FAFAF8")]),
                ("GRID",       (0, 0), (-1, -1), 0.5, colors.HexColor("#E6E7E5")),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING",(0, 0), (-1, -1), 6),
                ("TOPPADDING",  (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING",(0, 0), (-1, -1), 5),
            ]))
            story.append(t)

            if notes:
                story.append(Spacer(1, 0.5*cm))
                story.append(Paragraph(f"Notas: {notes}", styles["Normal"]))

            story.append(Spacer(1, 0.5*cm))
            story.append(Paragraph("Enviado desde CONSTRUCTA — app de gestión de obras.", sub_style))

            doc.build(story)
            return buf.getvalue()

        except ImportError:
            # Fallback: devuelve un PDF mínimo con el contenido en texto
            lines = [
                f"%PDF-1.4",
                f"% Solicitud {ref_code} — Obra {obra_name}",
                f"% Materiales: {', '.join(m.name for m in materials)}",
            ]
            return "\n".join(lines).encode()

    # ── Crear solicitud ───────────────────────────────────────────────────────

    async def create(
        self,
        obra_id: int,
        material_ids: list[int],
        supplier_ids: list[int],
        notes: str | None,
        created_by: int | None,
        contratista_phones: list[str] | None = None,
    ) -> SolicitudCotizacion:
        from app.integrations.twilio.client import send_whatsapp_message

        obra = await self._get_obra(obra_id)

        # Validar materiales de la obra
        materials = (await self.db.execute(
            select(TaskMaterial)
            .where(TaskMaterial.id.in_(material_ids))
        )).scalars().all()
        if not materials:
            raise ValueError("Ningún material válido")

        # Validar proveedores (puede ser lista vacía → borrador sin envío)
        suppliers: list[Supplier] = []
        if supplier_ids:
            suppliers = list((await self.db.execute(
                select(Supplier).where(Supplier.id.in_(supplier_ids))
            )).scalars().all())

        # Crear solicitud
        ref_code = await self._next_ref_code(obra_id)
        sol = SolicitudCotizacion(
            obra_id=obra_id,
            ref_code=ref_code,
            status="borrador",
            notes=notes,
            created_by=created_by,
            contratista_phone=contratista_phones[0] if contratista_phones else None,
        )
        self.db.add(sol)
        await self.db.flush()

        # Asociar materiales (M2M)
        for m in materials:
            await self.db.execute(
                insert(solicitud_materiales).values(solicitud_id=sol.id, material_id=m.id)
            )

        # Asociar proveedores y enviar PDF por WA a cada uno (solo si hay proveedores)
        if suppliers:
            now = datetime.now(timezone.utc)
            sol.sent_at = now

            for supplier in suppliers:
                sent = False

                if supplier.phone:
                    try:
                        msg = (
                            f"Solicitud de cotización {ref_code} — Obra: {obra.name}\n"
                            f"Materiales: {', '.join(m.name for m in materials)}\n"
                            f"{"Notas: " + notes if notes else ""}\n\n"
                            "Adjuntamos el detalle en el PDF. Respondé a este mensaje con tu cotización."
                        )
                        await send_whatsapp_message(supplier.phone, msg)
                        sent = True
                    except Exception as exc:
                        logger.warning("No se pudo enviar WA a %s: %s", supplier.name, exc)

                self.db.add(SolicitudSupplier(
                    solicitud_id=sol.id,
                    supplier_id=supplier.id,
                    status="enviada",
                    sent_at=now if sent else None,
                ))

            sol.status = "enviada"

        # Enviar por WA directo a contratistas que no son Supplier formal
        if contratista_phones:
            now_ct = datetime.now(timezone.utc)
            if not sol.sent_at:
                sol.sent_at = now_ct
            ct_msg = (
                f"Solicitud de cotización {ref_code} — Obra: {obra.name}\n"
                f"Materiales: {', '.join(m.name for m in materials)}\n"
                + (f"Notas: {notes}\n" if notes else "")
                + "\nPor favor respondé con tu cotización. Gracias."
            )
            for phone in contratista_phones:
                try:
                    await send_whatsapp_message(phone, ct_msg)
                except Exception as exc:
                    logger.warning("No se pudo enviar WA a contratista %s: %s", phone, exc)
            sol.status = "enviada"

        await self.db.flush()
        await self.db.refresh(sol)

        await HistorialRepository(self.db).log(
            event_type="solicitud_cotizacion_creada",
            description=(
                f"Solicitud {ref_code} "
                + (
                    f"enviada a {', '.join(s.name for s in suppliers)}"
                    if suppliers else "guardada como borrador (sin proveedor registrado)"
                )
                + f" ({len(materials)} material{'es' if len(materials) != 1 else ''})"
            ),
            obra_id=obra_id,
            payload={
                "solicitud_id": sol.id,
                "ref_code": ref_code,
                "material_ids": [m.id for m in materials],
                "supplier_ids": [s.id for s in suppliers],
            },
            triggered_by="user",
        )
        return sol

    # ── Recibir PDF de proveedor (desde WhatsApp) ─────────────────────────────

    async def receive_supplier_pdf(
        self,
        supplier_id: int | None,
        supplier_name: str,
        solicitud: SolicitudCotizacion,
        media_url: str,
        media_content_type: str | None = None,
    ) -> Budget:
        """Descarga el PDF del proveedor, lo extrae con IA y lo vincula a la solicitud.
        Si hay 2+ respuestas genera el análisis comparativo automáticamente.
        """
        from app.services.budget_service import BudgetService

        # Descargar PDF de Twilio/Evolution
        file_bytes: bytes | None = None
        content_type = media_content_type or "application/pdf"

        try:
            auth: tuple[str, str] | None = None
            if settings.TWILIO_ACCOUNT_SID and settings.TWILIO_AUTH_TOKEN:
                auth = (settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)
            async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
                resp = await client.get(media_url, auth=auth)
                resp.raise_for_status()
                file_bytes = resp.content
                if not media_content_type:
                    content_type = resp.headers.get("content-type", "application/pdf").split(";")[0].strip()
        except Exception as exc:
            logger.error("Error descargando PDF de %s: %s", media_url, exc)

        # Extraer datos con IA (BudgetService ya tiene toda la lógica)
        bsvc = BudgetService(self.db)
        budget = await bsvc.create(
            tenant_id=None,
            created_by=None,
            obra_id=solicitud.obra_id,
            supplier_name=supplier_name,
            file_bytes=file_bytes,
            content_type=content_type,
            filename=f"{solicitud.ref_code}_{supplier_name.replace(' ', '_')}.pdf",
        )
        # Vincular a la solicitud
        budget.solicitud_id = solicitud.id
        budget.supplier_id = supplier_id
        await self.db.flush()

        # Marcar proveedor como respondido
        for link in solicitud.supplier_links:
            if link.supplier_id == supplier_id:
                link.status = "respondida"
                break

        # Actualizar estado de la solicitud
        solicitud.status = "respondida"
        await self.db.flush()
        await self.db.refresh(solicitud)

        # Si hay 2+ respuestas únicas → generar análisis comparativo
        # Incluir contratistas (supplier_id=None con supplier_name) y deduplicar por supplier
        _seen: set = set()
        respuestas = []
        for b in sorted(solicitud.respuestas, key=lambda x: x.created_at, reverse=True):
            if b.status == "error":
                continue
            if b.supplier_id is None and not b.supplier_name:
                continue
            key = b.supplier_id if b.supplier_id is not None else b.supplier_name
            if key not in _seen:
                _seen.add(key)
                respuestas.append(b)
        if len(respuestas) >= 2:
            try:
                analisis = await self._run_ai_analysis(solicitud, respuestas)
                # Guardar en la última respuesta recibida (la del budget que acabamos de crear)
                budget.ai_analysis = json.dumps(analisis, ensure_ascii=False)
                await self.db.flush()
            except Exception as exc:
                logger.error("Error generando análisis IA para solicitud %s: %s", solicitud.ref_code, exc)

        await HistorialRepository(self.db).log(
            event_type="cotizacion_recibida",
            description=(
                f"Cotización de {supplier_name} recibida para solicitud {solicitud.ref_code}"
                + (f" — Total: ${float(budget.total):,.0f}" if budget.total else "")
            ),
            obra_id=solicitud.obra_id,
            payload={"solicitud_id": solicitud.id, "budget_id": budget.id, "supplier_id": supplier_id},
            triggered_by="whatsapp",
        )
        return budget

    # ── Análisis comparativo con IA ───────────────────────────────────────────

    async def _run_ai_analysis(
        self,
        solicitud: SolicitudCotizacion,
        respuestas: list[Budget],
    ) -> dict:
        if not settings.ANTHROPIC_API_KEY:
            raise ValueError("ANTHROPIC_API_KEY no configurada")

        import anthropic

        # Armar prompt con los datos estructurados
        presupuestos_txt = []
        for b in respuestas:
            d = b.data or {}
            items_txt = "\n".join(
                f"    - {it['descripcion']}: {it.get('cantidad','')} {it.get('unidad','')} "
                f"@ ${it.get('precio_unitario','?')} = ${it.get('subtotal','?')}"
                for it in (d.get("items") or [])
            )
            presupuestos_txt.append(
                f"Proveedor: {b.supplier_name} (ID: {b.supplier_id})\n"
                f"Total: ${float(b.total):,.0f}\n"
                f"Plazo: {d.get('plazo_entrega') or '—'}\n"
                f"Pago: {d.get('condiciones_pago') or '—'}\n"
                f"Validez: {d.get('validez') or '—'}\n"
                f"Flete: {'sí' if d.get('incluye_flete') else ('no' if d.get('incluye_flete') is False else '—')}\n"
                f"Ítems:\n{items_txt}"
            )

        mats_txt = ", ".join(m.name for m in solicitud.materials)
        prompt = (
            f"Solicitud {solicitud.ref_code} para obra {solicitud.obra_id}.\n"
            f"Materiales solicitados: {mats_txt}\n\n"
            "PRESUPUESTOS RECIBIDOS:\n\n" +
            "\n\n---\n\n".join(presupuestos_txt)
        )

        client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        resp = await client.messages.create(
            model=settings.CLAUDE_MODEL,
            max_tokens=2048,
            system=(
                "Sos asesor de compras de obras de construcción para CONSTRUCTA. "
                "Recibís cotizaciones de proveedores (ya extraídas en texto estructurado) "
                "y producís un análisis comparativo detallado.\n\n"
                "Reglas:\n"
                "- Comparar ítem por ítem cuando los nombres coincidan (sé flexible con variantes).\n"
                "- donde_ganas: 2-4 ventajas concretas del proveedor recomendado.\n"
                "- donde_pierdes: 2-4 desventajas concretas del proveedor recomendado.\n"
                "- riesgos: alertas específicas (validez próxima a vencer, flete no especificado, etc.).\n"
                "- recomendacion: 1-2 oraciones directas en español rioplatense.\n"
                "- supplier_recomendado_id: el ID (integer) del proveedor recomendado.\n"
                "- No inventés datos que no figuren."
            ),
            messages=[{"role": "user", "content": prompt}],
            output_config={"format": {"type": "json_schema", "schema": _ANALISIS_SCHEMA}},
        )
        text = next(b.text for b in resp.content if b.type == "text")
        return json.loads(text)

    # ── Listar solicitudes de una obra ────────────────────────────────────────

    async def list_for_obra(self, obra_id: int) -> list[SolicitudCotizacionRead]:
        result = await self.db.execute(
            select(SolicitudCotizacion)
            .where(SolicitudCotizacion.obra_id == obra_id)
            .order_by(SolicitudCotizacion.created_at.desc())
        )
        solicitudes = result.scalars().all()
        return [await self._to_read(sol) for sol in solicitudes]

    async def _to_read(self, sol: SolicitudCotizacion) -> SolicitudCotizacionRead:
        # Proveedores con nombre
        supplier_ids = [link.supplier_id for link in sol.supplier_links]
        suppliers_db: dict[int, Supplier] = {}
        if supplier_ids:
            rows = (await self.db.execute(
                select(Supplier).where(Supplier.id.in_(supplier_ids))
            )).scalars().all()
            suppliers_db = {s.id: s for s in rows}

        supplier_reads = [
            SolicitudSupplierRead(
                supplier_id=link.supplier_id,
                supplier_name=suppliers_db.get(link.supplier_id, Supplier(name="—")).name,
                supplier_phone=suppliers_db.get(link.supplier_id, Supplier()).phone,
                status=link.status,
                sent_at=link.sent_at,
            )
            for link in sol.supplier_links
        ]

        # Respuestas (budgets vinculados) — deduplicar por supplier, solo el más reciente
        respuesta_reads: list[RespuestaCotizacionRead] = []
        ai_analysis: AnalisisComparativoRead | None = None
        seen_supplier_keys: set = set()

        for b in sorted(sol.respuestas, key=lambda x: x.created_at, reverse=True):
            if b.status == "error" or (b.supplier_id is None and not b.supplier_name):
                continue
            supplier_key = b.supplier_id if b.supplier_id is not None else b.supplier_name
            if supplier_key in seen_supplier_keys:
                continue
            seen_supplier_keys.add(supplier_key)
            sup = suppliers_db.get(b.supplier_id) if b.supplier_id else None
            d = b.data or {}

            items = [
                RespuestaItemRead(
                    nombre=it.get("descripcion", ""),
                    cantidad=it.get("cantidad"),
                    unidad=it.get("unidad"),
                    precio_unitario=it.get("precio_unitario"),
                    subtotal=it.get("subtotal"),
                )
                for it in (d.get("items") or [])
            ]
            incons_raw = d.get("inconsistencias")
            respuesta_reads.append(RespuestaCotizacionRead(
                id=b.id,
                solicitud_id=sol.id,
                supplier_id=b.supplier_id,
                supplier_name=b.supplier_name or (sup.name if sup else "—"),
                total=float(b.total) if b.total is not None else None,
                currency=b.currency,
                plazo_entrega=d.get("plazo_entrega"),
                condiciones_pago=d.get("condiciones_pago"),
                validez=d.get("validez"),
                rubro=d.get("rubro"),
                proveedor_nombre=d.get("proveedor"),
                fecha=d.get("fecha"),
                iva_pct=float(d["iva_pct"]) if d.get("iva_pct") is not None else None,
                iva_monto=float(d["iva_monto"]) if d.get("iva_monto") is not None else None,
                incluye_flete=d.get("incluye_flete"),
                inconsistencias=[i if isinstance(i, dict) else vars(i) for i in incons_raw] if incons_raw else None,
                created_at=b.created_at,
                items=items,
            ))
            # El análisis IA está en la respuesta más reciente que lo tenga
            if b.ai_analysis and not ai_analysis:
                try:
                    raw = json.loads(b.ai_analysis)
                    ai_analysis = AnalisisComparativoRead(**raw)
                except Exception:
                    pass

        return SolicitudCotizacionRead(
            id=sol.id,
            obra_id=sol.obra_id,
            ref_code=sol.ref_code,
            status=sol.status,
            notes=sol.notes,
            pdf_url=sol.pdf_url,
            contratista_phone=sol.contratista_phone,
            created_at=sol.created_at,
            sent_at=sol.sent_at,
            material_ids=[m.id for m in sol.materials],
            suppliers=supplier_reads,
            respuestas=respuesta_reads,
            analisis_ia=ai_analysis,
        )

    # ── Confirmar proveedor → crear PurchaseOrder ─────────────────────────────

    async def confirmar(
        self,
        solicitud_id: int,
        supplier_id: int,
        confirmed_by: int | None,
    ) -> PurchaseOrder:
        from app.integrations.twilio.client import send_whatsapp_message

        sol = await self.db.get(SolicitudCotizacion, solicitud_id)
        if not sol:
            raise ValueError("Solicitud no encontrada")

        supplier = await self.db.get(Supplier, supplier_id)
        if not supplier:
            raise ValueError("Proveedor no encontrado")

        obra = await self._get_obra(sol.obra_id)

        # Crear la orden de compra
        order = PurchaseOrder(
            obra_id=sol.obra_id,
            supplier_id=supplier_id,
            created_by=confirmed_by,
            notes=sol.notes,
            status="borrador",
        )
        self.db.add(order)
        await self.db.flush()

        # Agregar ítems y marcar materiales como pedido
        for m in sol.materials:
            self.db.add(PurchaseOrderItem(
                order_id=order.id,
                material_id=m.id,
                name=m.name,
                quantity=m.quantity,
                unit=m.unit,
                unit_price=m.unit_price,
            ))
            m.status = "pedido"

        # Marcar solicitud como confirmada
        sol.status = "confirmada"
        await self.db.flush()
        await self.db.refresh(order)

        # Notificar al proveedor por WhatsApp que su cotización fue aceptada
        phone = supplier.phone or sol.contratista_phone
        if phone:
            try:
                mat_names = ", ".join(m.name for m in sol.materials)
                accept_msg = (
                    f"Hola {supplier.name}! Confirmamos que aceptamos tu cotización "
                    f"{sol.ref_code} para la obra {obra.name}.\n"
                    f"Materiales: {mat_names}.\n"
                    "Te contactaremos para coordinar la entrega. Gracias!"
                )
                await send_whatsapp_message(phone, accept_msg)
            except Exception as exc:
                logger.warning("No se pudo notificar aceptación a %s: %s", supplier.name, exc)

        await HistorialRepository(self.db).log(
            event_type="cotizacion_confirmada",
            description=(
                f"Cotización {sol.ref_code} confirmada con {supplier.name}. "
                f"Pedido #{order.id} generado."
            ),
            obra_id=sol.obra_id,
            payload={
                "solicitud_id": sol.id,
                "supplier_id": supplier_id,
                "order_id": order.id,
            },
            triggered_by="user",
        )
        return order

    # ── Borrar solicitud ──────────────────────────────────────────────────────

    async def delete_solicitud(self, solicitud_id: int) -> None:
        sol = await self.db.get(SolicitudCotizacion, solicitud_id)
        if not sol:
            raise ValueError("Solicitud no encontrada")
        # DB cascade handles solicitud_materiales, solicitud_suppliers, budget.solicitud_id=NULL
        await self.db.delete(sol)
        await self.db.flush()

    # ── Análisis histórico de compras (on-demand, usa IA) ─────────────────────

    _HISTORICO_SCHEMA = {
        "type": "object",
        "properties": {
            "proveedor_recomendado": {"anyOf": [{"type": "string"}, {"type": "null"}]},
            "motivo": {"type": "string"},
            "por_proveedor": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "nombre": {"type": "string"},
                        "cotizaciones_respondidas": {"type": "integer"},
                        "precio_promedio": {"anyOf": [{"type": "number"}, {"type": "null"}]},
                        "precio_min": {"anyOf": [{"type": "number"}, {"type": "null"}]},
                        "precio_max": {"anyOf": [{"type": "number"}, {"type": "null"}]},
                        "tendencia": {"type": "string"},
                        "fortaleza": {"type": "string"},
                    },
                    "required": ["nombre", "cotizaciones_respondidas", "precio_promedio", "precio_min", "precio_max", "tendencia", "fortaleza"],
                    "additionalProperties": False,
                },
            },
            "materiales_criticos": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "nombre": {"type": "string"},
                        "proveedor_mas_barato": {"anyOf": [{"type": "string"}, {"type": "null"}]},
                        "diferencia_pct": {"anyOf": [{"type": "number"}, {"type": "null"}]},
                        "veces_cotizado": {"type": "integer"},
                    },
                    "required": ["nombre", "proveedor_mas_barato", "diferencia_pct", "veces_cotizado"],
                    "additionalProperties": False,
                },
            },
            "alertas": {"type": "array", "items": {"type": "string"}},
            "ahorro_potencial": {"anyOf": [{"type": "number"}, {"type": "null"}]},
        },
        "required": ["proveedor_recomendado", "motivo", "por_proveedor", "materiales_criticos", "alertas", "ahorro_potencial"],
        "additionalProperties": False,
    }

    async def analizar_historico(self, obra_id: int) -> dict:
        if not settings.ANTHROPIC_API_KEY:
            raise ValueError("ANTHROPIC_API_KEY no configurada")

        import anthropic

        obra = await self._get_obra(obra_id)
        reads = await self.list_for_obra(obra_id)
        respondidas = [s for s in reads if s.respuestas]
        if not respondidas:
            raise ValueError("No hay cotizaciones respondidas para analizar")

        lines: list[str] = [f"Obra: {obra.name}\nTotal solicitudes con respuesta: {len(respondidas)}\n"]
        for sol in respondidas:
            lines.append(f"=== {sol.ref_code} (status: {sol.status}) ===")
            for r in sol.respuestas:
                items_txt = " | ".join(
                    f"{it.nombre} x{it.cantidad or 1} = {('$' + f'{it.subtotal:,.0f}') if it.subtotal else '?'}"
                    for it in r.items[:6]
                )
                total_str = f"${float(r.total):,.0f}" if r.total is not None else "?"
                flete_str = "sí" if r.incluye_flete else ("no" if r.incluye_flete is False else "-")
                lines.append(
                    f"  [{r.supplier_name}] total={total_str}"
                    f" plazo={r.plazo_entrega or '-'}"
                    f" pago={r.condiciones_pago or '-'}"
                    f" flete={flete_str}"
                    + (f"\n    ítems: {items_txt}" if items_txt else "")
                )
        summary = "\n".join(lines)

        client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        resp = await client.messages.create(
            model=settings.CLAUDE_MODEL,
            max_tokens=1200,
            system=(
                "Sos analista de compras de obras de construcción en Argentina. "
                "Analizás el historial de cotizaciones de una obra y producís un análisis estadístico conciso. "
                "Reglas: sé directo, usá números y porcentajes, evitá texto de relleno. "
                "motivo: máximo 1 oración. tendencia: una de estas palabras exactas: competitivo/caro/variable/sin_datos. "
                "fortaleza: máximo 4 palabras. alertas: máximo 3 ítems, cada uno máximo 10 palabras."
            ),
            messages=[{"role": "user", "content": summary}],
            output_config={"format": {"type": "json_schema", "schema": SolicitudService._HISTORICO_SCHEMA}},
        )
        text = next(b.text for b in resp.content if b.type == "text")
        return json.loads(text)

    # ── Confirmar contratista → auto-crear Supplier → crear PurchaseOrder ────

    async def confirmar_contratista(
        self,
        solicitud_id: int,
        supplier_name: str,
        supplier_phone: str | None,
        confirmed_by: int | None,
    ) -> PurchaseOrder:
        sol = await self.db.get(SolicitudCotizacion, solicitud_id)
        if not sol:
            raise ValueError("Solicitud no encontrada")

        phone = supplier_phone or sol.contratista_phone

        # Buscar si ya existe un Supplier con ese nombre o teléfono
        existing: Supplier | None = None
        if phone:
            result = await self.db.execute(select(Supplier).where(Supplier.phone == phone).limit(1))
            existing = result.scalar_one_or_none()
        if not existing:
            result = await self.db.execute(
                select(Supplier).where(Supplier.name.ilike(supplier_name)).limit(1)
            )
            existing = result.scalar_one_or_none()

        if existing:
            supplier = existing
        else:
            supplier = Supplier(name=supplier_name, phone=phone, is_active=True)
            self.db.add(supplier)
            await self.db.flush()

        return await self.confirmar(solicitud_id, supplier.id, confirmed_by)

    # ── Lookup para routing WhatsApp ──────────────────────────────────────────

    async def get_pending_for_supplier(
        self, supplier_id: int
    ) -> SolicitudCotizacion | None:
        """Busca la solicitud más reciente en estado 'enviada' para este proveedor."""
        result = await self.db.execute(
            select(SolicitudCotizacion)
            .join(SolicitudSupplier, SolicitudCotizacion.id == SolicitudSupplier.solicitud_id)
            .where(
                SolicitudSupplier.supplier_id == supplier_id,
                SolicitudCotizacion.status.in_(["enviada", "respondida"]),
            )
            .order_by(SolicitudCotizacion.created_at.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def get_pending_for_phone(self, phone: str) -> SolicitudCotizacion | None:
        """Busca la solicitud más reciente enviada directamente a un número de teléfono
        (contratistas que no son proveedores formales)."""
        normalized = phone.replace("whatsapp:", "").strip()
        result = await self.db.execute(
            select(SolicitudCotizacion)
            .where(
                SolicitudCotizacion.contratista_phone == normalized,
                SolicitudCotizacion.status.in_(["enviada", "respondida"]),
            )
            .order_by(SolicitudCotizacion.created_at.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()
