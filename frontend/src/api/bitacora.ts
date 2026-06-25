import { apiClient } from "./client";

export interface BitacoraSuggestion {
  type: "reschedule_task" | "create_task" | "update_status" | "note";
  task_id: number | null;
  task_title: string | null;
  new_start_date: string | null;
  new_due_date: string | null;
  new_status: string | null;
  title: string | null;
  description: string | null;
  responsible_name: string | null;
  reason: string;
  applied: boolean;
  dismissed: boolean;
  result_task_id: number | null;
  result_note: string | null;
}

export interface BitacoraEntry {
  id: number;
  obra_id: number | null;
  obra_name: string | null;
  responsible_id: number | null;
  responsible_name: string | null;
  created_by: number | null;
  source: "web" | "whatsapp";
  audio_path: string | null;
  transcript: string | null;
  summary: string | null;
  key_points: string[] | null;
  suggestions: BitacoraSuggestion[] | null;
  status: "pendiente_transcripcion" | "pendiente_analisis" | "pendiente_obra" | "procesado" | "error";
  error: string | null;
  created_at: string;
  processed_at: string | null;
}

export async function fetchBitacora(obraId?: number): Promise<BitacoraEntry[]> {
  const { data } = await apiClient.get<BitacoraEntry[]>("/bitacora", {
    params: obraId ? { obra_id: obraId } : undefined,
  });
  return data;
}

export async function fetchBitacoraUnassigned(): Promise<BitacoraEntry[]> {
  const { data } = await apiClient.get<BitacoraEntry[]>("/bitacora/unassigned");
  return data;
}

export async function fetchTaskBitacora(taskId: number): Promise<BitacoraEntry[]> {
  const { data } = await apiClient.get<BitacoraEntry[]>(`/tasks/${taskId}/bitacora`);
  return data;
}

export async function fetchBitacoraPendingCount(obraId?: number): Promise<number> {
  const { data } = await apiClient.get<{ count: number }>("/bitacora/pending-count", {
    params: obraId ? { obra_id: obraId } : undefined,
  });
  return data.count;
}

export async function createAudioEntry(obraId: number, file: File | Blob, filename = "audio.webm"): Promise<BitacoraEntry> {
  const form = new FormData();
  form.append("file", file, file instanceof File ? file.name : filename);
  const { data } = await apiClient.post<BitacoraEntry>(`/obras/${obraId}/bitacora/audio`, form, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 180_000, // transcripción + análisis pueden tardar
  });
  return data;
}

export async function createTextEntry(obraId: number, text: string): Promise<BitacoraEntry> {
  const { data } = await apiClient.post<BitacoraEntry>(`/obras/${obraId}/bitacora/texto`, { text }, { timeout: 120_000 });
  return data;
}

export async function setTranscript(entryId: number, text: string): Promise<BitacoraEntry> {
  const { data } = await apiClient.post<BitacoraEntry>(`/bitacora/${entryId}/transcript`, { text }, { timeout: 120_000 });
  return data;
}

export async function reprocessEntry(entryId: number): Promise<BitacoraEntry> {
  const { data } = await apiClient.post<BitacoraEntry>(`/bitacora/${entryId}/reprocess`, undefined, { timeout: 180_000 });
  return data;
}

export async function assignObra(entryId: number, obraId: number): Promise<BitacoraEntry> {
  const { data } = await apiClient.post<BitacoraEntry>(`/bitacora/${entryId}/obra`, { obra_id: obraId }, { timeout: 120_000 });
  return data;
}

export interface SuggestionEdit {
  new_start_date?: string | null;
  new_due_date?: string | null;
  new_status?: string | null;
  title?: string | null;
  responsible_name?: string | null;
}

export async function applySuggestion(
  entryId: number, index: number, edits?: SuggestionEdit,
): Promise<BitacoraEntry> {
  const { data } = await apiClient.post<BitacoraEntry>(
    `/bitacora/${entryId}/suggestions/${index}/apply`,
    edits ?? undefined,
  );
  return data;
}

export async function dismissSuggestion(entryId: number, index: number): Promise<BitacoraEntry> {
  const { data } = await apiClient.post<BitacoraEntry>(`/bitacora/${entryId}/suggestions/${index}/dismiss`);
  return data;
}

export async function deleteEntry(entryId: number): Promise<void> {
  await apiClient.delete(`/bitacora/${entryId}`);
}
