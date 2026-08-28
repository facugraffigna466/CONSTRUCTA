from __future__ import annotations

import re
import uuid
import unicodedata
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ConflictError, NotFoundError, UnprocessableError
from app.models.plano import Plano
from app.models.task import Task
from app.repositories.historial import HistorialRepository

UPLOADS_DIR = Path(__file__).parent.parent.parent / "uploads"
UPLOADS_DIR.mkdir(exist_ok=True)

MAX_BYTES = 25 * 1024 * 1024  # 25 MB — los planos pueden pesar

# Tope de WhatsApp/Twilio para adjuntos. Un plano más pesado que esto se sube y
# se descarga bien desde la web, pero Twilio lo rechaza al intentar entregarlo
# (error 63019) y el responsable en obra no recibe nada. Es menor que MAX_BYTES
# a propósito: no queremos bloquear la carga de un plano pesado, solo avisar que
# no se va a poder mandar por WhatsApp.
WHATSAPP_MAX_BYTES = 16 * 1024 * 1024  # 16 MB

# Extensiones permitidas al subir un plano. Se valida contra esto — nunca contra el
# content_type que manda el cliente (falsificable) — y determina tanto el nombre en
# disco como el Content-Type real que se sirve después (ver app/main.py). Cerrar esta
# whitelist es lo que evita que un .html/.svg disfrazado se sirva y ejecute como tal.
ALLOWED_EXTS = {"pdf", "png", "jpg", "jpeg", "webp", "gif", "dwg", "dxf"}

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

# Disciplinas aceptadas al SUBIR un plano (a diferencia del matcheo del bot, acá no
# hay fallback silencioso: lo que no es una de estas — o "general" — se rechaza).
CANONICAL_DISCIPLINES = frozenset(DISCIPLINE_SYNONYMS.keys())


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
    """Detecta la disciplina pedida dentro de un mensaje libre del chatbot.

    Matchea por palabra completa (\\b): "gasto" o "Gaspar" ya no disparan "gas".
    Sigue habiendo ambigüedad inherente al lenguaje natural en sinónimos genéricos
    de una sola palabra ("agua", "luz", "aire") — eso no lo resuelve un regex.
    """
    n = _norm(text)
    for canon, syns in DISCIPLINE_SYNONYMS.items():
        for s in (*syns, canon):
            if re.search(rf"\b{re.escape(s)}\b", n):
                return canon
    return None


class PlanoService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.historial = HistorialRepository(session)

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
        replaces_plano_id: int | None = None,
        actor_name: str | None = None,
    ) -> Plano:
        # ── Actualización de un plano existente ──────────────────────────────
        # El usuario eligió "esto reemplaza a aquel plano", así que la disciplina y
        # el sector se HEREDAN en vez de pedirlos de nuevo: no hay que reescribir el
        # nombre exacto ni arriesgarse a que un typo abra un grupo paralelo.
        replaces: Plano | None = None
        if replaces_plano_id is not None:
            replaces = await self.get_or_raise(replaces_plano_id, tenant_id)
            if replaces.obra_id != obra_id:
                raise NotFoundError("Plano", replaces_plano_id)
            discipline, name = replaces.discipline, replaces.name

        disc = canonical_discipline(discipline)
        if disc not in CANONICAL_DISCIPLINES and disc != "general":
            raise UnprocessableError(
                f"Disciplina no reconocida: «{discipline}». Elegí una de las disponibles."
            )
        clean_name = (name or "").strip() or None
        # Un plano nuevo necesita nombre: es lo que le da identidad propia. Sin él,
        # dos planos distintos de la misma disciplina caían en el mismo grupo
        # (name = NULL) y se versionaban entre sí sin que nadie lo pidiera.
        # Al versionar no se pide: se hereda del plano que se está actualizando.
        if replaces is None and clean_name is None:
            raise UnprocessableError("Poné un nombre para identificar el plano.")

        # Extensión validada contra whitelist — nunca se usa el content_type que manda
        # el cliente (falsificable) para decidir qué se guarda ni qué se sirve después.
        ext = ""
        if original_filename and "." in original_filename:
            ext = original_filename.rsplit(".", 1)[-1].lower()[:8]
        ext = "".join(ch for ch in ext if ch.isalnum())
        if ext not in ALLOWED_EXTS:
            raise UnprocessableError(
                "Tipo de archivo no permitido. Subí un PDF, una imagen (jpg/png/webp/gif) "
                "o un CAD (dwg/dxf)."
            )

        # Todo lo anterior se valida ANTES de tocar el disco: si algo de esto falla,
        # no queda ningún archivo huérfano en uploads/.

        # versión: agrupar por (obra, disciplina, nombre); la anterior deja de ser vigente.
        # FOR UPDATE serializa uploads concurrentes del mismo grupo (reduce la ventana
        # de la carrera); el índice único parcial en la migración es el backstop real
        # para cuando el grupo arranca vacío (ahí no hay fila que lockear).
        group = (await self.session.execute(
            select(Plano).where(
                Plano.obra_id == obra_id,
                Plano.discipline == disc,
                Plano.name.is_(clean_name) if clean_name is None else Plano.name == clean_name,
            ).with_for_update()
        )).scalars().all()
        next_version = (max((p.version for p in group), default=0)) + 1

        # La versión que se sube es la vigente. Una sola regla, sin inferencias:
        # si quedó mal (se cargó una revisión vieja), se corrige con set_latest().
        for prev in group:
            prev.is_latest = False
        # Bajar los anteriores ANTES de insertar el nuevo: el índice único parcial
        # (migración 0045) no tolera dos vigentes del mismo grupo ni un instante.
        await self.session.flush()

        stored = f"{uuid.uuid4().hex}.{ext}"
        dest = UPLOADS_DIR / stored
        dest.write_bytes(file_bytes)

        plano = Plano(
            obra_id=obra_id, tenant_id=tenant_id, uploaded_by=uploaded_by,
            discipline=disc, name=clean_name, version=next_version, is_latest=True,
            file_path=stored, original_filename=original_filename,
            content_type=content_type, file_size=len(file_bytes), notes=notes,
        )
        self.session.add(plano)
        try:
            await self.session.flush()
        except IntegrityError:
            dest.unlink(missing_ok=True)
            raise ConflictError(
                "Justo se subió otra versión de este plano al mismo tiempo. Volvé a intentar."
            )
        except Exception:
            dest.unlink(missing_ok=True)
            raise
        await self.session.refresh(plano)

        verbo = "actualizó" if replaces is not None else "subió"
        await self.historial.log(
            event_type="plano_uploaded",
            description=(
                f"{actor_name or 'Alguien'} {verbo} el plano de {disc}"
                f"{f' — {clean_name}' if clean_name else ''} (v{next_version})."
            ),
            obra_id=obra_id,
            payload={
                "discipline": disc, "name": clean_name, "version": next_version,
                "file_size": len(file_bytes),
            },
            triggered_by="user",
        )
        return plano

    async def set_latest(self, plano_id: int, tenant_id: int | None, actor_name: str | None = None) -> Plano:
        """Marca manualmente una versión como la vigente de su plano. Es la
        escapatoria a la regla "manda la última que subís": si se cargó una revisión
        vieja por error, se corrige acá en vez de borrar y volver a subir."""
        plano = await self.get_or_raise(plano_id, tenant_id)
        if plano.is_latest:
            return plano

        siblings = (await self.session.execute(
            select(Plano).where(
                Plano.obra_id == plano.obra_id,
                Plano.discipline == plano.discipline,
                Plano.name.is_(None) if plano.name is None else Plano.name == plano.name,
                Plano.id != plano.id,
            ).with_for_update()
        )).scalars().all()
        for s in siblings:
            s.is_latest = False
        # Igual que en create(): bajar los otros y persistirlo antes de subir este,
        # o el índice único parcial ve dos vigentes a la vez y aborta.
        await self.session.flush()

        plano.is_latest = True
        await self.session.flush()

        await self.historial.log(
            event_type="plano_set_latest",
            description=(
                f"{actor_name or 'Alguien'} marcó como vigente el plano de {plano.discipline}"
                f"{f' — {plano.name}' if plano.name else ''} v{plano.version}."
            ),
            obra_id=plano.obra_id,
            payload={"discipline": plano.discipline, "name": plano.name,
                     "version": plano.version},
            triggered_by="user",
        )
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

    async def delete(self, plano_id: int, tenant_id: int | None, actor_name: str | None = None) -> None:
        plano = await self.get_or_raise(plano_id, tenant_id)
        # Capturar todo lo que hace falta ANTES de borrar — después el objeto queda expirado.
        was_latest = plano.is_latest
        discipline, name, obra_id, version, file_path = (
            plano.discipline, plano.name, plano.obra_id, plano.version, plano.file_path,
        )
        group_filter = [
            Plano.obra_id == plano.obra_id,
            Plano.discipline == plano.discipline,
            Plano.name.is_(None) if plano.name is None else Plano.name == plano.name,
            Plano.id != plano.id,
        ]
        await self.session.delete(plano)
        if was_latest:
            siblings = (await self.session.execute(
                select(Plano).where(*group_filter)
            )).scalars().all()
            if siblings:
                # Al borrar la vigente, hereda la última que se había cargado antes
                # — mismo criterio que create(): manda el orden de carga.
                siblings.sort(key=lambda p: p.version)
                siblings[-1].is_latest = True

        # Borrar el archivo físico — antes quedaba huérfano en uploads/.
        (UPLOADS_DIR / file_path).unlink(missing_ok=True)

        await self.historial.log(
            event_type="plano_deleted",
            description=(
                f"{actor_name or 'Alguien'} borró el plano de {discipline}"
                f"{f' — {name}' if name else ''} (v{version})."
            ),
            obra_id=obra_id,
            payload={"discipline": discipline, "name": name, "version": version},
            triggered_by="user",
        )

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
        """Obras accesibles para el responsable vía WhatsApp.

        Ahora sale de `obra_team_members` (fuente de verdad de "está en el
        equipo HOY"). Antes se derivaba de `Task.responsible_id` (historial
        de asignaciones), lo que dejaba entrar a obras donde el responsable
        ya no participaba. Ver docs/roles-redesign/whatsapp-identidad-permisos.md
        Parte A.2."""
        from app.repositories.obra_team_member import ObraTeamMemberRepository
        return await ObraTeamMemberRepository(self.session).list_obra_ids_for_responsible(
            responsible_id
        )

    async def resolve_plan_access(
        self, responsible_id: int, obra_id: int
    ) -> tuple[bool, list[str] | None]:
        """Devuelve `(is_member, disciplines)`:

          - `(False, [])`   → el responsable NO está en el equipo de la obra.
            Sin acceso a ningún plano.
          - `(True, None)`  → en el equipo, acceso total a todos los planos
            (default cuando `plan_disciplines is None`).
          - `(True, [])`    → en el equipo pero explícitamente sin acceso a planos.
          - `(True, [x,y])` → en el equipo con acceso solo a esas disciplinas.
        """
        from app.repositories.obra_team_member import ObraTeamMemberRepository

        row = await ObraTeamMemberRepository(self.session).get_for_pair(
            obra_id, responsible_id
        )
        if row is None:
            return False, []
        if row.plan_disciplines is None:
            return True, None
        return True, list(row.plan_disciplines)

    async def allowed_disciplines_for_responsible(
        self, responsible_id: int, obra_id: int
    ) -> list[str] | None:
        """Compat con call sites viejos: colapsa el resultado de
        `resolve_plan_access` en un `list[str] | None`. Preferible usar
        `resolve_plan_access` directamente en código nuevo para evitar el
        `None` ambiguo — este helper existe SOLO para no romper llamadas
        heredadas mientras se migran.
        """
        is_member, disciplines = await self.resolve_plan_access(
            responsible_id, obra_id
        )
        if not is_member:
            return []
        return disciplines
