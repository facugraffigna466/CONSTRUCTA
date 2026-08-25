import type { ObraTeamMember } from "../types";
import { apiClient } from "./client";

export async function fetchObraTeam(obraId: number): Promise<ObraTeamMember[]> {
  const { data } = await apiClient.get<ObraTeamMember[]>(`/obras/${obraId}/team`);
  return data;
}

export async function addObraTeamMember(obraId: number, payload: {
  responsible_id?: number;
  full_name?: string;
  whatsapp_number?: string;
  role?: string | null;
  plan_disciplines?: string[] | null;
}): Promise<ObraTeamMember> {
  const { data } = await apiClient.post<ObraTeamMember>(`/obras/${obraId}/team`, payload);
  return data;
}

export async function updateObraTeamMember(obraId: number, responsibleId: number, payload: {
  role?: string | null;
  plan_disciplines?: string[] | null;
}): Promise<ObraTeamMember> {
  const { data } = await apiClient.patch<ObraTeamMember>(`/obras/${obraId}/team/${responsibleId}`, payload);
  return data;
}

export async function removeObraTeamMember(obraId: number, responsibleId: number): Promise<void> {
  await apiClient.delete(`/obras/${obraId}/team/${responsibleId}`);
}
