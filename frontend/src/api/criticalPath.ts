import { apiClient } from "./client";

export interface CriticalPathResult {
  critical_task_ids: number[];
  float_by_task: Record<string, number>;
  /** Tareas excluidas del CPM por no tener fechas (para avisar que el resultado es parcial). */
  tasks_without_dates?: number[];
}

export async function fetchCriticalPath(obraId: number): Promise<CriticalPathResult> {
  const { data } = await apiClient.get<CriticalPathResult>(`/obras/${obraId}/critical-path`);
  return data;
}
