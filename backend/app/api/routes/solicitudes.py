"""
Solicitudes de Cotización — Módulo Compras.

GET    /obras/{obra_id}/solicitudes-cotizacion          → listar solicitudes
POST   /obras/{obra_id}/solicitudes-cotizacion          → crear y enviar
POST   /obras/{obra_id}/analisis-compras                → análisis IA on-demand
POST   /solicitudes-cotizacion/{id}/confirmar           → confirmar proveedor formal
POST   /solicitudes-cotizacion/{id}/confirmar-contratista → confirmar contratista
DELETE /solicitudes-cotizacion/{id}                     → eliminar solicitud
"""
from fastapi import APIRouter, HTTPException, Response, status

from app.core.deps import CurrentUserId, DbSession
from app.models.obra import Obra
from app.schemas.purchase_order import PurchaseOrderRead
from app.schemas.solicitud_cotizacion import (
    AnalisisHistoricoComprasRead,
    ConfirmarContratistaRequest,
    ConfirmarProveedorRequest,
    SolicitudCotizacionCreate,
    SolicitudCotizacionRead,
)
from app.services.solicitud_service import SolicitudService
from sqlalchemy import select

router = APIRouter(tags=["solicitudes-cotizacion"])


async def _get_obra_or_404(obra_id: int, db: DbSession) -> Obra:
    obra = (await db.execute(select(Obra).where(Obra.id == obra_id))).scalar_one_or_none()
    if not obra:
        raise HTTPException(404, "Obra no encontrada")
    return obra


def _order_read(order) -> PurchaseOrderRead:
    return PurchaseOrderRead(
        id=order.id,
        obra_id=order.obra_id,
        supplier_id=order.supplier_id,
        status=order.status,
        notes=order.notes,
        created_at=order.created_at,
        items=[],
        total=0.0,
    )


# ── Listar ────────────────────────────────────────────────────────────────────

@router.get(
    "/obras/{obra_id}/solicitudes-cotizacion",
    response_model=list[SolicitudCotizacionRead],
)
async def list_solicitudes(obra_id: int, db: DbSession, _: CurrentUserId):
    await _get_obra_or_404(obra_id, db)
    return await SolicitudService(db).list_for_obra(obra_id)


# ── Crear ─────────────────────────────────────────────────────────────────────

@router.post(
    "/obras/{obra_id}/solicitudes-cotizacion",
    response_model=SolicitudCotizacionRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_solicitud(
    obra_id: int,
    data: SolicitudCotizacionCreate,
    db: DbSession,
    current_user_id: CurrentUserId,
):
    await _get_obra_or_404(obra_id, db)
    try:
        svc = SolicitudService(db)
        sol = await svc.create(
            obra_id=obra_id,
            material_ids=data.material_ids,
            supplier_ids=data.supplier_ids,
            notes=data.notes,
            created_by=current_user_id,
            contratista_phones=data.contratista_phones,
        )
        return await svc._to_read(sol)
    except ValueError as exc:
        raise HTTPException(422, str(exc))


# ── Análisis IA de compras (on-demand) ────────────────────────────────────────

@router.post(
    "/obras/{obra_id}/analisis-compras",
    response_model=AnalisisHistoricoComprasRead,
)
async def analisis_compras(obra_id: int, db: DbSession, _: CurrentUserId):
    await _get_obra_or_404(obra_id, db)
    try:
        return await SolicitudService(db).analizar_historico(obra_id)
    except ValueError as exc:
        raise HTTPException(422, str(exc))


# ── Confirmar proveedor formal ────────────────────────────────────────────────

@router.post(
    "/solicitudes-cotizacion/{solicitud_id}/confirmar",
    response_model=PurchaseOrderRead,
    status_code=status.HTTP_201_CREATED,
)
async def confirmar_proveedor(
    solicitud_id: int,
    data: ConfirmarProveedorRequest,
    db: DbSession,
    current_user_id: CurrentUserId,
):
    try:
        order = await SolicitudService(db).confirmar(
            solicitud_id=solicitud_id,
            supplier_id=data.supplier_id,
            confirmed_by=current_user_id,
        )
    except ValueError as exc:
        raise HTTPException(404 if "no encontrada" in str(exc).lower() else 422, str(exc))
    return _order_read(order)


# ── Confirmar contratista (auto-crea Supplier) ────────────────────────────────

@router.post(
    "/solicitudes-cotizacion/{solicitud_id}/confirmar-contratista",
    response_model=PurchaseOrderRead,
    status_code=status.HTTP_201_CREATED,
)
async def confirmar_contratista(
    solicitud_id: int,
    data: ConfirmarContratistaRequest,
    db: DbSession,
    current_user_id: CurrentUserId,
):
    try:
        order = await SolicitudService(db).confirmar_contratista(
            solicitud_id=solicitud_id,
            supplier_name=data.supplier_name,
            supplier_phone=data.supplier_phone,
            confirmed_by=current_user_id,
        )
    except ValueError as exc:
        raise HTTPException(404 if "no encontrada" in str(exc).lower() else 422, str(exc))
    return _order_read(order)


# ── Eliminar solicitud ────────────────────────────────────────────────────────

@router.delete(
    "/solicitudes-cotizacion/{solicitud_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_solicitud(
    solicitud_id: int,
    db: DbSession,
    _: CurrentUserId,
):
    try:
        await SolicitudService(db).delete_solicitud(solicitud_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc))
    return Response(status_code=status.HTTP_204_NO_CONTENT)
