from fastapi import APIRouter
from sqlalchemy import text

from app.core.config import settings as app_settings
from app.core.deps import CurrentUserId, DbSession
from app.integrations.twilio.client import send_whatsapp_message
from app.repositories.settings import SettingsRepository
from app.schemas.settings import (
    SettingsPatch,
    SettingsRead,
    SystemHealth,
    TestWhatsAppRequest,
)
from app.services.notification_service import NotificationService

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("", response_model=SettingsRead)
async def get_settings(db: DbSession, manager_id: CurrentUserId) -> SettingsRead:
    obj = await SettingsRepository(db).get_or_create(manager_id)
    return SettingsRead.model_validate(obj)


@router.patch("", response_model=SettingsRead)
async def patch_settings(
    data: SettingsPatch, db: DbSession, manager_id: CurrentUserId
) -> SettingsRead:
    updates = data.model_dump(exclude_none=True)
    obj = await SettingsRepository(db).update(manager_id, updates)
    return SettingsRead.model_validate(obj)


@router.get("/system-health", response_model=SystemHealth)
async def system_health(db: DbSession, _: CurrentUserId) -> SystemHealth:
    try:
        await db.execute(text("SELECT 1"))
        db_ok = True
    except Exception:
        db_ok = False

    whatsapp_configured = bool(
        app_settings.TWILIO_ACCOUNT_SID and app_settings.TWILIO_AUTH_TOKEN
    )
    raw = app_settings.TWILIO_WHATSAPP_NUMBER or ""
    whatsapp_number = raw.replace("whatsapp:", "") or None

    return SystemHealth(
        backend=True,
        database=db_ok,
        whatsapp_configured=whatsapp_configured,
        whatsapp_number=whatsapp_number,
    )


@router.post("/test-whatsapp")
async def test_whatsapp(body: TestWhatsAppRequest, _: CurrentUserId) -> dict:
    sid = await send_whatsapp_message(
        body.phone_number,
        "✅ Mensaje de prueba desde CONSTRUCTA. El chatbot está funcionando correctamente.",
    )
    if sid:
        return {"success": True, "sid": sid}
    return {"success": False, "detail": "Twilio no configurado o error al enviar."}


@router.post("/simulate-overdue")
async def simulate_overdue(db: DbSession, _: CurrentUserId) -> dict:
    count = await NotificationService(db).mark_overdue_tasks()
    return {"alerts_created": count}
