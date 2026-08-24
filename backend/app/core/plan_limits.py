from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.obra import Obra
from app.models.plan import Plan
from app.models.task import Task
from app.models.tenant import Tenant
from app.models.user import User

logger = logging.getLogger(__name__)

# Umbral a partir del cual mandamos el aviso preventivo. Si el uso proyectado
# alcanza ≥ 80% del límite del plan y no mandamos un aviso en los últimos 7
# días para este tenant, encolamos un email al owner.
_PLAN_WARNING_THRESHOLD = 0.80
_PLAN_WARNING_COOLDOWN_DAYS = 7


async def check_plan_limit(
    db: AsyncSession,
    tenant_id: int | None,
    resource: Literal["obras", "users", "tasks"],
    obra_id: int | None = None,
    requested: int = 1,
) -> None:
    """
    Raises HTTP 402 if the tenant would exceed the plan limit after adding `requested` rows.
    - tenant_id=None → skip check (no tenant assigned yet)
    - obra_id required when resource='tasks'
    - requested: cuántas filas se van a crear en esta operación (para batch/bulk)

    Como efecto secundario: si el chequeo PASA pero el uso proyectado alcanza
    el 80% del límite, encola un email preventivo al owner del tenant (dedupe
    de 7 días para no molestar). El aviso corre en background (`create_task`)
    para no sumar latencia al request. Ver docs/roles-redesign/fase-6-emails.md.
    """
    if tenant_id is None:
        return

    tenant = await db.get(Tenant, tenant_id)
    if not tenant or not tenant.plan_id:
        return

    plan = await db.get(Plan, tenant.plan_id)
    if not plan:
        return

    if resource == "obras":
        limit = plan.max_obras
        if limit is None:
            return
        count_result = await db.execute(
            select(func.count()).where(Obra.tenant_id == tenant_id)
        )
        current = count_result.scalar_one()
        if current + requested > limit:
            _raise_upgrade_error("obras", current, limit, plan.name)
        _maybe_schedule_plan_warning(
            db, tenant, plan, "obras", current + requested, limit, requested,
        )

    elif resource == "users":
        limit = plan.max_users
        if limit is None:
            return
        # El conteo incluye:
        #   - usuarios activos (ya aceptaron)
        #   - invitaciones pendientes NO vencidas (token vivo)
        # Esto evita el bypass de mandar N invitaciones en batch, aceptarlas todas
        # y quedar arriba del límite del plan.
        #
        # ────────────────────────────────────────────────────────────────────
        # TODO (decisión de producto — Fase 3+ rediseño de roles): definir si
        # los users con rol `solo_lectura` (auditor, consultor externo, cliente
        # con acceso de solo-vista) deberían contar contra `max_users` o no.
        # HOY todos los users cuentan igual, sin importar sus roles por-obra.
        #
        # Camino A (mantener): 1 fila en `users` = 1 slot del plan, sin importar
        #   qué haga o vea. Regla simple, no penaliza a quien vende el plan
        #   ("Pro incluye 30 usuarios" siempre significa 30 filas).
        #   * Cambio requerido: NINGUNO (comportamiento actual).
        #
        # Camino B (excluir solo_lectura): los users cuyo ÚNICO rol activo es
        #   `solo_lectura` no consumen slot. Permite invitar auditores y
        #   clientes sin cobrar más. Cuidado: hay que decidir qué pasa con
        #   users híbridos (colaborador en obra A + solo_lectura en obra B) —
        #   probablemente el criterio es "si tiene AL MENOS un rol >
        #   solo_lectura, cuenta". Y qué pasa con los admin de empresa
        #   (siempre cuentan, no tienen rol por-obra).
        #   * Cambio requerido: subquery contra `obra_user_roles` para excluir
        #     users cuyo rol máximo es solo_lectura. Los admin siguen contando
        #     porque no tienen filas en la tabla. Ejemplo del filtro:
        #         and_(
        #             User.role == "admin",
        #             ...
        #         )  OR (max(role_level) > solo_lectura)
        #
        # Ver docs/roles-redesign/fase-3-invitacion.md §"Decisión pendiente".
        # ────────────────────────────────────────────────────────────────────
        now = datetime.now(timezone.utc)
        count_result = await db.execute(
            select(func.count()).where(
                User.tenant_id == tenant_id,
                or_(
                    User.is_active == True,  # noqa: E712
                    (User.invitation_token.isnot(None)) & (User.invitation_expires_at > now),
                ),
            )
        )
        current = count_result.scalar_one()
        if current + requested > limit:
            _raise_upgrade_error("usuarios", current, limit, plan.name)
        _maybe_schedule_plan_warning(
            db, tenant, plan, "usuarios", current + requested, limit, requested,
        )

    elif resource == "tasks":
        limit = plan.max_tasks_per_obra
        if limit is None or obra_id is None:
            return
        count_result = await db.execute(
            select(func.count()).where(Task.obra_id == obra_id)
        )
        current = count_result.scalar_one()
        if current + requested > limit:
            _raise_upgrade_error("tareas por obra", current, limit, plan.name)
        _maybe_schedule_plan_warning(
            db, tenant, plan, "tareas por obra", current + requested, limit, requested,
        )


def _raise_upgrade_error(resource: str, current: int, limit: int, plan_name: str) -> None:
    raise HTTPException(
        status_code=status.HTTP_402_PAYMENT_REQUIRED,
        detail={
            "code": "plan_limit_reached",
            "resource": resource,
            "current": current,
            "limit": limit,
            "plan": plan_name,
            "message": f"Alcanzaste el límite de {resource} para el plan {plan_name} ({current}/{limit}). Actualizá tu plan para continuar.",
        },
    )


def _maybe_schedule_plan_warning(
    db: AsyncSession,
    tenant: Tenant,
    plan: Plan,
    resource_label: str,
    projected: int,
    limit: int,
    requested: int,
) -> None:
    """Encola un email preventivo si el uso proyectado ≥ 80% del límite Y no
    se envió un aviso en los últimos 7 días para este tenant.

    Sync-safe: chequea `last_plan_warning_at`, actualiza el timestamp en la
    misma sesión, y dispara el envío en background con `create_task`. Nunca
    levanta — cualquier error se loguea y se descarta (el envío es una mejora
    UX, no puede romper el request que ya pasó el check).

    `requested=0` (usado por el doble candado de accept-invite) NO dispara
    warning: el user ya estaba contado como invitación viva y el aviso ya se
    disparó (o no) en el momento del invite original."""
    if requested <= 0:
        return
    if limit <= 0:
        return
    if projected < limit * _PLAN_WARNING_THRESHOLD:
        return

    now = datetime.now(timezone.utc)
    last = tenant.last_plan_warning_at
    if last is not None:
        if last.tzinfo is None:
            last = last.replace(tzinfo=timezone.utc)
        if now - last < timedelta(days=_PLAN_WARNING_COOLDOWN_DAYS):
            return

    # Actualizamos el timestamp acá mismo — cuando el request commit-ee, queda
    # persistido. El envío en background NO puede reusar `db` (la sesión se
    # cierra cuando termina el request), así que le pasamos primitivos.
    tenant.last_plan_warning_at = now

    asyncio.create_task(
        _send_plan_warning_now(
            tenant_id=tenant.id,
            resource_label=resource_label,
            projected=projected,
            limit=limit,
            plan_name=plan.name,
        )
    )


async def _send_plan_warning_now(
    *, tenant_id: int, resource_label: str, projected: int, limit: int, plan_name: str
) -> None:
    """Envío efectivo del email preventivo. Se ejecuta en background — abre su
    propia sesión de DB (la del request original ya no está disponible) y hace
    fire-and-forget. Los errores se loguean, no explotan."""
    try:
        # Import diferido para no crear ciclo (email_service importa settings,
        # no plan_limits, pero mantiene el módulo core liviano).
        from app.core.database import AsyncSessionLocal
        from app.services.email_service import send_plan_warning_email

        async with AsyncSessionLocal() as session:
            tenant = await session.get(Tenant, tenant_id)
            if tenant is None or tenant.owner_user_id is None:
                logger.info(
                    "plan-warning skipped: tenant %s sin owner_user_id", tenant_id
                )
                return
            owner = await session.get(User, tenant.owner_user_id)
            if owner is None or not owner.email:
                logger.info(
                    "plan-warning skipped: owner de tenant %s sin email", tenant_id
                )
                return

            await send_plan_warning_email(
                to_email=owner.email,
                admin_name=owner.full_name or owner.email,
                tenant_name=tenant.name,
                resource_label=resource_label,
                current=projected,
                limit=limit,
                plan_label=plan_name,
            )
    except Exception as exc:
        # Fire-and-forget: nunca queremos que un fallo del email tumbe algo.
        logger.error("plan-warning email failed for tenant %s: %s", tenant_id, exc)
