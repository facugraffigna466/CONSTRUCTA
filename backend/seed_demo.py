"""Seed de una obra de DEMO limpia para capturas del IPI.

Crea "Edificio Norte — Demo" (tenant del admin) con tareas reales de obra,
dependencias FS/SS (para que el Gantt muestre flechas + ruta crítica),
materiales, y una solicitud de cotización con 2 proveedores + análisis
comparativo de IA ya cargado (para la pestaña Inteligencia).

NO toca tus datos: solo borra y recrea lo marcado como demo.

Requisitos: correr antes `alembic upgrade head`.
Uso:  cd backend && .venv/bin/python seed_demo.py
"""
import asyncio
import json
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import text

from app.core.database import AsyncSessionLocal
from app.models.budget import Budget
from app.models.obra import Obra, ObraStatus
from app.models.obra_team_member import ObraTeamMember
from app.models.solicitud_cotizacion import (
    SolicitudCotizacion,
    SolicitudSupplier,
    solicitud_materiales,
)
from app.models.supplier import Supplier
from app.models.task import Task, TaskStatus, task_dependencies_table
from app.models.task_material import TaskMaterial

OBRA_NAME = "Edificio Norte — Demo"
SUP_A = "Corralón El Roble"
SUP_B = "Materiales del Sur"
RESP_IDS = [1, 2]  # Juan Perez, Ana Lopez (tenant 1, nombres reales)
PROJECT_START = date(2026, 8, 4)  # lunes

# (título, duración_días, deps_FS[idx], deps_SS[idx], estado, avance, hito)
PLAN = [
    ("Excavación y limpieza del terreno",       5, [],   [],  "completada",  100, False),
    ("Cimientos y platea de fundación",         7, [0],  [],  "completada",  100, False),
    ("Estructura de hormigón armado",          15, [1],  [],  "en_progreso",  45, False),
    ("Mampostería de elevación",               12, [2],  [],  "pendiente",     0, False),
    ("Instalación sanitaria",                  10, [],   [3], "pendiente",     0, False),
    ("Instalación eléctrica",                  10, [],   [3], "pendiente",     0, False),
    ("Revoques gruesos y finos",               10, [3],  [],  "pendiente",     0, False),
    ("Contrapisos y carpetas",                  6, [6],  [],  "pendiente",     0, False),
    ("Colocación de pisos y revestimientos",    8, [7],  [],  "pendiente",     0, False),
    ("Pintura y terminaciones",                 8, [8],  [],  "pendiente",     0, False),
    ("Entrega de obra",                         0, [9],  [],  "pendiente",     0, True),
]


async def main():
    async with AsyncSessionLocal() as s:
        # ── Admin (dueño de la obra) vía SQL crudo (independiente del estado de migración) ──
        row = (await s.execute(text(
            "SELECT id, tenant_id FROM users WHERE email='admin@constructa.com'"
        ))).first()
        if not row:
            print("ERROR: no existe admin@constructa.com. Creá el admin primero.")
            return
        admin_id, tenant_id = row[0], row[1]

        # ── Limpieza de una corrida anterior del demo (solo lo del demo) ──
        old = (await s.execute(text(
            "SELECT id FROM obras WHERE name=:n AND tenant_id=:t"
        ), {"n": OBRA_NAME, "t": tenant_id})).scalar()
        if old:
            await s.execute(text(
                "DELETE FROM budgets WHERE obra_id=:o OR solicitud_id IN "
                "(SELECT id FROM solicitudes_cotizacion WHERE obra_id=:o)"), {"o": old})
            await s.execute(text(
                "DELETE FROM solicitud_suppliers WHERE solicitud_id IN "
                "(SELECT id FROM solicitudes_cotizacion WHERE obra_id=:o)"), {"o": old})
            await s.execute(text("DELETE FROM solicitudes_cotizacion WHERE obra_id=:o"), {"o": old})
            await s.execute(text("DELETE FROM obras WHERE id=:o"), {"o": old})  # cascada: tasks, materiales, deps
        await s.execute(text(
            "DELETE FROM suppliers WHERE name IN (:a,:b) AND tenant_id=:t"),
            {"a": SUP_A, "b": SUP_B, "t": tenant_id})
        await s.flush()

        # ── Fechas por dependencias ──
        starts: dict[int, date] = {}
        dues: dict[int, date] = {}
        for i, (_, dur, fs, ss, *_r) in enumerate(PLAN):
            cands = [PROJECT_START]
            cands += [dues[d] + timedelta(days=1) for d in fs]
            cands += [starts[d] for d in ss]
            st = max(cands)
            starts[i] = st
            dues[i] = st + timedelta(days=max(dur - 1, 0))

        # ── Obra ──
        obra = Obra(
            name=OBRA_NAME, location="Córdoba Centro", status=ObraStatus.EN_PROGRESO,
            client_name="Constructora RODE S.A.", start_date=PROJECT_START,
            expected_end_date=max(dues.values()), manager_id=admin_id, tenant_id=tenant_id,
            description="Obra de demostración para el informe (datos ficticios).",
        )
        s.add(obra)
        await s.flush()

        # ── Tareas ──
        ids: dict[int, int] = {}
        for i, (title, dur, fs, ss, st_status, prog, milestone) in enumerate(PLAN):
            t = Task(
                obra_id=obra.id, tenant_id=tenant_id, title=title,
                status=TaskStatus(st_status), estimated_progress=prog, is_milestone=milestone,
                start_date=starts[i], due_date=dues[i], order_index=i,
                responsible_id=RESP_IDS[i % len(RESP_IDS)] if not milestone else None,
            )
            s.add(t)
            await s.flush()
            ids[i] = t.id

        # ── Equipo de la obra (para que los responsables se muestren en planilla/Gantt) ──
        roles = {1: "Jefe de obra", 2: "Estructuras"}
        for rid in RESP_IDS:
            s.add(ObraTeamMember(obra_id=obra.id, tenant_id=tenant_id, responsible_id=rid,
                                 role=roles.get(rid, "Equipo"), member_type="equipo"))
        await s.flush()

        # ── Dependencias (FS / SS) ──
        for i, (_, dur, fs, ss, *_r) in enumerate(PLAN):
            for d in fs:
                await s.execute(task_dependencies_table.insert().values(
                    task_id=ids[i], depends_on_id=ids[d], dependency_type="FS", lag_days=0))
            for d in ss:
                await s.execute(task_dependencies_table.insert().values(
                    task_id=ids[i], depends_on_id=ids[d], dependency_type="SS", lag_days=0))

        # ── Proveedores ──
        sa = Supplier(tenant_id=tenant_id, name=SUP_A, category="Materiales de construcción",
                      phone="+543510000001", email="ventas@elroble.com.ar")
        sb = Supplier(tenant_id=tenant_id, name=SUP_B, category="Materiales de construcción",
                      phone="+543510000002", email="pedidos@materialesdelsur.com.ar")
        s.add_all([sa, sb])
        await s.flush()

        # ── Materiales de la tarea "Estructura" (los que se cotizan) ──
        estructura_id = ids[2]
        mats = [
            TaskMaterial(task_id=estructura_id, tenant_id=tenant_id, name="Cemento CPC40 x50kg",
                         quantity=30, unit="bolsa", unit_price=9500, status="recibido", supplier_id=sa.id),
            TaskMaterial(task_id=estructura_id, tenant_id=tenant_id, name="Hierro nervurado Ø8 (12m)",
                         quantity=40, unit="barra", unit_price=3800, status="pedido"),
            TaskMaterial(task_id=estructura_id, tenant_id=tenant_id, name="Arena gruesa",
                         quantity=6, unit="m3", unit_price=8000, status="pendiente"),
        ]
        # Materiales de "Mampostería" (para que la vista Presupuesto tenga más cuerpo)
        mamp_id = ids[3]
        mats += [
            TaskMaterial(task_id=mamp_id, tenant_id=tenant_id, name="Ladrillo hueco 12x18x33",
                         quantity=2000, unit="u", unit_price=850, status="pendiente"),
            TaskMaterial(task_id=mamp_id, tenant_id=tenant_id, name="Cemento de albañilería x25kg",
                         quantity=20, unit="bolsa", unit_price=7200, status="pendiente"),
        ]
        s.add_all(mats)
        await s.flush()

        # ── Solicitud de cotización + respuestas + análisis de IA ──
        sol = SolicitudCotizacion(
            obra_id=obra.id, tenant_id=tenant_id, created_by=admin_id,
            ref_code="COT-DEMO-01", status="respondida",
            notes="Cotización de materiales para la etapa de estructura.",
        )
        s.add(sol)
        await s.flush()
        # Vincular los 3 materiales cotizados
        for m in mats[:3]:
            await s.execute(solicitud_materiales.insert().values(solicitud_id=sol.id, material_id=m.id))
        # Links de proveedores (respondieron)
        now = datetime.now(timezone.utc)
        s.add_all([
            SolicitudSupplier(solicitud_id=sol.id, supplier_id=sa.id, status="respondida", sent_at=now),
            SolicitudSupplier(solicitud_id=sol.id, supplier_id=sb.id, status="respondida", sent_at=now),
        ])

        def quote(items):
            return {
                "proveedor": None, "fecha": "2026-08-06", "rubro": "Materiales de construcción",
                "items": items, "iva_pct": 21, "incluye_flete": False,
                "condiciones_pago": None, "plazo_entrega": None, "validez": "15 días",
            }

        items_a = [
            {"descripcion": "Cemento CPC40 x50kg", "cantidad": 30, "unidad": "bolsa", "precio_unitario": 9500, "subtotal": 285000},
            {"descripcion": "Hierro nervurado Ø8 (12m)", "cantidad": 40, "unidad": "barra", "precio_unitario": 3800, "subtotal": 152000},
            {"descripcion": "Arena gruesa", "cantidad": 6, "unidad": "m3", "precio_unitario": 8000, "subtotal": 48000},
        ]
        items_b = [
            {"descripcion": "Cemento CPC40 x50kg", "cantidad": 30, "unidad": "bolsa", "precio_unitario": 9900, "subtotal": 297000},
            {"descripcion": "Hierro nervurado Ø8 (12m)", "cantidad": 40, "unidad": "barra", "precio_unitario": 4100, "subtotal": 164000},
            {"descripcion": "Arena gruesa", "cantidad": 6, "unidad": "m3", "precio_unitario": 8500, "subtotal": 51000},
        ]
        data_a = quote(items_a); data_a.update(condiciones_pago="50% anticipo, 50% contra entrega", plazo_entrega="5 días hábiles")
        data_b = quote(items_b); data_b.update(condiciones_pago="Contado", plazo_entrega="3 días hábiles")

        analisis = {
            "resumen": "Se compararon dos cotizaciones para cemento, hierro y arena. Corralón El Roble "
                       "resulta ~5,3% más económico en el total, mientras que Materiales del Sur ofrece "
                       "un plazo de entrega menor.",
            "comparacion_items": [
                {"nombre": "Cemento CPC40 x50kg",
                 "precios": [{"supplier_id": sa.id, "supplier_name": SUP_A, "precio_unitario": 9500, "subtotal": 285000},
                             {"supplier_id": sb.id, "supplier_name": SUP_B, "precio_unitario": 9900, "subtotal": 297000}],
                 "mas_barato_id": sa.id, "diferencia": 12000},
                {"nombre": "Hierro nervurado Ø8 (12m)",
                 "precios": [{"supplier_id": sa.id, "supplier_name": SUP_A, "precio_unitario": 3800, "subtotal": 152000},
                             {"supplier_id": sb.id, "supplier_name": SUP_B, "precio_unitario": 4100, "subtotal": 164000}],
                 "mas_barato_id": sa.id, "diferencia": 12000},
                {"nombre": "Arena gruesa",
                 "precios": [{"supplier_id": sa.id, "supplier_name": SUP_A, "precio_unitario": 8000, "subtotal": 48000},
                             {"supplier_id": sb.id, "supplier_name": SUP_B, "precio_unitario": 8500, "subtotal": 51000}],
                 "mas_barato_id": sa.id, "diferencia": 3000},
            ],
            "donde_ganas": ["Precio total $27.000 más bajo (5,3%).",
                             "Mejor precio unitario en los tres ítems.",
                             "Financiación 50/50 sin recargo."],
            "donde_pierdes": ["Plazo de entrega mayor (5 días hábiles vs. 3).",
                               "No incluye flete."],
            "condiciones_pago": f"{SUP_A}: 50% anticipo, 50% contra entrega. {SUP_B}: contado.",
            "plazos": f"{SUP_A}: 5 días hábiles. {SUP_B}: 3 días hábiles.",
            "riesgos": ["El plazo de El Roble podría atrasar el inicio de la mampostería si hay demoras.",
                         "Confirmar disponibilidad de stock de hierro Ø8."],
            "recomendacion": f"Se recomienda {SUP_A} por el menor costo total; si el material se necesita con "
                             f"urgencia, considerar {SUP_B} por su entrega más rápida.",
            "supplier_recomendado_id": sa.id,
        }

        s.add_all([
            Budget(tenant_id=tenant_id, obra_id=obra.id, created_by=admin_id, supplier_id=sa.id,
                   supplier_name=SUP_A, rubro="Materiales de construcción", source_type="pdf",
                   data=data_a, total=485000, currency="ARS", status="procesado",
                   solicitud_id=sol.id, ai_analysis=json.dumps(analisis, ensure_ascii=False)),
            Budget(tenant_id=tenant_id, obra_id=obra.id, created_by=admin_id, supplier_id=sb.id,
                   supplier_name=SUP_B, rubro="Materiales de construcción", source_type="pdf",
                   data=data_b, total=512000, currency="ARS", status="procesado", solicitud_id=sol.id),
        ])

        await s.commit()
        print(f"OK — obra '{OBRA_NAME}' (id {obra.id}) creada:")
        print(f"  {len(PLAN)} tareas con dependencias + ruta crítica, {len(mats)} materiales,")
        print(f"  2 proveedores y 1 cotización comparada con IA (pestaña Inteligencia).")
        print("  Entrá a esa obra y sacá las capturas 2–5 desde ahí.")


if __name__ == "__main__":
    asyncio.run(main())
