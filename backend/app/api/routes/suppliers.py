from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.core.deps import AdminUser, CurrentUser, DbSession
from app.models.supplier import Supplier
from app.schemas.supplier import SupplierCreate, SupplierRead, SupplierUpdate

router = APIRouter(prefix="/suppliers", tags=["suppliers"])


@router.get("", response_model=list[SupplierRead])
async def list_suppliers(db: DbSession, current_user: CurrentUser):
    result = await db.execute(
        select(Supplier)
        .where(Supplier.is_active == True)
        .order_by(Supplier.name)
    )
    return result.scalars().all()


@router.get("/all", response_model=list[SupplierRead])
async def list_all_suppliers(db: DbSession, admin: AdminUser):
    result = await db.execute(select(Supplier).order_by(Supplier.name))
    return result.scalars().all()


@router.post("", response_model=SupplierRead, status_code=status.HTTP_201_CREATED)
async def create_supplier(data: SupplierCreate, db: DbSession, admin: AdminUser):
    supplier = Supplier(
        tenant_id=admin.tenant_id,
        name=data.name,
        email=data.email,
        phone=data.phone,
        category=data.category,
        notes=data.notes,
    )
    db.add(supplier)
    await db.flush()
    await db.refresh(supplier)
    return supplier


@router.patch("/{supplier_id}", response_model=SupplierRead)
async def update_supplier(
    supplier_id: int, data: SupplierUpdate, db: DbSession, admin: AdminUser
):
    result = await db.execute(select(Supplier).where(Supplier.id == supplier_id))
    supplier = result.scalar_one_or_none()
    if not supplier:
        raise HTTPException(status_code=404, detail="Proveedor no encontrado")

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(supplier, field, value)

    await db.flush()
    await db.refresh(supplier)
    return supplier


@router.delete("/{supplier_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_supplier(supplier_id: int, db: DbSession, admin: AdminUser):
    result = await db.execute(select(Supplier).where(Supplier.id == supplier_id))
    supplier = result.scalar_one_or_none()
    if not supplier:
        raise HTTPException(status_code=404, detail="Proveedor no encontrado")
    supplier.is_active = False
    await db.flush()
