import axios from "axios";
import { clearToken, getToken } from "../lib/tokenStorage";

const BASE_URL = "http://localhost:8000/api/v1";

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

apiClient.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err.response?.status;
    const detail = err.response?.data?.detail;
    const isLoginRequest = (err.config?.url ?? "").includes("/auth/login");
    const isUnauthenticated =
      status === 401 ||
      (status === 403 && detail === "Not authenticated");
    if (isUnauthenticated && !isLoginRequest) {
      clearToken();
      window.location.href = "/";
    }
    return Promise.reject(err);
  }
);
