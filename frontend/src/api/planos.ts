import { apiClient } from "./client";
import type { Plano } from "../types";

export async function fetchPlanos(obraId: number): Promise<Plano[]> {
  const { data } = await apiClient.get<Plano[]>(`/obras/${obraId}/planos`);
  return data;
}

export async function uploadPlano(
  obraId: number,
  file: File,
  opts: {
    discipline: string;
    name?: string | null;
    notes?: string | null;
    /** Sube el archivo como nueva versión de este plano: hereda su disciplina y
     *  sector, y queda vigente. */
    replacesPlanoId?: number | null;
  },
): Promise<Plano> {
  const form = new FormData();
  form.append("file", file);
  form.append("discipline", opts.discipline);
  if (opts.name) form.append("name", opts.name);
  if (opts.notes) form.append("notes", opts.notes);
  if (opts.replacesPlanoId) form.append("replaces_plano_id", String(opts.replacesPlanoId));
  const { data } = await apiClient.post<Plano>(`/obras/${obraId}/planos`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

/** Marca este plano como el vigente de su grupo (admin). */
export async function setPlanoVigente(planoId: number): Promise<Plano> {
  const { data } = await apiClient.patch<Plano>(`/planos/${planoId}/vigente`);
  return data;
}

export async function deletePlano(planoId: number): Promise<void> {
  await apiClient.delete(`/planos/${planoId}`);
}
