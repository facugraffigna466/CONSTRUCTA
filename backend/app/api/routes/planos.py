from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status

from app.core.deps import CurrentUser, DbSession
from app.core.signing import signed_upload_url
from app.models.plano import Plano
from app.schemas.plano import PlanoRead
from app.services.plano_service import MAX_BYTES, PlanoService
from app.services.obra_service import ObraService

router = APIRouter(tags=["planos"])


def _to_read(plano: Plano) -> PlanoRead:
    out = PlanoRead.model_validate(plano)
    # URL firmada (HMAC + expiración): los planos no se sirven públicamente.
    return out.model_copy(update={"file_url": signed_upload_url(plano.file_path)})


@router.post("/obras/{obra_id}/planos", response_model=PlanoRead, status_code=status.HTTP_201_CREATED)
async def upload_plano(
    obra_id: int,
    db: DbSession,
    current_user: CurrentUser,
    file: UploadFile = File(...),
    discipline: Annotated[str, Form()] = "general",
    name: Annotated[str | None, Form()] = None,
    notes: Annotated[str | None, Form()] = None,
):
    content = await file.read()
    if len(content) > MAX_BYTES:
        raise HTTPException(400, "El plano no puede superar 25 MB.")
    if not content:
        raise HTTPException(400, "El archivo está vacío.")
    plano = await PlanoService(db).create(
        obra_id=obra_id,
        tenant_id=current_user.tenant_id,
        uploaded_by=current_user.id,
        discipline=discipline,
        name=name,
        file_bytes=content,
        original_filename=file.filename,
        content_type=file.content_type,
        notes=notes,
    )
    return _to_read(plano)


@router.get("/obras/{obra_id}/planos", response_model=list[PlanoRead])
async def list_planos(obra_id: int, db: DbSession, current_user: CurrentUser):
    await ObraService(db).get_or_raise(obra_id, tenant_id=current_user.tenant_id)
    planos = await PlanoService(db).list_by_obra(obra_id)
    return [_to_read(p) for p in planos]


@router.delete("/planos/{plano_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_plano(plano_id: int, db: DbSession, current_user: CurrentUser):
    await PlanoService(db).delete(plano_id, current_user.tenant_id)
