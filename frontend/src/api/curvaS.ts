import { apiClient } from "./client";
import type { CurvaSResponse } from "../types";

export async function fetchCurvaS(obraId: number): Promise<CurvaSResponse> {
  const { data } = await apiClient.get<CurvaSResponse>(`/obras/${obraId}/dashboard/curva-s`);
  return data;
}
