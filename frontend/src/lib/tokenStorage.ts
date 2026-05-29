const KEY = "access_token";

// On tab start: if this tab has no sessionStorage token yet, inherit from localStorage.
// This lets new tabs pick up the last login without sharing live state between tabs.
if (!sessionStorage.getItem(KEY)) {
  const stored = localStorage.getItem(KEY);
  if (stored) sessionStorage.setItem(KEY, stored);
}

export function getToken(): string | null {
  return sessionStorage.getItem(KEY);
}

export function setToken(token: string): void {
  sessionStorage.setItem(KEY, token);  // this tab's independent session
  localStorage.setItem(KEY, token);    // new tabs can inherit this login
}

export function clearToken(): void {
  sessionStorage.removeItem(KEY);
  localStorage.removeItem(KEY);
}
