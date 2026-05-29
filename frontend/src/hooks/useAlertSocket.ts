import { useEffect } from "react";
import socket from "../lib/socket";
import type { Alert } from "../types";

interface AlertCreatedPayload {
  id: number;
  obraId: number | null;
  taskId: number | null;
  type: Alert["type"];
  message: string;
  is_read: boolean;
  created_at: string;
}

export function useAlertSocket(
  obraId: number,
  onAlertCreated: (alert: Alert) => void,
) {
  useEffect(() => {
    function handleAlertCreated(payload: AlertCreatedPayload) {
      if (payload.obraId !== obraId) return;
      const alert: Alert = {
        id:         payload.id,
        obra_id:    payload.obraId,
        task_id:    payload.taskId,
        type:       payload.type,
        message:    payload.message,
        is_read:    payload.is_read,
        created_at: payload.created_at,
      };
      onAlertCreated(alert);
    }

    socket.on("alert_created", handleAlertCreated);
    return () => { socket.off("alert_created", handleAlertCreated); };
  }, [obraId, onAlertCreated]);
}
