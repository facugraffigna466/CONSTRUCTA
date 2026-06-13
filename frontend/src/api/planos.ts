import { apiClient } from "./client";
import type { Plano } from "../types";

export async function fetchPlanos(obraId: number): Promise<Plano[]> {
  const { data } = await apiClient.get<Plano[]>(`/obras/${obraId}/planos`);
  return data;
}

export async function uploadPlano(
  obraId: number,
  file: File,
  opts: { discipline: string; name?: string | null; notes?: string | null },
): Promise<Plano> {
  const form = new FormData();
  form.append("file", file);
  form.append("discipline", opts.discipline);
  if (opts.name) form.append("name", opts.name);
  if (opts.notes) form.append("notes", opts.notes);
  const { data } = await apiClient.post<Plano>(`/obras/${obraId}/planos`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export async function deletePlano(planoId: number): Promise<void> {
  await apiClient.delete(`/planos/${planoId}`);
}
