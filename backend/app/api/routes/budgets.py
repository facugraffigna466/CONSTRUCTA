from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status

from app.core.deps import CurrentUser, DbSession
from app.core.obra_permissions import (
    assert_obra_access,
    require_budget_obra_role,
    visible_obra_ids,
)
from app.models.budget import Budget
from app.models.obra_user_role import ObraUserRoleType
from app.models.user import User
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
    if obra_id is not None:
        await assert_obra_access(db, current_user, obra_id, ObraUserRoleType.COLABORADOR)
    else:
        # Budget global del tenant: solo admin de empresa puede crearlo.
        if current_user.role != "admin":
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Los budgets sin obra asignada requieren admin de empresa",
            )
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
async def create_budget_from_text(
    data: BudgetTextCreate, db: DbSession, current_user: CurrentUser
):
    if data.obra_id is not None:
        await assert_obra_access(db, current_user, data.obra_id, ObraUserRoleType.COLABORADOR)
    else:
        if current_user.role != "admin":
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Los budgets sin obra asignada requieren admin de empresa",
            )
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
    if obra_id is not None:
        await assert_obra_access(db, current_user, obra_id, ObraUserRoleType.SOLO_LECTURA)
    budgets = await svc.list_all(current_user.tenant_id, obra_id=obra_id)
    if obra_id is None:
        # Non-admin ve solo budgets de sus obras (los globales sin obra_id no).
        visible = await visible_obra_ids(db, current_user)
        if visible is not None:
            budgets = [b for b in budgets if b.obra_id in visible]
    return [await _to_read(b, svc) for b in budgets]


@router.get("/{budget_id}", response_model=BudgetRead)
async def get_budget(
    budget_id: int,
    db: DbSession,
    current_user: Annotated[User, Depends(require_budget_obra_role(ObraUserRoleType.SOLO_LECTURA))],
):
    svc = BudgetService(db)
    return await _to_read(await svc.get_or_raise(budget_id, current_user.tenant_id), svc)


@router.delete("/{budget_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_budget(
    budget_id: int,
    db: DbSession,
    current_user: Annotated[User, Depends(require_budget_obra_role(ObraUserRoleType.JEFE_OBRA))],
):
    await BudgetService(db).delete(budget_id, current_user.tenant_id)


@router.post("/compare", response_model=BudgetComparison)
async def compare_budgets(data: BudgetCompareRequest, db: DbSession, current_user: CurrentUser):
    """Comparación cross-budget. Requiere que el usuario tenga acceso a TODOS los
    budgets involucrados — admin de empresa siempre pasa; non-admin solo si todos
    los budgets están en obras donde tiene rol (o si son globales, no puede)."""
    svc = BudgetService(db)
    if current_user.role != "admin":
        # Chequeo por-budget: fallamos si alguno no es visible.
        visible = await visible_obra_ids(db, current_user) or set()
        for bid in data.budget_ids:
            b = await svc.get_or_raise(bid, current_user.tenant_id)
            if b.obra_id is None or b.obra_id not in visible:
                raise HTTPException(
                    status.HTTP_403_FORBIDDEN,
                    "No tenés acceso a alguno de los presupuestos a comparar",
                )
    return await svc.compare(data.budget_ids, current_user.tenant_id)
