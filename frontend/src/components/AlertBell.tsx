import { useEffect, useRef, useState } from "react";
import type { Alert } from "../types";

const TYPE_META: Record<Alert["type"], { icon: string; color: string; label: string }> = {
  task_blocked:          { icon: "🔴", color: "#D03A3A", label: "Tarea bloqueada" },
  task_overdue:          { icon: "⏰", color: "#D03A3A", label: "Tarea vencida" },
  delay_risk:            { icon: "⚠️", color: "#C97D0E", label: "Riesgo de demora" },
  no_response:           { icon: "💬", color: "#C97D0E", label: "Sin respuesta" },
  reschedule_requested:  { icon: "📅", color: "#3A6BD9", label: "Reprogramación solicitada" },
};

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "ahora";
  if (diff < 3600) return `hace ${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)}h`;
  return `hace ${Math.floor(diff / 86400)}d`;
}

interface Props {
  alerts: Alert[];
  unreadCount: number;
  onMarkRead: (id: number) => Promise<void>;
}

export function AlertBell({ alerts, unreadCount, onMarkRead }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (
        ref.current && !ref.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const recent = alerts.slice(0, 5);

  return (
    <div style={{ position: "relative" }}>
      <button
        ref={btnRef}
        onClick={() => setOpen(v => !v)}
        title="Alertas"
        style={{
          position: "relative",
          width: 34, height: 34, borderRadius: 99,
          background: open ? "#F0F1EF" : "#fff",
          border: "1px solid #E6E7E5",
          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          color: "#5B6770", transition: "background 0.15s, border-color 0.15s",
          flexShrink: 0,
        }}
        onMouseEnter={e => { if (!open) e.currentTarget.style.background = "#F4F5F4"; }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.background = "#fff"; }}
      >
        {/* Bell icon */}
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
          <path d="M8 1.5A4.5 4.5 0 0 0 3.5 6v2.5L2 10.5h12L12.5 8.5V6A4.5 4.5 0 0 0 8 1.5z" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinejoin="round"/>
          <path d="M6.5 13a1.5 1.5 0 0 0 3 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>

        {/* Badge */}
        {unreadCount > 0 && (
          <div style={{
            position: "absolute", top: -3, right: -3,
            minWidth: 16, height: 16, borderRadius: 99,
            background: "#D03A3A", color: "#fff",
            fontSize: 9, fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "'Plus Jakarta Sans', sans-serif",
            border: "2px solid #F4F5F4",
            padding: "0 3px",
          }}>
            {unreadCount > 99 ? "99+" : unreadCount}
          </div>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div
          ref={ref}
          style={{
            position: "absolute", top: "calc(100% + 8px)", right: 0,
            width: 320, background: "#fff", borderRadius: 14,
            border: "1px solid #E6E7E5",
            boxShadow: "0 8px 32px -8px rgba(0,0,0,0.14)",
            zIndex: 50, overflow: "hidden",
          }}
        >
          {/* Header */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "12px 14px 10px",
            borderBottom: "1px solid #F0F1EF",
          }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#1A2329", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
              Alertas
            </span>
            {unreadCount > 0 && (
              <span style={{
                fontSize: 10.5, fontWeight: 600, color: "#D03A3A",
                background: "#FCE5E5", borderRadius: 99, padding: "2px 8px",
                fontFamily: "'Plus Jakarta Sans', sans-serif",
              }}>
                {unreadCount} sin leer
              </span>
            )}
          </div>

          {/* Alert list */}
          {recent.length === 0 ? (
            <div style={{ padding: "24px 14px", textAlign: "center" }}>
              <p style={{ margin: 0, fontSize: 13, color: "#8E97A0", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                Sin alertas recientes
              </p>
            </div>
          ) : (
            <div>
              {recent.map(alert => {
                const meta = TYPE_META[alert.type] ?? { icon: "⚠️", color: "#C97D0E", label: alert.type };
                return (
                  <div
                    key={alert.id}
                    onClick={() => { if (!alert.is_read) onMarkRead(alert.id); }}
                    style={{
                      display: "flex", alignItems: "flex-start", gap: 10,
                      padding: "10px 14px",
                      background: alert.is_read ? "transparent" : "#FFF8F6",
                      borderBottom: "1px solid #F4F5F4",
                      cursor: alert.is_read ? "default" : "pointer",
                      transition: "background 0.1s",
                    }}
                    onMouseEnter={e => { if (!alert.is_read) e.currentTarget.style.background = "#FFF0EB"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = alert.is_read ? "transparent" : "#FFF8F6"; }}
                  >
                    {/* Dot unread */}
                    <div style={{ paddingTop: 4, flexShrink: 0 }}>
                      <div style={{
                        width: 7, height: 7, borderRadius: 99,
                        background: alert.is_read ? "#E6E7E5" : meta.color,
                        transition: "background 0.2s",
                      }} />
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 2 }}>
                        <span style={{ fontSize: 10.5, fontWeight: 700, color: meta.color, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                          {meta.icon} {meta.label}
                        </span>
                      </div>
                      <p style={{
                        margin: 0, fontSize: 12, color: alert.is_read ? "#8E97A0" : "#1A2329",
                        fontFamily: "'Plus Jakarta Sans', sans-serif", lineHeight: 1.4,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {alert.message}
                      </p>
                      <span style={{ fontSize: 10.5, color: "#ADAAA4", fontFamily: "'JetBrains Mono', monospace" }}>
                        {timeAgo(alert.created_at)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
