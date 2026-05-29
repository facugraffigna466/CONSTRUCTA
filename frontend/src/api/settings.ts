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

export async function testWhatsApp(phoneNumber: string): Promise<{ success: boolean; detail?: string }> {
  const { data } = await apiClient.post("/settings/test-whatsapp", {
    phone_number: phoneNumber,
  });
  return data;
}

export async function simulateOverdue(): Promise<{ alerts_created: number }> {
  const { data } = await apiClient.post<{ alerts_created: number }>(
    "/settings/simulate-overdue"
  );
  return data;
}
