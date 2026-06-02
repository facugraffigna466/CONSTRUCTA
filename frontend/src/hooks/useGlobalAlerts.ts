import { useEffect, useRef, useState, useCallback } from "react";
import socket from "../lib/socket";
import { fetchAlerts, markAlertRead } from "../api/alerts";
import type { Alert } from "../types";

export interface GlobalAlertsState {
  alerts: Alert[];
  unreadCount: number;
  toastAlert: Alert | null;
  markRead: (id: number) => Promise<void>;
  clearToast: () => void;
}

const CRITICAL_TYPES: Alert["type"][] = ["task_blocked", "task_overdue"];

export function useGlobalAlerts(): GlobalAlertsState {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [toastAlert, setToastAlert] = useState<Alert | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    fetchAlerts().then(data => {
      if (mountedRef.current) setAlerts(data);
    }).catch(() => {});
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    function handleAlertCreated(payload: {
      id: number; obraId: number | null; taskId: number | null;
      type: Alert["type"]; message: string; is_read: boolean; created_at: string;
    }) {
      const alert: Alert = {
        id: payload.id,
        obra_id: payload.obraId,
        task_id: payload.taskId,
        type: payload.type,
        message: payload.message,
        is_read: payload.is_read,
        created_at: payload.created_at,
      };
      setAlerts(prev => [alert, ...prev]);
      if (CRITICAL_TYPES.includes(alert.type)) {
        setToastAlert(alert);
      }
    }

    function handleAlertsResolved(payload: { taskId: number; obraId: number }) {
      setAlerts(prev =>
        prev.map(a => a.task_id === payload.taskId ? { ...a, is_read: true } : a)
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

  const clearToast = useCallback(() => setToastAlert(null), []);

  const unreadCount = alerts.filter(a => !a.is_read).length;

  return { alerts, unreadCount, toastAlert, markRead, clearToast };
}
