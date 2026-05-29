import { apiClient } from "./client";

export async function login(email: string, password: string): Promise<string> {
  const { data } = await apiClient.post<{ access_token: string }>("/auth/login", {
    email,
    password,
  });
  return data.access_token;
}
