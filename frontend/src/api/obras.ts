import type { Obra } from "../types";
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
}

export async function createObra(payload: ObraCreatePayload): Promise<Obra> {
  const { data } = await apiClient.post<Obra>("/obras", payload);
  return data;
}
