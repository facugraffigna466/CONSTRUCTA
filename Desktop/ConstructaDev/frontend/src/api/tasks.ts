import type { Task } from "../types";
import { apiClient } from "./client";

export async function fetchTasksByObra(obraId: number): Promise<Task[]> {
  const { data } = await apiClient.get<Task[]>(`/tasks/obra/${obraId}`);
  return data;
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
  dependency_ids?: number[];
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
  dependency_ids?: number[];
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
