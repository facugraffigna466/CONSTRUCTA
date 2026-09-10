// Separado de OnboardingModal.tsx: un archivo de componente solo puede
// exportar componentes (Fast Refresh de Vite se rompe si además exporta
// funciones sueltas).
const STORAGE_KEY = "onboarding_done";

export function isOnboardingDone(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) === "true"; } catch { return true; }
}

export function markOnboardingDone(): void {
  try { localStorage.setItem(STORAGE_KEY, "true"); } catch { /* ignore */ }
}
