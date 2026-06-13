from typing import Annotated

from fastapi import APIRouter, File, Form, Query, UploadFile, status

from app.core.deps import CurrentUser, DbSession
from app.models.budget import Budget
from app.schemas.budget import (
    BudgetCompareRequest,
    BudgetComparison,
    BudgetRead,
    BudgetTextCreate,
)
from app.services.budget_service import BudgetService

router = APIRouter(prefix="/budgets", tags=["budgets"])


async def _to_read(budget: Budget, svc: BudgetService) -> BudgetRead:
    out = BudgetRead.model_validate(budget)
    return out.model_copy(update={"obra_name": await svc.obra_name(budget.obra_id)})


@router.post("/upload", response_model=BudgetRead, status_code=status.HTTP_201_CREATED)
async def upload_budget(
    db: DbSession,
    current_user: CurrentUser,
    file: UploadFile = File(...),
    obra_id: Annotated[int | None, Form()] = None,
    supplier_name: Annotated[str | None, Form()] = None,
):
    svc = BudgetService(db)
    budget = await svc.create(
        tenant_id=current_user.tenant_id,
        created_by=current_user.id,
        obra_id=obra_id,
        supplier_name=supplier_name,
        file_bytes=await file.read(),
        content_type=file.content_type,
        filename=file.filename,
    )
    return await _to_read(budget, svc)


@router.post("/text", response_model=BudgetRead, status_code=status.HTTP_201_CREATED)
async def create_budget_from_text(data: BudgetTextCreate, db: DbSession, current_user: CurrentUser):
    svc = BudgetService(db)
    budget = await svc.create(
        tenant_id=current_user.tenant_id,
        created_by=current_user.id,
        obra_id=data.obra_id,
        supplier_name=data.supplier_name,
        text=data.text,
    )
    return await _to_read(budget, svc)


@router.get("", response_model=list[BudgetRead])
async def list_budgets(
    db: DbSession,
    current_user: CurrentUser,
    obra_id: Annotated[int | None, Query()] = None,
):
    svc = BudgetService(db)
    budgets = await svc.list_all(current_user.tenant_id, obra_id=obra_id)
    return [await _to_read(b, svc) for b in budgets]


@router.get("/{budget_id}", response_model=BudgetRead)
async def get_budget(budget_id: int, db: DbSession, current_user: CurrentUser):
    svc = BudgetService(db)
    return await _to_read(await svc.get_or_raise(budget_id, current_user.tenant_id), svc)


@router.delete("/{budget_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_budget(budget_id: int, db: DbSession, current_user: CurrentUser):
    await BudgetService(db).delete(budget_id, current_user.tenant_id)


@router.post("/compare", response_model=BudgetComparison)
async def compare_budgets(data: BudgetCompareRequest, db: DbSession, current_user: CurrentUser):
    return await BudgetService(db).compare(data.budget_ids, current_user.tenant_id)
