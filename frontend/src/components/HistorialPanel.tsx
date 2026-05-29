import { useState } from "react";
import { Activity } from "lucide-react";
import type { HistorialEvento, Task } from "../types/index";

// ─── Badge types ──────────────────────────────────────────────────────────────

type BadgeType = "new" | "completed" | "blocked" | "reschedule" | "progress" | "alert" | "updated" | "cancelled";
type HistorialFilter = "todos" | "tareas" | "alertas" | "obra" | "sistema";

const BADGE: Record<BadgeType, { label: string; dot: string; color: string; bg: string; border: string }> = {
  new:        { label: "Nueva tarea",    dot: "#8E97A0", color: "#5B6770", bg: "#F0F1EF", border: "#E0E3E1" },
  completed:  { label: "Completada",     dot: "#1F8A5B", color: "#136E47", bg: "#E4F3EC", border: "#BFE3CE" },
  blocked:    { label: "Bloqueada",      dot: "#D03A3A", color: "#A82B2B", bg: "#FCE5E5", border: "#F0B0B0" },
  reschedule: { label: "Reprogramación", dot: "#2A6FDB", color: "#1A4FA8", bg: "#E5EEFB", border: "#B3CEFA" },
  progress:   { label: "En progreso",    dot: "#E85A26", color: "#C74018", bg: "#FFF1E9", border: "#FDBFA0" },
  alert:      { label: "Alerta",         dot: "#C97D0E", color: "#9A5D08", bg: "#FDF1DE", border: "#F0D5A0" },
  updated:    { label: "Actualización",  dot: "#8E97A0", color: "#5B6770", bg: "#F0F1EF", border: "#E0E3E1" },
  cancelled:  { label: "Cancelada",      dot: "#D03A3A", color: "#A82B2B", bg: "#FCE5E5", border: "#F0B0B0" },
};

const FILTERS: { id: HistorialFilter; label: string }[] = [
  { id: "todos",   label: "Todos" },
  { id: "tareas",  label: "Tareas" },
  { id: "alertas", label: "Alertas" },
  { id: "obra",    label: "Obra" },
  { id: "sistema", label: "Sistema" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  "#2A6FDB", "#1F8A5B", "#9A4DC9", "#C97D0E",
  "#D03A3A", "#2C6571", "#E85A26", "#6B4FBB", "#E91E8C",
];

function avatarColor(name: string): string {
  let h = 0;
  for (const c of name) h = ((h * 31) + c.charCodeAt(0)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function getInitials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("") || "?";
}

function relativeTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60)     return "hace unos segundos";
  if (diff < 3600)   return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400)  return `hace ${Math.floor(diff / 3600)} h`;
  if (diff < 172800) return "ayer";
  return `hace ${Math.floor(diff / 86400)} días`;
}

function fmtDate(val: unknown): string {
  if (!val) return "Sin fecha";
  const s = String(val);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [, m, d] = s.split("-");
    const months = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
    return `${parseInt(d)} ${months[parseInt(m) - 1]}`;
  }
  return s;
}

function getTaskTitle(ev: HistorialEvento, tasks?: Task[]): string {
  if (ev.task_id && tasks) {
    const t = tasks.find(t => t.id === ev.task_id);
    if (t) return t.title;
  }
  if (ev.event_type === "task_deleted" && ev.payload?.title) return String(ev.payload.title);
  for (const re of [/Task '(.+?)' created/, /[«'"](.+?)[»'"]/, /tarea «(.+?)»/i]) {
    const m = ev.description.match(re);
    if (m) return m[1];
  }
  return "tarea";
}

function matchesFilter(ev: HistorialEvento, filter: HistorialFilter): boolean {
  switch (filter) {
    case "tareas":  return ev.event_type.startsWith("task_");
    case "alertas": return ev.event_type === "alert_created";
    case "obra":    return ev.event_type.startsWith("obra_");
    case "sistema": return ev.triggered_by === "chatbot" || ev.triggered_by === "system";
    default:        return true;
  }
}

// ─── Row builder ──────────────────────────────────────────────────────────────

interface RowData {
  actorName: string;
  avatarBg: string;
  sentence: React.ReactNode;
  badge: BadgeType;
  time: string;
}

type ChangeEntry = { from?: unknown; to?: unknown; from_label?: unknown; to_label?: unknown };

function buildRow(ev: HistorialEvento, tasks?: Task[]): RowData {
  const actor = ev.payload?.actor as { name?: string } | undefined;
  const isSystem = ev.triggered_by === "system";
  const isChatbot = ev.triggered_by === "chatbot";
  const name = actor?.name || (isChatbot ? "WhatsApp" : "Sistema");
  const avatarBg = (isSystem || isChatbot) ? "#8E97A0" : avatarColor(name);
  const taskTitle = getTaskTitle(ev, tasks);

  let sentence: React.ReactNode = ev.description;
  let badge: BadgeType = "updated";

  switch (ev.event_type) {
    case "task_created":
      sentence = <>{name} creó <strong>{taskTitle}</strong></>;
      badge = "new";
      break;

    case "task_deleted":
      sentence = <>{name} eliminó <strong>{taskTitle}</strong></>;
      badge = "cancelled";
      break;

    case "task_status_changed": {
      const to = String(ev.payload?.to ?? "");
      const reason = ev.payload?.reason ? String(ev.payload.reason) : null;
      switch (to) {
        case "completada":
          sentence = <>{name} completó <strong>{taskTitle}</strong></>;
          badge = "completed";
          break;
        case "bloqueada":
          sentence = (
            <>{name} bloqueó <strong>{taskTitle}</strong>
              {reason && <span style={{ color: "#8E97A0" }}> · {reason}</span>}
            </>
          );
          badge = "blocked";
          break;
        case "en_progreso":
          sentence = <>{name} inició <strong>{taskTitle}</strong></>;
          badge = "progress";
          break;
        case "cancelada":
          sentence = <>{name} canceló <strong>{taskTitle}</strong></>;
          badge = "cancelled";
          break;
        default:
          sentence = <>{name} actualizó el estado de <strong>{taskTitle}</strong></>;
          badge = "updated";
      }
      break;
    }

    case "task_updated": {
      const changes = ev.payload?.changes as Record<string, ChangeEntry> | undefined;
      if (changes) {
        const fields = Object.keys(changes);
        const hasDue   = fields.includes("due_date");
        const hasStart = fields.includes("start_date");
        if (hasDue || hasStart) {
          if (hasDue && hasStart) {
            const se = changes.start_date;
            const de = changes.due_date;
            const sf = se.from_label != null ? String(se.from_label) : fmtDate(se.from);
            const st = se.to_label   != null ? String(se.to_label)   : fmtDate(se.to);
            const df = de.from_label != null ? String(de.from_label) : fmtDate(de.from);
            const dt = de.to_label   != null ? String(de.to_label)   : fmtDate(de.to);
            sentence = (
              <>{name} reprogramó las <strong>fechas</strong> de <strong>{taskTitle}</strong>{" · "}
                Inicio: <span style={{ color: "#8E97A0", textDecoration: "line-through" }}>{sf}</span>{" → "}<strong>{st}</strong>
                {" · "}
                Fin: <span style={{ color: "#8E97A0", textDecoration: "line-through" }}>{df}</span>{" → "}<strong>{dt}</strong>
              </>
            );
          } else {
            const field     = hasDue ? "due_date" : "start_date";
            const dateLabel = hasDue ? "fecha de fin" : "fecha de inicio";
            const entry = changes[field];
            const from = entry.from_label != null ? String(entry.from_label) : fmtDate(entry.from);
            const to   = entry.to_label   != null ? String(entry.to_label)   : fmtDate(entry.to);
            sentence = (
              <>{name} reprogramó la <strong>{dateLabel}</strong> de <strong>{taskTitle}</strong>{" · "}
                <span style={{ color: "#8E97A0", textDecoration: "line-through" }}>{from}</span>
                {" → "}<strong>{to}</strong>
              </>
            );
          }
          badge = "reschedule";
          break;
        }
        if (fields.includes("responsible_id")) {
          const entry = changes.responsible_id;
          const to = entry.to_label != null ? String(entry.to_label) : "Sin responsable";
          sentence = <>{name} asignó <strong>{taskTitle}</strong> a {to}</>;
          badge = "updated";
          break;
        }
      }
      sentence = <>{name} actualizó <strong>{taskTitle}</strong></>;
      badge = "updated";
      break;
    }

    case "task_rescheduled": {
      const from = fmtDate(ev.payload?.from);
      const to   = fmtDate(ev.payload?.to);
      sentence = (
        <>{name} reprogramó la <strong>fecha de fin</strong> de <strong>{taskTitle}</strong>{" · "}
          <span style={{ color: "#8E97A0", textDecoration: "line-through" }}>{from}</span>
          {" → "}<strong>{to}</strong>
        </>
      );
      badge = "reschedule";
      break;
    }

    case "alert_created": {
      const ALERT_LABELS: Record<string, string> = {
        delay_risk:            "Riesgo de demora",
        task_blocked:          "Tarea bloqueada",
        task_overdue:          "Tarea vencida",
        no_response:           "Sin respuesta",
        reschedule_requested:  "Demora informada",
      };
      const alertType  = String(ev.payload?.alert_type ?? "");
      const alertLabel = ALERT_LABELS[alertType] ?? "alerta";
      const hasTask    = !!ev.task_id;
      sentence = hasTask
        ? <span style={{ color: "#8E97A0" }}>Sistema detectó <strong style={{ color: "#C97D0E" }}>{alertLabel}</strong> en <strong style={{ color: "#1A2329" }}>{taskTitle}</strong></span>
        : <span style={{ color: "#8E97A0" }}>Sistema detectó <strong style={{ color: "#C97D0E" }}>{alertLabel}</strong> en la obra</span>;
      badge = "alert";
      break;
    }

    case "reschedule_requested": {
      const respName     = ev.payload?.responsible_name ? String(ev.payload.responsible_name) : name;
      const suggestedRaw = ev.payload?.suggested_date   ? String(ev.payload.suggested_date)   : null;
      const suggested    = suggestedRaw ? fmtDate(suggestedRaw) : "fecha sin especificar";
      sentence = (
        <><strong>{respName}</strong> sugirió nueva fecha de fin para <strong>{taskTitle}</strong>{": "}<strong>{suggested}</strong></>
      );
      badge = "reschedule";
      break;
    }

    case "obra_created":
      sentence = <>{name} creó la obra</>;
      badge = "new";
      break;

    case "obra_updated":
      sentence = <>{name} actualizó la obra</>;
      badge = "updated";
      break;
  }

  return { actorName: name, avatarBg, sentence, badge, time: relativeTime(ev.created_at) };
}

// ─── Component ────────────────────────────────────────────────────────────────

interface HistorialPanelProps {
  events: HistorialEvento[];
  tasks?: Task[];
  filterable?: boolean;
}

export function HistorialPanel({ events, tasks, filterable = false }: HistorialPanelProps) {
  const [filter, setFilter] = useState<HistorialFilter>("todos");
  const displayed = filterable ? events.filter(ev => matchesFilter(ev, filter)) : events;

  if (events.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 0", color: "#8E97A0", fontSize: 13, gap: 8 }}>
        <Activity style={{ width: 28, height: 28, opacity: 0.3 }} />
        <span>No hay eventos registrados.</span>
      </div>
    );
  }

  return (
    <div>
      {/* ── Filter pills ── */}
      {filterable && (
        <div style={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap", marginBottom: 0, paddingBottom: 12, borderBottom: "1px solid #F0F1EF" }}>
          {FILTERS.map(({ id, label }) => {
            const isActive = filter === id;
            const count = id === "todos" ? events.length : events.filter(ev => matchesFilter(ev, id)).length;
            return (
              <button
                key={id}
                onClick={() => setFilter(id)}
                style={{
                  padding: "5px 12px", borderRadius: 8,
                  fontSize: 12, fontWeight: isActive ? 600 : 500,
                  background: isActive ? "#2F3A40" : "transparent",
                  color: isActive ? "#fff" : "#5B6770",
                  border: "none", cursor: "pointer",
                  transition: "background 0.12s, color 0.12s",
                }}
                onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = "#F0F1EF"; }}
                onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              >
                {label}
                <span style={{ marginLeft: 5, fontSize: 10.5, fontFamily: "'JetBrains Mono', monospace", opacity: 0.6 }}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* ── Empty filtered state ── */}
      {displayed.length === 0 ? (
        <div style={{ padding: "32px 0", textAlign: "center", color: "#8E97A0", fontSize: 13 }}>
          No hay eventos con este filtro.
        </div>
      ) : (
        <ol style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {displayed.map((ev, i) => {
            const row = buildRow(ev, tasks);
            const bdg = BADGE[row.badge];
            return (
              <li
                key={ev.id}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 14,
                  padding: "16px 0",
                  borderTop: i > 0 ? "1px solid #F0F1EF" : "none",
                }}
              >
                {/* Avatar */}
                <div style={{
                  width: 42, height: 42, borderRadius: 12, flexShrink: 0,
                  background: row.avatarBg,
                  color: "#fff",
                  fontFamily: "'Plus Jakarta Sans', sans-serif",
                  fontWeight: 700, fontSize: 13,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  letterSpacing: "0.02em",
                }}>
                  {getInitials(row.actorName)}
                </div>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 14, color: "#1A2329", lineHeight: 1.5 }}>
                    {row.sentence}
                  </p>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 7 }}>
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: 5,
                      padding: "2px 9px 2px 7px",
                      borderRadius: 99,
                      border: `1px solid ${bdg.border}`,
                      background: bdg.bg,
                      fontSize: 11.5, fontWeight: 600, color: bdg.color,
                      whiteSpace: "nowrap",
                    }}>
                      <span style={{ width: 6, height: 6, borderRadius: 99, background: bdg.dot, flexShrink: 0 }} />
                      {bdg.label}
                    </span>
                    <span style={{ fontSize: 12, color: "#8E97A0", whiteSpace: "nowrap" }}>
                      {row.time}
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
