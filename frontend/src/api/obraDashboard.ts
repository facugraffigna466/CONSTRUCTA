import { apiClient } from "./client";
import type { ObraDashboard } from "../types";

export async function fetchObraDashboard(obraId: number): Promise<ObraDashboard> {
  const { data } = await apiClient.get<ObraDashboard>(`/obras/${obraId}/dashboard`);
  return data;
}
