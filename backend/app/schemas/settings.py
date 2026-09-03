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

    # ── Detección de riesgo (una regla por toggle + su umbral) ────────────────
    risk_critical_task_delayed: bool
    risk_critical_delay_lookahead_days: int
    risk_float_shrinking: bool
    risk_float_threshold_days: int
    risk_baseline_deviation: bool
    risk_baseline_deviation_days: int
    risk_material_pending: bool
    risk_material_pending_days: int
    risk_order_no_confirmation: bool
    risk_order_confirmation_days: int
    risk_material_blocking_task: bool
    risk_material_blocking_days: int
    risk_progress_stalled: bool
    risk_progress_stalled_days: int
    risk_deadline_holiday: bool
    risk_holiday_lookahead_days: int
    risk_recurring_blocker: bool
    risk_recurring_blocker_count: int
    risk_chronic_no_response: bool
    risk_chronic_no_response_count: int
    risk_chronic_no_response_window_days: int
    risk_milestone_at_risk: bool
    risk_milestone_lookahead_days: int

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

    # ── Detección de riesgo (una regla por toggle + su umbral) ────────────────
    risk_critical_task_delayed: bool | None = None
    risk_critical_delay_lookahead_days: int | None = None
    risk_float_shrinking: bool | None = None
    risk_float_threshold_days: int | None = None
    risk_baseline_deviation: bool | None = None
    risk_baseline_deviation_days: int | None = None
    risk_material_pending: bool | None = None
    risk_material_pending_days: int | None = None
    risk_order_no_confirmation: bool | None = None
    risk_order_confirmation_days: int | None = None
    risk_material_blocking_task: bool | None = None
    risk_material_blocking_days: int | None = None
    risk_progress_stalled: bool | None = None
    risk_progress_stalled_days: int | None = None
    risk_deadline_holiday: bool | None = None
    risk_holiday_lookahead_days: int | None = None
    risk_recurring_blocker: bool | None = None
    risk_recurring_blocker_count: int | None = None
    risk_chronic_no_response: bool | None = None
    risk_chronic_no_response_count: int | None = None
    risk_chronic_no_response_window_days: int | None = None
    risk_milestone_at_risk: bool | None = None
    risk_milestone_lookahead_days: int | None = None

    company_name: str | None = None
    main_responsible: str | None = None
    company_email: str | None = None
    company_phone: str | None = None


class SystemHealth(BaseModel):
    backend: bool
    database: bool
    whatsapp_configured: bool
    whatsapp_number: str | None
