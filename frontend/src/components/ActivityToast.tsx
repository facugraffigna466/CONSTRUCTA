import { useEffect, useState } from "react";
import type { ActivityEvent } from "../hooks/useActivityFeed";

interface Props {
  event: ActivityEvent | null;
}

export function ActivityToast({ event }: Props) {
  const [visible, setVisible] = useState(false);
  const [current, setCurrent] = useState<ActivityEvent | null>(null);

  useEffect(() => {
    if (!event) return;
    setCurrent(event);
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 4200);
    return () => clearTimeout(t);
  }, [event]);

  if (!current) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        zIndex: 9999,
        transform: visible ? "translateY(0)" : "translateY(calc(100% + 24px))",
        opacity: visible ? 1 : 0,
        transition: "transform 0.35s cubic-bezier(0.34,1.56,0.64,1), opacity 0.25s ease",
        pointerEvents: visible ? "auto" : "none",
      }}
    >
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        background: "#2F3A40",
        borderRadius: 14,
        padding: "12px 16px",
        boxShadow: "0 8px 32px -8px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.06)",
        minWidth: 300,
        maxWidth: 380,
      }}>
        {/* Avatar */}
        <div style={{
          width: 34, height: 34, borderRadius: 99, flexShrink: 0,
          background: current.userColor, color: "#fff",
          fontWeight: 700, fontSize: 12,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: "'Plus Jakarta Sans', sans-serif",
          boxShadow: "0 0 0 2px rgba(255,255,255,0.12)",
        }}>
          {current.userInitials}
        </div>

        {/* Text */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, color: "#fff", fontFamily: "'Plus Jakarta Sans', sans-serif", lineHeight: 1.4 }}>
            <span style={{ fontWeight: 600 }}>{current.userName}</span>
            {" "}
            <span style={{ color: "rgba(255,255,255,0.65)" }}>{current.action}</span>
            {" "}
            <span style={{ fontWeight: 500, color: "#FF8856" }}>{current.target}</span>
            {current.detail && (
              <span style={{ color: "rgba(255,255,255,0.5)" }}> {current.detail}</span>
            )}
          </div>
          <div style={{
            fontSize: 11, color: "rgba(255,255,255,0.35)",
            marginTop: 2, fontFamily: "'JetBrains Mono', monospace",
          }}>
            ahora mismo
          </div>
        </div>

        {/* Green live dot */}
        <div style={{
          width: 8, height: 8, borderRadius: 99, flexShrink: 0,
          background: "#1F8A5B",
          boxShadow: "0 0 0 3px rgba(31,138,91,0.25)",
        }} />
      </div>
    </div>
  );
}
