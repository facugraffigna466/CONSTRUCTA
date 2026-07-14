import type { DependencyType, Task } from "../types";
import { apiClient } from "./client";

export async function fetchTasksByObra(obraId: number): Promise<Task[]> {
  const { data } = await apiClient.get<Task[]>(`/tasks/obra/${obraId}`);
  return data;
}

export interface DependencyLinkInput {
  depends_on_id: number;
  dependency_type?: DependencyType;
  lag_days?: number;
}

export interface TaskCreatePayload {
  obra_id: number;
  title: string;
  description?: string | null;
  responsible_id?: number | null;
  start_date?: string | null;
  start_time?: string | null;
  due_date?: string | null;
  due_time?: string | null;
  order_index?: number;
  parent_task_id?: number | null;
  dependency_links?: DependencyLinkInput[] | null;
  is_milestone?: boolean;
  estimated_progress?: number;
}

export async function createTask(payload: TaskCreatePayload): Promise<Task> {
  const { data } = await apiClient.post<Task>("/tasks", payload);
  return data;
}

export interface TaskUpdatePayload {
  title?: string;
  description?: string | null;
  responsible_id?: number | null;
  start_date?: string | null;
  start_time?: string | null;
  due_date?: string | null;
  due_time?: string | null;
  order_index?: number;
  parent_task_id?: number | null;
  dependency_links?: DependencyLinkInput[] | null;
  is_milestone?: boolean;
  estimated_progress?: number;
  cascade_dates?: boolean;
}

export async function updateTask(
  id: number,
  payload: TaskUpdatePayload
): Promise<Task> {
  const { cascade_dates, ...rest } = payload;
  const params = cascade_dates ? { cascade_dates: true } : undefined;
  const { data } = await apiClient.patch<Task>(`/tasks/${id}`, rest, { params });
  return data;
}

export interface BulkTaskRow {
  title: string;
  start_date?: string | null;
  due_date?: string | null;
  responsible_id?: number | null;
  depends_on_row?: number | null;
}

export interface BulkTaskResult {
  created: number;
  failed: number;
  errors: string[];
  task_ids: (number | null)[];
}

export async function bulkCreateTasks(obraId: number, rows: BulkTaskRow[]): Promise<BulkTaskResult> {
  const { data } = await apiClient.post<BulkTaskResult>(`/tasks/obra/${obraId}/bulk`, { rows }, { timeout: 120_000 });
  return data;
}

export interface CascadeAffectedTask {
  task_id: number;
  title: string;
  old_start: string | null;
  old_due: string | null;
  new_start: string | null;
  new_due: string | null;
}

export async function fetchCascadePreview(
  taskId: number,
  newDates: { start_date: string | null; due_date: string | null },
): Promise<CascadeAffectedTask[]> {
  const { data } = await apiClient.post<{ affected: CascadeAffectedTask[] }>(
    `/tasks/${taskId}/cascade-preview`,
    newDates,
  );
  return data.affected;
}

export async function updateTaskStatus(
  id: number,
  status: string,
): Promise<Task> {
  const { data } = await apiClient.post<Task>(`/tasks/${id}/status`, {
    status,
    triggered_by: "user",
  });
  return data;
}

export async function deleteTask(id: number): Promise<void> {
  await apiClient.delete(`/tasks/${id}`);
}

/** Reordena las tareas de una obra (lista de IDs en el orden deseado). */
export async function reorderTasks(obraId: number, taskIds: number[]): Promise<void> {
  await apiClient.post(`/tasks/obra/${obraId}/reorder`, { task_ids: taskIds });
}
