import type { HistorialEvento } from "../types";
import { apiClient } from "./client";

// docs/auditoria/07-historial.md, hallazgo 7.2/8.3: el límite de 30 hacía que
// el tab mostrara "30 eventos" como si fuera el total en cualquier obra con
// más actividad, sin ningún indicador de que había más. El servidor acepta
// hasta 200; 100 cubre la enorme mayoría de obras sin agregar paginación real.
export async function fetchHistorial(
  obraId: number,
  limit = 100
): Promise<HistorialEvento[]> {
  const { data } = await apiClient.get<HistorialEvento[]>(
    `/obras/${obraId}/historial`,
    { params: { limit } }
  );
  return data;
}

export async function fetchGlobalHistorial(limit = 100): Promise<HistorialEvento[]> {
  const { data } = await apiClient.get<HistorialEvento[]>(
    "/obras/historial/global",
    { params: { limit } }
  );
  return data;
}
