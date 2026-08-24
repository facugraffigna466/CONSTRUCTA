#!/usr/bin/env python3
"""
seed_demo.py — Carga de datos de demostración para CONSTRUCTA.

SOLO PARA ENTORNO LOCAL DE DESARROLLO.
Nunca ejecutar contra una base de producción.

Uso:
    cd backend
    source .venv/bin/activate
    python scripts/seed_demo.py

El script es idempotente: si lo corrés dos veces, borra y recrea el tenant de demo.
"""

import asyncio
import os
import sys
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

# ── Guardia de producción ─────────────────────────────────────────────────────
_db_url = os.getenv("DATABASE_URL", "")
if "localhost" not in _db_url and "127.0.0.1" not in _db_url and _db_url != "":
    print("❌  DATABASE_URL no apunta a localhost. Este script solo corre en dev local.")
    sys.exit(1)

# ── Agregar backend/ al path para importar la app ────────────────────────────
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import delete, insert, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.core.security import hash_password

from app.models.plan import Plan
from app.models.tenant import Tenant
from app.models.user import User
from app.models.responsible import Responsible
from app.models.obra import Obra, ObraStatus
from app.models.obra_team_member import ObraTeamMember
from app.models.task import Task, TaskStatus, task_dependencies_table
from app.models.baseline import TaskBaseline
from app.models.calendar import WorkingCalendar, CalendarException
from app.models.alert import Alert, AlertType
from app.models.historial import HistorialEvento
from app.models.bitacora import BitacoraEntry
from app.models.supplier import Supplier
from app.models.task_material import TaskMaterial
from app.models.purchase_order import PurchaseOrder, PurchaseOrderItem
from app.models.solicitud_cotizacion import (
    SolicitudCotizacion,
    SolicitudSupplier,
    solicitud_materiales,
)
from app.models.budget import Budget
from app.models.plano import Plano
from app.models.settings import SystemSettings

# ── Constantes del dataset de demo ───────────────────────────────────────────
DEMO_TENANT_NAME = "CONSTRUCTA Demo SRL"
DEMO_ADMIN_EMAIL = "admin@demo.constructa.com"
DEMO_ADMIN_PASSWORD = "Demo2024!"
DEMO_COLLAB_EMAIL = "jefe.obra@demo.constructa.com"
DEMO_COLLAB_PASSWORD = "Demo2024!"

# Referencia temporal: hoy
TODAY = date.today()
NOW = datetime.now(timezone.utc)


def d(offset_days: int) -> date:
    """Devuelve TODAY + offset_days."""
    return TODAY + timedelta(days=offset_days)


def dt(offset_days: int) -> datetime:
    """Devuelve NOW + offset_days (aware UTC)."""
    return NOW + timedelta(days=offset_days)


# ─────────────────────────────────────────────────────────────────────────────
# CLEANUP
# ─────────────────────────────────────────────────────────────────────────────

async def cleanup(session: AsyncSession) -> None:
    result = await session.execute(select(Tenant).where(Tenant.name == DEMO_TENANT_NAME))
    tenant = result.scalar_one_or_none()
    if tenant is None:
        return

    tid = tenant.id
    print(f"  → Limpiando tenant demo (id={tid})…")

    # Nullear owner_user_id para romper FK circular tenant ↔ user
    await session.execute(
        update(Tenant).where(Tenant.id == tid).values(owner_user_id=None)
    )
    await session.flush()

    # Eliminar en orden respetando FKs
    await session.execute(delete(Alert).where(Alert.tenant_id == tid))
    await session.execute(delete(HistorialEvento).where(HistorialEvento.tenant_id == tid))
    await session.execute(delete(Budget).where(Budget.tenant_id == tid))
    # Obras en cascada elimina: tasks + dependencies + materials + purchase_orders +
    # solicitudes + supplier_links + solicitud_materiales + baselines +
    # calendars + exceptions + planos + bitacora_entries + obra_team_members
    await session.execute(delete(Obra).where(Obra.tenant_id == tid))
    # Responsibles en cascada elimina: conversation_sessions
    await session.execute(delete(Responsible).where(Responsible.tenant_id == tid))
    # SystemSettings referencia users; borrar antes que users
    # (buscamos usuarios del tenant para sus settings)
    user_ids_res = await session.execute(
        select(User.id).where(User.tenant_id == tid)
    )
    user_ids = [r[0] for r in user_ids_res.all()]
    if user_ids:
        await session.execute(
            delete(SystemSettings).where(SystemSettings.manager_id.in_(user_ids))
        )
    await session.execute(delete(User).where(User.tenant_id == tid))
    await session.execute(delete(Tenant).where(Tenant.id == tid))
    await session.flush()
    print("  ✓ Limpieza completa.")


# ─────────────────────────────────────────────────────────────────────────────
# PLAN + TENANT + USERS
# ─────────────────────────────────────────────────────────────────────────────

async def create_foundation(session: AsyncSession):
    # Plan "enterprise" (upsert)
    result = await session.execute(select(Plan).where(Plan.name == "enterprise"))
    plan = result.scalar_one_or_none()
    if plan is None:
        plan = Plan(name="enterprise", max_obras=None, max_users=None,
                    max_tasks_per_obra=None, price_monthly=Decimal("299.00"))
        session.add(plan)
        await session.flush()

    # Tenant (sin owner aún, lo seteamos después de crear el user)
    tenant = Tenant(
        name=DEMO_TENANT_NAME,
        plan_id=plan.id,
        owner_user_id=None,
        active_until=dt(365),
    )
    session.add(tenant)
    await session.flush()

    # Admin user
    admin = User(
        email=DEMO_ADMIN_EMAIL,
        hashed_password=hash_password(DEMO_ADMIN_PASSWORD),
        full_name="Arq. Laura Méndez",
        role="admin",
        is_active=True,
        is_verified=True,
        tenant_id=tenant.id,
        whatsapp_number="+5493516000001",
    )
    session.add(admin)
    await session.flush()

    # Collaborator user
    collab = User(
        email=DEMO_COLLAB_EMAIL,
        hashed_password=hash_password(DEMO_COLLAB_PASSWORD),
        full_name="Ing. Rodrigo Salinas",
        role="collaborator",
        is_active=True,
        is_verified=True,
        tenant_id=tenant.id,
        whatsapp_number="+5493516000002",
    )
    session.add(collab)
    await session.flush()

    # Setear owner del tenant
    tenant.owner_user_id = admin.id
    await session.flush()

    # SystemSettings para admin
    settings_obj = SystemSettings(
        manager_id=admin.id,
        chatbot_enabled=True,
        send_hour_from=7,
        send_hour_to=19,
        max_response_hours=24,
        auto_reminders=True,
        reminder_3days=True,
        reminder_1day=True,
        alert_overdue=True,
        alert_no_response=True,
        retry_failed=True,
        notify_task_overdue=True,
        notify_task_blocked=True,
        notify_no_response=True,
        notify_rescheduled=True,
        company_name="Constructora Acacias SRL",
        main_responsible="Arq. Laura Méndez",
        company_email=DEMO_ADMIN_EMAIL,
        company_phone="+5493512345678",
    )
    session.add(settings_obj)
    await session.flush()

    return tenant, admin, collab


# ─────────────────────────────────────────────────────────────────────────────
# RESPONSIBLES (personal de campo)
# ─────────────────────────────────────────────────────────────────────────────

async def create_responsibles(session: AsyncSession, tenant_id: int) -> dict:
    """Números Twilio test: +15005550006 (válidos en sandbox Twilio)."""
    data = [
        dict(full_name="Carlos Méndez",    whatsapp_number="+15005550001",
             role="Jefe de Obra",          tenant_id=tenant_id),
        dict(full_name="María González",   whatsapp_number="+15005550002",
             role="Arquitecta de Sitio",   tenant_id=tenant_id),
        dict(full_name="Roberto Flores",   whatsapp_number="+15005550003",
             role="Electricista",          tenant_id=tenant_id),
        dict(full_name="Ana Rodríguez",    whatsapp_number="+15005550004",
             role="Plomera",               tenant_id=tenant_id),
        dict(full_name="Diego Sánchez",    whatsapp_number="+15005550005",
             role="Albañil Oficial",       tenant_id=tenant_id),
        dict(full_name="Lucía Fernández",  whatsapp_number="+15005550006",
             role="Capataz de Obra",       tenant_id=tenant_id),
    ]
    resp = {}
    for d in data:
        r = Responsible(**d)
        session.add(r)
        await session.flush()
        resp[d["full_name"]] = r
    return resp


# ─────────────────────────────────────────────────────────────────────────────
# SUPPLIERS
# ─────────────────────────────────────────────────────────────────────────────

async def create_suppliers(session: AsyncSession, tenant_id: int) -> dict:
    data = [
        dict(name="Ferretería El Tornillo SRL", email="ventas@tornillo.com.ar",
             phone="+5493511234001", category="materiales",
             notes="Proveedor principal de herrajes, bulones y materiales generales.",
             tenant_id=tenant_id),
        dict(name="ElectroInsumos Córdoba SA", email="cotizaciones@electroinsumos.com",
             phone="+5493511234002", category="electricidad",
             notes="Cables, tableros y materiales eléctricos. Entrega en 48h.",
             tenant_id=tenant_id),
        dict(name="Hormigones del Norte SRL", email="pedidos@hormigonesnorte.com",
             phone="+5493511234003", category="estructura",
             notes="Proveedor de hormigón elaborado H21, H25 y H30. Planta propia.",
             tenant_id=tenant_id),
        dict(name="Cerámica Villanueva", email="ventas@ceramicavillanueva.com",
             phone="+5493511234004", category="terminaciones",
             notes="Cerámicos, porcelanato y accesorios de baño.",
             tenant_id=tenant_id),
    ]
    supp = {}
    for d in data:
        s = Supplier(**d)
        session.add(s)
        await session.flush()
        supp[d["name"]] = s
    return supp


# ─────────────────────────────────────────────────────────────────────────────
# OBRAS
# ─────────────────────────────────────────────────────────────────────────────

async def create_obras(session: AsyncSession, tenant_id: int, manager_id: int) -> dict:
    obras_data = [
        dict(
            name="Edificio Residencial Las Acacias",
            description=(
                "Edificio residencial de 8 pisos con 24 departamentos de 2 y 3 ambientes. "
                "Planta baja con cocheras y SUM. Ubicado en Bº Nueva Córdoba."
            ),
            location="Av. Hipólito Yrigoyen 1250, Nueva Córdoba, Córdoba",
            status=ObraStatus.EN_PROGRESO,
            start_date=d(-90),
            expected_end_date=d(180),
            client_name="Desarrolladora Acacias SA",
            client_email="contacto@acacias-dev.com",
            client_phone="+5493512000100",
            manager_id=manager_id,
            tenant_id=tenant_id,
            image_url="https://placehold.co/800x400/1A2329/FF6B35?text=Las+Acacias",
        ),
        dict(
            name="Local Comercial Centro Histórico",
            description=(
                "Refuncionalización de local de 380 m² en planta baja. "
                "Incluye nuevo núcleo de baños, cocina industrial y salón principal."
            ),
            location="Calle 27 de Abril 380, Centro, Córdoba",
            status=ObraStatus.PLANIFICADA,
            start_date=d(15),
            expected_end_date=d(120),
            client_name="Gastronómica del Centro SAS",
            client_email="info@gastronomicacentro.com",
            client_phone="+5493512000200",
            manager_id=manager_id,
            tenant_id=tenant_id,
            image_url="https://placehold.co/800x400/1A2329/1F8A5B?text=Centro+Histórico",
        ),
        dict(
            name="Vivienda Familiar Barrio Jardín",
            description=(
                "Vivienda unifamiliar de 220 m² en dos plantas. "
                "Incluye piscina, quincho y jardín. Proyecto finalizado exitosamente."
            ),
            location="Calle Los Naranjos 458, Barrio Jardín, Córdoba",
            status=ObraStatus.COMPLETADA,
            start_date=d(-300),
            expected_end_date=d(-30),
            actual_end_date=d(-35),
            client_name="Familia Grosso",
            client_email="pgrosso@gmail.com",
            client_phone="+5493514500300",
            manager_id=manager_id,
            tenant_id=tenant_id,
            image_url="https://placehold.co/800x400/1A2329/1F8A5B?text=Barrio+Jardín",
        ),
    ]
    obras = {}
    for od in obras_data:
        o = Obra(**od)
        session.add(o)
        await session.flush()
        obras[od["name"]] = o
    return obras


# ─────────────────────────────────────────────────────────────────────────────
# TASKS para la obra principal
# ─────────────────────────────────────────────────────────────────────────────

async def create_tasks(
    session: AsyncSession,
    obra: Obra,
    responsibles: dict,
) -> dict:
    """
    Estructura WBS:
    1. Trabajos Preliminares (COMPLETADA)
       1.1 Limpieza y demolición parcial       COMPLETADA
       1.2 Replanteo topográfico               COMPLETADA
       1.3 Instalación de obrador              COMPLETADA
    2. Estructura (EN_PROGRESO)
       2.1 Excavación y pilotaje               COMPLETADA
       2.2 Fundaciones y vigas encadenado      COMPLETADA
       2.3 Encofrado y hormigonado PB          EN_PROGRESO  ← demo principal
       2.4 Encofrado y hormigonado 1er piso    BLOQUEADA    ← alerta
    3. Instalaciones (EN_PROGRESO)
       3.1 Cañería eléctrica embutida PB       EN_PROGRESO
       3.2 Cañería sanitaria PB                BLOQUEADA    ← alerta
       3.3 Instalación de gas                  PENDIENTE
    4. Albañilería y cerramientos (PENDIENTE)
       4.1 Mampostería PB                      PENDIENTE
       4.2 Revoques interiores PB              PENDIENTE
       4.3 Colocación de aberturas             PENDIENTE
    5. Terminaciones (PENDIENTE)
       5.1 Revestimiento cerámico baños        PENDIENTE
       5.2 Pintura interior PB                 CANCELADA
       5.3 Carpintería metálica                PENDIENTE
    6. Hito: Entrega parcial PB               PENDIENTE (milestone)
    """
    carlos   = responsibles["Carlos Méndez"]
    maria    = responsibles["María González"]
    roberto  = responsibles["Roberto Flores"]
    ana      = responsibles["Ana Rodríguez"]
    diego    = responsibles["Diego Sánchez"]
    lucia    = responsibles["Lucía Fernández"]

    def t(**kwargs) -> Task:
        defaults = dict(
            obra_id=obra.id,
            tenant_id=obra.tenant_id,
            estimated_progress=0,
            order_index=0,
            is_milestone=False,
        )
        defaults.update(kwargs)
        task = Task(**defaults)
        session.add(task)
        return task

    # ── Fase 1: Trabajos Preliminares ─────────────────────────────────────
    f1 = t(title="1. Trabajos Preliminares", status=TaskStatus.COMPLETADA,
           start_date=d(-90), due_date=d(-55), completed_date=d(-57),
           estimated_progress=100, order_index=0,
           description="Fase de preparación del terreno y montaje de infraestructura de obra.",
           responsible_id=carlos.id)
    await session.flush()

    t11 = t(title="1.1 Limpieza y demolición parcial", status=TaskStatus.COMPLETADA,
            parent_task_id=f1.id, start_date=d(-90), due_date=d(-78),
            completed_date=d(-80), estimated_progress=100, order_index=1,
            description="Demolición de estructuras preexistentes y limpieza del terreno.",
            responsible_id=diego.id)
    t12 = t(title="1.2 Replanteo topográfico", status=TaskStatus.COMPLETADA,
            parent_task_id=f1.id, start_date=d(-78), due_date=d(-70),
            completed_date=d(-71), estimated_progress=100, order_index=2,
            description="Medición y marcación de ejes de construcción por topógrafo.",
            responsible_id=maria.id)
    t13 = t(title="1.3 Instalación de obrador", status=TaskStatus.COMPLETADA,
            parent_task_id=f1.id, start_date=d(-70), due_date=d(-60),
            completed_date=d(-62), estimated_progress=100, order_index=3,
            description="Montaje de vestuarios, depósito, oficina de obra y cerco perimetral.",
            responsible_id=lucia.id)
    await session.flush()

    # ── Fase 2: Estructura ────────────────────────────────────────────────
    f2 = t(title="2. Estructura", status=TaskStatus.EN_PROGRESO,
           start_date=d(-75), due_date=d(30), estimated_progress=45,
           order_index=4,
           description="Ejecución completa de la estructura de hormigón armado.",
           responsible_id=carlos.id)
    await session.flush()

    t21 = t(title="2.1 Excavación y pilotaje", status=TaskStatus.COMPLETADA,
            parent_task_id=f2.id, start_date=d(-75), due_date=d(-55),
            completed_date=d(-56), estimated_progress=100, order_index=5,
            description="Excavación a 4 m de profundidad y ejecución de 18 pilotes de 60 cm.",
            responsible_id=carlos.id)
    t22 = t(title="2.2 Fundaciones y vigas encadenado", status=TaskStatus.COMPLETADA,
            parent_task_id=f2.id, start_date=d(-55), due_date=d(-35),
            completed_date=d(-36), estimated_progress=100, order_index=6,
            description="Armado y hormigonado de fundaciones superficiales y vigas de encadenado.",
            responsible_id=carlos.id)
    t23 = t(title="2.3 Encofrado y hormigonado PB", status=TaskStatus.EN_PROGRESO,
            parent_task_id=f2.id, start_date=d(-30), due_date=d(10),
            estimated_progress=65, order_index=7,
            description="Encofrado de columnas y losa, armado de hierros y hormigonado H25.",
            responsible_id=carlos.id)
    t24 = t(title="2.4 Encofrado y hormigonado 1er piso", status=TaskStatus.BLOQUEADA,
            parent_task_id=f2.id, start_date=d(10), due_date=d(35),
            estimated_progress=0, order_index=8,
            description="Encofrado de columnas y losa del primer piso. Espera curado de PB.",
            responsible_id=carlos.id)
    await session.flush()

    # ── Fase 3: Instalaciones ─────────────────────────────────────────────
    f3 = t(title="3. Instalaciones", status=TaskStatus.EN_PROGRESO,
           start_date=d(-20), due_date=d(40), estimated_progress=30,
           order_index=9,
           description="Instalaciones eléctricas, sanitarias y de gas.",
           responsible_id=lucia.id)
    await session.flush()

    t31 = t(title="3.1 Cañería eléctrica embutida PB", status=TaskStatus.EN_PROGRESO,
            parent_task_id=f3.id, start_date=d(-20), due_date=d(15),
            estimated_progress=55, order_index=10,
            description="Tendido de cañerías conduit embutidas en losa y paredes para circuitos.",
            responsible_id=roberto.id)
    t32 = t(title="3.2 Cañería sanitaria PB", status=TaskStatus.BLOQUEADA,
            parent_task_id=f3.id, start_date=d(5), due_date=d(25),
            estimated_progress=0, order_index=11,
            description="Instalación de cañería de desagüe cloacal y agua fría/caliente.",
            responsible_id=ana.id)
    t33 = t(title="3.3 Instalación de gas", status=TaskStatus.PENDIENTE,
            parent_task_id=f3.id, start_date=d(20), due_date=d(40),
            estimated_progress=0, order_index=12,
            description="Tendido de cañería de gas natural desde medidor hasta cocinas.",
            responsible_id=ana.id)
    await session.flush()

    # ── Fase 4: Albañilería ───────────────────────────────────────────────
    f4 = t(title="4. Albañilería y Cerramientos", status=TaskStatus.PENDIENTE,
           start_date=d(15), due_date=d(75), estimated_progress=0,
           order_index=13,
           description="Mampostería, revoques y colocación de carpinterías.",
           responsible_id=diego.id)
    await session.flush()

    t41 = t(title="4.1 Mampostería PB", status=TaskStatus.PENDIENTE,
            parent_task_id=f4.id, start_date=d(15), due_date=d(45),
            estimated_progress=0, order_index=14,
            description="Construcción de muros divisorios y de fachada en ladrillo cerámico.",
            responsible_id=diego.id)
    t42 = t(title="4.2 Revoques interiores PB", status=TaskStatus.PENDIENTE,
            parent_task_id=f4.id, start_date=d(40), due_date=d(65),
            estimated_progress=0, order_index=15,
            description="Revoque grueso y fino de cielorrasos y paredes interiores.",
            responsible_id=diego.id)
    t43 = t(title="4.3 Colocación de aberturas", status=TaskStatus.PENDIENTE,
            parent_task_id=f4.id, start_date=d(55), due_date=d(75),
            estimated_progress=0, order_index=16,
            description="Colocación de ventanas DVH y puertas de acceso y habitaciones.",
            responsible_id=lucia.id)
    await session.flush()

    # ── Fase 5: Terminaciones ─────────────────────────────────────────────
    f5 = t(title="5. Terminaciones", status=TaskStatus.PENDIENTE,
           start_date=d(65), due_date=d(130), estimated_progress=0,
           order_index=17,
           description="Revestimientos, pintura y carpintería de terminación.",
           responsible_id=maria.id)
    await session.flush()

    t51 = t(title="5.1 Revestimiento cerámico baños", status=TaskStatus.PENDIENTE,
            parent_task_id=f5.id, start_date=d(65), due_date=d(90),
            estimated_progress=0, order_index=18,
            description="Colocación de porcelanato 60×60 en pisos y cerámico en paredes de baños.",
            responsible_id=diego.id)
    t52 = t(title="5.2 Pintura interior PB", status=TaskStatus.CANCELADA,
            parent_task_id=f5.id, start_date=d(-10), due_date=d(20),
            estimated_progress=0, order_index=19,
            description="CANCELADA — Se decidió tercerizar la pintura con empresa especializada.",
            responsible_id=None)
    t53 = t(title="5.3 Carpintería metálica", status=TaskStatus.PENDIENTE,
            parent_task_id=f5.id, start_date=d(75), due_date=d(100),
            estimated_progress=0, order_index=20,
            description="Fabricación y colocación de barandas de escalera y rejillas.",
            responsible_id=roberto.id)
    await session.flush()

    # ── Hito: Entrega parcial PB ──────────────────────────────────────────
    hito = t(title="⬧ Hito: Entrega parcial Planta Baja", status=TaskStatus.PENDIENTE,
             is_milestone=True, start_date=d(100), due_date=d(100),
             estimated_progress=0, order_index=21,
             description="Entrega formal de planta baja al comitente para inicio de habilitación.",
             responsible_id=maria.id)
    await session.flush()

    tasks = {
        "f1": f1, "t11": t11, "t12": t12, "t13": t13,
        "f2": f2, "t21": t21, "t22": t22, "t23": t23, "t24": t24,
        "f3": f3, "t31": t31, "t32": t32, "t33": t33,
        "f4": f4, "t41": t41, "t42": t42, "t43": t43,
        "f5": f5, "t51": t51, "t52": t52, "t53": t53,
        "hito": hito,
    }
    return tasks


# ─────────────────────────────────────────────────────────────────────────────
# DEPENDENCIAS M2M (task_dependencies)
# ─────────────────────────────────────────────────────────────────────────────

async def create_dependencies(session: AsyncSession, tasks: dict) -> None:
    """
    Tipos de dependencia (FS, SS, FF, SF):
    - FS (Finish→Start): la predecesora debe terminar antes de que la sucesora empiece
    - SS (Start→Start): ambas pueden empezar, con un lag mínimo entre inicios
    - FF (Finish→Finish): ambas deben terminar, con lag entre finalizaciones
    - SF (Start→Finish): la sucesora no puede terminar hasta que la predecesora empiece
    """
    deps = [
        # Fase 1: encadenamiento FS estricto
        dict(task_id=tasks["t12"].id, depends_on_id=tasks["t11"].id, dependency_type="FS", lag_days=0),
        dict(task_id=tasks["t13"].id, depends_on_id=tasks["t12"].id, dependency_type="FS", lag_days=1),

        # Fase 1 → 2: el obrador debe estar listo antes de excavar
        dict(task_id=tasks["t21"].id, depends_on_id=tasks["t13"].id, dependency_type="FS", lag_days=2),

        # Dentro de Fase 2: FS con lags realistas
        dict(task_id=tasks["t22"].id, depends_on_id=tasks["t21"].id, dependency_type="FS", lag_days=0),
        dict(task_id=tasks["t23"].id, depends_on_id=tasks["t22"].id, dependency_type="FS", lag_days=2),
        # PB debe curar 7 días antes de encofrar 1er piso
        dict(task_id=tasks["t24"].id, depends_on_id=tasks["t23"].id, dependency_type="FS", lag_days=7),

        # Eléctrica puede empezar SS 3 días después de iniciar excavación (pase en losa)
        dict(task_id=tasks["t31"].id, depends_on_id=tasks["t21"].id, dependency_type="SS", lag_days=3),

        # Sanitaria puede iniciar SS 5 días después que eléctrica (coordinación de espacios)
        dict(task_id=tasks["t32"].id, depends_on_id=tasks["t31"].id, dependency_type="SS", lag_days=5),

        # Gas y sanitaria deben terminar juntos (FF, prueba hidráulica conjunta)
        dict(task_id=tasks["t33"].id, depends_on_id=tasks["t32"].id, dependency_type="FF", lag_days=2),

        # Mampostería puede arrancar cuando hormigonado PB esté avanzado (FS)
        dict(task_id=tasks["t41"].id, depends_on_id=tasks["t23"].id, dependency_type="FS", lag_days=5),

        # Revoque empieza después de mampostería (FS)
        dict(task_id=tasks["t42"].id, depends_on_id=tasks["t41"].id, dependency_type="FS", lag_days=3),

        # Aberturas se colocan mientras se termina el revoque (SF: revoque no termina hasta que
        # las aberturas están colocadas — condición de cierre de cerramiento)
        dict(task_id=tasks["t42"].id, depends_on_id=tasks["t43"].id, dependency_type="SF", lag_days=0),

        # Cerámicos después de revoques
        dict(task_id=tasks["t51"].id, depends_on_id=tasks["t42"].id, dependency_type="FS", lag_days=5),

        # Hito: solo cuando todo en fase 4 esté completo
        dict(task_id=tasks["hito"].id, depends_on_id=tasks["t43"].id, dependency_type="FS", lag_days=0),
        dict(task_id=tasks["hito"].id, depends_on_id=tasks["t51"].id, dependency_type="FS", lag_days=0),
    ]
    await session.execute(insert(task_dependencies_table).values(deps))
    await session.flush()


# ─────────────────────────────────────────────────────────────────────────────
# BASELINE
# ─────────────────────────────────────────────────────────────────────────────

async def create_baseline(
    session: AsyncSession,
    obra: Obra,
    tasks: dict,
    admin_id: int,
) -> None:
    """
    Guarda una baseline donde 3 tareas ya se corrieron respecto al plan original.
    Las fechas de baseline son las planificadas originales (antes de los desvíos).
    """
    all_tasks = list(tasks.values())

    baselines = []
    for task in all_tasks:
        if task.start_date is None and task.due_date is None:
            continue
        # Para t23, t31, t32 simulamos un desvío: la baseline era 7 días antes
        if task in (tasks["t23"], tasks["t31"], tasks["t32"]):
            bl_start = (task.start_date - timedelta(days=7)) if task.start_date else None
            bl_finish = (task.due_date - timedelta(days=7)) if task.due_date else None
        else:
            bl_start = task.start_date
            bl_finish = task.due_date

        baselines.append(TaskBaseline(
            obra_id=obra.id,
            task_id=task.id,
            tenant_id=obra.tenant_id,
            baseline_start=bl_start,
            baseline_finish=bl_finish,
            saved_at=dt(-15),  # La baseline se guardó hace 15 días
        ))

    session.add_all(baselines)
    await session.flush()


# ─────────────────────────────────────────────────────────────────────────────
# CALENDARIO LABORAL
# ─────────────────────────────────────────────────────────────────────────────

async def create_calendar(session: AsyncSession, obra: Obra) -> None:
    # Lunes a sábado = bits 0-5 → bitmask 0b0111111 = 63
    cal = WorkingCalendar(
        obra_id=obra.id,
        tenant_id=obra.tenant_id,
        working_days=63,
        hour_from=7,
        hour_to=18,
    )
    session.add(cal)
    await session.flush()

    # Feriados nacionales argentinos 2025 y 2026 (relativos a año corriente)
    current_year = TODAY.year
    feriados = [
        # 2025/2026
        (1,  1,  "Año Nuevo"),
        (3,  3,  "Carnaval"),
        (3,  4,  "Carnaval"),
        (3,  24, "Día Nacional de la Memoria"),
        (4,  2,  "Malvinas"),
        (4,  17, "Jueves Santo"),
        (4,  18, "Viernes Santo"),
        (5,  1,  "Día del Trabajador"),
        (5,  25, "Revolución de Mayo"),
        (6,  20, "Día de la Bandera"),
        (7,  9,  "Día de la Independencia"),
        (8,  17, "San Martín"),
        (10, 12, "Respeto a la Diversidad Cultural"),
        (11, 20, "Soberanía Nacional"),
        (12, 8,  "Inmaculada Concepción"),
        (12, 25, "Navidad"),
    ]

    exceptions = []
    for year in [current_year, current_year + 1]:
        for mes, dia, label in feriados:
            try:
                fdate = date(year, mes, dia)
                exceptions.append(CalendarException(
                    calendar_id=cal.id,
                    date=fdate,
                    is_working=False,
                    label=label,
                ))
            except ValueError:
                pass  # fecha inválida para ese año (ej: 29 feb en año no bisiesto)

    session.add_all(exceptions)
    await session.flush()


# ─────────────────────────────────────────────────────────────────────────────
# OBRA TEAM MEMBERS
# ─────────────────────────────────────────────────────────────────────────────

async def create_team_members(
    session: AsyncSession,
    obra: Obra,
    responsibles: dict,
) -> None:
    assignments = [
        ("Carlos Méndez",   "Jefe de Obra",         None),
        ("María González",  "Arquitecta a cargo",   None),
        ("Roberto Flores",  "Electricista",         ["electricidad"]),
        ("Ana Rodríguez",   "Plomera",              ["sanitarios", "gas"]),
        ("Diego Sánchez",   "Albañil Oficial",      ["estructura", "albañileria"]),
        ("Lucía Fernández", "Capataz General",      None),
    ]
    for name, role, disciplines in assignments:
        resp = responsibles[name]
        otm = ObraTeamMember(
            obra_id=obra.id,
            tenant_id=obra.tenant_id,
            responsible_id=resp.id,
            role=role,
            member_type="equipo",
            plan_disciplines=disciplines,
        )
        session.add(otm)
    await session.flush()


# ─────────────────────────────────────────────────────────────────────────────
# ALERTS
# ─────────────────────────────────────────────────────────────────────────────

async def create_alerts(
    session: AsyncSession,
    obra: Obra,
    tasks: dict,
    tenant_id: int,
) -> None:
    alerts_data = [
        Alert(
            obra_id=obra.id,
            task_id=tasks["t24"].id,
            tenant_id=tenant_id,
            type=AlertType.TASK_BLOCKED,
            message=(
                "La tarea '2.4 Encofrado y hormigonado 1er piso' está BLOQUEADA. "
                "Depende de '2.3 Encofrado y hormigonado PB' (en progreso, 65%). "
                "Fecha estimada de desbloqueo: " + (TODAY + timedelta(days=10)).strftime("%d/%m/%Y") + "."
            ),
            is_read=False,
            created_at=dt(-2),
        ),
        Alert(
            obra_id=obra.id,
            task_id=tasks["t32"].id,
            tenant_id=tenant_id,
            type=AlertType.TASK_BLOCKED,
            message=(
                "La tarea '3.2 Cañería sanitaria PB' está BLOQUEADA. "
                "Espera que '3.1 Cañería eléctrica embutida PB' avance al menos 5 días más. "
                "Responsable: Ana Rodríguez — se le notificó por WhatsApp."
            ),
            is_read=False,
            created_at=dt(-1),
        ),
        Alert(
            obra_id=obra.id,
            task_id=tasks["t23"].id,
            tenant_id=tenant_id,
            type=AlertType.DELAY_RISK,
            message=(
                "RIESGO DE DESVÍO: '2.3 Encofrado y hormigonado PB' lleva 65% a "
                + str(abs(-30 + 0)) + " días de inicio. "
                "El plan original estimaba 75% a esta altura. "
                "Proyección: finalización con 5-7 días de retraso respecto a la línea base."
            ),
            is_read=True,
            created_at=dt(-5),
        ),
        Alert(
            obra_id=obra.id,
            task_id=tasks["t31"].id,
            tenant_id=tenant_id,
            type=AlertType.NO_RESPONSE,
            message=(
                "Roberto Flores no respondió el reporte de avance de '3.1 Cañería eléctrica "
                "embutida PB' en las últimas 28 horas. "
                "Último mensaje recibido: hace 2 días."
            ),
            is_read=True,
            created_at=dt(-3),
        ),
        Alert(
            obra_id=obra.id,
            task_id=tasks["t22"].id,
            tenant_id=tenant_id,
            type=AlertType.TASK_OVERDUE,
            message=(
                "'2.2 Fundaciones y vigas encadenado' venció hace "
                + str(abs(-36)) + " días. "
                "Estado actual: COMPLETADA (se completó con 1 día de adelanto). "
                "Alerta generada automáticamente antes del cierre."
            ),
            is_read=True,
            created_at=dt(-38),
        ),
        Alert(
            obra_id=obra.id,
            task_id=tasks["t23"].id,
            tenant_id=tenant_id,
            type=AlertType.RESCHEDULE_REQUESTED,
            message=(
                "Carlos Méndez solicitó reprogramación de '2.3 Encofrado y hormigonado PB' "
                "por WhatsApp: 'Necesito 3 días más, hubo demora en entrega del hierro'. "
                "Pendiente de aprobación por el jefe de proyecto."
            ),
            is_read=False,
            created_at=dt(-1),
        ),
        Alert(
            obra_id=obra.id,
            task_id=None,
            tenant_id=tenant_id,
            type=AlertType.ORDER_RECEIVED,
            message=(
                "Orden de compra OC-2024-001 recibida de Ferretería El Tornillo SRL. "
                "Ítems: 2.400 kg hierro Ø12, 800 kg hierro Ø8, 50 kg alambre de atar. "
                "Recibido conforme. Stock ingresado a depósito."
            ),
            is_read=True,
            created_at=dt(-7),
        ),
    ]
    session.add_all(alerts_data)
    await session.flush()


# ─────────────────────────────────────────────────────────────────────────────
# BITÁCORA
# ─────────────────────────────────────────────────────────────────────────────

async def create_bitacora(
    session: AsyncSession,
    obra: Obra,
    responsibles: dict,
    admin_id: int,
) -> dict:
    carlos = responsibles["Carlos Méndez"]
    ana    = responsibles["Ana Rodríguez"]

    entry1 = BitacoraEntry(
        obra_id=obra.id,
        responsible_id=carlos.id,
        created_by=admin_id,
        source="whatsapp",
        audio_path="uploads/bitacora/demo_audio_001.ogg",
        transcript=(
            "Hoy arrancamos el hormigonado de la losa de planta baja. Llegaron los camiones "
            "de Hormigones del Norte a las 7 y media, tuvimos un retraso de 45 minutos porque "
            "faltaba completar el armado en el sector norte. El hormigón H25 llegó en perfecto "
            "estado, slump de 14 cm aprobado. Pusimos el primer volumen a las 8 y cuarto. "
            "La cuadrilla está trabajando bien, Sánchez con tres peones en el vibrado. "
            "Proyectamos terminar el sector sur mañana a primera hora si el tiempo aguanta."
        ),
        summary=(
            "Se inició el hormigonado de la losa de planta baja con hormigón H25. "
            "Retraso de 45 min por completar armado en sector norte. "
            "El hormigón llegó en condiciones óptimas. Se prevé finalizar el sector sur al día siguiente."
        ),
        key_points=[
            "Inicio de hormigonado losa PB con H25",
            "Retraso inicial de 45 minutos por completar armado",
            "Slump de 14 cm aprobado por laboratorista",
            "Continuidad prevista para mañana en sector sur",
        ],
        suggestions=[
            {
                "id": 1,
                "text": "Actualizar avance de tarea '2.3 Encofrado y hormigonado PB' al 70%",
                "type": "update_progress",
                "task_id": None,
                "status": "applied",
                "applied_at": dt(-8).isoformat(),
            },
            {
                "id": 2,
                "text": "Registrar en historial el inicio de hormigonado de losa PB",
                "type": "log_event",
                "status": "applied",
                "applied_at": dt(-8).isoformat(),
            },
        ],
        status="procesado",
        created_at=dt(-9),
        processed_at=dt(-8),
    )

    entry2 = BitacoraEntry(
        obra_id=obra.id,
        responsible_id=ana.id,
        created_by=admin_id,
        source="whatsapp",
        audio_path="uploads/bitacora/demo_audio_002.ogg",
        transcript=(
            "Ana Rodríguez reportando desde obra. Fui a ver el recorrido de las cañerías "
            "de desagüe en la zona de baños y encontré un problema. El plano indica que la "
            "bajada principal va por el eje de la columna C3 pero esa columna ya tiene los "
            "hierros pasados y no hay espacio para el caño de 110. Necesito que el arquitecto "
            "me diga cómo resolvemos esto, si cambiamos el recorrido o si vamos por el tabique "
            "divisorio. También me avisaron que el proveedor de caños Pead no puede entregar "
            "hasta la semana que viene."
        ),
        summary=(
            "Ana Rodríguez reporta interferencia entre la bajada de desagüe 110mm y la columna C3 "
            "que ya tiene su armado colocado. Se requiere definición del arquitecto sobre el recorrido "
            "alternativo. Además, el proveedor de caños PEAD tiene demora de una semana."
        ),
        key_points=[
            "Interferencia entre bajada de desagüe ø110 y columna C3",
            "La columna ya tiene armado colocado — no se puede modificar",
            "Se necesita decisión: rodear por tabique divisorio o replantear recorrido",
            "Demora de proveedor de caños PEAD: entrega pospuesta 7 días",
        ],
        suggestions=[
            {
                "id": 1,
                "text": "Crear alerta de RIESGO DE DESVÍO para '3.2 Cañería sanitaria PB' por interferencia estructural",
                "type": "create_alert",
                "status": "applied",
                "applied_at": dt(-3).isoformat(),
            },
            {
                "id": 2,
                "text": "Actualizar fecha de inicio de '3.2 Cañería sanitaria PB' corrida 7 días por demora de proveedor",
                "type": "reschedule_task",
                "status": "applied",
                "applied_at": dt(-3).isoformat(),
            },
        ],
        status="procesado",
        created_at=dt(-4),
        processed_at=dt(-3),
    )

    entry3 = BitacoraEntry(
        obra_id=obra.id,
        responsible_id=carlos.id,
        created_by=admin_id,
        source="web",
        audio_path=None,
        transcript=(
            "Reunión con el proveedor de hierros esta mañana. Confirmaron que el lote de "
            "hierros Ø12 y Ø8 que llegó ayer tiene certificado de calidad en regla, pero "
            "el peso real entregado fue 2.380 kg contra los 2.400 kg pedidos. Diferencia de "
            "20 kg. El proveedor prometió compensar en el próximo pedido. "
            "También se definió que el encofrado para el 1er piso va a arrancar el lunes "
            "si el curado de PB llega al 70% de resistencia según los ensayos de laboratorio. "
            "Hay que programar el ensayo para el viernes."
        ),
        summary=(
            "Se verificó el lote de hierros recibido: 2.380 kg reales vs 2.400 kg pedidos (faltante de 20 kg). "
            "El proveedor compensará en el próximo pedido. "
            "Se condicionó el inicio del encofrado de 1er piso al resultado del ensayo de hormigón del viernes."
        ),
        key_points=[
            "Hierros recibidos con diferencia de 20 kg (2.380 vs 2.400 kg solicitados)",
            "Certificado de calidad aprobado para el lote recibido",
            "Inicio de encofrado 1er piso sujeto a resultado de ensayo laboratorio del viernes",
            "Proveedor compromete compensación de faltante en próximo pedido",
        ],
        suggestions=[
            {
                "id": 1,
                "text": "Registrar diferencia de 20 kg en historial de materiales de la orden OC-2024-001",
                "type": "log_event",
                "status": "pendiente",
            },
            {
                "id": 2,
                "text": "Programar tarea 'Ensayo de rotura de probetas' para el viernes "
                        + d(3).strftime("%d/%m/%Y"),
                "type": "create_task",
                "status": "pendiente",
            },
        ],
        status="pendiente_sugerencia",
        created_at=dt(-1),
        processed_at=dt(-1),
    )

    session.add_all([entry1, entry2, entry3])
    await session.flush()
    return {"entry3_pending": entry3}


# ─────────────────────────────────────────────────────────────────────────────
# MATERIALES Y COMPRAS
# ─────────────────────────────────────────────────────────────────────────────

async def create_materials_and_orders(
    session: AsyncSession,
    obra: Obra,
    tasks: dict,
    suppliers: dict,
    admin_id: int,
    tenant_id: int,
) -> dict:
    tornillo    = suppliers["Ferretería El Tornillo SRL"]
    electro     = suppliers["ElectroInsumos Córdoba SA"]
    hormigones  = suppliers["Hormigones del Norte SRL"]
    ceramica    = suppliers["Cerámica Villanueva"]

    # Materiales para t23 (hormigonado PB)
    m1 = TaskMaterial(task_id=tasks["t23"].id, tenant_id=tenant_id,
                      name="Hierro en barra Ø12 mm",
                      quantity=Decimal("2380"), unit="kg",
                      unit_price=Decimal("850.00"),
                      supplier_id=tornillo.id,
                      created_by=admin_id,
                      status="recibido")
    m2 = TaskMaterial(task_id=tasks["t23"].id, tenant_id=tenant_id,
                      name="Hierro en barra Ø8 mm",
                      quantity=Decimal("800"), unit="kg",
                      unit_price=Decimal("820.00"),
                      supplier_id=tornillo.id,
                      created_by=admin_id,
                      status="recibido")
    m3 = TaskMaterial(task_id=tasks["t23"].id, tenant_id=tenant_id,
                      name="Hormigón elaborado H25",
                      quantity=Decimal("48.5"), unit="m³",
                      unit_price=Decimal("78000.00"),
                      supplier_id=hormigones.id,
                      created_by=admin_id,
                      status="recibido")
    m4 = TaskMaterial(task_id=tasks["t23"].id, tenant_id=tenant_id,
                      name="Alambre de atar",
                      quantity=Decimal("50"), unit="kg",
                      unit_price=Decimal("1200.00"),
                      supplier_id=tornillo.id,
                      created_by=admin_id,
                      status="recibido")

    # Materiales para t31 (eléctrica)
    m5 = TaskMaterial(task_id=tasks["t31"].id, tenant_id=tenant_id,
                      name="Caño corrugado reforzado Ø20",
                      quantity=Decimal("480"), unit="m",
                      unit_price=Decimal("420.00"),
                      supplier_id=electro.id,
                      created_by=admin_id,
                      status="pedido")
    m6 = TaskMaterial(task_id=tasks["t31"].id, tenant_id=tenant_id,
                      name="Caño corrugado reforzado Ø32",
                      quantity=Decimal("180"), unit="m",
                      unit_price=Decimal("680.00"),
                      supplier_id=electro.id,
                      created_by=admin_id,
                      status="pedido")
    m7 = TaskMaterial(task_id=tasks["t31"].id, tenant_id=tenant_id,
                      name="Cajas de paso 10×10 cm",
                      quantity=Decimal("96"), unit="un",
                      unit_price=Decimal("850.00"),
                      supplier_id=electro.id,
                      created_by=admin_id,
                      status="pendiente")

    # Materiales para t51 (cerámicos)
    m8 = TaskMaterial(task_id=tasks["t51"].id, tenant_id=tenant_id,
                      name="Porcelanato Rectificado 60×60 Blanco",
                      quantity=Decimal("340"), unit="m²",
                      unit_price=Decimal("9800.00"),
                      supplier_id=ceramica.id,
                      created_by=admin_id,
                      status="pendiente")
    m9 = TaskMaterial(task_id=tasks["t51"].id, tenant_id=tenant_id,
                      name="Adhesivo para porcelanato (bolsa 30kg)",
                      quantity=Decimal("85"), unit="bolsa",
                      unit_price=Decimal("3200.00"),
                      supplier_id=tornillo.id,
                      created_by=admin_id,
                      status="pendiente")

    session.add_all([m1, m2, m3, m4, m5, m6, m7, m8, m9])
    await session.flush()

    # ── Orden de compra RECIBIDA (hierros ya llegaron) ─────────────────────
    oc1 = PurchaseOrder(
        obra_id=obra.id,
        supplier_id=tornillo.id,
        created_by=admin_id,
        status="recibido",
        notes="Pedido urgente para inicio de hormigonado PB. Entrega acordada en 48h.",
        created_at=dt(-12),
        sent_at=dt(-12),
        received_at=dt(-7),
    )
    session.add(oc1)
    await session.flush()
    session.add_all([
        PurchaseOrderItem(order_id=oc1.id, material_id=m1.id,
                          name="Hierro en barra Ø12 mm",
                          quantity=Decimal("2400"), unit="kg",
                          unit_price=Decimal("850.00")),
        PurchaseOrderItem(order_id=oc1.id, material_id=m2.id,
                          name="Hierro en barra Ø8 mm",
                          quantity=Decimal("800"), unit="kg",
                          unit_price=Decimal("820.00")),
        PurchaseOrderItem(order_id=oc1.id, material_id=m4.id,
                          name="Alambre de atar",
                          quantity=Decimal("50"), unit="kg",
                          unit_price=Decimal("1200.00")),
    ])

    # ── Orden de compra ENVIADA (materiales eléctricos en camino) ──────────
    oc2 = PurchaseOrder(
        obra_id=obra.id,
        supplier_id=electro.id,
        created_by=admin_id,
        status="enviado",
        notes="Materiales conduit para cañería embutida eléctrica PB. Entrega pactada en 5 días.",
        created_at=dt(-4),
        sent_at=dt(-3),
        received_at=None,
    )
    session.add(oc2)
    await session.flush()
    session.add_all([
        PurchaseOrderItem(order_id=oc2.id, material_id=m5.id,
                          name="Caño corrugado reforzado Ø20",
                          quantity=Decimal("480"), unit="m",
                          unit_price=Decimal("420.00")),
        PurchaseOrderItem(order_id=oc2.id, material_id=m6.id,
                          name="Caño corrugado reforzado Ø32",
                          quantity=Decimal("180"), unit="m",
                          unit_price=Decimal("680.00")),
        PurchaseOrderItem(order_id=oc2.id, material_id=m7.id,
                          name="Cajas de paso 10×10 cm",
                          quantity=Decimal("96"), unit="un",
                          unit_price=Decimal("850.00")),
    ])
    await session.flush()

    return {"m8": m8, "m9": m9, "oc1": oc1, "oc2": oc2,
            "m5": m5, "m6": m6, "m7": m7}


# ─────────────────────────────────────────────────────────────────────────────
# SOLICITUD DE COTIZACIÓN
# ─────────────────────────────────────────────────────────────────────────────

async def create_solicitud(
    session: AsyncSession,
    obra: Obra,
    materials_result: dict,
    suppliers: dict,
    admin_id: int,
    tenant_id: int,
) -> SolicitudCotizacion:
    ceramica  = suppliers["Cerámica Villanueva"]
    tornillo  = suppliers["Ferretería El Tornillo SRL"]
    electro   = suppliers["ElectroInsumos Córdoba SA"]
    m8 = materials_result["m8"]
    m9 = materials_result["m9"]

    sol = SolicitudCotizacion(
        obra_id=obra.id,
        tenant_id=tenant_id,
        created_by=admin_id,
        ref_code="SC-2024-003",
        status="respondida",
        notes=(
            "Solicitud de cotización para materiales de terminaciones — baños PB. "
            "Se pide precio por metro cuadrado de porcelanato rectificado blanco 60×60 "
            "y adhesivo cerámico. Entrega requerida en obra para " + d(60).strftime("%d/%m/%Y") + "."
        ),
        created_at=dt(-14),
        sent_at=dt(-13),
        contratista_phone=None,
    )
    session.add(sol)
    await session.flush()

    # M2M: materiales incluidos en la solicitud
    await session.execute(
        insert(solicitud_materiales).values([
            {"solicitud_id": sol.id, "material_id": m8.id},
            {"solicitud_id": sol.id, "material_id": m9.id},
        ])
    )

    # Proveedores contactados
    sl1 = SolicitudSupplier(solicitud_id=sol.id, supplier_id=ceramica.id,
                            status="respondida", sent_at=dt(-13))
    sl2 = SolicitudSupplier(solicitud_id=sol.id, supplier_id=tornillo.id,
                            status="respondida", sent_at=dt(-13))
    sl3 = SolicitudSupplier(solicitud_id=sol.id, supplier_id=electro.id,
                            status="enviada", sent_at=dt(-13))
    session.add_all([sl1, sl2, sl3])
    await session.flush()

    # Respuestas (Budgets vinculados a la solicitud)
    resp1 = Budget(
        tenant_id=tenant_id,
        obra_id=obra.id,
        created_by=admin_id,
        supplier_id=ceramica.id,
        supplier_name="Cerámica Villanueva",
        rubro="Terminaciones — Porcelanato y adhesivo",
        source_type="texto",
        source_filename=None,
        raw_text=(
            "Porcelanato Rectificado 60×60 Blanco: $9.800/m² (IVA incl.) — "
            "disponibilidad inmediata, 340 m² en stock.\n"
            "Adhesivo cerámico 30 kg: $3.200/bolsa — stock 85 bolsas.\n"
            "Flete a obra: $85.000 (incluido en oferta para pedido mayor a 200 m²).\n"
            "Validez de oferta: 15 días desde la fecha."
        ),
        data=[
            {"descripcion": "Porcelanato Rectificado 60x60 Blanco",
             "cantidad": 340, "unidad": "m²",
             "precio_unitario": 9800.00, "subtotal": 3332000.00},
            {"descripcion": "Adhesivo cerámico 30 kg",
             "cantidad": 85, "unidad": "bolsa",
             "precio_unitario": 3200.00, "subtotal": 272000.00},
            {"descripcion": "Flete a obra",
             "cantidad": 1, "unidad": "gl",
             "precio_unitario": 85000.00, "subtotal": 85000.00},
        ],
        inconsistencies=[],
        total=Decimal("3689000.00"),
        currency="ARS",
        status="procesado",
        solicitud_id=sol.id,
        ai_analysis=(
            "Oferta competitiva. El precio de porcelanato ($9.800/m²) está dentro del rango "
            "de mercado para la categoría ($9.200–$10.500). El flete incluido es una ventaja "
            "para este volumen. Stock disponible garantiza entrega sin demoras. "
            "Recomendación: primera opción si los plazos son prioritarios."
        ),
        created_at=dt(-10),
    )

    resp2 = Budget(
        tenant_id=tenant_id,
        obra_id=obra.id,
        created_by=admin_id,
        supplier_id=tornillo.id,
        supplier_name="Ferretería El Tornillo SRL",
        rubro="Terminaciones — Porcelanato y adhesivo",
        source_type="texto",
        source_filename=None,
        raw_text=(
            "Porcelanato 60×60 Blanco Rectificado: $9.200/m² + IVA.\n"
            "Adhesivo cerámico 30 kg: $2.950/bolsa + IVA.\n"
            "NOTA: El porcelanato es importado — puede haber demoras de aduana de hasta 3 semanas.\n"
            "Flete: $120.000 adicionales.\n"
            "Stock actual: 180 m² (necesitan completar con importación).\n"
            "Validez: 10 días."
        ),
        data=[
            {"descripcion": "Porcelanato 60x60 Blanco Rectificado",
             "cantidad": 340, "unidad": "m²",
             "precio_unitario": 9200.00, "subtotal": 3128000.00},
            {"descripcion": "Adhesivo cerámico 30 kg",
             "cantidad": 85, "unidad": "bolsa",
             "precio_unitario": 2950.00, "subtotal": 250750.00},
            {"descripcion": "Flete a obra",
             "cantidad": 1, "unidad": "gl",
             "precio_unitario": 120000.00, "subtotal": 120000.00},
        ],
        inconsistencies=[
            {
                "tipo": "stock_insuficiente",
                "descripcion": (
                    "El proveedor tiene solo 180 m² en stock de los 340 m² requeridos. "
                    "Los 160 m² restantes dependen de importación con demora estimada de 3 semanas. "
                    "Riesgo de retraso para la tarea '5.1 Revestimiento cerámico baños'."
                ),
                "campo": "cantidad disponible",
                "severidad": "alta",
            }
        ],
        total=Decimal("3498750.00"),
        currency="ARS",
        status="procesado",
        solicitud_id=sol.id,
        ai_analysis=(
            "Precio unitario 6% menor que Cerámica Villanueva, pero con riesgo logístico importante: "
            "el stock disponible cubre solo el 53% del pedido. La demora de importación de 3 semanas "
            "puede impactar el cronograma de la tarea '5.1' y en cascada el hito de entrega. "
            "Recomendación: elegir esta opción SOLO si el margen de tiempo lo permite o "
            "si se negocia garantía de entrega parcial inmediata."
        ),
        created_at=dt(-9),
    )

    session.add_all([resp1, resp2])
    await session.flush()
    return sol


# ─────────────────────────────────────────────────────────────────────────────
# BUDGET DIRECTO (presupuesto cargado manualmente con inconsistencia)
# ─────────────────────────────────────────────────────────────────────────────

async def create_budget(
    session: AsyncSession,
    obra: Obra,
    suppliers: dict,
    admin_id: int,
    tenant_id: int,
) -> None:
    hormigones = suppliers["Hormigones del Norte SRL"]

    budget = Budget(
        tenant_id=tenant_id,
        obra_id=obra.id,
        created_by=admin_id,
        supplier_id=hormigones.id,
        supplier_name="Hormigones del Norte SRL",
        rubro="Estructura — Hormigón elaborado",
        source_type="texto",
        source_filename=None,
        raw_text=(
            "Presupuesto N° 8821 — Hormigones del Norte SRL\n"
            "Fecha: " + d(-20).strftime("%d/%m/%Y") + "\n\n"
            "H25 — 48,5 m³ a $78.000/m³ = $3.783.000\n"
            "H21 — 12 m³ a $71.000/m³ = $852.000\n"
            "Bomba pluma 32 m: 4 hs a $185.000/h = $740.000\n"
            "Retardo de fragüe (aditivo): $95.000\n"
            "TOTAL: $5.470.000 + IVA 21%\n\n"
            "Nota: Los precios son sin IVA. El total indicado incluye IVA según tabla."
        ),
        data=[
            {"descripcion": "Hormigón elaborado H25",
             "cantidad": 48.5, "unidad": "m³",
             "precio_unitario": 78000.00, "subtotal": 3783000.00},
            {"descripcion": "Hormigón elaborado H21",
             "cantidad": 12.0, "unidad": "m³",
             "precio_unitario": 71000.00, "subtotal": 852000.00},
            {"descripcion": "Servicio de bomba pluma 32m",
             "cantidad": 4.0, "unidad": "hora",
             "precio_unitario": 185000.00, "subtotal": 740000.00},
            {"descripcion": "Aditivo retardador de fragüe",
             "cantidad": 1.0, "unidad": "gl",
             "precio_unitario": 95000.00, "subtotal": 95000.00},
        ],
        inconsistencies=[
            {
                "tipo": "suma_incorrecta",
                "descripcion": (
                    "El presupuesto indica TOTAL: $5.470.000 + IVA 21%, pero la suma de los ítems "
                    "da $5.470.000. Sin embargo, el texto inicial dice 'precios sin IVA' y luego "
                    "afirma que 'el total incluye IVA': contradicción. "
                    "Si los precios son sin IVA, el total con IVA 21% sería $6.618.700. "
                    "Si ya incluyen IVA, el total está correcto. Requiere aclaración."
                ),
                "campo": "total",
                "severidad": "alta",
                "valor_declarado": 5470000.00,
                "valor_calculado": 6618700.00,
            }
        ],
        total=Decimal("5470000.00"),
        currency="ARS",
        status="procesado",
        solicitud_id=None,
        ai_analysis=(
            "Se detectó una inconsistencia grave en el tratamiento del IVA. "
            "El presupuesto primero indica que los precios son sin IVA, y luego afirma que el total "
            "ya incluye IVA — ambas afirmaciones son contradictorias. "
            "El impacto económico es de $1.148.700 si la discrepancia no se aclara. "
            "Acción recomendada: solicitar aclaración escrita al proveedor antes de aprobar el pago."
        ),
        created_at=dt(-20),
    )
    session.add(budget)
    await session.flush()


# ─────────────────────────────────────────────────────────────────────────────
# PLANOS
# ─────────────────────────────────────────────────────────────────────────────

async def create_planos(
    session: AsyncSession,
    obra: Obra,
    admin_id: int,
) -> None:
    planos = [
        # Estructura — versión 1 (reemplazada)
        Plano(
            tenant_id=obra.tenant_id,
            obra_id=obra.id,
            uploaded_by=admin_id,
            discipline="estructura",
            name="Plano Estructural General — Rev. A",
            version=1,
            is_latest=False,
            file_path="uploads/planos/demo_estructura_v1.pdf",
            original_filename="PE-LasAcacias-RevA.pdf",
            content_type="application/pdf",
            file_size=2_480_000,
            notes="Versión inicial. Revisada por modificación en fundaciones sector norte.",
            created_at=dt(-60),
        ),
        # Estructura — versión 2 (vigente)
        Plano(
            tenant_id=obra.tenant_id,
            obra_id=obra.id,
            uploaded_by=admin_id,
            discipline="estructura",
            name="Plano Estructural General — Rev. B",
            version=2,
            is_latest=True,
            file_path="uploads/planos/demo_estructura_v2.pdf",
            original_filename="PE-LasAcacias-RevB.pdf",
            content_type="application/pdf",
            file_size=2_620_000,
            notes="Rev. B: corrección de posición de columnas C3 y C4 en sector norte según replanteo.",
            created_at=dt(-30),
        ),
        # Electricidad — única versión
        Plano(
            tenant_id=obra.tenant_id,
            obra_id=obra.id,
            uploaded_by=admin_id,
            discipline="electricidad",
            name="Plano de Instalación Eléctrica PB",
            version=1,
            is_latest=True,
            file_path="uploads/planos/demo_electrica_v1.pdf",
            original_filename="PIE-LasAcacias-PB-RevA.pdf",
            content_type="application/pdf",
            file_size=1_850_000,
            notes="Circuitos eléctricos planta baja, tablero seccional y puesta a tierra.",
            created_at=dt(-45),
        ),
        # Sanitarios — única versión
        Plano(
            tenant_id=obra.tenant_id,
            obra_id=obra.id,
            uploaded_by=admin_id,
            discipline="sanitarios",
            name="Plano de Instalación Sanitaria PB",
            version=1,
            is_latest=True,
            file_path="uploads/planos/demo_sanitaria_v1.pdf",
            original_filename="PIS-LasAcacias-PB-RevA.pdf",
            content_type="application/pdf",
            file_size=1_640_000,
            notes="Cañería de desagüe y agua fría/caliente. PENDIENTE actualización por interferencia C3.",
            created_at=dt(-40),
        ),
    ]
    session.add_all(planos)
    await session.flush()


# ─────────────────────────────────────────────────────────────────────────────
# HISTORIAL (entradas manuales para acciones clave)
# ─────────────────────────────────────────────────────────────────────────────

async def create_historial(
    session: AsyncSession,
    obra: Obra,
    tasks: dict,
    admin_id: int,
    collab_id: int,
    tenant_id: int,
) -> None:
    eventos = [
        HistorialEvento(
            obra_id=obra.id, task_id=None, tenant_id=tenant_id,
            event_type="obra_created",
            description="Obra 'Edificio Residencial Las Acacias' creada.",
            payload={"actor": "Arq. Laura Méndez", "status": "planificada"},
            triggered_by="user",
            created_at=dt(-91),
        ),
        HistorialEvento(
            obra_id=obra.id, task_id=None, tenant_id=tenant_id,
            event_type="obra_updated",
            description="Estado de obra actualizado de PLANIFICADA a EN_PROGRESO al iniciar excavación.",
            payload={"campo": "status", "anterior": "planificada", "nuevo": "en_progreso"},
            triggered_by="system",
            created_at=dt(-75),
        ),
        HistorialEvento(
            obra_id=obra.id, task_id=tasks["t11"].id, tenant_id=tenant_id,
            event_type="task_updated",
            description="Tarea '1.1 Limpieza y demolición parcial' marcada como COMPLETADA.",
            payload={"campo": "status", "anterior": "en_progreso", "nuevo": "completada",
                     "actor": "Diego Sánchez", "canal": "whatsapp"},
            triggered_by="chatbot",
            created_at=dt(-80),
        ),
        HistorialEvento(
            obra_id=obra.id, task_id=tasks["t21"].id, tenant_id=tenant_id,
            event_type="task_updated",
            description="Tarea '2.1 Excavación y pilotaje' completada. 18 pilotes de ø60 ejecutados.",
            payload={"campo": "status", "anterior": "en_progreso", "nuevo": "completada",
                     "actor": "Carlos Méndez", "canal": "whatsapp"},
            triggered_by="chatbot",
            created_at=dt(-56),
        ),
        HistorialEvento(
            obra_id=obra.id, task_id=tasks["t22"].id, tenant_id=tenant_id,
            event_type="task_updated",
            description="Tarea '2.2 Fundaciones y vigas encadenado' completada con 1 día de adelanto.",
            payload={"campo": "status", "anterior": "en_progreso", "nuevo": "completada",
                     "actor": "Carlos Méndez", "canal": "whatsapp"},
            triggered_by="chatbot",
            created_at=dt(-36),
        ),
        HistorialEvento(
            obra_id=obra.id, task_id=tasks["t23"].id, tenant_id=tenant_id,
            event_type="task_updated",
            description="Avance de '2.3 Encofrado y hormigonado PB' actualizado al 65%.",
            payload={"campo": "estimated_progress", "anterior": 50, "nuevo": 65,
                     "actor": "Carlos Méndez", "canal": "whatsapp"},
            triggered_by="chatbot",
            created_at=dt(-9),
        ),
        HistorialEvento(
            obra_id=obra.id, task_id=tasks["t24"].id, tenant_id=tenant_id,
            event_type="task_updated",
            description="Tarea '2.4 Encofrado y hormigonado 1er piso' bloqueada automáticamente.",
            payload={"campo": "status", "anterior": "pendiente", "nuevo": "bloqueada",
                     "razon": "predecesora_en_progreso", "predecesora_id": tasks["t23"].id},
            triggered_by="system",
            created_at=dt(-2),
        ),
        HistorialEvento(
            obra_id=obra.id, task_id=tasks["t32"].id, tenant_id=tenant_id,
            event_type="task_updated",
            description="Tarea '3.2 Cañería sanitaria PB' bloqueada. Interferencia detectada en columna C3.",
            payload={"campo": "status", "anterior": "pendiente", "nuevo": "bloqueada",
                     "razon": "interferencia_estructural",
                     "reporte": "bitacora_entry_002"},
            triggered_by="system",
            created_at=dt(-3),
        ),
        HistorialEvento(
            obra_id=obra.id, task_id=None, tenant_id=tenant_id,
            event_type="order_received",
            description="Orden de compra OC-2024-001 recibida conforme. Hierros ingresados a depósito.",
            payload={"supplier": "Ferretería El Tornillo SRL",
                     "items": ["Hierro Ø12: 2.380 kg", "Hierro Ø8: 800 kg", "Alambre: 50 kg"],
                     "diferencia": "Hierro Ø12: 20 kg menos (compensación pendiente)"},
            triggered_by="user",
            created_at=dt(-7),
        ),
        HistorialEvento(
            obra_id=obra.id, task_id=None, tenant_id=tenant_id,
            event_type="obra_updated",
            description="Baseline guardada para la obra. 21 tareas capturadas.",
            payload={"actor": "Arq. Laura Méndez", "total_tareas": 21},
            triggered_by="user",
            created_at=dt(-15),
        ),
    ]
    session.add_all(eventos)
    await session.flush()


# ─────────────────────────────────────────────────────────────────────────────
# TAREAS SIMPLES PARA OBRAS SECUNDARIAS
# ─────────────────────────────────────────────────────────────────────────────

async def create_simple_tasks(
    session: AsyncSession,
    obra_planificada: Obra,
    obra_completada: Obra,
    responsibles: dict,
) -> None:
    carlos = responsibles["Carlos Méndez"]
    maria  = responsibles["María González"]

    # Obra planificada: algunas tareas en estado pendiente
    for i, title in enumerate([
        "Relevamiento del local existente",
        "Proyecto ejecutivo y planos",
        "Trámites municipales y permisos",
        "Demolición interna",
    ]):
        session.add(Task(
            obra_id=obra_planificada.id, tenant_id=obra_planificada.tenant_id,
            title=title, status=TaskStatus.PENDIENTE,
            start_date=d(15 + i * 14), due_date=d(15 + (i + 1) * 14),
            estimated_progress=0, order_index=i,
            responsible_id=(carlos.id if i % 2 == 0 else maria.id),
        ))

    # Obra completada: tareas COMPLETADA
    for i, title in enumerate([
        "Proyecto y aprobación municipal",
        "Movimiento de suelos",
        "Estructura de hormigón",
        "Cerramiento y cubierta",
        "Terminaciones interiores",
        "Piscina y quincho",
        "Entrega final al comitente",
    ]):
        session.add(Task(
            obra_id=obra_completada.id, tenant_id=obra_completada.tenant_id,
            title=title, status=TaskStatus.COMPLETADA,
            start_date=d(-300 + i * 35), due_date=d(-300 + (i + 1) * 35),
            completed_date=d(-300 + (i + 1) * 35 - 2),
            estimated_progress=100, order_index=i,
            responsible_id=carlos.id,
        ))

    await session.flush()


# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────

async def main() -> None:
    print("\n" + "=" * 65)
    print("  CONSTRUCTA — Carga de datos de demostración")
    print("=" * 65)

    async with AsyncSessionLocal() as session:
        async with session.begin():

            print("\n[1/12] Limpieza de datos previos…")
            await cleanup(session)

            print("[2/12] Creando tenant, plan y usuarios…")
            tenant, admin, collab = await create_foundation(session)

            print("[3/12] Creando responsables (personal de campo)…")
            responsibles = await create_responsibles(session, tenant.id)

            print("[4/12] Creando proveedores…")
            suppliers = await create_suppliers(session, tenant.id)

            print("[5/12] Creando obras…")
            obras = await create_obras(session, tenant.id, admin.id)
            obra_principal  = obras["Edificio Residencial Las Acacias"]
            obra_planificada = obras["Local Comercial Centro Histórico"]
            obra_completada  = obras["Vivienda Familiar Barrio Jardín"]

            print("[6/12] Creando estructura WBS de tareas…")
            tasks = await create_tasks(session, obra_principal, responsibles)

            print("[7/12] Creando dependencias M2M entre tareas…")
            await create_dependencies(session, tasks)

            print("[8/12] Guardando baseline…")
            await create_baseline(session, obra_principal, tasks, admin.id)

            print("[9/12] Creando calendario laboral con feriados argentinos…")
            await create_calendar(session, obra_principal)

            print("[10/12] Asignando equipo a la obra principal…")
            await create_team_members(session, obra_principal, responsibles)

            print("[11/12] Creando alertas, bitácora, materiales, compras, planos e historial…")
            await create_alerts(session, obra_principal, tasks, tenant.id)
            bitacora_result = await create_bitacora(
                session, obra_principal, responsibles, admin.id
            )
            materials_result = await create_materials_and_orders(
                session, obra_principal, tasks, suppliers, admin.id, tenant.id
            )
            sol = await create_solicitud(
                session, obra_principal, materials_result, suppliers, admin.id, tenant.id
            )
            await create_budget(session, obra_principal, suppliers, admin.id, tenant.id)
            await create_planos(session, obra_principal, admin.id)
            await create_historial(
                session, obra_principal, tasks, admin.id, collab.id, tenant.id
            )

            print("[12/12] Creando tareas para obras secundarias…")
            await create_simple_tasks(
                session, obra_planificada, obra_completada, responsibles
            )

    # ── HOJA DE RUTA PARA LA DEMO ─────────────────────────────────────────────
    width = 65
    print("\n" + "=" * width)
    print("  HOJA DE RUTA PARA LA DEMO")
    print("=" * width)
    print(f"""
CREDENCIALES DE LOGIN
  URL:       http://localhost:5173
  Email:     {DEMO_ADMIN_EMAIL}
  Password:  {DEMO_ADMIN_PASSWORD}
  Rol:       Admin (acceso completo)

OBRA PRINCIPAL A ABRIR
  → "Edificio Residencial Las Acacias"
    (Av. Hipólito Yrigoyen 1250, Nueva Córdoba)
    Estado: EN PROGRESO — cliente: Desarrolladora Acacias SA

QUÉ MOSTRAR EN CADA TAB
  Tab RESUMEN
    • Completitud de la obra (imagen, comitente, equipo, tareas, fechas)
    • Comitente: Desarrolladora Acacias SA
    • Equipo: 6 personas asignadas con disciplinas

  Tab GANTT
    • Toggle "Mostrar línea base": tareas 2.3, 3.1 y 3.2 se ven
      desplazadas respecto al plan original (7 días de desvío)
    • Toggle "Ruta crítica": resaltado automático del camino crítico
    • Flechas SVG de dependencias — 4 tipos: FS, SS, FF, SF
    • Tarea padre 2. Estructura → colapsar/expandir subtareas

  Tab TAREAS — TAREAS BLOQUEADAS PARA MOSTRAR
    1. "2.4 Encofrado y hormigonado 1er piso"  (bloqueada, espera curado PB)
    2. "3.2 Cañería sanitaria PB"              (bloqueada, interferencia C3)
    → Ambas tienen alertas sin leer en el panel de Alertas

  Tab ALERTAS
    • 3 alertas sin leer: task_blocked (×2) + reschedule_requested (×1)
    • Tipos cubiertos: task_blocked, delay_risk, task_overdue,
      no_response, reschedule_requested, order_received

  Tab BITÁCORA
    • Entrada 3 ("Reunión proveedor hierros") → status: PENDIENTE_SUGERENCIA
      → Mostrar flujo APLICAR / DESCARTAR sugerencia en vivo
      → Sugerencias pendientes:
          1. Registrar diferencia de 20 kg en historial de materiales
          2. Programar tarea 'Ensayo de rotura de probetas'

  Tab HISTORIAL
    • 10 eventos reales (chatbot, user, system) con payload JSON

  Tab PRESUPUESTO (Pestaña general de la obra)
    • Solicitud SC-2024-003 → "respondida" → 2 proveedores cotizaron
      → Cerámica Villanueva: $3.689.000 (sin inconsistencias)
      → Ferretería El Tornillo: $3.498.750 (inconsistencia: stock insuficiente)
    • Presupuesto de hormigón → inconsistencia grave de IVA detectada por IA

  Tab COMPRAS
    • OC-2024-001: RECIBIDA (Tornillo, hierros — con diferencia de 20 kg)
    • OC-2024-002: ENVIADA  (ElectroInsumos, materiales eléctricos)

  Tab PLANOS
    • Disciplina "estructura": 2 versiones (Rev. A reemplazada, Rev. B vigente)
    • Disciplina "electricidad": 1 versión
    • Disciplina "sanitarios": 1 versión (nota de interferencia C3)

OTRAS OBRAS EN EL PORTFOLIO
  • "Local Comercial Centro Histórico" → PLANIFICADA (recién creada, 4 tareas)
  • "Vivienda Familiar Barrio Jardín"  → COMPLETADA  (7 tareas, todas completas)

NÚMEROS WHATSAPP (placeholders Twilio test sandbox)
  Carlos Méndez   +15005550001   María González   +15005550002
  Roberto Flores  +15005550003   Ana Rodríguez    +15005550004
  Diego Sánchez   +15005550005   Lucía Fernández  +15005550006
""")
    print("=" * width)
    print("  ✅  Datos de demo cargados correctamente.")
    print("=" * width + "\n")


if __name__ == "__main__":
    asyncio.run(main())
