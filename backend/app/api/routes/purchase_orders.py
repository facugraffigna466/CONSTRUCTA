"""
Módulo Compras + Presupuesto por obra.

GET  /obras/{obra_id}/presupuesto            → materiales agrupados por tarea + totales
GET  /obras/{obra_id}/purchase-orders        → pedidos de la obra
POST /obras/{obra_id}/purchase-orders        → crear pedido desde materiales pendientes
POST /purchase-orders/{order_id}/send        → enviar al proveedor (WhatsApp/email)
POST /purchase-orders/{order_id}/receive     → confirmar recepción
"""
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select

from app.core.deps import CurrentUser, DbSession
from app.core.obra_permissions import (
    require_obra_role,
    require_purchase_order_obra_role,
)
from app.models.alert import AlertType
from app.models.obra_user_role import ObraUserRoleType
from app.models.obra import Obra
from app.models.purchase_order import PurchaseOrder, PurchaseOrderItem
from app.models.responsible import Responsible
from app.models.supplier import Supplier
from app.models.task import Task
from app.models.task_material import TaskMaterial
from app.models.user import User
from app.repositories.alert import AlertRepository
from app.repositories.historial import HistorialRepository
from app.schemas.purchase_order import (
    PresupuestoResponse,
    PresupuestoRow,
    PurchaseOrderCreate,
    PurchaseOrderRead,
    PurchaseOrderSendRequest,
)
from app.integrations.twilio.client import send_whatsapp_message
from app.services.email_service import send_email

router = APIRouter(tags=["purchase-orders"])


async def _get_obra_scoped(obra_id: int, db: DbSession, current_user: User) -> Obra:
    """Obra de la obra_id, verificando que pertenezca al tenant del usuario.
    Colapsa el caso cross-tenant en el mismo 404 para no filtrar existencia."""
    obra = (await db.execute(select(Obra).where(Obra.id == obra_id))).scalar_one_or_none()
    if not obra or (
        current_user.tenant_id is not None and obra.tenant_id != current_user.tenant_id
    ):
        raise HTTPException(404, "Obra no encontrada")
    return obra


def _order_total(order: PurchaseOrder) -> float:
    return float(sum(
        (float(i.quantity or 0) * float(i.unit_price or 0)) for i in order.items
    ))


async def _order_to_read(order: PurchaseOrder, db: DbSession) -> PurchaseOrderRead:
    data = PurchaseOrderRead.model_validate(order)
    data.total = _order_total(order)
    if order.supplier_id:
        sup = (await db.execute(select(Supplier).where(Supplier.id == order.supplier_id))).scalar_one_or_none()
        if sup:
            data.supplier_name = sup.name
            data.supplier_phone = sup.phone
            data.supplier_email = sup.email
    return data


# ─── Presupuesto ──────────────────────────────────────────────────────────────

@router.get("/obras/{obra_id}/presupuesto", response_model=PresupuestoResponse)
async def get_presupuesto(
    obra_id: int,
    db: DbSession,
    current_user: Annotated[User, Depends(require_obra_role(ObraUserRoleType.SOLO_LECTURA))],
):

    ResponsibleAlias = Responsible
    UserAlias = User

    result = await db.execute(
        select(TaskMaterial, Task.title, Supplier.name, ResponsibleAlias.full_name, UserAlias.full_name)
        .join(Task, TaskMaterial.task_id == Task.id)
        .outerjoin(Supplier, TaskMaterial.supplier_id == Supplier.id)
        .outerjoin(ResponsibleAlias, TaskMaterial.responsible_id == ResponsibleAlias.id)
        .outerjoin(UserAlias, TaskMaterial.created_by == UserAlias.id)
        .where(Task.obra_id == obra_id)
        .order_by(Task.order_index, Task.id, TaskMaterial.created_at)
    )

    rows: list[PresupuestoRow] = []
    total_estimado = total_pedido = total_recibido = 0.0
    for material, task_title, supplier_name, responsible_name, created_by_name in result.all():
        subtotal = float(material.quantity or 0) * float(material.unit_price or 0)
        rows.append(PresupuestoRow(
            task_id=material.task_id,
            task_title=task_title,
            material_id=material.id,
            name=material.name,
            quantity=float(material.quantity) if material.quantity is not None else None,
            unit=material.unit,
            unit_price=float(material.unit_price) if material.unit_price is not None else None,
            subtotal=subtotal,
            status=material.status,
            supplier_id=material.supplier_id,
            supplier_name=supplier_name,
            responsible_id=material.responsible_id,
            responsible_name=responsible_name,
            created_by=material.created_by,
            created_by_name=created_by_name,
        ))
        total_estimado += subtotal
        if material.status == "pedido":
            total_pedido += subtotal
        elif material.status == "recibido":
            total_recibido += subtotal

    return PresupuestoResponse(
        rows=rows,
        total_estimado=total_estimado,
        total_pedido=total_pedido,
        total_recibido=total_recibido,
    )


# ─── Pedidos ──────────────────────────────────────────────────────────────────

@router.get("/obras/{obra_id}/purchase-orders", response_model=list[PurchaseOrderRead])
async def list_orders(
    obra_id: int,
    db: DbSession,
    current_user: Annotated[User, Depends(require_obra_role(ObraUserRoleType.SOLO_LECTURA))],
):
    result = await db.execute(
        select(PurchaseOrder)
        .where(PurchaseOrder.obra_id == obra_id)
        .order_by(PurchaseOrder.created_at.desc())
    )
    orders = result.scalars().all()
    return [await _order_to_read(o, db) for o in orders]


@router.post("/obras/{obra_id}/purchase-orders", response_model=PurchaseOrderRead, status_code=status.HTTP_201_CREATED)
async def create_order(
    obra_id: int,
    data: PurchaseOrderCreate,
    db: DbSession,
    current_user: Annotated[User, Depends(require_obra_role(ObraUserRoleType.JEFE_OBRA))],
):

    materials = (await db.execute(
        select(TaskMaterial)
        .join(Task, TaskMaterial.task_id == Task.id)
        .where(TaskMaterial.id.in_(data.material_ids), Task.obra_id == obra_id)
    )).scalars().all()
    if not materials:
        raise HTTPException(422, "Ningún material válido para esta obra.")

    order = PurchaseOrder(
        obra_id=obra_id,
        supplier_id=data.supplier_id,
        created_by=current_user.id,
        notes=data.notes,
        status="borrador",
    )
    db.add(order)
    await db.flush()

    for m in materials:
        db.add(PurchaseOrderItem(
            order_id=order.id,
            material_id=m.id,
            name=m.name,
            quantity=m.quantity,
            unit=m.unit,
            unit_price=m.unit_price,
        ))
        m.status = "pedido"
    await db.flush()
    await db.refresh(order)

    await HistorialRepository(db).log(
        event_type="purchase_order_created",
        description=f"Pedido #{order.id} creado con {len(materials)} ítem{'s' if len(materials) != 1 else ''}",
        obra_id=obra_id,
        payload={"order_id": order.id, "material_ids": [m.id for m in materials]},
        triggered_by="user",
    )
    return await _order_to_read(order, db)


def _build_order_message(order: PurchaseOrder, obra_name: str, supplier_name: str | None) -> str:
    lines = [
        f"Pedido de materiales #{order.id} — Obra: {obra_name}",
        "",
    ]
    for i in order.items:
        qty = f"{float(i.quantity):g} {i.unit or 'un'}" if i.quantity else "—"
        lines.append(f"• {i.name}: {qty}")
    if order.notes:
        lines.append("")
        lines.append(f"Notas: {order.notes}")
    lines.append("")
    lines.append("Enviado desde CONSTRUCTA.")
    return "\n".join(lines)


@router.post("/purchase-orders/{order_id}/send", response_model=PurchaseOrderRead)
async def send_order(
    order_id: int,
    data: PurchaseOrderSendRequest,
    db: DbSession,
    current_user: Annotated[User, Depends(require_purchase_order_obra_role(ObraUserRoleType.JEFE_OBRA))],
):
    order = (await db.execute(
        select(PurchaseOrder).where(PurchaseOrder.id == order_id)
    )).scalar_one_or_none()
    # La dependency ya validó existencia + tenant + rol; el reload acá es defensivo.
    if not order:
        raise HTTPException(404, "Pedido no encontrado")

    obra = await _get_obra_scoped(order.obra_id, db, current_user)

    # Idempotencia: solo un pedido en 'borrador' se envía. Un segundo click / reintento
    # (ya 'enviado' o 'recibido') no dispara un mensaje duplicado al proveedor.
    if order.status != "borrador":
        detail = "El pedido ya fue recibido." if order.status == "recibido" else "El pedido ya fue enviado."
        raise HTTPException(409, detail)

    if not order.supplier_id:
        raise HTTPException(422, "El pedido no tiene proveedor asignado.")

    supplier = (await db.execute(select(Supplier).where(Supplier.id == order.supplier_id))).scalar_one_or_none()
    if not supplier:
        raise HTTPException(422, "El proveedor del pedido ya no existe.")

    body = _build_order_message(order, obra.name, supplier.name)

    delivered = False
    if data.channel == "whatsapp":
        if not supplier.phone:
            raise HTTPException(422, "El proveedor no tiene teléfono cargado.")
        sid = await send_whatsapp_message(supplier.phone, body)
        delivered = sid is not None
    else:
        if not supplier.email:
            raise HTTPException(422, "El proveedor no tiene email cargado.")
        html = "<pre style='font-family:sans-serif'>" + body.replace("\n", "<br>") + "</pre>"
        delivered = await send_email(supplier.email, f"Pedido de materiales #{order.id} — {obra.name}", html, body)

    order.status = "enviado"
    order.sent_at = datetime.now(timezone.utc)
    await db.flush()

    await HistorialRepository(db).log(
        event_type="purchase_order_sent",
        description=(
            f"Pedido #{order.id} enviado a {supplier.name} por {('WhatsApp' if data.channel == 'whatsapp' else 'email')}"
            + ("" if delivered else " (el canal no está configurado — marcado como enviado)")
        ),
        obra_id=order.obra_id,
        payload={"order_id": order.id, "channel": data.channel, "delivered": delivered},
        triggered_by="user",
    )
    return await _order_to_read(order, db)


@router.post("/purchase-orders/{order_id}/receive", response_model=PurchaseOrderRead)
async def receive_order(
    order_id: int,
    db: DbSession,
    current_user: Annotated[User, Depends(require_purchase_order_obra_role(ObraUserRoleType.COLABORADOR))],
):
    order = (await db.execute(
        select(PurchaseOrder).where(PurchaseOrder.id == order_id)
    )).scalar_one_or_none()
    if not order:
        raise HTTPException(404, "Pedido no encontrado")

    if order.status == "recibido":
        return await _order_to_read(order, db)

    order.status = "recibido"
    order.received_at = datetime.now(timezone.utc)

    # Materiales del pedido → recibidos
    material_ids = [i.material_id for i in order.items if i.material_id]
    if material_ids:
        mats = (await db.execute(
            select(TaskMaterial).where(TaskMaterial.id.in_(material_ids))
        )).scalars().all()
        for m in mats:
            m.status = "recibido"
    await db.flush()

    supplier_name = None
    if order.supplier_id:
        supplier_name = (await db.execute(
            select(Supplier.name).where(Supplier.id == order.supplier_id)
        )).scalar_one_or_none()

    msg = f"Pedido #{order.id}{f' de {supplier_name}' if supplier_name else ''} marcado como recibido."
    await AlertRepository(db).create_alert(
        alert_type=AlertType.ORDER_RECEIVED,
        message=msg,
        obra_id=order.obra_id,
        task_id=None,
    )
    await HistorialRepository(db).log(
        event_type="purchase_order_received",
        description=msg,
        obra_id=order.obra_id,
        payload={"order_id": order.id, "material_ids": material_ids},
        triggered_by="user",
    )
    return await _order_to_read(order, db)
