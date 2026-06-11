from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.deps import CurrentUserId, DbSession
from app.models.task import Task
from app.models.task_material import TaskMaterial
from app.models.supplier import Supplier
from app.schemas.task_material import TaskMaterialCreate, TaskMaterialRead, TaskMaterialUpdate

router = APIRouter(prefix="/tasks/{task_id}/materials", tags=["task-materials"])


async def _get_task_or_404(task_id: int, db: DbSession) -> Task:
    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Tarea no encontrada")
    return task


async def _enrich(material: TaskMaterial, db: DbSession) -> TaskMaterialRead:
    supplier_name = None
    if material.supplier_id:
        res = await db.execute(select(Supplier.name).where(Supplier.id == material.supplier_id))
        supplier_name = res.scalar_one_or_none()
    data = TaskMaterialRead.model_validate(material)
    data.supplier_name = supplier_name
    return data


@router.get("", response_model=list[TaskMaterialRead])
async def list_materials(task_id: int, db: DbSession, _: CurrentUserId):
    await _get_task_or_404(task_id, db)
    result = await db.execute(
        select(TaskMaterial)
        .where(TaskMaterial.task_id == task_id)
        .order_by(TaskMaterial.created_at)
    )
    materials = result.scalars().all()
    return [await _enrich(m, db) for m in materials]


@router.post("", response_model=TaskMaterialRead, status_code=status.HTTP_201_CREATED)
async def create_material(
    task_id: int, data: TaskMaterialCreate, db: DbSession, _: CurrentUserId
):
    await _get_task_or_404(task_id, db)
    material = TaskMaterial(
        task_id=task_id,
        name=data.name,
        quantity=data.quantity,
        unit=data.unit,
        unit_price=data.unit_price,
        supplier_id=data.supplier_id,
        status=data.status,
    )
    db.add(material)
    await db.flush()
    await db.refresh(material)
    return await _enrich(material, db)


@router.patch("/{material_id}", response_model=TaskMaterialRead)
async def update_material(
    task_id: int, material_id: int, data: TaskMaterialUpdate, db: DbSession, _: CurrentUserId
):
    result = await db.execute(
        select(TaskMaterial).where(
            TaskMaterial.id == material_id, TaskMaterial.task_id == task_id
        )
    )
    material = result.scalar_one_or_none()
    if not material:
        raise HTTPException(status_code=404, detail="Material no encontrado")

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(material, field, value)

    await db.flush()
    await db.refresh(material)
    return await _enrich(material, db)


@router.delete("/{material_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_material(
    task_id: int, material_id: int, db: DbSession, _: CurrentUserId
):
    result = await db.execute(
        select(TaskMaterial).where(
            TaskMaterial.id == material_id, TaskMaterial.task_id == task_id
        )
    )
    material = result.scalar_one_or_none()
    if not material:
        raise HTTPException(status_code=404, detail="Material no encontrado")
    await db.delete(material)
    await db.flush()
