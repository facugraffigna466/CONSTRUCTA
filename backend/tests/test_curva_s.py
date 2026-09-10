"""GET /obras/{id}/dashboard/curva-s — I-05 (docs/features/dashboard-indicadores-obra.md).

`planned` es determinístico (se recalcula siempre); `real` sale de
obra_progress_daily y es None antes de que exista una fila para esa fecha —
el gráfico corta la línea, no la manda a cero.
"""
from datetime import date, timedelta

import pytest_asyncio

from app.models.obra import Obra
from app.models.obra_progress_daily import ObraProgressDaily
from app.models.task import Task, TaskStatus
from app.models.tenant import Tenant
from app.models.user import User
from app.services.obra_dashboard_service import ObraDashboardService

LUNES = date(2026, 6, 1)
LUNES_SIGUIENTE = date(2026, 6, 8)          # working_days_between(LUNES, .) = 6
LUNES_MAS_DOS_SEMANAS = date(2026, 6, 15)   # working_days_between(LUNES, .) = 12


@pytest_asyncio.fixture
async def ctx(db):
    tenant = Tenant(name="Empresa Curva S API")
    db.add(tenant)
    await db.flush()
    user = User(email="curvasapi@x.com", hashed_password="x", full_name="Jefe",
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


async def test_sin_tareas_con_fechas_no_hay_puntos(ctx, db):
    obra = await ctx["new_obra"]("Sin fechas")
    db.add(_task(obra, ctx["tenant"], "Tarea", status=TaskStatus.PENDIENTE))
    await db.flush()

    body = await ObraDashboardService(db).get_curva_s(obra.id)

    assert body["points"] == []
    assert body["tracking_since"] is None
    assert body["granularity"] == "week"


async def test_planned_semanal_calculado_a_mano_sin_historia_real(ctx, db):
    obra = await ctx["new_obra"]("Con fechas")
    db.add(_task(
        obra, ctx["tenant"], "Tarea", status=TaskStatus.EN_PROGRESO,
        start_date=LUNES, due_date=LUNES_MAS_DOS_SEMANAS,
    ))
    await db.flush()

    body = await ObraDashboardService(db).get_curva_s(obra.id)
    puntos = {p["date"]: p for p in body["points"]}

    assert set(puntos.keys()) == {LUNES.isoformat(), LUNES_SIGUIENTE.isoformat(), LUNES_MAS_DOS_SEMANAS.isoformat()}
    assert puntos[LUNES.isoformat()]["planned"] == 0.0
    assert puntos[LUNES_SIGUIENTE.isoformat()]["planned"] == 50.0       # 100*6/12
    assert puntos[LUNES_MAS_DOS_SEMANAS.isoformat()]["planned"] == 100.0
    assert all(p["real"] is None for p in body["points"])
    assert body["tracking_since"] is None


async def test_real_aparece_solo_desde_que_hay_filas_guardadas(ctx, db):
    obra = await ctx["new_obra"]("Con historia")
    db.add(_task(
        obra, ctx["tenant"], "Tarea", status=TaskStatus.EN_PROGRESO,
        start_date=LUNES, due_date=LUNES_MAS_DOS_SEMANAS,
    ))
    await db.flush()

    db.add_all([
        ObraProgressDaily(obra_id=obra.id, tenant_id=ctx["tenant"].id, date=LUNES_SIGUIENTE, progress_real=45.0),
        ObraProgressDaily(obra_id=obra.id, tenant_id=ctx["tenant"].id, date=LUNES_MAS_DOS_SEMANAS, progress_real=95.0),
    ])
    await db.flush()

    body = await ObraDashboardService(db).get_curva_s(obra.id)
    puntos = {p["date"]: p for p in body["points"]}

    assert body["tracking_since"] == LUNES_SIGUIENTE.isoformat()
    assert puntos[LUNES.isoformat()]["real"] is None
    assert puntos[LUNES_SIGUIENTE.isoformat()]["real"] == 45.0
    assert puntos[LUNES_MAS_DOS_SEMANAS.isoformat()]["real"] == 95.0


async def test_real_empareja_por_cercania_no_por_fecha_exacta(ctx, db):
    """Regresión: el job de tracking corre todos los días, anclado al día en
    que arrancó a trackear — casi nunca cae justo en un punto semanal del
    gráfico (que está anclado al día de la semana del inicio de la obra).
    Exigir fecha exacta dejaba la serie real siempre vacía en la práctica."""
    obra = await ctx["new_obra"]("Tracking desalineado")
    db.add(_task(
        obra, ctx["tenant"], "Tarea", status=TaskStatus.EN_PROGRESO,
        start_date=LUNES, due_date=LUNES_MAS_DOS_SEMANAS,
    ))
    await db.flush()

    # El tracking arrancó 2 días después del punto semanal (miércoles, no lunes).
    db.add(ObraProgressDaily(
        obra_id=obra.id, tenant_id=ctx["tenant"].id,
        date=LUNES_SIGUIENTE + timedelta(days=2), progress_real=60.0,
    ))
    await db.flush()

    body = await ObraDashboardService(db).get_curva_s(obra.id)
    puntos = {p["date"]: p for p in body["points"]}

    assert puntos[LUNES_SIGUIENTE.isoformat()]["real"] == 60.0
