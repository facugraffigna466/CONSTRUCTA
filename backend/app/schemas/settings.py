from pydantic import BaseModel


class SettingsRead(BaseModel):
    chatbot_enabled: bool
    send_hour_from: int
    send_hour_to: int
    max_response_hours: int
    auto_reminders: bool
    reminder_3days: bool
    reminder_1day: bool
    alert_overdue: bool
    alert_no_response: bool
    retry_failed: bool
    notify_task_overdue: bool
    notify_task_blocked: bool
    notify_no_response: bool
    notify_rescheduled: bool
    company_name: str | None
    main_responsible: str | None
    company_email: str | None
    company_phone: str | None

    model_config = {"from_attributes": True}


class SettingsPatch(BaseModel):
    chatbot_enabled: bool | None = None
    send_hour_from: int | None = None
    send_hour_to: int | None = None
    max_response_hours: int | None = None
    auto_reminders: bool | None = None
    reminder_3days: bool | None = None
    reminder_1day: bool | None = None
    alert_overdue: bool | None = None
    alert_no_response: bool | None = None
    retry_failed: bool | None = None
    notify_task_overdue: bool | None = None
    notify_task_blocked: bool | None = None
    notify_no_response: bool | None = None
    notify_rescheduled: bool | None = None
    company_name: str | None = None
    main_responsible: str | None = None
    company_email: str | None = None
    company_phone: str | None = None


class SystemHealth(BaseModel):
    backend: bool
    database: bool
    whatsapp_configured: bool
    whatsapp_number: str | None


class TestWhatsAppRequest(BaseModel):
    phone_number: str
