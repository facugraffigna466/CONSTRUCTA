from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import select

from app.core.deps import DbSession
from app.core.obra_permissions import require_obra_role, require_plano_obra_role
from app.core.signing import WEB_TTL, signed_upload_url
from app.models.obra_user_role import ObraUserRoleType
from app.models.plano import Plano
from app.models.user import User
from app.schemas.plano import PlanoRead
from app.services.plano_service import MAX_BYTES, WHATSAPP_MAX_BYTES, PlanoService
from app.services.obra_service import ObraService

router = APIRouter(tags=["planos"])


def _to_read(plano: Plano, author: str | None = None) -> PlanoRead:
    out = PlanoRead.model_validate(plano)
    # URL firmada (HMAC + expiración + scope de tenant): los planos no se sirven públicamente.
    return out.model_copy(update={
        "file_url": signed_upload_url(plano.file_path, plano.tenant_id, ttl=WEB_TTL),
        "uploaded_by_name": author,
        "too_big_for_whatsapp": (plano.file_size or 0) > WHATSAPP_MAX_BYTES,
    })


async def _authors(db, planos: list[Plano]) -> dict[int, str]:
    """Nombre de quien subió cada versión, en una sola query (evita N+1)."""
    ids = {p.uploaded_by for p in planos if p.uploaded_by}
    if not ids:
        return {}
    rows = (await db.execute(
        select(User.id, User.full_name, User.email).where(User.id.in_(ids))
    )).all()
    return {r.id: (r.full_name or r.email) for r in rows}


@router.post("/obras/{obra_id}/planos", response_model=PlanoRead, status_code=status.HTTP_201_CREATED)
async def upload_plano(
    obra_id: int,
    db: DbSession,
    current_user: Annotated[User, Depends(require_obra_role(ObraUserRoleType.COLABORADOR))],
    file: UploadFile = File(...),
    discipline: Annotated[str, Form()] = "general",
    name: Annotated[str | None, Form(max_length=255)] = None,
    notes: Annotated[str | None, Form(max_length=500)] = None,
    replaces_plano_id: Annotated[int | None, Form()] = None,
):
    """Sube un plano. Con `replaces_plano_id` se carga como nueva versión de un
    plano existente: hereda su disciplina y nombre, y queda vigente — sin depender
    de que el nombre que se mande coincida."""

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
        replaces_plano_id=replaces_plano_id,
        actor_name=current_user.full_name or current_user.email,
    )
    return _to_read(plano)


@router.get("/obras/{obra_id}/planos", response_model=list[PlanoRead])
async def list_planos(
    obra_id: int,
    db: DbSession,
    current_user: Annotated[User, Depends(require_obra_role(ObraUserRoleType.SOLO_LECTURA))],
):
    planos = await PlanoService(db).list_by_obra(obra_id)
    authors = await _authors(db, planos)
    return [_to_read(p, authors.get(p.uploaded_by)) for p in planos]


@router.patch("/planos/{plano_id}/vigente", response_model=PlanoRead)
async def set_plano_vigente(
    plano_id: int,
    db: DbSession,
    current_user: Annotated[User, Depends(require_plano_obra_role(ObraUserRoleType.JEFE_OBRA))],
):
    """Marca esta versión como la vigente de su plano (la que responde el bot y la que
    se muestra primero). Para corregir cuando se cargó una versión vieja por error."""
    plano = await PlanoService(db).set_latest(
        plano_id, current_user.tenant_id, actor_name=current_user.full_name or current_user.email
    )
    return _to_read(plano)


@router.delete("/planos/{plano_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_plano(
    plano_id: int,
    db: DbSession,
    current_user: Annotated[User, Depends(require_plano_obra_role(ObraUserRoleType.JEFE_OBRA))],
):
    await PlanoService(db).delete(
        plano_id, current_user.tenant_id, actor_name=current_user.full_name or current_user.email
    )
