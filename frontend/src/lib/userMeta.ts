// Constantes de rol/avatar de usuario. Separadas de context/UserContext.tsx
// porque ese archivo solo puede exportar componentes/hooks (Fast Refresh de
// Vite se rompe si un archivo de componente también exporta constantes).
import type { UserRole } from "../context/UserContext";

export const ROLE_LABELS: Record<UserRole, string> = {
  admin:        "Administrador",
  collaborator: "Colaborador",
};

export const ROLE_COLORS: Record<UserRole, { bg: string; color: string; border: string }> = {
  admin:        { bg: "#E5EEFB", color: "#2A6FDB", border: "#B8D0F5" },
  collaborator: { bg: "#E4F3EC", color: "#1F8A5B", border: "#BFE3CE" },
};

export const AVATAR_COLORS = ["#FF6B35", "#2A6FDB", "#1F8A5B", "#9A4DC9", "#C97D0E", "#D03A3A", "#2C6571"];

export function userAvatarColor(userId: number): string {
  return AVATAR_COLORS[userId % AVATAR_COLORS.length];
}
