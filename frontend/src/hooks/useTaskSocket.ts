import { useEffect, useRef } from "react";
import socket from "../lib/socket";
import type { Task, TaskStatus } from "../types/index";

// ─── Payload types ────────────────────────────────────────────────────────────

export interface TaskSocketActor {
  id: number;
  name: string;
  role?: string;
  channel?: string;
}

export interface TaskUpdatedPayload {
  taskId: number;
  obraId: number;
  title: string;
  responsibleId: number | null;
  status: TaskStatus;
  startDate: string | null;
  dueDate: string | null;
  updatedAt: string;
  actor: TaskSocketActor | null;
}

export interface TaskCreatedPayload {
  taskId: number;
  obraId: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  responsibleId: number | null;
  startDate: string | null;
  dueDate: string | null;
  startTime: string | null;
  dueTime: string | null;
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
  actor: TaskSocketActor | null;
}

export interface TaskDeletedPayload {
  taskId: number;
  obraId: number;
  title: string;
  actor: TaskSocketActor | null;
}

// ─── Payload → Task mapper ────────────────────────────────────────────────────

export function taskFromCreatedPayload(p: TaskCreatedPayload): Task {
  return {
    id: p.taskId,
    obra_id: p.obraId,
    title: p.title,
    description: p.description,
    status: p.status,
    responsible_id: p.responsibleId,
    start_date: p.startDate,
    due_date: p.dueDate,
    start_time: p.startTime,
    due_time: p.dueTime,
    order_index: p.orderIndex,
    depends_on_id: null,
    completed_date: null,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
  };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

interface UseTaskSocketOptions {
  obraId: number;
  onTaskUpdated?: (payload: TaskUpdatedPayload) => void;
  onTaskCreated?: (payload: TaskCreatedPayload) => void;
  onTaskDeleted?: (payload: TaskDeletedPayload) => void;
}

export function useTaskSocket({
  obraId,
  onTaskUpdated,
  onTaskCreated,
  onTaskDeleted,
}: UseTaskSocketOptions): void {
  const updatedRef = useRef(onTaskUpdated);
  const createdRef = useRef(onTaskCreated);
  const deletedRef = useRef(onTaskDeleted);
  updatedRef.current = onTaskUpdated;
  createdRef.current = onTaskCreated;
  deletedRef.current = onTaskDeleted;

  useEffect(() => {
    if (!socket.connected) socket.connect();

    function handleUpdated(p: TaskUpdatedPayload) {
      if (p.obraId === obraId) updatedRef.current?.(p);
    }
    function handleCreated(p: TaskCreatedPayload) {
      if (p.obraId === obraId) createdRef.current?.(p);
    }
    function handleDeleted(p: TaskDeletedPayload) {
      if (p.obraId === obraId) deletedRef.current?.(p);
    }

    socket.on("task_updated", handleUpdated);
    socket.on("task_created", handleCreated);
    socket.on("task_deleted", handleDeleted);

    return () => {
      socket.off("task_updated", handleUpdated);
      socket.off("task_created", handleCreated);
      socket.off("task_deleted", handleDeleted);
    };
  }, [obraId]);
}
