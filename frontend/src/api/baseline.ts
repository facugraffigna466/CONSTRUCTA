import { apiClient } from "./client";

export interface BaselineEntry {
  task_id: number;
  baseline_start: string | null;
  baseline_finish: string | null;
}

export interface BaselineResponse {
  obra_id: number;
  saved_at: string | null;
  entries: BaselineEntry[];
}

export async function saveBaseline(obraId: number): Promise<BaselineResponse> {
  const { data } = await apiClient.post<BaselineResponse>(`/obras/${obraId}/baseline`);
  return data;
}

export async function fetchBaseline(obraId: number): Promise<BaselineResponse> {
  const { data } = await apiClient.get<BaselineResponse>(`/obras/${obraId}/baseline`);
  return data;
}
