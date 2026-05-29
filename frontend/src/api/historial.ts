import type { HistorialEvento } from "../types";
import { apiClient } from "./client";

export async function fetchHistorial(
  obraId: number,
  limit = 30
): Promise<HistorialEvento[]> {
  const { data } = await apiClient.get<HistorialEvento[]>(
    `/obras/${obraId}/historial`,
    { params: { limit } }
  );
  return data;
}
