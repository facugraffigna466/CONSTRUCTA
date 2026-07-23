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

/** Pide el email de recuperación. Siempre resuelve (el backend no revela si el email existe). */
export async function requestPasswordReset(email: string): Promise<void> {
  await apiClient.post("/auth/forgot-password", { email });
}

/** Setea la nueva contraseña con el token del link; devuelve el access token (login). */
export async function resetPassword(token: string, newPassword: string): Promise<string> {
  const { data } = await apiClient.post<{ access_token: string }>("/auth/reset-password", {
    token,
    new_password: newPassword,
  });
  return data.access_token;
}
