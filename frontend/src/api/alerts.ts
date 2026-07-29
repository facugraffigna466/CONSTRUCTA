import type { Alert } from "../types";
import { apiClient } from "./client";

export async function fetchAlerts(
  unreadOnly = false,
  obraId?: number,
  limit?: number,
): Promise<Alert[]> {
  const params: Record<string, unknown> = { unread_only: unreadOnly };
  if (obraId != null) params.obra_id = obraId;   // filtra por obra en el servidor
  if (limit != null) params.limit = limit;
  const { data } = await apiClient.get<Alert[]>("/alerts", { params });
  return data;
}

export async function markAlertRead(alertId: number): Promise<Alert> {
  const { data } = await apiClient.patch<Alert>(`/alerts/${alertId}/read`);
  return data;
}

export async function markAllAlertsRead(obraId?: number): Promise<Alert[]> {
  const { data } = await apiClient.patch<Alert[]>("/alerts/mark-all-read", null, {
    params: obraId != null ? { obra_id: obraId } : {},
  });
  return data;
}
