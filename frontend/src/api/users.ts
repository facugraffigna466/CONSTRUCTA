import { apiClient } from "./client";

export interface ApiUser {
  id: number;
  email: string;
  full_name: string;
  role: "admin" | "collaborator";
  is_active: boolean;
  avatar_url: string | null;
  created_at: string;
}

export async function fetchMe(): Promise<ApiUser> {
  const { data } = await apiClient.get<ApiUser>("/users/me");
  return data;
}

export async function fetchMembers(): Promise<ApiUser[]> {
  const { data } = await apiClient.get<ApiUser[]>("/users");
  return data;
}

export async function inviteMember(email: string, role: "admin" | "collaborator"): Promise<{ invite_token: string; invite_url: string }> {
  const { data } = await apiClient.post("/users/invite", { email, role });
  return data;
}

export async function acceptInvite(token: string, full_name: string, password: string): Promise<string> {
  const { data } = await apiClient.post<{ access_token: string }>("/auth/accept-invite", { token, full_name, password });
  return data.access_token;
}

export async function removeMember(userId: number): Promise<void> {
  await apiClient.delete(`/users/${userId}`);
}

export async function updateProfile(data: { full_name?: string; avatar_url?: string | null }): Promise<ApiUser> {
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
