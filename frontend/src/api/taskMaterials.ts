import { apiClient } from "./client";
import type { TaskMaterial, MaterialStatus } from "../types";

export interface TaskMaterialCreate {
  name: string;
  quantity?: number | null;
  unit?: string | null;
  unit_price?: number | null;
  supplier_id?: number | null;
  responsible_id?: number | null;
  status?: MaterialStatus;
}

export interface TaskMaterialUpdate {
  name?: string;
  quantity?: number | null;
  unit?: string | null;
  unit_price?: number | null;
  supplier_id?: number | null;
  responsible_id?: number | null;
  status?: MaterialStatus;
}

export async function fetchMaterials(taskId: number): Promise<TaskMaterial[]> {
  const res = await apiClient.get<TaskMaterial[]>(`/tasks/${taskId}/materials`);
  return res.data;
}

export async function createMaterial(taskId: number, data: TaskMaterialCreate): Promise<TaskMaterial> {
  const res = await apiClient.post<TaskMaterial>(`/tasks/${taskId}/materials`, data);
  return res.data;
}

export async function updateMaterial(
  taskId: number,
  materialId: number,
  data: TaskMaterialUpdate
): Promise<TaskMaterial> {
  const res = await apiClient.patch<TaskMaterial>(`/tasks/${taskId}/materials/${materialId}`, data);
  return res.data;
}

export async function deleteMaterial(taskId: number, materialId: number): Promise<void> {
  await apiClient.delete(`/tasks/${taskId}/materials/${materialId}`);
}
