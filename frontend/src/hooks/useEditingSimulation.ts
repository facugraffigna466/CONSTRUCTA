import { useEffect, useState } from "react";
import socket from "../lib/socket";
import { useUser } from "../context/UserContext";

export interface Editor {
  id: number;
  name: string;
  initials: string;
  color: string;
}

interface PresencePayload {
  obra_id: number;
  viewers: Editor[];
  editing: Record<string, Editor>;
}

/**
 * Devuelve un mapa task_id → Editor con quién está editando cada tarea.
 * Se actualiza en tiempo real via presence_update del servidor.
 */
export function useEditingSimulation(obraId: number): Map<number, Editor> {
  const { user } = useUser();
  const [editingMap, setEditingMap] = useState(new Map<number, Editor>());

  useEffect(() => {
    function handler({ obra_id, editing }: PresencePayload) {
      if (obra_id !== obraId) return;
      const map = new Map<number, Editor>();
      for (const [taskIdStr, editor] of Object.entries(editing)) {
        if (editor.id !== user.id) {
          map.set(parseInt(taskIdStr, 10), editor);
        }
      }
      setEditingMap(map);
    }

    socket.on("presence_update", handler);
    return () => { socket.off("presence_update", handler); };
  }, [obraId, user.id]);

  return editingMap;
}

/** Emite start/stop_editing_task al servidor. */
export function emitStartEditing(taskId: number, obraId: number) {
  socket.emit("start_editing_task", { task_id: taskId, obra_id: obraId });
}

export function emitStopEditing(taskId: number, obraId: number) {
  socket.emit("stop_editing_task", { task_id: taskId, obra_id: obraId });
}
