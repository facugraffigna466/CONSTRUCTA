import { useEffect, useState } from "react";
import type { Alert } from "../types";

const DISMISS_MS = 8000;

const TYPE_META: Record<string, { label: string; bg: string; border: string; icon: JSX.Element }> = {
  task_blocked: {
    label: "Tarea bloqueada",
    bg: "#FCE5E5", border: "#F0B0B0",
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="6.5" stroke="#D03A3A" strokeWidth="1.4"/>
        <path d="M8 5v3.5M8 10.5v.5" stroke="#D03A3A" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
  },
  task_overdue: {
    label: "Tarea vencida",
    bg: "#FCE5E5", border: "#F0B0B0",
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="6.5" stroke="#D03A3A" strokeWidth="1.4"/>
        <path d="M8 4v4.5l2.5 1.5" stroke="#D03A3A" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
};

interface Props {
  alert: Alert | null;
  onDismiss: () => void;
}

export function CriticalAlertToast({ alert, onDismiss }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!alert) { setVisible(false); return; }
    setVisible(true);
    const t = setTimeout(() => { setVisible(false); setTimeout(onDismiss, 350); }, DISMISS_MS);
    return () => clearTimeout(t);
  }, [alert, onDismiss]);

  const meta = alert ? (TYPE_META[alert.type] ?? TYPE_META["task_blocked"]) : null;

  if (!alert || !meta) return null;

  return (
    <div
      style={{
        position: "fixed", bottom: 24, right: 24, zIndex: 9999,
        transform: visible ? "translateY(0)" : "translateY(calc(100% + 32px))",
        opacity: visible ? 1 : 0,
        transition: "transform 0.35s cubic-bezier(0.34,1.4,0.64,1), opacity 0.25s ease",
        pointerEvents: visible ? "auto" : "none",
      }}
    >
      <div style={{
        display: "flex", alignItems: "flex-start", gap: 12,
        background: "#fff", border: `1px solid ${meta.border}`,
        borderLeft: `4px solid #D03A3A`,
        borderRadius: 14, padding: "12px 14px",
        boxShadow: "0 8px 32px -8px rgba(208,58,58,0.25), 0 2px 8px -2px rgba(0,0,0,0.08)",
        minWidth: 300, maxWidth: 380,
      }}>
        <div style={{ marginTop: 1, flexShrink: 0 }}>{meta.icon}</div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{
            margin: 0, fontSize: 11.5, fontWeight: 700, color: "#D03A3A",
            fontFamily: "'Plus Jakarta Sans', sans-serif",
            textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 3,
          }}>
            {meta.label}
          </p>
          <p style={{
            margin: 0, fontSize: 13, color: "#1A2329", lineHeight: 1.4,
            fontFamily: "'Plus Jakarta Sans', sans-serif",
            overflow: "hidden", display: "-webkit-box",
            WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
          }}>
            {alert.message}
          </p>
        </div>

        <button
          onClick={() => { setVisible(false); setTimeout(onDismiss, 350); }}
          style={{
            flexShrink: 0, width: 22, height: 22, borderRadius: 6,
            background: "transparent", border: "none",
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            color: "#ADAAA4", marginTop: -2,
            transition: "background 0.1s, color 0.1s",
          }}
          onMouseEnter={e => { e.currentTarget.style.background = "#F4F5F4"; e.currentTarget.style.color = "#5B6770"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#ADAAA4"; }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
    </div>
  );
}
