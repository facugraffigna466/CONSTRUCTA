import { apiClient } from "./client";
import type { TenantOption } from "../types";

interface TokenPair {
  access_token: string;
  refresh_token: string;
}

/** Si el email tiene membership activa en más de una empresa, login no
 * devuelve tokens todavía — hay que elegir con selectTenant(). */
export interface TenantSelectionRequired {
  requires_tenant_selection: true;
  pre_auth_token: string;
  tenants: TenantOption[];
}

export type LoginResult = (TokenPair & { requires_tenant_selection?: false }) | TenantSelectionRequired;

export async function login(email: string, password: string): Promise<LoginResult> {
  const { data } = await apiClient.post<LoginResult>("/auth/login", { email, password });
  return data;
}

/** Canjea el pre_auth_token de un login con varias empresas por la sesión real. */
export async function selectTenant(preAuthToken: string, tenantId: number): Promise<TokenPair> {
  const { data } = await apiClient.post<TokenPair>("/auth/select-tenant", {
    pre_auth_token: preAuthToken,
    tenant_id: tenantId,
  });
  return data;
}

/** Cambia la empresa activa sin desloguearse (switcher del Sidebar). */
export async function switchTenant(tenantId: number): Promise<TokenPair> {
  const { data } = await apiClient.post<TokenPair>("/auth/switch-tenant", { tenant_id: tenantId });
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

/** Setea la nueva contraseña con el token del link. Devuelve tokens, salvo
 * que el email tenga membership activa en más de una empresa — en ese caso
 * (raro) pide iniciar sesión normalmente para elegir cuál. */
export async function resetPassword(token: string, newPassword: string): Promise<LoginResult> {
  const { data } = await apiClient.post<LoginResult>("/auth/reset-password", {
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
