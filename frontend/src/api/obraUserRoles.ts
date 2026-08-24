import { apiClient } from "./client";
import type { ObraUserRoleType } from "./users";

export interface ObraUserRoleRow {
  user_id: number;
  user_full_name: string;
  user_email: string;
  role: ObraUserRoleType;
}

export async function fetchObraUserRoles(obraId: number): Promise<ObraUserRoleRow[]> {
  const { data } = await apiClient.get<ObraUserRoleRow[]>(`/obras/${obraId}/user-roles`);
  return data;
}

export async function assignObraUserRole(
  obraId: number,
  userId: number,
  role: ObraUserRoleType,
): Promise<ObraUserRoleRow> {
  const { data } = await apiClient.post<ObraUserRoleRow>(
    `/obras/${obraId}/user-roles`,
    { user_id: userId, role },
  );
  return data;
}

export async function updateObraUserRole(
  obraId: number,
  userId: number,
  role: ObraUserRoleType,
): Promise<ObraUserRoleRow> {
  const { data } = await apiClient.patch<ObraUserRoleRow>(
    `/obras/${obraId}/user-roles/${userId}`,
    { role },
  );
  return data;
}

export async function removeObraUserRole(obraId: number, userId: number): Promise<void> {
  await apiClient.delete(`/obras/${obraId}/user-roles/${userId}`);
}
