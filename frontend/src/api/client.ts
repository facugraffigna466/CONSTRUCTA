import axios from "axios";
import { clearRefreshToken, clearToken, getRefreshToken, getToken, setRefreshToken, setToken } from "../lib/tokenStorage";

// Configurable para producción vía VITE_API_URL (sin barra final)
const BASE_URL = `${import.meta.env.VITE_API_URL ?? "http://localhost:8000"}/api/v1`;

export const apiClient = axios.create({
  baseURL: BASE_URL,
});

apiClient.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.set("Authorization", `Bearer ${token}`);
  }
  return config;
});

// Queue de requests que esperan un refresh en curso.
let isRefreshing = false;
let failedQueue: Array<{ resolve: (token: string) => void; reject: (err: unknown) => void }> = [];

function processQueue(error: unknown, token: string | null = null) {
  failedQueue.forEach(({ resolve, reject }) => {
    if (error) reject(error);
    else resolve(token!);
  });
  failedQueue = [];
}

function clearSession() {
  clearToken();
  clearRefreshToken();
  window.location.href = "/";
}

apiClient.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config;
    const status = err.response?.status;
    const detail = err.response?.data?.detail;
    const url: string = original?.url ?? "";

    const isUnauthenticated =
      status === 401 || (status === 403 && detail === "Not authenticated");

    // No interceptar endpoints de auth para evitar loops infinitos.
    const isAuthEndpoint = url.includes("/auth/login") || url.includes("/auth/refresh");

    if (!isUnauthenticated || isAuthEndpoint) {
      return Promise.reject(err);
    }

    const refreshToken = getRefreshToken();
    if (!refreshToken) {
      clearSession();
      return Promise.reject(err);
    }

    // Si ya hay un refresh en curso, encolar este request.
    if (isRefreshing) {
      return new Promise<string>((resolve, reject) => {
        failedQueue.push({ resolve, reject });
      }).then((newToken) => {
        original.headers["Authorization"] = `Bearer ${newToken}`;
        return apiClient(original);
      });
    }

    isRefreshing = true;
    try {
      const { data } = await apiClient.post<{ access_token: string; refresh_token: string }>(
        "/auth/refresh",
        { refresh_token: refreshToken }
      );
      setToken(data.access_token);
      setRefreshToken(data.refresh_token);
      processQueue(null, data.access_token);
      original.headers["Authorization"] = `Bearer ${data.access_token}`;
      return apiClient(original);
    } catch (refreshErr) {
      processQueue(refreshErr, null);
      clearSession();
      return Promise.reject(refreshErr);
    } finally {
      isRefreshing = false;
    }
  }
);
