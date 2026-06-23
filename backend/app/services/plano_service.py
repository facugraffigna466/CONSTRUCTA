from __future__ import annotations

import uuid
import unicodedata
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.models.plano import Plano
from app.models.task import Task

UPLOADS_DIR = Path(__file__).parent.parent.parent / "uploads"
UPLOADS_DIR.mkdir(exist_ok=True)

MAX_BYTES = 25 * 1024 * 1024  # 25 MB — los planos pueden pesar

# Disciplinas canónicas y los sinónimos que el chatbot reconoce en el texto.
DISCIPLINE_SYNONYMS: dict[str, list[str]] = {
    "electricidad": ["electricidad", "electrico", "electrica", "luz", "tablero", "iluminacion"],
    "sanitarios": ["sanitario", "sanitarios", "plomeria", "agua", "cloaca", "cloacal", "desague"],
    "gas": ["gas", "gasista"],
    "estructura": ["estructura", "estructural", "hormigon", "hierro", "fundacion", "fundaciones", "calculo"],
    "arquitectura": ["arquitectura", "arquitectonico", "planta", "albanileria", "obra civil"],
    "incendio": ["incendio", "contra incendio", "rociadores", "hidrante"],
    "termomecanica": ["termomecanica", "hvac", "aire", "climatizacion", "calefaccion", "ventilacion"],
    "pluviales": ["pluvial", "pluviales", "desague pluvial"],
    "instalaciones": ["instalacion", "instalaciones"],
    "replanteo": ["replanteo", "topografia", "relevamiento"],
}


def _norm(text: str) -> str:
    """minúsculas sin acentos."""
    t = unicodedata.normalize("NFKD", text.lower())
    return "".join(c for c in t if not unicodedata.combining(c))


def canonical_discipline(value: str) -> str:
    n = _norm(value).strip()
    for canon, syns in DISCIPLINE_SYNONYMS.items():
        if n == canon or any(s == n for s in syns):
            return canon
    return n or "general"


def match_discipline_in_text(text: str) -> str | None:
    """Detecta la disciplina pedida dentro de un mensaje libre del chatbot."""
    n = _norm(text)
    for canon, syns in DISCIPLINE_SYNONYMS.items():
        if any(s in n for s in syns) or canon in n:
            return canon
    return None


class PlanoService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # ── Carga con versionado ─────────────────────────────────────────────────

    async def create(
        self,
        *,
        obra_id: int,
        tenant_id: int | None,
        uploaded_by: int | None,
        discipline: str,
        name: str | None,
        file_bytes: bytes,
        original_filename: str | None,
        content_type: str | None,
        notes: str | None = None,
    ) -> Plano:
        disc = canonical_discipline(discipline)
        clean_name = (name or "").strip() or None

        # versión: agrupar por (obra, disciplina, nombre); la anterior deja de ser vigente
        group = (await self.session.execute(
            select(Plano).where(
                Plano.obra_id == obra_id,
                Plano.discipline == disc,
                Plano.name.is_(clean_name) if clean_name is None else Plano.name == clean_name,
            )
        )).scalars().all()
        next_version = (max((p.version for p in group), default=0)) + 1
        for prev in group:
            prev.is_latest = False

        ext = ""
        if original_filename and "." in original_filename:
            ext = "." + original_filename.rsplit(".", 1)[-1].lower()[:8]
        stored = f"{uuid.uuid4().hex}{ext}"
        (UPLOADS_DIR / stored).write_bytes(file_bytes)

        plano = Plano(
            obra_id=obra_id, tenant_id=tenant_id, uploaded_by=uploaded_by,
            discipline=disc, name=clean_name, version=next_version, is_latest=True,
            file_path=stored, original_filename=original_filename,
            content_type=content_type, file_size=len(file_bytes), notes=notes,
        )
        self.session.add(plano)
        await self.session.flush()
        await self.session.refresh(plano)
        return plano

    # ── Consultas ────────────────────────────────────────────────────────────

    async def list_by_obra(self, obra_id: int) -> list[Plano]:
        return list((await self.session.execute(
            select(Plano).where(Plano.obra_id == obra_id).order_by(Plano.created_at.desc())
        )).scalars().all())

    async def get_or_raise(self, plano_id: int, tenant_id: int | None) -> Plano:
        plano = await self.session.get(Plano, plano_id)
        if not plano or (tenant_id is not None and plano.tenant_id is not None and plano.tenant_id != tenant_id):
            raise NotFoundError("Plano", plano_id)
        return plano

    async def delete(self, plano_id: int, tenant_id: int | None) -> None:
        plano = await self.get_or_raise(plano_id, tenant_id)
        # si era la vigente, promover la versión anterior del grupo
        was_latest = plano.is_latest
        group_filter = [
            Plano.obra_id == plano.obra_id,
            Plano.discipline == plano.discipline,
            Plano.name.is_(None) if plano.name is None else Plano.name == plano.name,
            Plano.id != plano.id,
        ]
        await self.session.delete(plano)
        if was_latest:
            siblings = (await self.session.execute(
                select(Plano).where(*group_filter).order_by(Plano.version.desc())
            )).scalars().all()
            if siblings:
                siblings[0].is_latest = True

    # ── Soporte para el chatbot ──────────────────────────────────────────────

    async def find_latest_for_disciplines(self, obra_ids: list[int], discipline: str | None) -> Plano | None:
        stmt = select(Plano).where(Plano.obra_id.in_(obra_ids), Plano.is_latest.is_(True))
        if discipline:
            stmt = stmt.where(Plano.discipline == discipline)
        stmt = stmt.order_by(Plano.created_at.desc())
        return (await self.session.execute(stmt)).scalars().first()

    async def available_disciplines(self, obra_ids: list[int]) -> list[str]:
        rows = (await self.session.execute(
            select(Plano.discipline).where(Plano.obra_id.in_(obra_ids), Plano.is_latest.is_(True)).distinct()
        )).scalars().all()
        return sorted(set(rows))

    async def available_disciplines_by_obra(self, obra_ids: list[int]) -> dict[int, list[str]]:
        """Devuelve {obra_id: [disciplinas]} para obras que tienen al menos un plano vigente."""
        rows = (await self.session.execute(
            select(Plano.obra_id, Plano.discipline)
            .where(Plano.obra_id.in_(obra_ids), Plano.is_latest.is_(True))
            .distinct()
        )).all()
        result: dict[int, list[str]] = {}
        for obra_id, disc in rows:
            result.setdefault(obra_id, []).append(disc)
        for v in result.values():
            v.sort()
        return result

    async def obras_with_planos(self, obra_ids: list[int], discipline: str | None) -> list[int]:
        """Obras que tienen al menos un plano vigente (y de la disciplina pedida si se especifica)."""
        stmt = select(Plano.obra_id).where(Plano.obra_id.in_(obra_ids), Plano.is_latest.is_(True))
        if discipline:
            stmt = stmt.where(Plano.discipline == discipline)
        rows = (await self.session.execute(stmt.distinct())).scalars().all()
        return sorted(set(rows))

    async def obra_ids_for_responsible(self, responsible_id: int) -> list[int]:
        rows = (await self.session.execute(
            select(Task.obra_id).where(Task.responsible_id == responsible_id).distinct()
        )).scalars().all()
        return [r for r in rows if r is not None]

    async def allowed_disciplines_for_responsible(self, responsible_id: int, obra_id: int) -> list[str] | None:
        """Retorna las disciplinas permitidas para este responsable en esta obra.
        None = acceso a todos los planos. [] = sin acceso."""
        from app.models.obra_team_member import ObraTeamMember
        row = (await self.session.execute(
            select(ObraTeamMember.plan_disciplines).where(
                ObraTeamMember.obra_id == obra_id,
                ObraTeamMember.responsible_id == responsible_id,
            )
        )).scalar_one_or_none()
        return row  # None si no está en el equipo o si tiene acceso total
