import { useEffect, useRef, useState } from "react";
import socket from "../lib/socket";
import type { TaskCreatedPayload, TaskUpdatedPayload, TaskDeletedPayload } from "./useTaskSocket";

export interface ActivityEvent {
  id: string;
  userId: number;
  userName: string;
  userInitials: string;
  userColor: string;
  action: string;
  target: string;
  detail?: string;
  timestamp: Date;
}

const AVATAR_COLORS = ["#FF6B35", "#2A6FDB", "#1F8A5B", "#9A4DC9", "#C97D0E", "#D03A3A", "#2C6571"];

function avatarColor(userId: number): string {
  return AVATAR_COLORS[userId % AVATAR_COLORS.length];
}

function getInitials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("") || "?";
}

function makeEvent(userId: number, userName: string, action: string, target: string, detail?: string): ActivityEvent {
  return {
    id: `evt-${Date.now()}-${Math.random()}`,
    userId,
    userName,
    userInitials: getInitials(userName),
    userColor: avatarColor(userId),
    action,
    target,
    detail,
    timestamp: new Date(),
  };
}

/**
 * Subscribes to real socket events (task_created, task_updated, task_deleted)
 * and converts them to ActivityEvent notifications.
 *
 * Events from the current user are filtered out so you don't see your own actions.
 */
export function useActivityFeed(currentUserId?: number): [ActivityEvent[], ActivityEvent | null] {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [latest, setLatest] = useState<ActivityEvent | null>(null);
  const currentUserIdRef = useRef(currentUserId);
  currentUserIdRef.current = currentUserId;

  useEffect(() => {
    if (!socket.connected) socket.connect();

    function push(evt: ActivityEvent) {
      setEvents(prev => [...prev.slice(-19), evt]);
      setLatest(evt);
    }

    function handleCreated(p: TaskCreatedPayload) {
      if (!p.actor) return;
      if (currentUserIdRef.current && p.actor.id === currentUserIdRef.current) return;
      push(makeEvent(p.actor.id, p.actor.name, "creó la tarea", p.title));
    }

    function handleUpdated(p: TaskUpdatedPayload) {
      if (!p.actor) return;
      if (currentUserIdRef.current && p.actor.id === currentUserIdRef.current) return;
      push(makeEvent(p.actor.id, p.actor.name, "actualizó", p.title));
    }

    function handleDeleted(p: TaskDeletedPayload) {
      if (!p.actor) return;
      if (currentUserIdRef.current && p.actor.id === currentUserIdRef.current) return;
      push(makeEvent(p.actor.id, p.actor.name, "eliminó la tarea", p.title));
    }

    socket.on("task_created", handleCreated);
    socket.on("task_updated", handleUpdated);
    socket.on("task_deleted", handleDeleted);

    return () => {
      socket.off("task_created", handleCreated);
      socket.off("task_updated", handleUpdated);
      socket.off("task_deleted", handleDeleted);
    };
  }, []);

  return [events, latest];
}
