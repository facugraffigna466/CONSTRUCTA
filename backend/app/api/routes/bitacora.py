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

from app.core.deps import CurrentUser, CurrentUserId, DbSession
from app.models.bitacora import BitacoraEntry
from app.models.obra import Obra
from app.models.responsible import Responsible
from app.schemas.bitacora import BitacoraAssignObra, BitacoraEntryRead, BitacoraTextCreate
from app.services.bitacora_service import BitacoraService

router = APIRouter(tags=["bitacora"])

UPLOADS_DIR = Path(__file__).parent.parent.parent.parent / "uploads"
UPLOADS_DIR.mkdir(exist_ok=True)

AUDIO_TYPES = {"audio/ogg", "audio/mpeg", "audio/mp4", "audio/wav", "audio/webm", "audio/x-m4a", "audio/aac"}
MAX_AUDIO_BYTES = 25 * 1024 * 1024  # 25 MB (límite de Whisper)


async def _to_read(entry: BitacoraEntry, db: DbSession) -> BitacoraEntryRead:
    data = BitacoraEntryRead.model_validate(entry)
    if entry.obra_id:
        data.obra_name = (await db.execute(
            select(Obra.name).where(Obra.id == entry.obra_id)
        )).scalar_one_or_none()
    if entry.responsible_id:
        data.responsible_name = (await db.execute(
            select(Responsible.full_name).where(Responsible.id == entry.responsible_id)
        )).scalar_one_or_none()
    return data


@router.post("/obras/{obra_id}/bitacora/audio", response_model=BitacoraEntryRead, status_code=status.HTTP_201_CREATED)
async def create_audio_entry(
    obra_id: int,
    db: DbSession,
    current_user: CurrentUser,
    file: UploadFile = File(...),
):
    ctype = (file.content_type or "").split(";")[0].strip()
    raw_name = file.filename or "audio.ogg"
    ext = raw_name.rsplit(".", 1)[-1].lower() if "." in raw_name else "ogg"
    if ctype and ctype not in AUDIO_TYPES and not ctype.startswith("audio/"):
        raise HTTPException(400, "Solo se aceptan archivos de audio (ogg, mp3, m4a, wav, webm).")

    content = await file.read()
    if len(content) > MAX_AUDIO_BYTES:
        raise HTTPException(400, "El audio no puede superar 25 MB.")
    if not content:
        raise HTTPException(400, "El archivo está vacío.")

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
    return await _to_read(entry, db)


@router.post("/obras/{obra_id}/bitacora/texto", response_model=BitacoraEntryRead, status_code=status.HTTP_201_CREATED)
async def create_text_entry(
    obra_id: int, data: BitacoraTextCreate, db: DbSession, current_user: CurrentUser
):
    if not data.text.strip():
        raise HTTPException(400, "El texto está vacío.")
    service = BitacoraService(db)
    entry = await service.create_entry(
        obra_id=obra_id,
        source="web",
        transcript=data.text.strip(),
        created_by=current_user.id,
    )
    entry = await service.process_entry(entry)
    return await _to_read(entry, db)


@router.get("/bitacora", response_model=list[BitacoraEntryRead])
async def list_entries(db: DbSession, _: CurrentUserId, obra_id: int | None = None):
    service = BitacoraService(db)
    entries = await service.list_entries(obra_id)
    return [await _to_read(e, db) for e in entries]


@router.post("/bitacora/{entry_id}/transcript", response_model=BitacoraEntryRead)
async def set_transcript(entry_id: int, data: BitacoraTextCreate, db: DbSession, _: CurrentUserId):
    if not data.text.strip():
        raise HTTPException(400, "El texto está vacío.")
    service = BitacoraService(db)
    entry = await service.get_or_raise(entry_id)
    entry.transcript = data.text.strip()
    entry.status = "pendiente_analisis"
    entry.error = None
    entry = await service.process_entry(entry)
    return await _to_read(entry, db)


@router.post("/bitacora/{entry_id}/reprocess", response_model=BitacoraEntryRead)
async def reprocess(entry_id: int, db: DbSession, _: CurrentUserId):
    service = BitacoraService(db)
    entry = await service.get_or_raise(entry_id)
    audio_bytes = None
    filename = "audio.ogg"
    if entry.audio_path and not entry.transcript:
        path = UPLOADS_DIR / entry.audio_path.replace("/uploads/", "")
        if path.exists():
            audio_bytes = path.read_bytes()
            filename = path.name
    entry = await service.process_entry(entry, audio_bytes=audio_bytes, filename=filename)
    return await _to_read(entry, db)


@router.post("/bitacora/{entry_id}/obra", response_model=BitacoraEntryRead)
async def assign_obra(entry_id: int, data: BitacoraAssignObra, db: DbSession, _: CurrentUserId):
    service = BitacoraService(db)
    entry = await service.get_or_raise(entry_id)
    obra = (await db.execute(select(Obra).where(Obra.id == data.obra_id))).scalar_one_or_none()
    if not obra:
        raise HTTPException(404, "Obra no encontrada")
    entry.obra_id = data.obra_id
    # Re-analizar con el contexto de la obra correcta
    if entry.transcript:
        entry.status = "pendiente_analisis"
        entry = await service.process_entry(entry)
    await db.flush()
    return await _to_read(entry, db)


@router.post("/bitacora/{entry_id}/suggestions/{index}/apply", response_model=BitacoraEntryRead)
async def apply_suggestion(entry_id: int, index: int, db: DbSession, current_user: CurrentUser):
    actor = {
        "id": current_user.id,
        "name": current_user.full_name or current_user.email,
        "role": current_user.role,
        "channel": "bitacora",
    }
    service = BitacoraService(db)
    entry = await service.apply_suggestion(entry_id, index, current_user.id, actor=actor)
    return await _to_read(entry, db)


@router.post("/bitacora/{entry_id}/suggestions/{index}/dismiss", response_model=BitacoraEntryRead)
async def dismiss_suggestion(entry_id: int, index: int, db: DbSession, _: CurrentUserId):
    service = BitacoraService(db)
    entry = await service.dismiss_suggestion(entry_id, index)
    return await _to_read(entry, db)


@router.delete("/bitacora/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_entry(entry_id: int, db: DbSession, _: CurrentUserId):
    service = BitacoraService(db)
    entry = await service.get_or_raise(entry_id)
    await db.delete(entry)
    await db.flush()
