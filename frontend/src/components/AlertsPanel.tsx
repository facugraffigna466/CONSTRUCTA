import { Bell, CheckCheck } from "lucide-react";
import type { Alert, AlertType } from "../types";

interface AlertsPanelProps {
  alerts: Alert[];
  onMarkRead: (id: number) => void;
}

function getAlertLabel(alert: Alert): string {
  if (alert.type === "task_blocked")          return "Tarea bloqueada";
  if (alert.type === "task_overdue")          return "Tarea vencida";
  if (alert.type === "no_response")           return "Sin respuesta";
  if (alert.type === "reschedule_requested")  return "Demora informada";
  const msg = alert.message.toLowerCase();
  if (msg.includes("responsable"))  return "Sin responsable";
  if (msg.includes("vencida"))      return "Tarea vencida";
  if (msg.includes("avance"))       return "Avance inconsistente";
  return "Riesgo de demora";
}

const typeConfig: Record<AlertType, { border: string; dot: string; badge: string }> = {
  task_blocked: {
    border: "border-constructa-danger/30 bg-red-50",
    dot:    "bg-constructa-danger",
    badge:  "text-constructa-danger bg-red-100",
  },
  delay_risk: {
    border: "border-constructa-warning/40 bg-amber-50",
    dot:    "bg-constructa-warning",
    badge:  "text-amber-700 bg-amber-100",
  },
  task_overdue: {
    border: "border-constructa-danger/30 bg-red-50",
    dot:    "bg-constructa-danger",
    badge:  "text-constructa-danger bg-red-100",
  },
  no_response: {
    border: "border-constructa-warning/40 bg-amber-50",
    dot:    "bg-constructa-warning",
    badge:  "text-amber-700 bg-amber-100",
  },
  reschedule_requested: {
    border: "border-blue-200 bg-blue-50",
    dot:    "bg-blue-500",
    badge:  "text-blue-700 bg-blue-100",
  },
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("es-AR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export function AlertsPanel({ alerts, onMarkRead }: AlertsPanelProps) {
  if (alerts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-constructa-secondaryText text-sm gap-2">
        <Bell className="w-7 h-7 opacity-30" />
        <span>Sin alertas registradas.</span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {alerts.map((alert) => {
        const cfg = typeConfig[alert.type];
        return (
          <div
            key={alert.id}
            className={[
              "rounded border p-3 flex items-start gap-3 transition-opacity",
              cfg.border,
              alert.is_read ? "opacity-40" : "",
            ].join(" ")}
          >
            <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
            <div className="flex-1 min-w-0">
              <p className={`text-xs font-bold uppercase tracking-wide px-1.5 py-0.5 rounded inline-block mb-1 ${cfg.badge}`}>
                {getAlertLabel(alert)}
              </p>
              <p className="text-sm text-constructa-text leading-snug">{alert.message}</p>
              <p className="text-xs text-constructa-secondaryText mt-1">
                {formatDate(alert.created_at)}
              </p>
            </div>
            {!alert.is_read && (
              <button
                onClick={() => onMarkRead(alert.id)}
                title="Marcar como leída"
                className="flex-shrink-0 p-1 rounded hover:bg-white text-constructa-secondaryText hover:text-constructa-text transition-colors"
              >
                <CheckCheck className="w-4 h-4" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
