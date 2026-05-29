import type { Alert } from "../types";
import { apiClient } from "./client";

export async function fetchAlerts(unreadOnly = false): Promise<Alert[]> {
  const { data } = await apiClient.get<Alert[]>("/alerts", {
    params: { unread_only: unreadOnly },
  });
  return data;
}

export async function markAlertRead(alertId: number): Promise<Alert> {
  const { data } = await apiClient.patch<Alert>(`/alerts/${alertId}/read`);
  return data;
}
