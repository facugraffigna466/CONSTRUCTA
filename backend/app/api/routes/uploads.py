import uuid
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from app.core.deps import CurrentUserId

UPLOADS_DIR = Path(__file__).parent.parent.parent.parent / "uploads"
UPLOADS_DIR.mkdir(exist_ok=True)

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_BYTES = 5 * 1024 * 1024  # 5 MB

BACKEND_URL = "http://localhost:8000"

router = APIRouter(prefix="/upload", tags=["upload"])


@router.post("/image")
async def upload_image(
    file: UploadFile = File(...),
    _user_id: CurrentUserId = None,
) -> JSONResponse:
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(400, "Solo se aceptan imágenes JPG, PNG o WebP.")

    content = await file.read()
    if len(content) > MAX_BYTES:
        raise HTTPException(400, "La imagen no puede superar 5 MB.")

    raw_name = file.filename or "image.jpg"
    ext = raw_name.rsplit(".", 1)[-1].lower() if "." in raw_name else "jpg"
    if ext not in ("jpg", "jpeg", "png", "webp"):
        ext = "jpg"

    filename = f"{uuid.uuid4().hex}.{ext}"
    (UPLOADS_DIR / filename).write_bytes(content)

    url = f"{BACKEND_URL}/uploads/{filename}"
    return JSONResponse({"url": url})


