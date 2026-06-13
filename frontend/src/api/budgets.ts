import { apiClient } from "./client";
import type { Budget, BudgetComparison } from "../types";

export async function fetchBudgets(obraId?: number): Promise<Budget[]> {
  const { data } = await apiClient.get<Budget[]>("/budgets", {
    params: obraId != null ? { obra_id: obraId } : {},
  });
  return data;
}

export async function getBudget(id: number): Promise<Budget> {
  const { data } = await apiClient.get<Budget>(`/budgets/${id}`);
  return data;
}

export async function createBudgetFromText(payload: {
  text: string;
  obra_id?: number | null;
  supplier_name?: string | null;
}): Promise<Budget> {
  const { data } = await apiClient.post<Budget>("/budgets/text", payload);
  return data;
}

export async function uploadBudget(
  file: File,
  opts?: { obra_id?: number | null; supplier_name?: string | null },
): Promise<Budget> {
  const form = new FormData();
  form.append("file", file);
  if (opts?.obra_id != null) form.append("obra_id", String(opts.obra_id));
  if (opts?.supplier_name) form.append("supplier_name", opts.supplier_name);
  const { data } = await apiClient.post<Budget>("/budgets/upload", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export async function deleteBudget(id: number): Promise<void> {
  await apiClient.delete(`/budgets/${id}`);
}

export async function compareBudgets(budgetIds: number[]): Promise<BudgetComparison> {
  const { data } = await apiClient.post<BudgetComparison>("/budgets/compare", { budget_ids: budgetIds });
  return data;
}
