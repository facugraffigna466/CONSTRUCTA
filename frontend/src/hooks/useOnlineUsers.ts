import { useEffect, useRef, useState } from "react";
import socket from "../lib/socket";
import { useUser } from "../context/UserContext";
import { fetchOnlineUsers } from "../api/presence";

export interface OnlineUser {
  id: number;
  name: string;
  initials: string;
  color: string;
}

interface PresencePayload {
  obra_id: number;
  viewers: OnlineUser[];
  editing: Record<string, OnlineUser>;
}

/** Usuarios online globalmente (excluye al usuario actual). Polling HTTP cada 10s. */
export function useOnlineUsers(): OnlineUser[] {
  const { user } = useUser();
  const [online, setOnline] = useState<OnlineUser[]>([]);
  const userIdRef = useRef(user.id);
  userIdRef.current = user.id;

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const users = await fetchOnlineUsers();
        if (!cancelled) setOnline(users.filter(u => u.id !== userIdRef.current));
      } catch {
        // silent — will retry on next interval
      }
    }

    poll();
    const interval = setInterval(poll, 10_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return online;
}

/** Usuarios viendo activamente una obra específica (excluye al usuario actual). */
export function useViewingUsers(obraId: number): OnlineUser[] {
  const { user } = useUser();
  const [viewers, setViewers] = useState<OnlineUser[]>([]);
  const obraIdRef = useRef(obraId);
  const userIdRef = useRef(user.id);
  obraIdRef.current = obraId;
  userIdRef.current = user.id;

  useEffect(() => {
    if (!socket.connected) socket.connect();

    function emitJoin() {
      socket.emit("join_obra", { obra_id: obraIdRef.current });
    }

    function handlePresence({ obra_id, viewers: v }: PresencePayload) {
      if (obra_id !== obraIdRef.current) return;
      setViewers(v.filter(u => u.id !== userIdRef.current));
    }

    emitJoin();
    socket.on("presence_update", handlePresence);
    socket.on("connect", emitJoin);

    return () => {
      socket.emit("leave_obra", { obra_id: obraIdRef.current });
      socket.off("presence_update", handlePresence);
      socket.off("connect", emitJoin);
      setViewers([]);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obraId]);

  return viewers;
}
