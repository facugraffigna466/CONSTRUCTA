const ACCESS_KEY = "access_token";
const REFRESH_KEY = "refresh_token";

// On tab start: if this tab has no sessionStorage token yet, inherit from localStorage.
// This lets new tabs pick up the last login without sharing live state between tabs.
if (!sessionStorage.getItem(ACCESS_KEY)) {
  const stored = localStorage.getItem(ACCESS_KEY);
  if (stored) sessionStorage.setItem(ACCESS_KEY, stored);
}
if (!sessionStorage.getItem(REFRESH_KEY)) {
  const stored = localStorage.getItem(REFRESH_KEY);
  if (stored) sessionStorage.setItem(REFRESH_KEY, stored);
}

export function getToken(): string | null {
  return sessionStorage.getItem(ACCESS_KEY);
}

export function setToken(token: string): void {
  sessionStorage.setItem(ACCESS_KEY, token);
  localStorage.setItem(ACCESS_KEY, token);
}

export function clearToken(): void {
  sessionStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(ACCESS_KEY);
}

export function getRefreshToken(): string | null {
  return sessionStorage.getItem(REFRESH_KEY);
}

export function setRefreshToken(token: string): void {
  sessionStorage.setItem(REFRESH_KEY, token);
  localStorage.setItem(REFRESH_KEY, token);
}

export function clearRefreshToken(): void {
  sessionStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(REFRESH_KEY);
}
