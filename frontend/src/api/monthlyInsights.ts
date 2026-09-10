import { apiClient } from "./client";
import type { MonthlyInsights } from "../types";

export async function fetchMonthlyInsights(obraId: number): Promise<MonthlyInsights> {
  const { data } = await apiClient.get<MonthlyInsights>(`/obras/${obraId}/dashboard/monthly-insights`);
  return data;
}
