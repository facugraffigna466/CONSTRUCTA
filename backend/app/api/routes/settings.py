from fastapi import APIRouter
from sqlalchemy import text

from app.core.config import settings as app_settings
from app.core.deps import AdminUser, DbSession
from app.repositories.settings import SettingsRepository
from app.schemas.settings import SettingsPatch, SettingsRead, SystemHealth

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("", response_model=SettingsRead)
async def get_settings(db: DbSession, current_user: AdminUser) -> SettingsRead:
    obj = await SettingsRepository(db).get_or_create(current_user.tenant_id)
    return SettingsRead.model_validate(obj)


@router.patch("", response_model=SettingsRead)
async def patch_settings(
    data: SettingsPatch, db: DbSession, current_user: AdminUser
) -> SettingsRead:
    updates = data.model_dump(exclude_none=True)
    obj = await SettingsRepository(db).update(current_user.tenant_id, updates)
    return SettingsRead.model_validate(obj)


@router.get("/system-health", response_model=SystemHealth)
async def system_health(db: DbSession, _: AdminUser) -> SystemHealth:
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
