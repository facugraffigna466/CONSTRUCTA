import { apiClient } from "./client";

/**
 * Sugerencias de IA sobre el plan de obra.
 *
 * Desde la migración 0072 la sugerencia tiene id propio: se puede pedir y
 * resolver desde cualquier pantalla, sin conocer la nota de bitácora que la
 * originó. `entry_summary` y `reporter_name` traen ese origen para las
 * pantallas que no lo tienen alrededor (la tarjeta dentro de una tarea).
 */

export type SuggestionType = "reschedule_task" | "create_task" | "update_status" | "note";
export type SuggestionStatus = "pendiente" | "aplicada" | "descartada";

export interface Suggestion {
  id: number;
  obra_id: number | null;
  source: string;
  source_entry_id: number | null;
  order_index: number;
  type: SuggestionType;
  task_id: number | null;
  task_title: string | null;
  new_start_date: string | null;
  new_due_date: string | null;
  new_status: string | null;
  new_progress: number | null;
  title: string | null;
  description: string | null;
  responsible_name: string | null;
  reason: string;
  status: SuggestionStatus;
  result_task_id: number | null;
  result_note: string | null;
  resolved_by: number | null;
  resolved_at: string | null;
  created_at: string;
  // Derivados de `status`, para no razonar sobre el enum en cada pantalla.
  applied: boolean;
  dismissed: boolean;
  // Contexto de origen.
  obra_name: string | null;
  entry_summary: string | null;
  reporter_name: string | null;
}

export interface SuggestionEdit {
  new_start_date?: string | null;
  new_due_date?: string | null;
  new_status?: string | null;
  new_progress?: number | null;
  title?: string | null;
  responsible_name?: string | null;
  description?: string | null;
}

export async function fetchObraSuggestions(
  obraId: number, status?: SuggestionStatus,
): Promise<Suggestion[]> {
  const { data } = await apiClient.get<Suggestion[]>("/suggestions", {
    params: status ? { obra_id: obraId, status } : { obra_id: obraId },
  });
  return data;
}

export async function fetchTaskSuggestions(
  taskId: number, status?: SuggestionStatus,
): Promise<Suggestion[]> {
  const { data } = await apiClient.get<Suggestion[]>(`/tasks/${taskId}/suggestions`, {
    params: status ? { status } : undefined,
  });
  return data;
}

export async function fetchSuggestionsPendingCount(obraId?: number): Promise<number> {
  const { data } = await apiClient.get<{ count: number }>("/suggestions/pending-count", {
    params: obraId ? { obra_id: obraId } : undefined,
  });
  return data.count;
}

export async function applySuggestion(
  suggestionId: number, edits?: SuggestionEdit,
): Promise<Suggestion> {
  const { data } = await apiClient.post<Suggestion>(
    `/suggestions/${suggestionId}/apply`, edits ?? undefined,
  );
  return data;
}

export async function dismissSuggestion(suggestionId: number): Promise<Suggestion> {
  const { data } = await apiClient.post<Suggestion>(`/suggestions/${suggestionId}/dismiss`);
  return data;
}
