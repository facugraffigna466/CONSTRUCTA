import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { fetchMe } from "../api/users";
import type { ApiUser } from "../api/users";
import { getToken } from "../lib/tokenStorage";
import { userAvatarColor } from "../lib/userMeta";
import type { CurrentUser } from "../types";
import { UserContext } from "./userContextObject";

export type UserRole = "admin" | "collaborator";

function buildUser(api: ApiUser): CurrentUser {
  const initials = api.full_name
    .split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("");
  const color = userAvatarColor(api.id);
  return {
    id: api.id,
    name: api.full_name,
    email: api.email,
    initials,
    color,
    role: api.role,
    avatar_url: api.avatar_url,
    whatsapp_number: api.whatsapp_number ?? null,
    tenant_name: api.tenant_name ?? null,
    available_tenants: api.available_tenants ?? [],
    obra_roles: api.obra_roles ?? [],
  };
}

const PLACEHOLDER: CurrentUser = {
  id: 0, name: "", email: "", initials: "?", color: "#6B7580", role: "collaborator",
  avatar_url: null, available_tenants: [], obra_roles: [],
};

export interface UserContextValue {
  user: CurrentUser;
  role: UserRole;
  loading: boolean;
  refetch: () => Promise<void>;
}

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
    queueMicrotask(refetch);
  }, [refetch]);

  return (
    <UserContext.Provider value={{ user, role: user.role, loading, refetch }}>
      {children}
    </UserContext.Provider>
  );
}
