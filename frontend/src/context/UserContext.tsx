import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { fetchMe } from "../api/users";
import { getToken } from "../lib/tokenStorage";
import type { CurrentUser } from "../types";

export type UserRole = "admin" | "collaborator";

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

function buildUser(api: { id: number; full_name: string; email: string; role: UserRole; avatar_url?: string | null }): CurrentUser {
  const initials = api.full_name
    .split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("");
  const color = userAvatarColor(api.id);
  return { id: api.id, name: api.full_name, email: api.email, initials, color, role: api.role, avatar_url: api.avatar_url };
}

const PLACEHOLDER: CurrentUser = {
  id: 0, name: "", email: "", initials: "?", color: "#8E97A0", role: "collaborator", avatar_url: null,
};

interface UserContextValue {
  user: CurrentUser;
  role: UserRole;
  loading: boolean;
  refetch: () => Promise<void>;
}

const UserContext = createContext<UserContextValue | null>(null);

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser>(PLACEHOLDER);
  const [loading, setLoading] = useState(() => !!getToken());

  const refetch = useCallback(async () => {
    if (!getToken()) return;
    setLoading(true);
    try {
      const api = await fetchMe();
      setUser(buildUser(api));
    } catch {
      // backend down or token expired — apiClient interceptor handles 401
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return (
    <UserContext.Provider value={{ user, role: user.role, loading, refetch }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error("useUser must be used within UserProvider");
  return ctx;
}
