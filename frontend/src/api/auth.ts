import { apiClient } from "./client";

export async function login(email: string, password: string): Promise<string> {
  const { data } = await apiClient.post<{ access_token: string }>("/auth/login", {
    email,
    password,
  });
  return data.access_token;
}

export async function register(payload: {
  email: string;
  password: string;
  full_name: string;
  company_name?: string;
}): Promise<void> {
  await apiClient.post("/auth/register", payload);
}
