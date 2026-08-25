import { apiClient } from "./client";

export type ObraUserRoleType = "jefe_obra" | "colaborador" | "solo_lectura";

export interface ObraRoleForUser {
  obra_id: number;
  obra_name: string;
  role: ObraUserRoleType;
}

export interface ObraAssignmentInvite {
  obra_id: number;
  role: ObraUserRoleType;
}

export interface ApiUser {
  id: number;
  email: string;
  full_name: string;
  role: "admin" | "collaborator";
  is_active: boolean;
  avatar_url: string | null;
  whatsapp_number?: string | null;
  tenant_name?: string | null; // solo poblado en /users/me
  created_at: string;
  // Asignaciones por-obra del usuario (Fase 3/4). Vacío = no está asignado a
  // ninguna obra (los admin de empresa siempre vienen con [] y se resuelven
  // como superset en el hook).
  obra_roles: ObraRoleForUser[];
}

export async function fetchMe(): Promise<ApiUser> {
  const { data } = await apiClient.get<ApiUser>("/users/me");
  return data;
}

export async function fetchMembers(): Promise<ApiUser[]> {
  const { data } = await apiClient.get<ApiUser[]>("/users");
  return data;
}

export interface InviteResponse {
  invite_token: string;
  invite_url: string;
  obra_assignments: ObraAssignmentInvite[];
}

export async function inviteMember(
  email: string,
  role: "admin" | "collaborator",
  obraAssignments?: ObraAssignmentInvite[] | null,
): Promise<InviteResponse> {
  const payload: Record<string, unknown> = { email, role };
  if (obraAssignments && obraAssignments.length > 0) {
    payload.obra_assignments = obraAssignments;
  }
  const { data } = await apiClient.post<InviteResponse>("/users/invite", payload);
  return data;
}

export interface InviteContext {
  email: string;
  role: string;
  company_name: string | null;
  // Obras a las que el invitado se va a asignar al aceptar. Se hidrata con el
  // nombre de la obra para que la pantalla de accept pueda mostrar "vas a
  // entrar a X obras" antes de tipear la clave.
  obra_assignments: ObraRoleForUser[];
}

export async function fetchInviteContext(token: string): Promise<InviteContext> {
  const { data } = await apiClient.get<InviteContext>(`/auth/invite/${token}`);
  return data;
}

export async function acceptInvite(
  token: string,
  full_name: string,
  password: string
): Promise<{ access_token: string; refresh_token: string }> {
  const { data } = await apiClient.post<{ access_token: string; refresh_token: string }>(
    "/auth/accept-invite",
    { token, full_name, password }
  );
  return data;
}

export async function removeMember(userId: number): Promise<void> {
  await apiClient.delete(`/users/${userId}`);
}

/** Renueva el token de una invitación pendiente (ej. si venció) y reenvía el email. */
export async function resendInvite(userId: number): Promise<InviteResponse> {
  const { data } = await apiClient.post<InviteResponse>(`/users/${userId}/resend-invite`);
  return data;
}

export async function updateMemberRole(userId: number, role: "admin" | "collaborator"): Promise<ApiUser> {
  const { data } = await apiClient.patch<ApiUser>(`/users/${userId}/role`, { role });
  return data;
}

export async function updateProfile(data: { full_name?: string; avatar_url?: string | null; whatsapp_number?: string | null }): Promise<ApiUser> {
  const { data: res } = await apiClient.patch<ApiUser>("/users/me", data);
  return res;
}

export async function changePassword(current_password: string, new_password: string): Promise<void> {
  await apiClient.post("/users/me/password", { current_password, new_password });
}

export async function uploadAvatar(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await apiClient.post<{ url: string }>("/upload/image", form);
  return data.url;
}
