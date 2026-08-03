import { apiClient } from "./client";

interface TokenPair {
  access_token: string;
  refresh_token: string;
}

export async function login(email: string, password: string): Promise<TokenPair> {
  const { data } = await apiClient.post<TokenPair>("/auth/login", { email, password });
  return data;
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

/** Setea la nueva contraseña con el token del link; devuelve access + refresh token. */
export async function resetPassword(token: string, newPassword: string): Promise<TokenPair> {
  const { data } = await apiClient.post<TokenPair>("/auth/reset-password", {
    token,
    new_password: newPassword,
  });
  return data;
}

/** Confirma el email a partir del token del enlace de verificación. */
export async function verifyEmail(token: string): Promise<void> {
  await apiClient.post("/auth/verify-email", { token });
}

/** Rota el refresh token y devuelve nuevos access + refresh tokens. */
export async function refreshTokens(refreshToken: string): Promise<TokenPair> {
  const { data } = await apiClient.post<TokenPair>("/auth/refresh", {
    refresh_token: refreshToken,
  });
  return data;
}

/** Invalida el refresh token en el servidor (logout seguro). */
export async function logout(refreshToken: string): Promise<void> {
  await apiClient.post("/auth/logout", { refresh_token: refreshToken });
}
