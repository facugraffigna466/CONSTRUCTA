import type { Responsible } from "../types";
import { apiClient } from "./client";

export interface ResponsibleCreatePayload {
  full_name: string;
  whatsapp_number: string;
  role?: string | null;
}

export async function createResponsible(
  payload: ResponsibleCreatePayload
): Promise<Responsible> {
  const { data } = await apiClient.post<Responsible>("/responsibles", payload);
  return data;
}

export async function fetchResponsibles(): Promise<Responsible[]> {
  const { data } = await apiClient.get<Responsible[]>("/responsibles");
  return data;
}

export interface ResponsibleUpdatePayload {
  full_name?: string;
  role?: string | null;
}

export async function updateResponsible(
  id: number,
  payload: ResponsibleUpdatePayload
): Promise<Responsible> {
  const { data } = await apiClient.patch<Responsible>(`/responsibles/${id}`, payload);
  return data;
}

export async function deactivateResponsible(id: number): Promise<Responsible> {
  const { data } = await apiClient.delete<Responsible>(`/responsibles/${id}`);
  return data;
}

export async function reactivateResponsible(id: number): Promise<Responsible> {
  const { data } = await apiClient.patch<Responsible>(`/responsibles/${id}/reactivate`);
  return data;
}
