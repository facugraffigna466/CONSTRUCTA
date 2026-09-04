import { apiClient } from "./client";

export interface SystemSettings {
  chatbot_enabled: boolean;
  send_hour_from: number;
  send_hour_to: number;
  max_response_hours: number;
  auto_reminders: boolean;
  reminder_3days: boolean;
  reminder_1day: boolean;
  alert_overdue: boolean;
  alert_no_response: boolean;
  retry_failed: boolean;
  notify_task_overdue: boolean;
  notify_task_blocked: boolean;
  notify_no_response: boolean;
  notify_rescheduled: boolean;

  // Detección de riesgo — un toggle por regla + su umbral.
  risk_critical_task_delayed: boolean;
  risk_critical_delay_lookahead_days: number;
  risk_float_shrinking: boolean;
  risk_float_threshold_days: number;
  risk_baseline_deviation: boolean;
  risk_baseline_deviation_days: number;
  risk_material_pending: boolean;
  risk_material_pending_days: number;
  risk_order_no_confirmation: boolean;
  risk_order_confirmation_days: number;
  risk_material_blocking_task: boolean;
  risk_material_blocking_days: number;
  risk_progress_stalled: boolean;
  risk_progress_stalled_days: number;
  risk_deadline_holiday: boolean;
  risk_holiday_lookahead_days: number;
  risk_recurring_blocker: boolean;
  risk_recurring_blocker_count: number;
  risk_chronic_no_response: boolean;
  risk_chronic_no_response_count: number;
  risk_chronic_no_response_window_days: number;
  risk_whatsapp_critical: boolean;
  risk_milestone_at_risk: boolean;
  risk_milestone_lookahead_days: number;

  company_name: string | null;
  main_responsible: string | null;
  company_email: string | null;
  company_phone: string | null;
}

export interface SystemHealth {
  backend: boolean;
  database: boolean;
  whatsapp_configured: boolean;
  whatsapp_number: string | null;
}

export async function fetchSettings(): Promise<SystemSettings> {
  const { data } = await apiClient.get<SystemSettings>("/settings");
  return data;
}

export async function patchSettings(
  updates: Partial<SystemSettings>
): Promise<SystemSettings> {
  const { data } = await apiClient.patch<SystemSettings>("/settings", updates);
  return data;
}

export async function fetchSystemHealth(): Promise<SystemHealth> {
  const { data } = await apiClient.get<SystemHealth>("/settings/system-health");
  return data;
}
