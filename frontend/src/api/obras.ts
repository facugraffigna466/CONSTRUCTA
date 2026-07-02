import type { Obra, ObraStatus } from "../types";
import { apiClient } from "./client";

export async function fetchObras(): Promise<Obra[]> {
  const { data } = await apiClient.get<Obra[]>("/obras");
  return data;
}

export async function fetchObra(obraId: number): Promise<Obra> {
  const { data } = await apiClient.get<Obra>(`/obras/${obraId}`);
  return data;
}

export interface ObraCreatePayload {
  name: string;
  location?: string | null;
  description?: string | null;
  image_url?: string | null;
  start_date?: string | null;
  expected_end_date?: string | null;
  client_name?: string | null;
  client_email?: string | null;
  client_phone?: string | null;
}

export async function createObra(payload: ObraCreatePayload): Promise<Obra> {
  const { data } = await apiClient.post<Obra>("/obras", payload);
  return data;
}

/** Cambio manual de estado de la obra (pausar/reactivar/reabrir). */
export async function updateObraStatus(obraId: number, status: ObraStatus): Promise<Obra> {
  const { data } = await apiClient.patch<Obra>(`/obras/${obraId}`, { status });
  return data;
}

/** Borra la obra de forma permanente (cascada a tareas y equipo). */
export async function deleteObra(obraId: number): Promise<void> {
  await apiClient.delete(`/obras/${obraId}`);
}
