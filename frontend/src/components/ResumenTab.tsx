import { useState } from "react";
import type { CSSProperties } from "react";
import {
  AlertTriangle,
  ArrowRight, Calendar, Activity,
} from "lucide-react";
import { GanttTimeline } from "./GanttTimeline";
import { HistorialPanel } from "./HistorialPanel";
import type { Alert, HistorialEvento, Responsible, Task, TaskStatus } from "../types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TODAY = new Date().toISOString().slice(0, 10);

function isActive(task: Task) {
  return task.status !== "completada" && task.status !== "cancelada";
}

// ─── Progress ring ────────────────────────────────────────────────────────────

const RING_R    = 26;
const RING_CIRC = 2 * Math.PI * RING_R;

function ProgressRing({ pct }: { pct: number }) {
  const offset = (1 - pct / 100) * RING_CIRC;
  return (
    <div style={{ width: 64, height: 64, position: "relative", flexShrink: 0 }}>
      <svg width="64" height="64" viewBox="0 0 64 64" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="32" cy="32" r={RING_R} stroke="#F0F1EF" strokeWidth="7" fill="none"/>
        <circle
          cx="32" cy="32" r={RING_R}
          stroke="url(#kpi-ring-grad)" strokeWidth="7" fill="none"
          strokeDasharray={RING_CIRC}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
        <defs>
          <linearGradient id="kpi-ring-grad" x1="0" y1="0" x2="64" y2="64">
            <stop offset="0%" stopColor="#FF8856"/>
            <stop offset="100%" stopColor="#E85A26"/>
          </linearGradient>
        </defs>
      </svg>
      <div style={{
        position: "absolute", inset: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "'Plus Jakarta Sans', sans-serif",
        fontWeight: 700, fontSize: 15, letterSpacing: "-0.02em", color: "#1A2329",
      }}>
        {pct}%
      </div>
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface ResumenTabProps {
  tasks: Task[];
  alerts: Alert[];
  historial: HistorialEvento[];
  responsibles: Responsible[];
  obraStartDate?: string | null;
  obraExpectedEndDate?: string | null;
  obraId?: number;
  error: string | null;
  onMarkRead: (id: number) => void;
  onViewAlerts: () => void;
  onViewTareas: () => void;
  onViewHistorial?: () => void;
  onEditTask: (task: Task) => void;
  onTaskRescheduled: () => void;
  onStatusChange?: (task: Task, newStatus: TaskStatus) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ResumenTab({
  tasks,
  alerts,
  historial,
  responsibles,
  obraStartDate,
  obraExpectedEndDate,
  obraId,
  error,
  onViewAlerts,
  onViewTareas,
  onViewHistorial,
  onEditTask,
  onTaskRescheduled,
  onStatusChange,
}: ResumenTabProps) {
  const [draggingId, setDraggingId] = useState<number | null>(null);

  // ── Derived metrics ──────────────────────────────────────────────────────────
  const total          = tasks.length;
  const activeCount    = tasks.filter(isActive).length;
  const completedCount = tasks.filter((t) => t.status === "completada").length;
  const unreadAlerts   = alerts.filter((a) => !a.is_read);
  const unreadCount    = unreadAlerts.length;
  const nonCancelled = tasks.filter((t) => t.status !== "cancelada");
  const avgProgress  = nonCancelled.length === 0
    ? 0
    : Math.round((completedCount / nonCancelled.length) * 100);

  const tasksWithoutDates = tasks.filter((t) => !t.start_date && !t.due_date);

  const topAlert =
    unreadAlerts.find((a) => !a.task_id) ??
    unreadAlerts.find((a) => a.type === "task_blocked") ??
    unreadAlerts[0] ??
    null;

  void topAlert;

  // ── Critical tasks ───────────────────────────────────────────────────────────
  const seen = new Set<number>();
  const criticalTasks: Task[] = [];
  for (const t of [
    ...tasks.filter((t) => t.status === "bloqueada"),
    ...tasks.filter((t) => isActive(t) && !!t.due_date && t.due_date < TODAY && t.status !== "bloqueada"),
    ...tasks.filter((t) => isActive(t) && !t.responsible_id && t.status !== "bloqueada" && !(t.due_date && t.due_date < TODAY)),
  ]) {
    if (!seen.has(t.id) && criticalTasks.length < 3) {
      seen.add(t.id);
      criticalTasks.push(t);
    }
  }

  // ── Distribution bars by status ──────────────────────────────────────────────
  const statusDist = total === 0 ? null : {
    completada:  tasks.filter(t => t.status === "completada").length  / total * 100,
    en_progreso: tasks.filter(t => t.status === "en_progreso").length / total * 100,
    pendiente:   tasks.filter(t => t.status === "pendiente").length   / total * 100,
    bloqueada:   tasks.filter(t => t.status === "bloqueada").length   / total * 100,
  };

  const avgProgressLabel =
    avgProgress === 0   ? "Sin tareas aún" :
    avgProgress === 100 ? "Proyecto completado" :
                          `Promedio de ${total} tareas`;

  const kpiTileStyle: CSSProperties = {
    background: "#fff",
    border: "1px solid #ECEEED",
    borderRadius: 16,
    padding: "18px 20px",
    display: "flex",
    flexDirection: "column",
    gap: 12,
    position: "relative",
    overflow: "hidden",
  };

  const kpiLabelStyle: CSSProperties = {
    fontFamily: "'Plus Jakarta Sans', sans-serif",
    fontSize: 11, fontWeight: 600,
    letterSpacing: "0.06em", textTransform: "uppercase" as const,
    color: "#A0ABB4",
  };

  const kpiIconStyle = (bg: string, color: string): CSSProperties => ({
    width: 32, height: 32, borderRadius: 10,
    background: bg, color,
    display: "flex", alignItems: "center", justifyContent: "center",
    flexShrink: 0,
  });

  return (
    <div className="space-y-5">
      {/* ── API error ── */}
      {error && (
        <div className="bg-red-50 border border-constructa-danger/30 text-constructa-danger text-sm rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      {/* ── 5-tile KPI strip ── */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1.4fr 1fr 1fr 1fr 1fr",
        gap: 14,
      }}>

        {/* ── KPI 1: Avance general (hero) ── */}
        <div style={kpiTileStyle}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={kpiLabelStyle}>Avance general</span>
            <div style={kpiIconStyle("#FFF1E9", "#FF6B35")}>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M1 8h3l2-5 3 10 2-5 4-1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <ProgressRing pct={avgProgress} />
            <div>
              <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 22, fontWeight: 700, letterSpacing: "-0.03em", color: "#1A2329", lineHeight: 1 }}>
                {total} tareas
              </div>
              <div style={{ fontSize: 11.5, color: "#5B6770", marginTop: 4 }}>{avgProgressLabel}</div>
            </div>
          </div>
          {statusDist && (
            <div style={{ display: "flex", height: 6, borderRadius: 99, overflow: "hidden", background: "#F0F1EF" }} title="Distribución por estado">
              {statusDist.completada  > 0 && <span style={{ background: "#1F8A5B", width: statusDist.completada  + "%" }} />}
              {statusDist.en_progreso > 0 && <span style={{ background: "#D97706", width: statusDist.en_progreso + "%" }} />}
              {statusDist.pendiente   > 0 && <span style={{ background: "#3B82F6", width: statusDist.pendiente   + "%" }} />}
              {statusDist.bloqueada   > 0 && <span style={{ background: "#D03A3A", width: statusDist.bloqueada   + "%" }} />}
            </div>
          )}
        </div>

        {/* ── KPI 2: Tareas activas ── */}
        <div style={kpiTileStyle}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={kpiLabelStyle}>Tareas activas</span>
            <div style={kpiIconStyle("#E5EEFB", "#2A6FDB")}>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4" fill="none"/><path d="M8 4.5V8l2.4 1.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none"/></svg>
            </div>
          </div>
          <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 30, fontWeight: 700, letterSpacing: "-0.03em", color: "#1A2329", lineHeight: 1 }}>
            {String(activeCount).padStart(2, "0")}
          </div>
          <div style={{ fontSize: 11.5, color: "#5B6770" }}>de <b style={{ color: "#1A2329" }}>{total}</b> en total</div>
        </div>

        {/* ── KPI 3: Completadas ── */}
        <div style={kpiTileStyle}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={kpiLabelStyle}>Completadas</span>
            <div style={kpiIconStyle("#E4F3EC", "#1F8A5B")}>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.4" fill="none"/><path d="M5 8.2l2 2 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>
            </div>
          </div>
          <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 30, fontWeight: 700, letterSpacing: "-0.03em", color: "#1F8A5B", lineHeight: 1 }}>
            {String(completedCount).padStart(2, "0")}
          </div>
          <div style={{ fontSize: 11.5, color: "#5B6770" }}>de <b style={{ color: "#1A2329" }}>{total}</b> en total</div>
        </div>

        {/* ── KPI 4: Alertas activas ── */}
        <div style={kpiTileStyle}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={kpiLabelStyle}>Alertas activas</span>
            <div style={kpiIconStyle("#FDF1DE", "#C97D0E")}>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M8 2.5L14 13H2L8 2.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" fill="none"/><path d="M8 6.5V9.5M8 11.4v.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
            </div>
          </div>
          <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 30, fontWeight: 700, letterSpacing: "-0.03em", color: unreadCount > 0 ? "#C97D0E" : "#1A2329", lineHeight: 1 }}>
            {String(unreadCount).padStart(2, "0")}
          </div>
          {unreadCount > 0 ? (
            <button onClick={onViewAlerts} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 600, color: "#C97D0E", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
              Ver alertas <ArrowRight style={{ width: 11, height: 11 }} />
            </button>
          ) : (
            <div style={{ fontSize: 11.5, color: "#1F8A5B" }}>Sin alertas</div>
          )}
        </div>

        {/* ── KPI 5: Tareas críticas ── */}
        <div style={kpiTileStyle}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={kpiLabelStyle}>Críticas</span>
            <div style={kpiIconStyle("#FCE5E5", "#D03A3A")}>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M8 14c2.5 0 4.5-1.7 4.5-4.4 0-2-1.6-2.9-2.5-3.6.5-2 0-3.5-2-4 .5 2.5-2 4-3.7 5.4-.8.7-1.3 1.6-1.3 2.7C3 12.4 5.4 14 8 14z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" fill="none"/></svg>
            </div>
          </div>
          <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 30, fontWeight: 700, letterSpacing: "-0.03em", color: criticalTasks.length > 0 ? "#D03A3A" : "#1A2329", lineHeight: 1 }}>
            {String(criticalTasks.length).padStart(2, "0")}
          </div>
          {criticalTasks.length > 0 ? (
            <button onClick={onViewTareas} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 600, color: "#D03A3A", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
              Ver tareas <ArrowRight style={{ width: 11, height: 11 }} />
            </button>
          ) : (
            <div style={{ fontSize: 11.5, color: "#1F8A5B" }}>Sin tareas críticas</div>
          )}
        </div>
      </div>

      {/* ── Gantt timeline ────────────────────────────────────────────────────── */}
      <section>
        <GanttTimeline
          tasks={tasks}
          responsibles={responsibles}
          obraStartDate={obraStartDate}
          obraExpectedEndDate={obraExpectedEndDate}
          onSaved={onTaskRescheduled}
          onEditTask={onEditTask}
          onStatusChange={onStatusChange}
          tasksWithoutDates={tasksWithoutDates.length}
          obraId={obraId}
        />
      </section>

      {/* ── Lower two-column section ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Tareas sin fechas */}
        <section className="flex flex-col">
          <div style={{
            background: "#fff",
            border: "1px solid #E6E7E5",
            borderRadius: 14,
            overflow: "hidden",
            flex: 1,
          }}>
            {/* Header */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "14px 20px",
              borderBottom: tasksWithoutDates.length > 0 ? "1px solid #F0F1EF" : "none",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{
                  width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                  background: tasksWithoutDates.length > 0 ? "#FDF1DE" : "#E4F3EC",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {tasksWithoutDates.length > 0
                    ? <AlertTriangle style={{ width: 15, height: 15, color: "#C97D0E" }} />
                    : <Calendar style={{ width: 15, height: 15, color: "#1F8A5B" }} />
                  }
                </div>
                <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 15, fontWeight: 700, color: "#1A2329", letterSpacing: "-0.01em" }}>
                  Tareas sin fechas
                </span>
                <span style={{
                  fontSize: 11.5, fontWeight: 600,
                  padding: "2px 9px", borderRadius: 99,
                  background: tasksWithoutDates.length > 0 ? "#FDF1DE" : "#F0F1EF",
                  color: tasksWithoutDates.length > 0 ? "#9A5D08" : "#5B6770",
                  fontFamily: "'JetBrains Mono', monospace",
                }}>
                  {tasksWithoutDates.length}
                </span>
              </div>
              {tasksWithoutDates.length > 5 && (
                <button
                  onClick={onViewTareas}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 5,
                    fontSize: 13, fontWeight: 600, color: "#FF6B35",
                    background: "none", border: "none", cursor: "pointer", padding: 0,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.color = "#E85A26")}
                  onMouseLeave={e => (e.currentTarget.style.color = "#FF6B35")}
                >
                  Ver todas
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              )}
            </div>

            {/* Rows */}
            {tasksWithoutDates.length === 0 ? (
              <div style={{ padding: "32px 20px", textAlign: "center", color: "#6B7580", fontSize: 13 }}>
                Todas las tareas tienen fechas definidas.
              </div>
            ) : (
              <ol style={{ margin: 0, padding: "0 20px", listStyle: "none" }}>
                {tasksWithoutDates.slice(0, 5).map((t, i) => {
                  const STATUS_STYLE: Record<string, { label: string; dot: string; color: string; bg: string; border: string; avatarBg: string }> = {
                    pendiente:   { label: "Pendiente",   dot: "#3B82F6", color: "#1D4ED8", bg: "#EBF3FF", border: "#BFDBFE", avatarBg: "#3B82F6" },
                    en_progreso: { label: "En progreso", dot: "#D97706", color: "#92400E", bg: "#FFFBEB", border: "#FDE68A", avatarBg: "#D97706" },
                    bloqueada:   { label: "Bloqueada",   dot: "#D03A3A", color: "#A82B2B", bg: "#FCE5E5", border: "#F0B0B0", avatarBg: "#D03A3A" },
                    completada:  { label: "Completada",  dot: "#1F8A5B", color: "#136E47", bg: "#E4F3EC", border: "#BFE3CE", avatarBg: "#1F8A5B" },
                    cancelada:   { label: "Cancelada",   dot: "#8E97A0", color: "#5B6770", bg: "#F0F1EF", border: "#E0E3E1", avatarBg: "#8E97A0" },
                  };
                  const s = STATUS_STYLE[t.status] ?? STATUS_STYLE.pendiente;
                  const initials = t.title.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("");
                  const resp = responsibles.find(r => r.id === t.responsible_id);

                  return (
                    <li
                      key={t.id}
                      draggable
                      onDragStart={(e) => {
                        setDraggingId(t.id);
                        e.dataTransfer.setData("application/x-constructa-task", t.id.toString());
                        e.dataTransfer.effectAllowed = "copy";
                        const ghost = document.createElement("div");
                        ghost.style.cssText = "position:fixed;top:-9999px;left:-9999px;padding:7px 14px;border-radius:99px;background:#1B2A34;color:#fff;font:600 12.5px/1.4 'Plus Jakarta Sans',sans-serif;white-space:nowrap;pointer-events:none;";
                        ghost.textContent = t.title;
                        document.body.appendChild(ghost);
                        e.dataTransfer.setDragImage(ghost, ghost.offsetWidth / 2, ghost.offsetHeight / 2);
                        setTimeout(() => document.body.removeChild(ghost), 0);
                      }}
                      onDragEnd={() => setDraggingId(null)}
                      style={{
                        display: "flex", alignItems: "flex-start", gap: 14,
                        padding: "16px 0",
                        borderTop: i > 0 ? "1px solid #F0F1EF" : "none",
                        opacity: draggingId === t.id ? 0.4 : 1,
                        cursor: "grab",
                        transition: "opacity 0.15s",
                      }}
                    >
                      {/* Avatar */}
                      <div style={{
                        width: 42, height: 42, borderRadius: 12, flexShrink: 0,
                        background: s.avatarBg,
                        color: "#fff",
                        fontFamily: "'Plus Jakarta Sans', sans-serif",
                        fontWeight: 700, fontSize: 13,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        letterSpacing: "0.02em",
                      }}>
                        {initials || "#"}
                      </div>

                      {/* Content */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p
                          style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#1A2329", lineHeight: 1.45, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                          title={t.title}
                        >
                          {t.title}
                        </p>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 7 }}>
                          <span style={{
                            display: "inline-flex", alignItems: "center", gap: 5,
                            padding: "2px 9px 2px 7px", borderRadius: 99,
                            border: `1px solid ${s.border}`, background: s.bg,
                            fontSize: 11.5, fontWeight: 600, color: s.color, whiteSpace: "nowrap",
                          }}>
                            <span style={{ width: 6, height: 6, borderRadius: 99, background: s.dot, flexShrink: 0 }} />
                            {s.label}
                          </span>
                          <span style={{ fontSize: 12, color: "#6B7580", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {resp ? resp.full_name : "Sin responsable"}
                          </span>
                        </div>
                      </div>

                      {/* Action */}
                      <button
                        onClick={(e) => { e.stopPropagation(); onEditTask(t); }}
                        title="Agregar fechas"
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 5,
                          padding: "5px 11px", borderRadius: 8,
                          fontSize: 12, fontWeight: 600,
                          color: "#5B6770", background: "#F4F5F4",
                          border: "1px solid #E6E7E5", cursor: "pointer",
                          flexShrink: 0, transition: "background 0.12s, color 0.12s",
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#FFF1E9"; (e.currentTarget as HTMLElement).style.color = "#FF6B35"; (e.currentTarget as HTMLElement).style.borderColor = "#FDBFA0"; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F4"; (e.currentTarget as HTMLElement).style.color = "#5B6770"; (e.currentTarget as HTMLElement).style.borderColor = "#E6E7E5"; }}
                      >
                        <Calendar style={{ width: 12, height: 12 }} />
                        Programar
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </section>

        {/* Actividad reciente */}
        <section className="flex flex-col">
          <div style={{
            background: "#fff",
            border: "1px solid #E6E7E5",
            borderRadius: 14,
            overflow: "hidden",
            flex: 1,
          }}>
            {/* Header */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "14px 20px",
              borderBottom: historial.length > 0 ? "1px solid #F0F1EF" : "none",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{
                  width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                  background: "#FFF1E9",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <Activity style={{ width: 15, height: 15, color: "#FF6B35" }} />
                </div>
                <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 15, fontWeight: 700, color: "#1A2329", letterSpacing: "-0.01em" }}>
                  Actividad reciente
                </span>
                <span style={{
                  fontSize: 11.5, fontWeight: 600,
                  padding: "2px 9px", borderRadius: 99,
                  background: "#F0F1EF", color: "#5B6770",
                  fontFamily: "'JetBrains Mono', monospace",
                }}>
                  {historial.length} eventos
                </span>
              </div>
              {onViewHistorial && (
                <button
                  onClick={onViewHistorial}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 5,
                    fontSize: 13, fontWeight: 600, color: "#FF6B35",
                    background: "none", border: "none", cursor: "pointer", padding: 0,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.color = "#E85A26")}
                  onMouseLeave={e => (e.currentTarget.style.color = "#FF6B35")}
                >
                  Ver todo
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              )}
            </div>

            {/* Feed */}
            <div style={{ padding: "0 20px" }}>
              <HistorialPanel events={historial.slice(0, 5)} tasks={tasks} />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
