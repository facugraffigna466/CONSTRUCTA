import { useState } from "react";
import { CheckCheck, ArrowRight } from "lucide-react";
import type { Alert, AlertType, Task } from "../types";

// ─── Design tokens ─────────────────────────────────────────────────────────────

type Filter = "todas" | "no_leidas" | "leidas";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "no_leidas", label: "No leídas" },
  { id: "todas",     label: "Todas" },
  { id: "leidas",    label: "Leídas" },
];

const TYPE_STYLE: Record<AlertType, { bar: string; bg: string; color: string; border: string }> = {
  task_blocked: { bar: "#D03A3A", bg: "#FCE5E5", color: "#D03A3A", border: "#F0B0B0" },
  delay_risk:   { bar: "#E89B14", bg: "#FDF1DE", color: "#C97D0E", border: "#F0D5A0" },
  task_overdue: { bar: "#D03A3A", bg: "#FCE5E5", color: "#D03A3A", border: "#F0B0B0" },
  no_response:  { bar: "#2A6FDB", bg: "#E5EEFB", color: "#2A6FDB", border: "#B8CCF5" },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getAlertLabel(alert: Alert): string {
  switch (alert.type) {
    case "task_blocked":  return "Tarea bloqueada";
    case "task_overdue":  return "Tarea vencida";
    case "no_response":   return "Sin respuesta";
    default: {
      const msg = alert.message.toLowerCase();
      if (msg.includes("responsable")) return "Sin responsable";
      if (msg.includes("vencida"))     return "Tarea vencida";
      if (msg.includes("avance"))      return "Avance inconsistente";
      return "Riesgo de demora";
    }
  }
}

function getTypeStyle(alert: Alert) {
  const base = TYPE_STYLE[alert.type];
  if (base) return base;
  const msg = alert.message.toLowerCase();
  if (msg.includes("responsable")) return TYPE_STYLE.delay_risk;
  return TYPE_STYLE.delay_risk;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("es-AR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface AlertasTabProps {
  alerts: Alert[];
  tasks: Task[];
  onMarkRead: (id: number) => void;
  onMarkAllRead: () => void;
  onViewTask: (taskId?: number) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AlertasTab({ alerts, tasks, onMarkRead, onMarkAllRead, onViewTask }: AlertasTabProps) {
  const [filter, setFilter] = useState<Filter>("no_leidas");

  const unreadCount = alerts.filter(a => !a.is_read).length;
  const readCount   = alerts.length - unreadCount;

  const counts: Record<Filter, number> = {
    no_leidas: unreadCount,
    todas:     alerts.length,
    leidas:    readCount,
  };

  const filtered = alerts.filter(a => {
    if (filter === "no_leidas") return !a.is_read;
    if (filter === "leidas")    return a.is_read;
    return true;
  });

  return (
    <div style={{ background: "#fff", border: "1px solid #E6E7E5", borderRadius: 14, overflow: "hidden", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderBottom: "1px solid #F0F1EF", flexWrap: "wrap", gap: 12 }}>

        {/* Left: icon + title + unread badge */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 9, flexShrink: 0,
            background: unreadCount > 0
              ? "linear-gradient(135deg, #FCE5E5 0%, #F9CCCC 100%)"
              : "linear-gradient(135deg, #FFF0E8 0%, #FFE0CC 100%)",
            border: `1px solid ${unreadCount > 0 ? "#F0B0B0" : "#F5D5C0"}`,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
              <path d="M8 1.5A4.5 4.5 0 0 0 3.5 6v3L2 10.5h12L12.5 9V6A4.5 4.5 0 0 0 8 1.5Z"
                stroke={unreadCount > 0 ? "#D03A3A" : "#E76A2D"} strokeWidth="1.4" fill="none" strokeLinejoin="round"/>
              <path d="M6.5 12.5a1.5 1.5 0 0 0 3 0" stroke={unreadCount > 0 ? "#D03A3A" : "#E76A2D"} strokeWidth="1.4" strokeLinecap="round" fill="none"/>
            </svg>
          </div>
          <span style={{ fontSize: 15, fontWeight: 700, color: "#1A2329", letterSpacing: "-0.015em" }}>
            Alertas
          </span>
          {unreadCount > 0 && (
            <span style={{
              display: "inline-flex", alignItems: "center",
              padding: "2px 9px", borderRadius: 99,
              fontSize: 11.5, fontWeight: 700, color: "#D03A3A",
              background: "#FCE5E5", border: "1px solid #F0B0B0",
            }}>
              {unreadCount} sin leer
            </span>
          )}
        </div>

        {/* Right: segmented filter + mark all read */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Segmented tabs */}
          <div style={{ display: "flex", background: "#F4F1EB", borderRadius: 8, padding: 3, border: "1px solid #ECE7DD", gap: 1 }}>
            {FILTERS.map(({ id, label }) => {
              const isActive = filter === id;
              const count    = counts[id];
              return (
                <button
                  key={id}
                  onClick={() => setFilter(id)}
                  style={{
                    display: "flex", alignItems: "center", gap: 5,
                    padding: "4px 10px", borderRadius: 6, border: "none", cursor: "pointer",
                    fontSize: 12, fontWeight: isActive ? 600 : 500,
                    color: isActive ? "#1B1B1A" : "#6B6A66",
                    background: isActive ? "#fff" : "transparent",
                    boxShadow: isActive ? "0 1px 3px rgba(0,0,0,0.07)" : "none",
                    transition: "all 0.12s",
                  }}
                >
                  {label}
                  <span style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    minWidth: 18, height: 16, borderRadius: 99, padding: "0 4px",
                    fontSize: 10, fontWeight: 700,
                    background: isActive
                      ? (id === "no_leidas" && count > 0 ? "#D03A3A" : "#E6E7E5")
                      : "transparent",
                    color: isActive
                      ? (id === "no_leidas" && count > 0 ? "#fff" : "#5B6770")
                      : "#ADAAA4",
                  }}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Mark all read */}
          {unreadCount > 0 && (
            <button
              onClick={onMarkAllRead}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "7px 12px", borderRadius: 8,
                fontSize: 12, fontWeight: 600, color: "#5B6770",
                background: "#fff", border: "1px solid #E6E7E5",
                cursor: "pointer", transition: "border-color 0.15s, color 0.15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "#1F8A5B"; e.currentTarget.style.color = "#1F8A5B"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "#E6E7E5"; e.currentTarget.style.color = "#5B6770"; }}
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <rect x="1.5" y="1.5" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="1.4" fill="none"/>
                <path d="M4.5 8l2.5 2.5 4-4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Marcar todas como leídas
            </button>
          )}
        </div>
      </div>

      {/* ── Alert list ── */}
      {filtered.length === 0 ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "52px 24px", gap: 10 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: "#F0F1EF", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
              <path d="M8 1.5A4.5 4.5 0 0 0 3.5 6v3L2 10.5h12L12.5 9V6A4.5 4.5 0 0 0 8 1.5Z" stroke="#94928D" strokeWidth="1.4" fill="none" strokeLinejoin="round"/>
              <path d="M6.5 12.5a1.5 1.5 0 0 0 3 0" stroke="#94928D" strokeWidth="1.4" strokeLinecap="round" fill="none"/>
            </svg>
          </div>
          <div style={{ textAlign: "center" }}>
            <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: "#3E4A52" }}>
              {alerts.length === 0 ? "No hay alertas para esta obra" : filter === "no_leidas" ? "No hay alertas pendientes" : "No hay alertas con este filtro"}
            </p>
            <p style={{ margin: "3px 0 0", fontSize: 12, color: "#8E97A0" }}>
              {filter === "no_leidas" ? "Estás al día." : "Cambiá el filtro para ver más."}
            </p>
          </div>
        </div>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {filtered.map((alert, idx) => {
            const s          = getTypeStyle(alert);
            const isRead     = alert.is_read;
            const taskExists = alert.task_id != null && tasks.some(t => t.id === alert.task_id);
            const canNavigate = !isRead && taskExists;

            return (
              <li
                key={alert.id}
                style={{
                  display: "flex", alignItems: "stretch",
                  borderBottom: idx < filtered.length - 1 ? "1px solid #F2F0EC" : "none",
                  opacity: isRead ? 0.45 : 1,
                  transition: "opacity 0.2s",
                }}
              >
                {/* Left accent bar */}
                <div style={{ width: 3, flexShrink: 0, background: isRead ? "#E6E7E5" : s.bar }} />

                {/* Content */}
                <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 12, padding: "12px 20px", minWidth: 0 }}>

                  {/* Type badge */}
                  <span style={{
                    flexShrink: 0,
                    display: "inline-flex", alignItems: "center",
                    padding: "3px 8px", borderRadius: 99,
                    fontSize: 10, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.07em",
                    background: isRead ? "#F0F1EF" : s.bg,
                    color: isRead ? "#94928D" : s.color,
                    border: `1px solid ${isRead ? "#E6E7E5" : s.border}`,
                    whiteSpace: "nowrap" as const,
                  }}>
                    {getAlertLabel(alert)}
                  </span>

                  {/* Message */}
                  <p style={{ flex: 1, margin: 0, fontSize: 13, color: "#3E4A52", lineHeight: 1.4, minWidth: 0 }}>
                    {alert.message}
                  </p>

                  {/* Date */}
                  <span style={{
                    flexShrink: 0, fontSize: 11.5, color: "#ADAAA4",
                    fontFamily: "'JetBrains Mono', monospace", whiteSpace: "nowrap" as const,
                  }}>
                    {fmtDate(alert.created_at)}
                  </span>

                  {/* Actions */}
                  {!isRead && (
                    <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                      {canNavigate && (
                        <button
                          onClick={() => onViewTask(alert.task_id ?? undefined)}
                          style={{
                            display: "inline-flex", alignItems: "center", gap: 4,
                            padding: "5px 10px", borderRadius: 7,
                            fontSize: 12, fontWeight: 600, color: "#5B6770",
                            background: "transparent", border: "1px solid #E6E7E5",
                            cursor: "pointer", transition: "border-color 0.15s, color 0.15s",
                          }}
                          onMouseEnter={e => { e.currentTarget.style.borderColor = "#FF6B35"; e.currentTarget.style.color = "#FF6B35"; }}
                          onMouseLeave={e => { e.currentTarget.style.borderColor = "#E6E7E5"; e.currentTarget.style.color = "#5B6770"; }}
                        >
                          Ver tarea
                          <ArrowRight style={{ width: 11, height: 11 }} />
                        </button>
                      )}
                      {alert.task_id != null && !taskExists && (
                        <span style={{ fontSize: 10.5, color: "#ADAAA4", fontStyle: "italic" }}>
                          Tarea eliminada
                        </span>
                      )}
                      <button
                        onClick={() => onMarkRead(alert.id)}
                        title="Marcar como leída"
                        style={{
                          width: 30, height: 30, borderRadius: 8, border: "none",
                          background: "transparent", cursor: "pointer",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          color: "#ADAAA4", transition: "background 0.15s, color 0.15s",
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = "#E4F3EC"; e.currentTarget.style.color = "#1F8A5B"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#ADAAA4"; }}
                      >
                        <CheckCheck style={{ width: 13, height: 13 }} />
                      </button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
