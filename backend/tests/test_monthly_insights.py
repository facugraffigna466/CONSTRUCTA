"""GET /obras/{id}/dashboard/monthly-insights — I-12 a I-16.

D-01: el ranking por responsable (I-12) se filtra en el backend para quien
no sea admin — la clave ni siquiera debe viajar en el JSON.
D-04: I-14/I-15/I-16 (top_deviations, bitacora_themes, alert_reaction) no
tienen ranking por persona en lo que consume el front, así que viajan sin
filtrar para cualquier rol — a diferencia de risk_concentration.by_responsible.
"""
import pytest_asyncio

from app.core.security import create_access_token
from app.models.obra import Obra
from app.models.obra_stats_snapshot import ObraStatsSnapshot
from app.models.obra_user_role import ObraUserRole, ObraUserRoleType
from app.models.tenant import Tenant
from app.models.user import User
from app.services.obra_dashboard_service import ObraDashboardService

API = "/api/v1"


@pytest_asyncio.fixture
async def ctx(db):
    tenant = Tenant(name="Empresa Insights Mensual")
    db.add(tenant)
    await db.flush()
    admin = User(email="admin-mensual@x.com", hashed_password="x", full_name="Admin",
                 role="admin", is_active=True, tenant_id=tenant.id)
    colaborador = User(email="colab-mensual@x.com", hashed_password="x", full_name="Colaborador",
                        role="collaborator", is_active=True, tenant_id=tenant.id)
    db.add_all([admin, colaborador])
    await db.flush()

    async def new_obra(name: str) -> Obra:
        obra = Obra(name=name, manager_id=admin.id, tenant_id=tenant.id)
        db.add(obra)
        await db.flush()
        # El colaborador necesita una fila de rol para ver la obra (el admin no).
        db.add(ObraUserRole(obra_id=obra.id, user_id=colaborador.id, tenant_id=tenant.id,
                             role=ObraUserRoleType.SOLO_LECTURA))
        await db.flush()
        return obra

    return {"tenant": tenant, "admin": admin, "colaborador": colaborador, "new_obra": new_obra, "db": db}


def _metrics() -> dict:
    return {
        "risk_concentration": {
            "note": "x",
            "top_percent": 20,
            "by_task": {"tasks_considered": 10, "ranking": []},
            "by_responsible": {
                "responsibles_with_delay": 2,
                "ranking": [{"responsible_id": 1, "name": "Juan Albañil", "delay_days": 12, "task_count": 3}],
            },
        },
        "estimation_accuracy": {
            "method": "keyword_proxy",
            "tasks_considered": 5,
            "by_discipline": [{"discipline": "Hormigón", "avg_deviation_percent": 15.0}],
        },
        "top_deviations": {
            "count": 1,
            "items": [{
                "task": {"task_id": 5, "title": "Excavación", "deviation_days": 9, "responsible_id": 1},
                "bitacora_mentions": [],
                "alerts": [],
                "cascade_impact": {"direct_dependent_count": 0},
            }],
        },
        "bitacora_themes": {
            "categories": [
                {"category": "falta_material", "mentions": 4, "mentions_followed_by_delay": 3, "correlation_rate": 0.75},
            ],
        },
        "alert_reaction": {
            "by_type": [{"type": "task_overdue", "avg_hours": 30.0}],
        },
    }


async def test_sin_snapshot_no_disponible(ctx, db):
    obra = await ctx["new_obra"]("Sin snapshot")
    await db.flush()

    body = await ObraDashboardService(db).get_monthly_insights(obra.id, "admin")

    assert body["available"] is False
    assert body["period"] is None


async def test_admin_recibe_ranking_por_responsable(ctx, db, client):
    obra = await ctx["new_obra"]("Con snapshot")
    db.add(ObraStatsSnapshot(obra_id=obra.id, tenant_id=ctx["tenant"].id, period="2026-08", metrics=_metrics()))
    await db.flush()
    await db.commit()

    r = await client.get(
        f"{API}/obras/{obra.id}/dashboard/monthly-insights",
        headers={"Authorization": f"Bearer {create_access_token(ctx['admin'].id)}"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["available"] is True
    assert body["period"] == "2026-08"
    assert "by_responsible" in body["risk_concentration"]
    assert body["risk_concentration"]["by_responsible"]["ranking"][0]["name"] == "Juan Albañil"
    assert body["estimation_accuracy"]["by_discipline"][0]["discipline"] == "Hormigón"
    assert body["top_deviations"]["items"][0]["task"]["title"] == "Excavación"
    assert body["bitacora_themes"]["categories"][0]["category"] == "falta_material"
    assert body["alert_reaction"]["by_type"][0]["type"] == "task_overdue"


async def test_no_admin_no_recibe_ranking_por_responsable(ctx, db, client):
    obra = await ctx["new_obra"]("Con snapshot 2")
    db.add(ObraStatsSnapshot(obra_id=obra.id, tenant_id=ctx["tenant"].id, period="2026-08", metrics=_metrics()))
    await db.flush()
    await db.commit()

    r = await client.get(
        f"{API}/obras/{obra.id}/dashboard/monthly-insights",
        headers={"Authorization": f"Bearer {create_access_token(ctx['colaborador'].id)}"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["available"] is True
    assert "by_responsible" not in body["risk_concentration"]
    # el ranking por tarea SÍ viaja para cualquiera con acceso a la obra
    assert body["risk_concentration"]["by_task"]["tasks_considered"] == 10
    # D-04: I-14/I-15/I-16 no tienen ranking por persona, viajan igual para no-admin
    assert body["top_deviations"]["items"][0]["task"]["title"] == "Excavación"
    assert body["bitacora_themes"]["categories"][0]["category"] == "falta_material"
    assert body["alert_reaction"]["by_type"][0]["type"] == "task_overdue"
