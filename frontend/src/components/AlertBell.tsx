import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CalendarClock, Clock, MessageCircle, OctagonAlert, Package } from "lucide-react";
import type { Alert } from "../types";

const TYPE_META: Record<Alert["type"], { Icon: React.ComponentType<{ style?: React.CSSProperties }>; color: string; label: string }> = {
  task_blocked:          { Icon: OctagonAlert,  color: "#D03A3A", label: "Tarea bloqueada" },
  task_overdue:          { Icon: Clock,         color: "#D03A3A", label: "Tarea vencida" },
  delay_risk:            { Icon: AlertTriangle, color: "#C97D0E", label: "Riesgo de demora" },
  no_response:           { Icon: MessageCircle, color: "#C97D0E", label: "Sin respuesta" },
  reschedule_requested:  { Icon: CalendarClock, color: "#3A6BD9", label: "Reprogramación solicitada" },
  order_received:        { Icon: Package,       color: "#1F8A5B", label: "Pedido recibido" },
};

function AlertRow({ alert, onAlertClick, setOpen, obraName }: { alert: Alert; onAlertClick: (a: Alert) => void; setOpen: (v: boolean) => void; obraName?: string }) {
  const meta = TYPE_META[alert.type] ?? { Icon: AlertTriangle, color: "#C97D0E", label: alert.type };
  return (
    <div
      onClick={() => { if (alert.obra_id) { setOpen(false); onAlertClick(alert); } }}
      style={{
        display: "flex", alignItems: "flex-start", gap: 10,
        padding: "10px 14px", background: "#FFF8F6",
        borderBottom: "1px solid #F4F5F4",
        cursor: alert.obra_id ? "pointer" : "default",
        transition: "background 0.1s",
      }}
      onMouseEnter={e => { if (alert.obra_id) e.currentTarget.style.background = "#FFF0EB"; }}
      onMouseLeave={e => { e.currentTarget.style.background = "#FFF8F6"; }}
    >
      <div style={{ paddingTop: 4, flexShrink: 0 }}>
        <div style={{ width: 7, height: 7, borderRadius: 99, background: meta.color }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2, flexWrap: "wrap" }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: meta.color, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            <meta.Icon style={{ width: 11, height: 11, color: meta.color, flexShrink: 0 }} /> {meta.label}
          </span>
          {obraName && (
            <span style={{
              fontSize: 10, fontWeight: 600, color: "#fff",
              background: "#8E97A0", borderRadius: 99,
              padding: "1px 7px", fontFamily: "'Plus Jakarta Sans', sans-serif",
              whiteSpace: "nowrap",
            }}>
              {obraName}
            </span>
          )}
        </div>
        <p style={{
          margin: 0, fontSize: 12, color: "#1A2329",
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
}

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
  onAlertClick: (alert: Alert) => void;
  obraNames?: Map<number, string>;
  groupByObra?: boolean;
}

export function AlertBell({ alerts, unreadCount, onAlertClick, obraNames, groupByObra }: Props) {
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

  // Bloquear scroll del fondo: solo prevenir cuando el contenido interno llegó al límite
  useEffect(() => {
    if (!open || !ref.current) return;
    const el = ref.current;
    function blockScroll(e: WheelEvent) {
      const list = el.querySelector("[data-scroll-list]") as HTMLElement | null;
      if (!list) { e.preventDefault(); return; }
      const { scrollTop, scrollHeight, clientHeight } = list;
      const atTop    = e.deltaY < 0 && scrollTop === 0;
      const atBottom = e.deltaY > 0 && scrollTop + clientHeight >= scrollHeight - 1;
      if (atTop || atBottom) e.preventDefault();
    }
    el.addEventListener("wheel", blockScroll, { passive: false });
    return () => el.removeEventListener("wheel", blockScroll);
  }, [open]);

  // Solo mostrar no leídas
  const recent = alerts.filter(a => !a.is_read);

  const hasUnread = unreadCount > 0;

  return (
    <div style={{ position: "relative" }}>
      <button
        ref={btnRef}
        onClick={() => setOpen(v => !v)}
        title={hasUnread ? `${unreadCount} alerta${unreadCount > 1 ? "s" : ""} sin leer` : "Alertas"}
        style={{
          position: "relative",
          width: 36, height: 36, borderRadius: 99,
          background: open
            ? (hasUnread ? "rgba(255,107,53,0.18)" : "#F0F1EF")
            : (hasUnread ? "rgba(255,107,53,0.10)" : "#fff"),
          border: `1.5px solid ${hasUnread ? "rgba(255,107,53,0.35)" : "#E6E7E5"}`,
          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          color: hasUnread ? "#FF6B35" : "#5B6770",
          transition: "background 0.15s, border-color 0.15s, color 0.15s",
          flexShrink: 0,
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = hasUnread ? "rgba(255,107,53,0.18)" : "#F4F5F4";
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = open
            ? (hasUnread ? "rgba(255,107,53,0.18)" : "#F0F1EF")
            : (hasUnread ? "rgba(255,107,53,0.10)" : "#fff");
        }}
      >
        {/* Bell icon — filled when unread */}
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path
            d="M8 1.5A4.5 4.5 0 0 0 3.5 6v2.5L2 10.5h12L12.5 8.5V6A4.5 4.5 0 0 0 8 1.5z"
            stroke="currentColor" strokeWidth="1.5"
            fill={hasUnread ? "currentColor" : "none"}
            fillOpacity={hasUnread ? 0.15 : 0}
            strokeLinejoin="round"
          />
          <path d="M6.5 13a1.5 1.5 0 0 0 3 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          {hasUnread && (
            <circle cx="11.5" cy="4" r="2.5" fill="#D03A3A" stroke="#fff" strokeWidth="1.2"/>
          )}
        </svg>

        {/* Badge numérico */}
        {unreadCount > 0 && (
          <div style={{
            position: "absolute", top: -4, right: -4,
            minWidth: 18, height: 18, borderRadius: 99,
            background: "#D03A3A", color: "#fff",
            fontSize: 9.5, fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "'Plus Jakarta Sans', sans-serif",
            border: "2px solid #F4F5F4",
            padding: "0 4px",
            letterSpacing: "-0.02em",
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
                Sin alertas pendientes
              </p>
            </div>
          ) : (
            <div data-scroll-list style={{ maxHeight: 360, overflowY: "auto", overscrollBehavior: "contain" }}>
              {(() => {
                if (!groupByObra) {
                  return recent.map(alert => <AlertRow key={alert.id} alert={alert} onAlertClick={onAlertClick} setOpen={setOpen} />);
                }
                // Panel — mostrar nombre de obra como chip en cada alerta, agrupadas
                const groups = new Map<number | null, Alert[]>();
                for (const a of recent) {
                  const key = a.obra_id ?? null;
                  if (!groups.has(key)) groups.set(key, []);
                  groups.get(key)!.push(a);
                }
                return Array.from(groups.entries()).flatMap(([obraId, groupAlerts]) =>
                  groupAlerts.map(alert => (
                    <AlertRow
                      key={alert.id}
                      alert={alert}
                      onAlertClick={onAlertClick}
                      setOpen={setOpen}
                      obraName={obraId && obraNames?.get(obraId) ? obraNames.get(obraId) : undefined}
                    />
                  ))
                );
              })()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
