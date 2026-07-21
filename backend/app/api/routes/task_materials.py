from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.deps import CurrentUser, DbSession
from app.models.user import User
from app.models.obra import Obra
from app.models.responsible import Responsible
from app.models.supplier import Supplier
from app.models.task import Task
from app.models.task_material import TaskMaterial
from app.schemas.task_material import TaskMaterialCreate, TaskMaterialRead, TaskMaterialUpdate

router = APIRouter(prefix="/tasks/{task_id}/materials", tags=["task-materials"])


async def _get_task_or_404(task_id: int, db: DbSession, tenant_id: int | None = None) -> Task:
    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Tarea no encontrada")
    # Aislamiento multi-tenant: la tarea debe pertenecer a una obra del tenant.
    if tenant_id is not None:
        obra = await db.get(Obra, task.obra_id)
        if obra is not None and obra.tenant_id is not None and obra.tenant_id != tenant_id:
            raise HTTPException(status_code=404, detail="Tarea no encontrada")
    return task


async def _enrich(material: TaskMaterial, db: DbSession) -> TaskMaterialRead:
    supplier_name = None
    if material.supplier_id:
        res = await db.execute(select(Supplier.name).where(Supplier.id == material.supplier_id))
        supplier_name = res.scalar_one_or_none()
    responsible_name = None
    if material.responsible_id:
        res = await db.execute(select(Responsible.full_name).where(Responsible.id == material.responsible_id))
        responsible_name = res.scalar_one_or_none()
    created_by_name = None
    if material.created_by:
        res = await db.execute(select(User.full_name).where(User.id == material.created_by))
        created_by_name = res.scalar_one_or_none()
    data = TaskMaterialRead.model_validate(material)
    data.supplier_name = supplier_name
    data.responsible_name = responsible_name
    data.created_by_name = created_by_name
    return data


@router.get("", response_model=list[TaskMaterialRead])
async def list_materials(task_id: int, db: DbSession, current_user: CurrentUser):
    await _get_task_or_404(task_id, db, current_user.tenant_id)
    result = await db.execute(
        select(TaskMaterial)
        .where(TaskMaterial.task_id == task_id)
        .order_by(TaskMaterial.created_at)
    )
    materials = result.scalars().all()
    return [await _enrich(m, db) for m in materials]


@router.post("", response_model=TaskMaterialRead, status_code=status.HTTP_201_CREATED)
async def create_material(
    task_id: int, data: TaskMaterialCreate, db: DbSession, current_user: CurrentUser
):
    await _get_task_or_404(task_id, db, current_user.tenant_id)
    material = TaskMaterial(
        task_id=task_id,
        name=data.name,
        quantity=data.quantity,
        unit=data.unit,
        unit_price=data.unit_price,
        supplier_id=data.supplier_id,
        responsible_id=data.responsible_id,
        created_by=current_user.id,
        status=data.status,
    )
    db.add(material)
    await db.flush()
    await db.refresh(material)
    return await _enrich(material, db)


@router.patch("/{material_id}", response_model=TaskMaterialRead)
async def update_material(
    task_id: int, material_id: int, data: TaskMaterialUpdate, db: DbSession, current_user: CurrentUser
):
    await _get_task_or_404(task_id, db, current_user.tenant_id)
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
    task_id: int, material_id: int, db: DbSession, current_user: CurrentUser
):
    await _get_task_or_404(task_id, db, current_user.tenant_id)
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
