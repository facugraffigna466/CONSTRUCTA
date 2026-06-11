import type { PlanUsage } from "../types";
import { apiClient } from "./client";

export async function fetchPlanUsage(): Promise<PlanUsage> {
  const { data } = await apiClient.get<PlanUsage>("/admin/usage");
  return data;
}
