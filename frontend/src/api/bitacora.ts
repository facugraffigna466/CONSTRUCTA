import { apiClient } from "./client";
import type { Suggestion } from "./suggestions";

// La sugerencia dejó de ser un objeto anidado en la entrada: es entidad propia
// con id (migración 0072). Vive en `api/suggestions.ts`; acá solo se reexporta
// con el nombre que ya usaban las pantallas de bitácora.
export type { Suggestion as BitacoraSuggestion } from "./suggestions";

export interface BitacoraEntry {
  id: number;
  obra_id: number | null;
  obra_name: string | null;
  responsible_id: number | null;
  responsible_name: string | null;
  created_by: number | null;
  source: "web" | "whatsapp";
  audio_path: string | null;
  audio_url: string | null;  // ruta relativa firmada (/uploads/<name>?exp=..&sig=..)
  transcript: string | null;
  summary: string | null;
  key_points: string[] | null;
  suggestions: Suggestion[] | null;
  status: "pendiente_transcripcion" | "pendiente_analisis" | "pendiente_obra" | "procesado" | "error";
  error: string | null;
  created_at: string;
  processed_at: string | null;
}

export async function fetchBitacora(
  obraId?: number, limit?: number, offset?: number
): Promise<BitacoraEntry[]> {
  const params: Record<string, number> = {};
  if (obraId) params.obra_id = obraId;
  if (limit != null) params.limit = limit;
  if (offset != null) params.offset = offset;
  const { data } = await apiClient.get<BitacoraEntry[]>("/bitacora", { params });
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

// Aplicar y descartar viven en `api/suggestions.ts`: se direccionan por id de
// sugerencia, no por su posición dentro de la nota. Las rutas por índice siguen
// en el backend para compatibilidad, pero la interfaz ya no las usa.

export async function deleteEntry(entryId: number): Promise<void> {
  await apiClient.delete(`/bitacora/${entryId}`);
}
