"""record_daily_progress — historial diario para la curva S (I-05).

Job diario (app/core/scheduler.py:_job_obra_progress_daily) llama a esto por
cada obra activa. Acá se prueba la función que persiste, no el cron.
"""
from datetime import date, timedelta

import pytest_asyncio
from sqlalchemy import select

from app.models.obra import Obra
from app.models.obra_progress_daily import ObraProgressDaily
from app.models.task import Task, TaskStatus
from app.models.tenant import Tenant
from app.models.user import User
from app.services.obra_dashboard_service import ObraDashboardService


@pytest_asyncio.fixture
async def ctx(db):
    tenant = Tenant(name="Empresa Curva S")
    db.add(tenant)
    await db.flush()
    user = User(email="curvas@x.com", hashed_password="x", full_name="Jefe",
                role="admin", is_active=True, tenant_id=tenant.id)
    db.add(user)
    await db.flush()

    async def new_obra(name: str) -> Obra:
        obra = Obra(name=name, manager_id=user.id, tenant_id=tenant.id)
        db.add(obra)
        await db.flush()
        return obra

    return {"tenant": tenant, "user": user, "new_obra": new_obra, "db": db}


def _task(obra: Obra, tenant: Tenant, title: str, **kw) -> Task:
    return Task(obra_id=obra.id, tenant_id=tenant.id, title=title, **kw)


async def _row(db, obra_id: int) -> ObraProgressDaily | None:
    return (await db.execute(
        select(ObraProgressDaily).where(ObraProgressDaily.obra_id == obra_id)
    )).scalar_one_or_none()


async def test_crea_una_fila_con_los_valores_de_hoy(ctx, db):
    obra = await ctx["new_obra"]("Con avance")
    db.add(_task(
        obra, ctx["tenant"], "Tarea", status=TaskStatus.EN_PROGRESO, estimated_progress=40,
        start_date=date.today() - timedelta(days=5), due_date=date.today() + timedelta(days=5),
    ))
    await db.flush()

    await ObraDashboardService(db).record_daily_progress(obra)

    fila = await _row(db, obra.id)
    assert fila is not None
    assert fila.date == date.today()
    assert fila.tenant_id == ctx["tenant"].id
    assert float(fila.progress_real) == 40.0
    assert fila.tasks_total == 1
    # sin dependencias cargadas -> critical_path no disponible -> campos None
    assert fila.critical_task_count is None
    assert fila.median_float_days is None


async def test_llamado_dos_veces_el_mismo_dia_actualiza_no_duplica(ctx, db):
    obra = await ctx["new_obra"]("Upsert")
    tarea = _task(
        obra, ctx["tenant"], "Tarea", status=TaskStatus.EN_PROGRESO, estimated_progress=10,
        start_date=date.today() - timedelta(days=5), due_date=date.today() + timedelta(days=5),
    )
    db.add(tarea)
    await db.flush()

    service = ObraDashboardService(db)
    await service.record_daily_progress(obra)

    tarea.estimated_progress = 90
    await db.flush()
    await service.record_daily_progress(obra)

    filas = (await db.execute(
        select(ObraProgressDaily).where(ObraProgressDaily.obra_id == obra.id)
    )).scalars().all()
    assert len(filas) == 1
    assert float(filas[0].progress_real) == 90.0
