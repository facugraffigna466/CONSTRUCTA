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

interface PresenceViewer extends OnlineUser {
  tab?: string;
}

interface PresencePayload {
  obra_id: number;
  viewers: PresenceViewer[];
  editing: Record<string, OnlineUser>;
}

/** Usuarios online globalmente (excluye al usuario actual). Polling HTTP cada 10s.
 *
 * 6.10 de la auditoría del panel: cuando el tab está en background suspendemos
 * el interval. Al volver a foreground refrescamos de una y reanudamos.
 */
export function useOnlineUsers(): OnlineUser[] {
  const { user } = useUser();
  const [online, setOnline] = useState<OnlineUser[]>([]);
  const userIdRef = useRef(user.id);
  userIdRef.current = user.id;

  useEffect(() => {
    let cancelled = false;
    let interval: number | null = null;

    async function poll() {
      try {
        const users = await fetchOnlineUsers();
        if (!cancelled) setOnline(users.filter(u => u.id !== userIdRef.current));
      } catch {
        // silent — will retry on next interval
      }
    }

    function start() {
      if (interval !== null) return;
      poll();
      interval = window.setInterval(poll, 10_000);
    }

    function stop() {
      if (interval !== null) {
        window.clearInterval(interval);
        interval = null;
      }
    }

    function handleVisibility() {
      if (document.hidden) stop();
      else start();
    }

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      stop();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return online;
}

/**
 * Usuarios viendo activamente el mismo módulo (tab) de una obra específica
 * (excluye al usuario actual). Si el otro usuario está en la misma obra pero
 * en otro tab (ej. vos en Tareas, él en Alertas), no aparece.
 */
export function useViewingUsers(obraId: number, tab: string): OnlineUser[] {
  const { user } = useUser();
  const [viewers, setViewers] = useState<PresenceViewer[]>([]);
  const obraIdRef = useRef(obraId);
  const tabRef = useRef(tab);
  const userIdRef = useRef(user.id);
  obraIdRef.current = obraId;
  tabRef.current = tab;
  userIdRef.current = user.id;

  useEffect(() => {
    if (!socket.connected) socket.connect();

    function emitJoin() {
      socket.emit("join_obra", { obra_id: obraIdRef.current, tab: tabRef.current });
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

  // Al cambiar de módulo dentro de la misma obra, actualizamos el tab sin
  // salir/reentrar (evita que el indicador parpadee al navegar entre tabs).
  useEffect(() => {
    if (socket.connected) socket.emit("join_obra", { obra_id: obraId, tab });
  }, [obraId, tab]);

  return viewers.filter(v => v.tab === tab);
}
