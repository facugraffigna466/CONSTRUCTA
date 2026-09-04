import { useEffect, useRef, useState, useCallback } from "react";
import socket from "../lib/socket";
import { fetchAlerts, markAlertRead } from "../api/alerts";
import { fetchObras } from "../api/obras";
import type { Alert } from "../types";

/** Payload de `alerts_resolved`. `alertIds` es la vía precisa; `taskId` la
 *  heredada, para emisores que resuelven todas las alertas de una tarea. */
export interface AlertsResolvedPayload {
  taskId: number | null;
  obraId: number;
  alertIds?: number[] | null;
}

export interface GlobalAlertsState {
  alerts: Alert[];
  unreadCount: number;
  obraNames: Map<number, string>;
  toastAlert: Alert | null;
  markRead: (id: number) => Promise<void>;
  clearToast: () => void;
}

// Qué amerita un toast. Antes era una lista de tipos, que había que ampliar a
// mano por cada regla nueva; ahora lo decide la severidad, que es justamente el
// dato que dice cuánto pesa la alerta. Para los dos tipos que estaban en la
// lista el resultado no cambia: task_blocked y task_overdue son 'alta'.
const TOAST_SEVERITIES: Alert["severity"][] = ["critica", "alta"];

export function useGlobalAlerts(): GlobalAlertsState {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [obraNames, setObraNames] = useState<Map<number, string>>(new Map());
  const [toastQueue, setToastQueue] = useState<Alert[]>([]);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    // Hallazgo 8.6: la campana solo muestra no-leídas (AlertBell filtra
    // `!a.is_read`), así que traer todo el histórico del tenant en cada carga
    // de la app era trabajo desperdiciado que crecía sin límite con el tiempo.
    fetchAlerts(true).then(data => {
      if (mountedRef.current) setAlerts(data);
    }).catch(() => {});
    fetchObras().then(obras => {
      if (mountedRef.current) setObraNames(new Map(obras.map(o => [o.id, o.name])));
    }).catch(() => {});
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    function handleAlertCreated(payload: {
      id: number; obraId: number | null; taskId: number | null;
      type: Alert["type"]; severity?: Alert["severity"];
      message: string; is_read: boolean; created_at: string;
    }) {
      const alert: Alert = {
        id: payload.id,
        obra_id: payload.obraId,
        task_id: payload.taskId,
        type: payload.type,
        severity: payload.severity ?? "media",
        message: payload.message,
        is_read: payload.is_read,
        created_at: payload.created_at,
      };
      setAlerts(prev => [alert, ...prev]);
      if (TOAST_SEVERITIES.includes(alert.severity)) {
        // Hallazgo 8.5: cola en vez de un único slot — dos alertas críticas
        // seguidas ya no se pisan, la segunda espera a que la primera se cierre.
        setToastQueue(prev => [...prev, alert]);
      }
    }

    function handleAlertsResolved(payload: AlertsResolvedPayload) {
      // `alertIds` marca exactamente las que se resolvieron. El camino por
      // `taskId` queda para los emisores que resuelven un tipo entero de una
      // tarea (TaskService) y no mandan ids.
      const ids = payload.alertIds;
      setAlerts(prev =>
        prev.map(a => {
          const resuelta = ids ? ids.includes(a.id) : a.task_id === payload.taskId;
          return resuelta ? { ...a, is_read: true } : a;
        })
      );
    }

    socket.on("alert_created", handleAlertCreated);
    socket.on("alerts_resolved", handleAlertsResolved);
    return () => {
      socket.off("alert_created", handleAlertCreated);
      socket.off("alerts_resolved", handleAlertsResolved);
    };
  }, []);

  const markRead = useCallback(async (id: number) => {
    await markAlertRead(id);
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, is_read: true } : a));
  }, []);

  const clearToast = useCallback(() => setToastQueue(prev => prev.slice(1)), []);

  const unreadCount = alerts.filter(a => !a.is_read).length;

  return { alerts, unreadCount, obraNames, toastAlert: toastQueue[0] ?? null, markRead, clearToast };
}
