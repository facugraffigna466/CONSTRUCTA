from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.deps import get_current_user_id
from app.schemas.obra import ObraCreate, ObraUpdate, ObraRead, ObraSummary
from app.services.obra_service import ObraService

router = APIRouter(prefix="/obras", tags=["obras"])


@router.post("", response_model=ObraRead, status_code=status.HTTP_201_CREATED)
async def create_obra(
    data: ObraCreate,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    return await ObraService(db).create(data, user_id)


@router.get("", response_model=list[ObraSummary])
async def list_obras(
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    return await ObraService(db).list_mine(user_id)


@router.get("/{obra_id}", response_model=ObraRead)
async def get_obra(
    obra_id: int,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    obra = await ObraService(db).get_or_raise(obra_id)
    return obra


@router.patch("/{obra_id}", response_model=ObraRead)
async def update_obra(
    obra_id: int,
    data: ObraUpdate,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    return await ObraService(db).update(obra_id, data, user_id)


@router.delete("/{obra_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_obra(
    obra_id: int,
    db: AsyncSession = Depends(get_db),
    user_id: int = Depends(get_current_user_id),
):
    await ObraService(db).delete(obra_id, user_id)
