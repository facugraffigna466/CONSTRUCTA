import { useEffect, useState } from "react";
import socket from "../lib/socket";
import { useUser } from "../context/UserContext";

export interface GanttCursor {
  id: number;
  name: string;
  initials: string;
  color: string;
  x: number;
  y: number;
}

interface CursorUpdatePayload {
  obra_id: number;
  user: { id: number; name: string; initials: string; color: string };
  x: number;
  y: number;
}

interface CursorLeavePayload {
  obra_id: number;
  user_id: number;
}

const STALE_MS = 4_000;
const EMIT_THROTTLE_MS = 45;

/**
 * Cursores en vivo de otros usuarios viendo el mismo Gantt (mismo obra_id).
 * Las coordenadas x/y son relativas al área scrolleable de barras (railRef),
 * así que solo coinciden visualmente si ambos usuarios están en el mismo zoom.
 */
export function useGanttCursors(obraId: number): Map<number, GanttCursor> {
  const { user } = useUser();
  const [cursors, setCursors] = useState<Map<number, GanttCursor & { updatedAt: number }>>(new Map());

  useEffect(() => {
    function handleUpdate({ obra_id, user: u, x, y }: CursorUpdatePayload) {
      if (obra_id !== obraId || u.id === user.id) return;
      setCursors(prev => {
        const next = new Map(prev);
        next.set(u.id, { ...u, x, y, updatedAt: Date.now() });
        return next;
      });
    }

    function handleLeave({ obra_id, user_id }: CursorLeavePayload) {
      if (obra_id !== obraId) return;
      setCursors(prev => {
        if (!prev.has(user_id)) return prev;
        const next = new Map(prev);
        next.delete(user_id);
        return next;
      });
    }

    socket.on("cursor_update", handleUpdate);
    socket.on("cursor_leave", handleLeave);

    const pruneInterval = window.setInterval(() => {
      setCursors(prev => {
        const now = Date.now();
        let changed = false;
        const next = new Map(prev);
        for (const [id, c] of prev) {
          if (now - c.updatedAt > STALE_MS) { next.delete(id); changed = true; }
        }
        return changed ? next : prev;
      });
    }, 1_000);

    return () => {
      socket.off("cursor_update", handleUpdate);
      socket.off("cursor_leave", handleLeave);
      window.clearInterval(pruneInterval);
      setCursors(new Map());
    };
  }, [obraId, user.id]);

  return cursors;
}

let lastEmitAt = 0;

/** Emite la posición del mouse (throttleado) — llamar en onMouseMove del área de barras. */
export function emitCursorMove(obraId: number, x: number, y: number) {
  const now = Date.now();
  if (now - lastEmitAt < EMIT_THROTTLE_MS) return;
  lastEmitAt = now;
  socket.emit("cursor_move", { obra_id: obraId, x: Math.round(x), y: Math.round(y) });
}

/** Avisa que el cursor salió del área — para que desaparezca al toque en los demás clientes. */
export function emitCursorLeave(obraId: number) {
  socket.emit("cursor_leave", { obra_id: obraId });
}
