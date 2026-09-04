import { useEffect } from "react";
import socket from "../lib/socket";
import type { AlertsResolvedPayload } from "./useGlobalAlerts";
import type { Alert } from "../types";

interface AlertCreatedPayload {
  id: number;
  obraId: number | null;
  taskId: number | null;
  type: Alert["type"];
  severity?: Alert["severity"];
  message: string;
  is_read: boolean;
  created_at: string;
}

export function useAlertSocket(
  obraId: number,
  onAlertCreated: (alert: Alert) => void,
  // El tab Alertas de la obra mantiene su propio estado y solo escuchaba las
  // altas: una alerta resuelta seguía figurando pendiente hasta recargar.
  onAlertsResolved?: (payload: AlertsResolvedPayload) => void,
) {
  useEffect(() => {
    function handleAlertCreated(payload: AlertCreatedPayload) {
      if (payload.obraId !== obraId) return;
      const alert: Alert = {
        id:         payload.id,
        obra_id:    payload.obraId,
        task_id:    payload.taskId,
        // El backend siempre la manda; el fallback cubre un front nuevo
        // hablando con un backend anterior a la migración 0062.
        type:       payload.type,
        severity:   payload.severity ?? "media",
        message:    payload.message,
        is_read:    payload.is_read,
        created_at: payload.created_at,
      };
      onAlertCreated(alert);
    }

    function handleAlertsResolved(payload: AlertsResolvedPayload) {
      if (payload.obraId !== obraId) return;
      onAlertsResolved?.(payload);
    }

    socket.on("alert_created", handleAlertCreated);
    socket.on("alerts_resolved", handleAlertsResolved);
    return () => {
      socket.off("alert_created", handleAlertCreated);
      socket.off("alerts_resolved", handleAlertsResolved);
    };
  }, [obraId, onAlertCreated, onAlertsResolved]);
}
