import { apiClient } from "./client";
import type { OnlineUser } from "../hooks/useOnlineUsers";

export async function fetchOnlineUsers(): Promise<OnlineUser[]> {
  const res = await apiClient.get<{ users: OnlineUser[] }>("/presence/online");
  return res.data.users;
}
