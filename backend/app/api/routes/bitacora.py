"""
Bitácora de obra — audios de WhatsApp/web procesados con IA.

POST /obras/{obra_id}/bitacora/audio   → subir audio (graba/adjunta) y procesar
POST /obras/{obra_id}/bitacora/texto   → entrada de texto directo y procesar
GET  /bitacora?obra_id=                → listar entradas
POST /bitacora/{id}/transcript         → cargar transcripción manual y analizar
POST /bitacora/{id}/reprocess          → reintentar el análisis
POST /bitacora/{id}/obra               → asignar obra (audios de WhatsApp sin obra)
POST /bitacora/{id}/suggestions/{idx}/apply    → aplicar sugerencia
POST /bitacora/{id}/suggestions/{idx}/dismiss  → descartar sugerencia
DELETE /bitacora/{id}
"""
import uuid
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile, status
from sqlalchemy import select

from app.core.deps import CurrentUser, DbSession
from app.core.signing import signed_upload_path
from app.models.bitacora import BitacoraEntry
from app.models.obra import Obra
from app.models.responsible import Responsible
from app.schemas.bitacora import (
    BitacoraAssignObra,
    BitacoraEntryRead,
    BitacoraSuggestionEdit,
    BitacoraTextCreate,
)
from app.services.bitacora_service import BitacoraService
from app.services.obra_service import ObraService

router = APIRouter(tags=["bitacora"])

UPLOADS_DIR = Path(__file__).parent.parent.parent.parent / "uploads"
UPLOADS_DIR.mkdir(exist_ok=True)

AUDIO_TYPES = {"audio/ogg", "audio/mpeg", "audio/mp4", "audio/wav", "audio/webm", "audio/x-m4a", "audio/aac"}
AUDIO_EXTS = {"ogg", "oga", "mp3", "mpeg", "m4a", "mp4", "wav", "webm", "aac"}
MAX_AUDIO_BYTES = 25 * 1024 * 1024  # 25 MB (límite de Whisper)


def _audio_url(entry: BitacoraEntry, tenant_id: int | None) -> str | None:
    """Ruta relativa FIRMADA (con scope de tenant) para el audio."""
    if not entry.audio_path:
        return None
    return signed_upload_path(Path(entry.audio_path).name, tenant_id)


async def _to_read(entry: BitacoraEntry, db: DbSession, tenant_id: int | None) -> BitacoraEntryRead:
    data = BitacoraEntryRead.model_validate(entry)
    data.audio_url = _audio_url(entry, tenant_id)
    if entry.obra_id:
        data.obra_name = (await db.execute(
            select(Obra.name).where(Obra.id == entry.obra_id)
        )).scalar_one_or_none()
    if entry.responsible_id:
        data.responsible_name = (await db.execute(
            select(Responsible.full_name).where(Responsible.id == entry.responsible_id)
        )).scalar_one_or_none()
    return data


async def _to_read_bulk(
    entries: list[BitacoraEntry], db: DbSession, tenant_id: int | None
) -> list[BitacoraEntryRead]:
    """Resuelve nombres de obra y responsable en 2 queries para toda la lista (evita N+1)."""
    obra_ids = {e.obra_id for e in entries if e.obra_id}
    resp_ids = {e.responsible_id for e in entries if e.responsible_id}
    obra_names: dict[int, str] = {}
    resp_names: dict[int, str] = {}
    if obra_ids:
        obra_names = dict((await db.execute(
            select(Obra.id, Obra.name).where(Obra.id.in_(obra_ids))
        )).all())
    if resp_ids:
        resp_names = dict((await db.execute(
            select(Responsible.id, Responsible.full_name).where(Responsible.id.in_(resp_ids))
        )).all())
    result: list[BitacoraEntryRead] = []
    for e in entries:
        data = BitacoraEntryRead.model_validate(e)
        data.audio_url = _audio_url(e, tenant_id)
        data.obra_name = obra_names.get(e.obra_id) if e.obra_id else None
        data.responsible_name = resp_names.get(e.responsible_id) if e.responsible_id else None
        result.append(data)
    return result


@router.post("/obras/{obra_id}/bitacora/audio", response_model=BitacoraEntryRead, status_code=status.HTTP_201_CREATED)
async def create_audio_entry(
    obra_id: int,
    db: DbSession,
    current_user: CurrentUser,
    file: UploadFile = File(...),
):
    # 404 si la obra no existe o pertenece a otro tenant
    await ObraService(db).get_or_raise(obra_id, tenant_id=current_user.tenant_id)
    # Control de costo de IA: cota mensual por tenant (falla rápido, antes de leer el audio)
    await BitacoraService(db).assert_within_ai_quota(current_user.tenant_id)

    ctype = (file.content_type or "").split(";")[0].strip()
    raw_name = file.filename or "audio.ogg"
    ext = raw_name.rsplit(".", 1)[-1].lower() if "." in raw_name else "ogg"
    # Aceptamos por content-type de audio O por extensión conocida (WhatsApp/web a
    # veces mandan content-type genérico o vacío). Rechazamos si ninguno da audio.
    ctype_ok = ctype.startswith("audio/") or ctype in AUDIO_TYPES
    if not ctype_ok and ext not in AUDIO_EXTS:
        raise HTTPException(400, "Solo se aceptan archivos de audio (ogg, mp3, m4a, wav, webm).")

    content = await file.read()
    if len(content) > MAX_AUDIO_BYTES:
        raise HTTPException(400, "El audio no puede superar 25 MB.")
    if not content:
        raise HTTPException(400, "El archivo está vacío.")

    # No persistir extensiones arbitrarias en disco.
    if ext not in AUDIO_EXTS:
        ext = "ogg"
    filename = f"bitacora_{uuid.uuid4().hex}.{ext}"
    (UPLOADS_DIR / filename).write_bytes(content)

    service = BitacoraService(db)
    entry = await service.create_entry(
        obra_id=obra_id,
        source="web",
        audio_path=f"/uploads/{filename}",
        created_by=current_user.id,
    )
    entry = await service.process_entry(entry, audio_bytes=content, filename=f"audio.{ext}")
    return await _to_read(entry, db, current_user.tenant_id)


@router.post("/obras/{obra_id}/bitacora/texto", response_model=BitacoraEntryRead, status_code=status.HTTP_201_CREATED)
async def create_text_entry(
    obra_id: int, data: BitacoraTextCreate, db: DbSession, current_user: CurrentUser
):
    # 404 si la obra no existe o pertenece a otro tenant
    await ObraService(db).get_or_raise(obra_id, tenant_id=current_user.tenant_id)
    if not data.text.strip():
        raise HTTPException(400, "El texto está vacío.")
    service = BitacoraService(db)
    # Control de costo de IA: cota mensual por tenant
    await service.assert_within_ai_quota(current_user.tenant_id)
    entry = await service.create_entry(
        obra_id=obra_id,
        source="web",
        transcript=data.text.strip(),
        created_by=current_user.id,
    )
    entry = await service.process_entry(entry)
    return await _to_read(entry, db, current_user.tenant_id)


@router.get("/bitacora", response_model=list[BitacoraEntryRead])
async def list_entries(
    db: DbSession,
    current_user: CurrentUser,
    obra_id: int | None = None,
    limit: int = 100,
    offset: int = 0,
):
    service = BitacoraService(db)
    entries = await service.list_entries(
        tenant_id=current_user.tenant_id,
        user_id=current_user.id,
        obra_id=obra_id,
        limit=limit,
        offset=offset,
    )
    return await _to_read_bulk(entries, db, current_user.tenant_id)


@router.get("/bitacora/pending-count")
async def pending_count(
    db: DbSession, current_user: CurrentUser, obra_id: int | None = None
) -> dict[str, int]:
    """Sugerencias sin revisar (Sí/No pendiente) de una obra — para el badge del menú."""
    count = await BitacoraService(db).pending_suggestions_count(
        tenant_id=current_user.tenant_id, user_id=current_user.id, obra_id=obra_id
    )
    return {"count": count}


@router.get("/bitacora/unassigned", response_model=list[BitacoraEntryRead])
async def list_unassigned(db: DbSession, current_user: CurrentUser):
    """Notas de voz sin obra asignada del tenant — para asignación manual del jefe."""
    entries = await BitacoraService(db).list_unassigned(
        tenant_id=current_user.tenant_id, user_id=current_user.id
    )
    return await _to_read_bulk(entries, db, current_user.tenant_id)


@router.get("/tasks/{task_id}/bitacora", response_model=list[BitacoraEntryRead])
async def list_for_task(task_id: int, db: DbSession, current_user: CurrentUser):
    """Notas de voz que originaron o modificaron esta tarea (trazabilidad tarea → audio)."""
    entries = await BitacoraService(db).list_for_task(
        task_id=task_id, tenant_id=current_user.tenant_id, user_id=current_user.id
    )
    return await _to_read_bulk(entries, db, current_user.tenant_id)


@router.post("/bitacora/{entry_id}/transcript", response_model=BitacoraEntryRead)
async def set_transcript(entry_id: int, data: BitacoraTextCreate, db: DbSession, current_user: CurrentUser):
    if not data.text.strip():
        raise HTTPException(400, "El texto está vacío.")
    service = BitacoraService(db)
    entry = await service.get_scoped(entry_id, current_user.tenant_id, current_user.id)
    entry.transcript = data.text.strip()
    entry.status = "pendiente_analisis"
    entry.error = None
    entry = await service.process_entry(entry)
    return await _to_read(entry, db, current_user.tenant_id)


@router.post("/bitacora/{entry_id}/reprocess", response_model=BitacoraEntryRead)
async def reprocess(entry_id: int, db: DbSession, current_user: CurrentUser):
    service = BitacoraService(db)
    entry = await service.get_scoped(entry_id, current_user.tenant_id, current_user.id)
    audio_bytes = None
    filename = "audio.ogg"
    if entry.audio_path and not entry.transcript:
        path = UPLOADS_DIR / entry.audio_path.replace("/uploads/", "")
        if path.exists():
            audio_bytes = path.read_bytes()
            filename = path.name
    entry = await service.process_entry(entry, audio_bytes=audio_bytes, filename=filename)
    return await _to_read(entry, db, current_user.tenant_id)


@router.post("/bitacora/{entry_id}/obra", response_model=BitacoraEntryRead)
async def assign_obra(entry_id: int, data: BitacoraAssignObra, db: DbSession, current_user: CurrentUser):
    service = BitacoraService(db)
    entry = await service.get_scoped(entry_id, current_user.tenant_id, current_user.id)
    # 404 si la obra no existe o pertenece a otro tenant
    await ObraService(db).get_or_raise(data.obra_id, tenant_id=current_user.tenant_id)
    entry.obra_id = data.obra_id
    # Re-analizar con el contexto de la obra correcta
    if entry.transcript:
        entry.status = "pendiente_analisis"
        entry = await service.process_entry(entry)
    await db.flush()
    return await _to_read(entry, db, current_user.tenant_id)


@router.post("/bitacora/{entry_id}/suggestions/{index}/apply", response_model=BitacoraEntryRead)
async def apply_suggestion(
    entry_id: int, index: int, db: DbSession, current_user: CurrentUser,
    edits: BitacoraSuggestionEdit | None = None,
):
    actor = {
        "id": current_user.id,
        "name": current_user.full_name or current_user.email,
        "role": current_user.role,
        "channel": "bitacora",
    }
    service = BitacoraService(db)
    # 404 si la entrada es de otro tenant
    await service.get_scoped(entry_id, current_user.tenant_id, current_user.id)
    entry = await service.apply_suggestion(
        entry_id, index, current_user.id, actor=actor,
        edits=edits.model_dump(exclude_unset=True) if edits else None,
    )
    return await _to_read(entry, db, current_user.tenant_id)


@router.post("/bitacora/{entry_id}/suggestions/{index}/dismiss", response_model=BitacoraEntryRead)
async def dismiss_suggestion(entry_id: int, index: int, db: DbSession, current_user: CurrentUser):
    service = BitacoraService(db)
    await service.get_scoped(entry_id, current_user.tenant_id, current_user.id)
    entry = await service.dismiss_suggestion(entry_id, index)
    return await _to_read(entry, db, current_user.tenant_id)


@router.delete("/bitacora/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_entry(entry_id: int, db: DbSession, current_user: CurrentUser):
    service = BitacoraService(db)
    entry = await service.get_scoped(entry_id, current_user.tenant_id, current_user.id)
    # Borrar el audio del disco para no dejar archivos huérfanos
    if entry.audio_path:
        audio_file = UPLOADS_DIR / Path(entry.audio_path).name
        if audio_file.is_file():
            audio_file.unlink()
    await db.delete(entry)
    await db.flush()
