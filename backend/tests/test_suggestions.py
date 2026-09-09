"""Sugerencias de IA como entidad propia (migración 0072).

Lo que se cubre acá es lo que la promoción a tabla habilitó y antes no existía:
resolverlas por id desde fuera de la bitácora, pedir las de una tarea, contar
pendientes en SQL, y el aislamiento por obra/tenant de las rutas nuevas. Los
casos de aplicación en sí (fechas inválidas, tarea de otra obra, reprocesar con
algo aplicado) siguen en `test_bitacora.py`, que ejercita las mismas filas por
las rutas legacy — que ambos caminos terminen en el mismo servicio es parte de
lo que se está probando.
"""
from datetime import date, timedelta

import pytest
import pytest_asyncio

from app.core.security import create_access_token
from app.models.bitacora import BitacoraEntry
from app.models.obra import Obra
from app.models.suggestion import Suggestion, SuggestionStatus, SuggestionType
from app.models.task import Task
from app.models.tenant import Tenant
from app.models.tenant_membership import TenantMembership
from app.models.user import User

API = "/api/v1"

pytestmark = pytest.mark.asyncio


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _dia_habil(dias: int) -> date:
    """Fecha futura que cae en día laboral.

    El calendario de la obra corre al lunes cualquier fecha que caiga en fin de
    semana, así que una fecha fija haría que el test pase o falle según el día
    en que se corra. Ver la nota sobre tests dependientes del almanaque.
    """
    d = date.today() + timedelta(days=dias)
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d


@pytest_asyncio.fixture
async def ctx(db):
    """Obra con una tarea y una nota de bitácora procesada."""
    t = Tenant(name="Empresa Sugerencias")
    db.add(t)
    await db.flush()
    u = User(email="jefe@sug.com", hashed_password="x", full_name="Jefa de obra",
             role="admin", is_active=True, tenant_id=t.id)
    db.add(u)
    await db.flush()
    db.add(TenantMembership(user_id=u.id, tenant_id=t.id, role="admin", is_active=True))
    obra = Obra(name="Obra Sugerencias", manager_id=u.id, tenant_id=t.id)
    db.add(obra)
    await db.flush()
    tarea = Task(obra_id=obra.id, tenant_id=t.id, title="Hormigonado de losa")
    db.add(tarea)
    await db.flush()
    entry = BitacoraEntry(
        tenant_id=t.id, obra_id=obra.id, source="web", status="procesado",
        transcript="se atrasa el hormigonado", summary="Se atrasa el hormigonado",
        created_by=u.id,
    )
    db.add(entry)
    await db.flush()
    await db.commit()
    return {
        "db": db, "tenant_id": t.id, "user_id": u.id, "obra_id": obra.id,
        "task_id": tarea.id, "entry_id": entry.id, "token": create_access_token(u.id),
    }


async def _add_suggestion(ctx, **overrides) -> Suggestion:
    base = dict(
        tenant_id=ctx["tenant_id"], obra_id=ctx["obra_id"], source="bitacora",
        source_entry_id=ctx["entry_id"], order_index=0,
        type=SuggestionType.RESCHEDULE_TASK, task_id=ctx["task_id"],
        task_title="Hormigonado de losa", reason="lluvia",
        status=SuggestionStatus.PENDIENTE,
    )
    base.update(overrides)
    row = Suggestion(**base)
    ctx["db"].add(row)
    await ctx["db"].flush()
    await ctx["db"].commit()
    return row


# ── Lo nuevo: llegar a la sugerencia sin pasar por la bitácora ────────────────

async def test_list_suggestions_for_task(client, ctx):
    """El punto de todo el cambio: desde la tarea se pueden pedir las propuestas
    que la afectan, sin conocer la entrada de bitácora que las originó."""
    await _add_suggestion(ctx, new_due_date=_dia_habil(5))

    r = await client.get(f"{API}/tasks/{ctx['task_id']}/suggestions", headers=_auth(ctx["token"]))
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body) == 1
    assert body[0]["task_id"] == ctx["task_id"]
    assert body[0]["type"] == "reschedule_task"
    assert body[0]["applied"] is False
    # Contexto de origen: sin esto, la tarjeta dentro de la tarea no dice de
    # dónde salió la propuesta y el jefe no puede decidir.
    assert body[0]["entry_summary"] == "Se atrasa el hormigonado"
    assert body[0]["obra_name"] == "Obra Sugerencias"


async def test_list_for_task_filters_by_status(client, ctx):
    await _add_suggestion(ctx, order_index=0)
    await _add_suggestion(ctx, order_index=1, status=SuggestionStatus.DESCARTADA)

    r = await client.get(
        f"{API}/tasks/{ctx['task_id']}/suggestions?status=pendiente", headers=_auth(ctx["token"])
    )
    assert r.status_code == 200, r.text
    assert [s["status"] for s in r.json()] == ["pendiente"]


async def test_apply_by_id_moves_the_task(client, ctx):
    """Aplicar por id hace el mismo trabajo real que la ruta vieja por índice:
    la tarea se reprograma."""
    nueva_fecha = _dia_habil(10)
    row = await _add_suggestion(ctx, new_due_date=nueva_fecha)

    r = await client.post(f"{API}/suggestions/{row.id}/apply", headers=_auth(ctx["token"]))
    assert r.status_code == 200, r.text
    assert r.json()["applied"] is True
    assert r.json()["result_task_id"] == ctx["task_id"]

    ctx["db"].expire_all()
    tarea = await ctx["db"].get(Task, ctx["task_id"])
    assert tarea.due_date == nueva_fecha


async def test_apply_by_id_honors_edits(client, ctx):
    """La IA propone, la persona decide: el ajuste pisa la fecha propuesta."""
    row = await _add_suggestion(ctx, new_due_date=_dia_habil(10))
    elegida = _dia_habil(20)

    r = await client.post(
        f"{API}/suggestions/{row.id}/apply",
        headers=_auth(ctx["token"]),
        json={"new_due_date": elegida.isoformat()},
    )
    assert r.status_code == 200, r.text

    ctx["db"].expire_all()
    tarea = await ctx["db"].get(Task, ctx["task_id"])
    assert tarea.due_date == elegida


async def test_dismiss_by_id(client, ctx):
    row = await _add_suggestion(ctx)

    r = await client.post(f"{API}/suggestions/{row.id}/dismiss", headers=_auth(ctx["token"]))
    assert r.status_code == 200, r.text
    assert r.json()["dismissed"] is True
    assert r.json()["resolved_by"] == ctx["user_id"]


async def test_cannot_dismiss_an_applied_suggestion(client, ctx):
    """Descartar algo ya aplicado no desharía el cambio en la obra — sería un
    botón que miente sobre lo que hace."""
    row = await _add_suggestion(ctx, status=SuggestionStatus.APLICADA)

    r = await client.post(f"{API}/suggestions/{row.id}/dismiss", headers=_auth(ctx["token"]))
    assert r.status_code == 422, r.text


async def test_apply_twice_is_idempotent(client, ctx):
    """El segundo apply no debe volver a mover la tarea."""
    row_id = (await _add_suggestion(ctx, new_due_date=_dia_habil(10))).id
    assert (await client.post(f"{API}/suggestions/{row_id}/apply", headers=_auth(ctx["token"]))).status_code == 200

    ctx["db"].expire_all()
    fecha_tras_primera = (await ctx["db"].get(Task, ctx["task_id"])).due_date

    r = await client.post(
        f"{API}/suggestions/{row_id}/apply",
        headers=_auth(ctx["token"]),
        json={"new_due_date": _dia_habil(99).isoformat()},
    )
    assert r.status_code == 200, r.text
    ctx["db"].expire_all()
    assert (await ctx["db"].get(Task, ctx["task_id"])).due_date == fecha_tras_primera


# ── Contador ──────────────────────────────────────────────────────────────────

async def test_pending_count_ignores_resolved_and_unassigned(client, ctx):
    await _add_suggestion(ctx, order_index=0)
    await _add_suggestion(ctx, order_index=1, status=SuggestionStatus.APLICADA)
    await _add_suggestion(ctx, order_index=2, status=SuggestionStatus.DESCARTADA)
    # Sin obra no se puede aplicar, así que tampoco es un pendiente accionable.
    await _add_suggestion(ctx, order_index=3, obra_id=None, task_id=None)

    r = await client.get(
        f"{API}/suggestions/pending-count?obra_id={ctx['obra_id']}", headers=_auth(ctx["token"])
    )
    assert r.status_code == 200, r.text
    assert r.json()["count"] == 1


async def test_bitacora_pending_count_matches(client, ctx):
    """El endpoint viejo de la bitácora y el nuevo cuentan lo mismo: son la
    misma consulta, no dos fuentes de verdad."""
    await _add_suggestion(ctx, order_index=0)
    await _add_suggestion(ctx, order_index=1, status=SuggestionStatus.APLICADA)

    viejo = await client.get(
        f"{API}/bitacora/pending-count?obra_id={ctx['obra_id']}", headers=_auth(ctx["token"])
    )
    nuevo = await client.get(
        f"{API}/suggestions/pending-count?obra_id={ctx['obra_id']}", headers=_auth(ctx["token"])
    )
    assert viejo.json() == nuevo.json() == {"count": 1}


# ── Aislamiento ───────────────────────────────────────────────────────────────

async def test_suggestion_of_another_tenant_is_not_found(client, ctx, db):
    """Una sugerencia de otra empresa se reporta como inexistente (404), no 403."""
    otro_tenant = Tenant(name="Empresa Ajena")
    db.add(otro_tenant)
    await db.flush()
    ajeno = User(email="ajeno@x.com", hashed_password="x", full_name="Ajeno",
                 role="admin", is_active=True, tenant_id=otro_tenant.id)
    db.add(ajeno)
    await db.flush()
    db.add(TenantMembership(user_id=ajeno.id, tenant_id=otro_tenant.id, role="admin", is_active=True))
    await db.flush()
    await db.commit()

    row = await _add_suggestion(ctx)
    r = await client.post(
        f"{API}/suggestions/{row.id}/apply", headers=_auth(create_access_token(ajeno.id))
    )
    assert r.status_code == 404, r.text


async def test_list_suggestions_requires_obra_access(client, ctx, db):
    otro_tenant = Tenant(name="Empresa Ajena 2")
    db.add(otro_tenant)
    await db.flush()
    ajeno = User(email="ajeno2@x.com", hashed_password="x", full_name="Ajeno",
                 role="admin", is_active=True, tenant_id=otro_tenant.id)
    db.add(ajeno)
    await db.flush()
    db.add(TenantMembership(user_id=ajeno.id, tenant_id=otro_tenant.id, role="admin", is_active=True))
    await db.flush()
    await db.commit()

    r = await client.get(
        f"{API}/suggestions?obra_id={ctx['obra_id']}", headers=_auth(create_access_token(ajeno.id))
    )
    assert r.status_code in (403, 404), r.text


# ── Ciclo de vida frente al reprocesamiento ───────────────────────────────────

async def test_reprocessing_keeps_resolved_suggestions(client, ctx, monkeypatch):
    """Reprocesar reemplaza lo pendiente pero no borra lo ya decidido: una
    sugerencia aplicada es el registro de un cambio real en la obra.
    Es el hallazgo N6 del audit 08, ahora garantizado también en el modelo."""
    from app.services.bitacora_service import BitacoraService

    aplicada = await _add_suggestion(ctx, order_index=0, status=SuggestionStatus.APLICADA)
    await _add_suggestion(ctx, order_index=1)  # pendiente, se reemplaza

    async def _fake_analyze(self, transcript, obra_id):
        return {
            "summary": "nuevo resumen",
            "key_points": [],
            "suggestions": [{
                "type": "note", "task_id": None, "task_title": None,
                "new_start_date": None, "new_due_date": None, "new_status": None,
                "title": None, "description": None, "responsible_name": None,
                "reason": "propuesta nueva",
            }],
        }

    monkeypatch.setattr(BitacoraService, "_analyze", _fake_analyze)

    db = ctx["db"]
    db.expire_all()
    entry = await db.get(BitacoraEntry, ctx["entry_id"])
    await BitacoraService(db).process_entry(entry)
    await db.commit()
    db.expire_all()

    entry = await db.get(BitacoraEntry, ctx["entry_id"])
    tipos = [(s.id, s.status, s.reason) for s in entry.suggestion_rows]
    assert aplicada.id in [t[0] for t in tipos], "la aplicada se perdió al reprocesar"
    assert "propuesta nueva" in [t[2] for t in tipos]
    # La pendiente vieja se fue; quedan la aplicada y la nueva.
    assert len(tipos) == 2


# ── El corrimiento relativo se resuelve en el backend ─────────────────────────

async def test_shift_relativo_se_resuelve_contra_el_calendario(ctx, monkeypatch):
    """El modelo declara el corrimiento; la fecha concreta la calcula el backend.

    Es el arreglo de fondo: pedirle a un LLM que cuente días hábiles salteando
    feriados es pedirle lo que no hace bien.
    """
    from app.services.bitacora_service import BitacoraService

    from app.models.calendar import WorkingCalendar

    db = ctx["db"]
    tarea = await db.get(Task, ctx["task_id"])
    tarea.due_date = date(2026, 5, 29)  # viernes
    # Calendario explícito lunes a viernes: el DEFAULT de una obra es lunes a
    # SÁBADO (working_days=63), y el punto del test es que la cuenta salga del
    # calendario de la obra y no de un supuesto.
    db.add(WorkingCalendar(
        obra_id=ctx["obra_id"], tenant_id=ctx["tenant_id"],
        working_days=0b0011111, hour_from=7, hour_to=18,
    ))
    await db.flush()
    await db.commit()

    async def _fake_analyze(self, transcript, obra_id):
        return {
            "summary": "s", "key_points": [],
            "suggestions": [{
                "type": "reschedule_task", "task_id": ctx["task_id"],
                "task_title": "Hormigonado de losa",
                "new_start_date": None, "new_due_date": None,
                "shift_working_days": 2, "shift_target": "due",
                "new_status": None, "title": None, "description": None,
                "responsible_name": None, "reason": "se atrasó el proveedor",
            }],
        }

    monkeypatch.setattr(BitacoraService, "_analyze", _fake_analyze)
    db.expire_all()
    entry = await db.get(BitacoraEntry, ctx["entry_id"])
    await BitacoraService(db).process_entry(entry)
    await db.commit()
    db.expire_all()

    entry = await db.get(BitacoraEntry, ctx["entry_id"])
    sug = entry.suggestion_rows[-1]
    assert sug.new_due_date == date(2026, 6, 2), "dos días hábiles desde el viernes es el martes"


async def test_fecha_explicita_gana_sobre_el_shift(ctx, monkeypatch):
    """Si el audio nombró una fecha concreta, esa manda: es más específica."""
    from app.services.bitacora_service import BitacoraService

    async def _fake_analyze(self, transcript, obra_id):
        return {
            "summary": "s", "key_points": [],
            "suggestions": [{
                "type": "reschedule_task", "task_id": ctx["task_id"],
                "task_title": "Hormigonado de losa",
                "new_start_date": None, "new_due_date": "2026-07-20",
                "shift_working_days": 2, "shift_target": "due",
                "new_status": None, "title": None, "description": None,
                "responsible_name": None, "reason": "se mueve para el 20 de julio",
            }],
        }

    monkeypatch.setattr(BitacoraService, "_analyze", _fake_analyze)
    db = ctx["db"]
    db.expire_all()
    entry = await db.get(BitacoraEntry, ctx["entry_id"])
    await BitacoraService(db).process_entry(entry)
    await db.commit()
    db.expire_all()

    entry = await db.get(BitacoraEntry, ctx["entry_id"])
    assert entry.suggestion_rows[-1].new_due_date == date(2026, 7, 20)


# ── Qué fechas toca al aplicar ────────────────────────────────────────────────
#
# La regla la fijó el uso real: si el audio nombra una sola fecha, la otra queda
# como estaba; si habla de correr la tarea entera, se mueven las dos. El defecto
# venía de `main`: `TaskService.update` usa `exclude_unset`, así que mandar
# `start_date=None` no era "no la toques" sino "borrala", y aplicar un cambio de
# vencimiento le vaciaba el inicio a la tarea.

async def _tarea_con_fechas(ctx, inicio: date, fin: date) -> None:
    db = ctx["db"]
    tarea = await db.get(Task, ctx["task_id"])
    tarea.start_date = inicio
    tarea.due_date = fin
    await db.flush()
    await db.commit()
    db.expire_all()


async def test_aplicar_solo_fin_conserva_el_inicio(client, ctx):
    inicio, fin = _dia_habil(1), _dia_habil(8)
    await _tarea_con_fechas(ctx, inicio, fin)
    nuevo_fin = _dia_habil(15)
    row_id = (await _add_suggestion(ctx, new_start_date=None, new_due_date=nuevo_fin)).id

    r = await client.post(f"{API}/suggestions/{row_id}/apply", headers=_auth(ctx["token"]))
    assert r.status_code == 200, r.text

    ctx["db"].expire_all()
    tarea = await ctx["db"].get(Task, ctx["task_id"])
    assert tarea.due_date == nuevo_fin
    assert tarea.start_date == inicio, "aplicar un cambio de fin no debe borrar el inicio"


async def test_aplicar_solo_inicio_conserva_el_fin(client, ctx):
    inicio, fin = _dia_habil(1), _dia_habil(8)
    await _tarea_con_fechas(ctx, inicio, fin)
    nuevo_inicio = _dia_habil(3)
    row_id = (await _add_suggestion(ctx, new_start_date=nuevo_inicio, new_due_date=None)).id

    r = await client.post(f"{API}/suggestions/{row_id}/apply", headers=_auth(ctx["token"]))
    assert r.status_code == 200, r.text

    ctx["db"].expire_all()
    tarea = await ctx["db"].get(Task, ctx["task_id"])
    assert tarea.start_date == nuevo_inicio
    assert tarea.due_date == fin, "aplicar un cambio de inicio no debe borrar el vencimiento"


async def test_aplicar_ambas_mueve_la_tarea_entera(client, ctx):
    """'Corré toda la tarea' sí mueve las dos puntas."""
    await _tarea_con_fechas(ctx, _dia_habil(1), _dia_habil(8))
    nuevo_inicio, nuevo_fin = _dia_habil(6), _dia_habil(13)
    row_id = (await _add_suggestion(
        ctx, new_start_date=nuevo_inicio, new_due_date=nuevo_fin
    )).id

    r = await client.post(f"{API}/suggestions/{row_id}/apply", headers=_auth(ctx["token"]))
    assert r.status_code == 200, r.text

    ctx["db"].expire_all()
    tarea = await ctx["db"].get(Task, ctx["task_id"])
    assert (tarea.start_date, tarea.due_date) == (nuevo_inicio, nuevo_fin)


async def test_reschedule_sin_ninguna_fecha_se_rechaza(client, ctx):
    """Sin fecha no hay nada que aplicar: marcarla como aplicada sería mentir."""
    await _tarea_con_fechas(ctx, _dia_habil(1), _dia_habil(8))
    row_id = (await _add_suggestion(ctx, new_start_date=None, new_due_date=None)).id

    r = await client.post(f"{API}/suggestions/{row_id}/apply", headers=_auth(ctx["token"]))
    assert r.status_code == 422, r.text


# ── La respuesta por WhatsApp cuenta las sugerencias ──────────────────────────
#
# Este camino no tenía cobertura y por eso la migración 0072 lo rompió sin que
# nadie se enterara: `message_service` seguía leyendo `entry.suggestions`, la
# columna JSON que dejó de existir. El resultado era que la nota se procesaba
# bien pero el emisor recibía "no pudimos procesar tu nota de voz".

async def test_conteo_para_el_aviso_de_whatsapp_ignora_las_notas(ctx):
    """Solo se anuncian las sugerencias que proponen tocar el plan."""
    from app.services.message_service import _acciones_sugeridas

    await _add_suggestion(ctx, order_index=0, type=SuggestionType.RESCHEDULE_TASK)
    await _add_suggestion(ctx, order_index=1, type=SuggestionType.UPDATE_STATUS,
                          new_status="bloqueada")
    await _add_suggestion(ctx, order_index=2, type=SuggestionType.NOTE, task_id=None)

    db = ctx["db"]
    db.expire_all()
    entry = await db.get(BitacoraEntry, ctx["entry_id"])
    assert _acciones_sugeridas(entry) == 2


async def test_conteo_sin_sugerencias_no_rompe(ctx):
    from app.services.message_service import _acciones_sugeridas

    db = ctx["db"]
    db.expire_all()
    entry = await db.get(BitacoraEntry, ctx["entry_id"])
    assert _acciones_sugeridas(entry) == 0
