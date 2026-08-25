import { useEffect, useRef } from "react";
import socket from "../lib/socket";

export interface ObraSocketActor {
  id: number;
  name: string;
  role?: string;
  channel?: string;
}

export interface ObraCreatedPayload {
  id: number;
  name: string;
  status: string;
  tenantId: number;
  actor: ObraSocketActor | null;
}

export interface ObraUpdatedPayload {
  id: number;
  name: string;
  status: string;
  tenantId: number;
  actor: ObraSocketActor | null;
}

export interface ObraDeletedPayload {
  id: number;
  tenantId: number;
  actor: ObraSocketActor | null;
}

interface UseObraSocketOptions {
  onObraCreated?: (payload: ObraCreatedPayload) => void;
  onObraUpdated?: (payload: ObraUpdatedPayload) => void;
  onObraDeleted?: (payload: ObraDeletedPayload) => void;
}

export function useObraSocket({
  onObraCreated,
  onObraUpdated,
  onObraDeleted,
}: UseObraSocketOptions): void {
  const createdRef = useRef(onObraCreated);
  const updatedRef = useRef(onObraUpdated);
  const deletedRef = useRef(onObraDeleted);
  createdRef.current = onObraCreated;
  updatedRef.current = onObraUpdated;
  deletedRef.current = onObraDeleted;

  useEffect(() => {
    if (!socket.connected) socket.connect();

    function handleCreated(p: ObraCreatedPayload) {
      createdRef.current?.(p);
    }
    function handleUpdated(p: ObraUpdatedPayload) {
      updatedRef.current?.(p);
    }
    function handleDeleted(p: ObraDeletedPayload) {
      deletedRef.current?.(p);
    }

    socket.on("obra_created", handleCreated);
    socket.on("obra_updated", handleUpdated);
    socket.on("obra_deleted", handleDeleted);

    return () => {
      socket.off("obra_created", handleCreated);
      socket.off("obra_updated", handleUpdated);
      socket.off("obra_deleted", handleDeleted);
    };
  }, []);
}
