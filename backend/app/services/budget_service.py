from __future__ import annotations

import base64
import io
import json
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import NotFoundError
from app.models.budget import Budget
from app.models.obra import Obra

# ── Schema de extracción (structured output de Claude) ──────────────────────────
# Nota: la API rechaza enum sobre tipo union; se usa anyOf para los nullables.

def _nullable(t: str) -> dict:
    return {"anyOf": [{"type": t}, {"type": "null"}]}


_BUDGET_SCHEMA = {
    "type": "object",
    "properties": {
        "proveedor": _nullable("string"),
        "fecha": {**_nullable("string"), "description": "Fecha del presupuesto YYYY-MM-DD si aparece"},
        "rubro": {**_nullable("string"), "description": "Categoría principal: ej Hormigón, Electricidad, Sanitarios, Aberturas"},
        "moneda": {"type": "string", "description": "ARS o USD"},
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "descripcion": {"type": "string"},
                    "cantidad": _nullable("number"),
                    "unidad": _nullable("string"),
                    "precio_unitario": _nullable("number"),
                    "subtotal": _nullable("number"),
                },
                "required": ["descripcion", "cantidad", "unidad", "precio_unitario", "subtotal"],
                "additionalProperties": False,
            },
        },
        "subtotal": _nullable("number"),
        "iva_pct": _nullable("number"),
        "iva_monto": _nullable("number"),
        "total": _nullable("number"),
        "incluye_flete": _nullable("boolean"),
        "plazo_entrega": _nullable("string"),
        "condiciones_pago": _nullable("string"),
        "validez": {**_nullable("string"), "description": "Hasta cuándo es válido el presupuesto (texto o fecha)"},
        "inconsistencias": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "tipo": {"type": "string"},
                    "detalle": {"type": "string"},
                    "severidad": {"type": "string", "enum": ["alta", "media", "baja"]},
                },
                "required": ["tipo", "detalle", "severidad"],
                "additionalProperties": False,
            },
        },
    },
    "required": [
        "proveedor", "fecha", "rubro", "moneda", "items", "subtotal", "iva_pct",
        "iva_monto", "total", "incluye_flete", "plazo_entrega", "condiciones_pago",
        "validez", "inconsistencias",
    ],
    "additionalProperties": False,
}

_IMG_TYPES = {
    "image/png": "png", "image/jpeg": "jpeg", "image/jpg": "jpeg",
    "image/webp": "webp", "image/gif": "gif",
}


class BudgetService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # ── Lectura del documento ────────────────────────────────────────────────

    @staticmethod
    def _excel_to_text(data: bytes) -> str:
        import openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(data), data_only=True, read_only=True)
        lines: list[str] = []
        for ws in wb.worksheets:
            lines.append(f"# Hoja: {ws.title}")
            for row in ws.iter_rows(values_only=True):
                cells = [str(c) for c in row if c is not None]
                if cells:
                    lines.append("\t".join(cells))
        return "\n".join(lines)

    def _build_content(self, *, text: str | None, file_bytes: bytes | None, content_type: str | None) -> tuple[list, str, str]:
        """Devuelve (content_blocks_para_claude, source_type, raw_text)."""
        instr = (
            "Extraé los datos del siguiente presupuesto de proveedor de obra "
            "(contexto Argentina, pesos ARS salvo que diga USD)."
        )
        if file_bytes and content_type == "application/pdf":
            b64 = base64.standard_b64encode(file_bytes).decode()
            return (
                [
                    {"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": b64}},
                    {"type": "text", "text": instr},
                ],
                "pdf", "",
            )
        if file_bytes and content_type in _IMG_TYPES:
            b64 = base64.standard_b64encode(file_bytes).decode()
            return (
                [
                    {"type": "image", "source": {"type": "base64", "media_type": content_type, "data": b64}},
                    {"type": "text", "text": instr},
                ],
                "image", "",
            )
        if file_bytes and (content_type in (
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/vnd.ms-excel",
        )):
            raw = self._excel_to_text(file_bytes)
            return ([{"type": "text", "text": f"{instr}\n\n{raw}"}], "excel", raw)
        raw = (text or "").strip()
        return ([{"type": "text", "text": f"{instr}\n\n{raw}"}], "texto", raw)

    async def _analyze(self, content: list) -> dict:
        if not settings.ANTHROPIC_API_KEY:
            raise ValueError(
                "ANTHROPIC_API_KEY no está configurada. Agregala al .env del backend para habilitar la lectura con IA."
            )
        import anthropic

        today = date.today().isoformat()
        system = (
            "Sos el asistente de presupuestos de CONSTRUCTA, app de gestión de obras de construcción. "
            "Recibís un presupuesto/cotización de un proveedor (puede venir como PDF, imagen, planilla o texto) "
            "y extraés sus datos de forma estructurada.\n\n"
            "Reglas:\n"
            f"- Hoy es {today}. Contexto Argentina; la moneda por defecto es ARS (pesos), salvo que diga USD.\n"
            "- Detectá el rubro principal (Hormigón, Electricidad, Sanitarios, Aberturas, Mampostería, etc.).\n"
            "- Listá los ítems con cantidad, unidad, precio unitario y subtotal cuando estén.\n"
            "- Si un dato no figura, devolvelo como null (no lo inventes).\n"
            "- En 'inconsistencias' marcá problemas o faltantes del presupuesto, por ejemplo:\n"
            "    · no aclara si incluye flete/envío\n"
            "    · IVA no discriminado o sin aclarar\n"
            "    · validez vencida respecto a hoy, o sin validez indicada\n"
            "    · faltan precios unitarios o el total no cierra con la suma de ítems\n"
            "    · condiciones de pago no especificadas\n"
            "  Cada inconsistencia con tipo corto, detalle claro (español rioplatense) y severidad alta/media/baja.\n"
            "- Si el presupuesto está completo y prolijo, devolvé inconsistencias vacío."
        )
        client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        resp = await client.messages.create(
            model=settings.CLAUDE_MODEL,
            max_tokens=4096,
            system=system,
            messages=[{"role": "user", "content": content}],
            output_config={"format": {"type": "json_schema", "schema": _BUDGET_SCHEMA}},
        )
        text = next(b.text for b in resp.content if b.type == "text")
        return json.loads(text)

    # ── Crear (texto o archivo) ──────────────────────────────────────────────

    async def create(
        self,
        *,
        tenant_id: int | None,
        created_by: int | None,
        obra_id: int | None = None,
        supplier_name: str | None = None,
        text: str | None = None,
        file_bytes: bytes | None = None,
        content_type: str | None = None,
        filename: str | None = None,
    ) -> Budget:
        content, source_type, raw_text = self._build_content(
            text=text, file_bytes=file_bytes, content_type=content_type
        )
        budget = Budget(
            tenant_id=tenant_id, created_by=created_by, obra_id=obra_id,
            supplier_name=supplier_name, source_type=source_type,
            source_filename=filename, raw_text=raw_text or None,
        )
        try:
            data = await self._analyze(content)
            budget.data = data
            budget.inconsistencies = data.get("inconsistencias") or []
            budget.supplier_name = supplier_name or data.get("proveedor") or None
            budget.rubro = data.get("rubro") or None
            budget.currency = (data.get("moneda") or "ARS")[:8]
            budget.total = data.get("total")
            budget.status = "procesado"
        except Exception as exc:  # noqa: BLE001
            budget.status = "error"
            budget.error = f"No se pudo leer el presupuesto: {exc}"
        self.session.add(budget)
        await self.session.flush()
        await self.session.refresh(budget)
        return budget

    # ── Consultas ────────────────────────────────────────────────────────────

    async def list_all(self, tenant_id: int | None, obra_id: int | None = None) -> list[Budget]:
        stmt = select(Budget).order_by(Budget.created_at.desc())
        if tenant_id is not None:
            stmt = stmt.where(Budget.tenant_id == tenant_id)
        if obra_id is not None:
            stmt = stmt.where(Budget.obra_id == obra_id)
        return list((await self.session.execute(stmt)).scalars().all())

    async def get_or_raise(self, budget_id: int, tenant_id: int | None) -> Budget:
        budget = await self.session.get(Budget, budget_id)
        if not budget or (tenant_id is not None and budget.tenant_id is not None and budget.tenant_id != tenant_id):
            raise NotFoundError("Budget", budget_id)
        return budget

    async def delete(self, budget_id: int, tenant_id: int | None) -> None:
        budget = await self.get_or_raise(budget_id, tenant_id)
        await self.session.delete(budget)

    async def obra_name(self, obra_id: int | None) -> str | None:
        if not obra_id:
            return None
        obra = await self.session.get(Obra, obra_id)
        return obra.name if obra else None

    # ── Comparación ──────────────────────────────────────────────────────────

    async def compare(self, budget_ids: list[int], tenant_id: int | None) -> dict:
        budgets: list[Budget] = []
        for bid in budget_ids:
            budgets.append(await self.get_or_raise(bid, tenant_id))

        priced = [b for b in budgets if b.total is not None]
        promedio = round(sum(float(b.total) for b in priced) / len(priced), 2) if priced else None
        cheapest_id = min(priced, key=lambda b: float(b.total)).id if priced else None

        rows = []
        for b in budgets:
            d = b.data or {}
            total = float(b.total) if b.total is not None else None
            pct = round((total - promedio) / promedio * 100, 1) if (total is not None and promedio) else None
            flags: list[str] = []
            if pct is not None and pct >= 15:
                flags.append(f"{pct:.0f}% por encima del promedio")
            if d.get("incluye_flete") is False:
                flags.append("No incluye flete")
            if d.get("iva_pct") is None and d.get("iva_monto") is None:
                flags.append("IVA sin aclarar")
            if not d.get("validez"):
                flags.append("Sin validez indicada")
            rows.append({
                "budget_id": b.id,
                "supplier_name": b.supplier_name,
                "rubro": b.rubro,
                "total": total,
                "currency": b.currency,
                "plazo_entrega": d.get("plazo_entrega"),
                "condiciones_pago": d.get("condiciones_pago"),
                "validez": d.get("validez"),
                "incluye_flete": d.get("incluye_flete"),
                "pct_vs_promedio": pct,
                "es_mas_barato": b.id == cheapest_id,
                "flags": flags,
            })

        recomendacion = await self._recommendation(rows, promedio)
        return {"rows": rows, "promedio": promedio, "recomendacion": recomendacion}

    async def _recommendation(self, rows: list[dict], promedio: float | None) -> str | None:
        ranked = [r for r in rows if r["total"] is not None]
        if not ranked:
            return "No hay totales para comparar. Cargá presupuestos con monto para ver la recomendación."
        cheapest = min(ranked, key=lambda r: r["total"])
        base = (
            f"El más económico es {cheapest['supplier_name'] or 'sin proveedor'} "
            f"(${cheapest['total']:,.0f})."
        )
        # Recomendación con IA si hay key; si no, heurística simple.
        if not settings.ANTHROPIC_API_KEY:
            extra = ""
            if cheapest["flags"]:
                extra = f" Ojo: {', '.join(cheapest['flags']).lower()}."
            return base + extra
        try:
            import anthropic
            resumen = "\n".join(
                f"- {r['supplier_name'] or 'Proveedor'}: total ${r['total']:,.0f} | "
                f"plazo {r['plazo_entrega'] or '—'} | pago {r['condiciones_pago'] or '—'} | "
                f"validez {r['validez'] or '—'} | flete {'sí' if r['incluye_flete'] else ('no' if r['incluye_flete'] is False else '—')}"
                f"{' | ⚠ ' + '; '.join(r['flags']) if r['flags'] else ''}"
                for r in ranked
            )
            client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
            resp = await client.messages.create(
                model=settings.CLAUDE_MODEL,
                max_tokens=400,
                system=(
                    "Sos asesor de compras de obra. Te paso presupuestos comparables de proveedores. "
                    "Recomendá cuál conviene en 2-3 oraciones, ponderando precio, plazo de entrega y condiciones "
                    "(no siempre gana el más barato si tiene peores condiciones o le falta el flete). "
                    "Español rioplatense, directo, sin viñetas."
                ),
                messages=[{"role": "user", "content": f"Promedio: ${promedio:,.0f}\n{resumen}"}],
            )
            return next(b.text for b in resp.content if b.type == "text").strip()
        except Exception:  # noqa: BLE001
            return base
