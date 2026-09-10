import { useState } from "react";
import type { CSSProperties } from "react";
import {
  AlertTriangle,
  ArrowRight, Calendar, Activity, Route, Gauge, Flag, Boxes,
} from "lucide-react";
import { GanttTimeline } from "./GanttTimeline";
import { HistorialPanel } from "./HistorialPanel";
import type { Alert, HistorialEvento, ObraDashboard, Responsible, Task, TaskStatus } from "../types";
import { SEVERITY_LABEL, SEVERITY_ORDER, SEVERITY_PALETTE } from "../lib/alertMeta";
import { forecastReasonLabel, spiColor, spiLabel } from "../lib/dashboardMeta";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(d: string | null): string {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

// I-07: total de tareas consideradas por el CPM (críticas + en riesgo + holgadas),
// para las proporciones de la barra de 3 segmentos.
function cpTotal(cp: { critical_task_count: number; at_risk_task_count: number; slack_task_count: number }): number {
  return cp.critical_task_count + cp.at_risk_task_count + cp.slack_task_count || 1;
}

const MILESTONE_STATE_LABEL: Record<string, string> = {
  cumplido: "Cumplido",
  tarde: "Cumplido tarde",
  en_riesgo: "En riesgo",
  pendiente: "Pendiente",
};

const MILESTONE_STATE_COLOR: Record<string, string> = {
  cumplido: "#1F8A5B",
  tarde: "#D97706",
  en_riesgo: "#D03A3A",
  pendiente: "#3B82F6",
};

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
  /** taskId → propuestas de la IA sin revisar sobre esa tarea. */
  suggestionCounts?: Map<number, number>;
  /** null mientras carga o si el fetch falló — la banda de KPIs entra en estado "cargando". */
  dashboard: ObraDashboard | null;
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
  onDeleteTask?: (task: Task) => void;
  onTaskRescheduled: () => void;
  onStatusChange?: (task: Task, newStatus: TaskStatus) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ResumenTab({
  dashboard,
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
  onDeleteTask,
  onTaskRescheduled,
  onStatusChange,
  suggestionCounts,
}: ResumenTabProps) {
  const [draggingId, setDraggingId] = useState<number | null>(null);

  // ── Derived metrics ──────────────────────────────────────────────────────────
  const total = tasks.length;
  const unreadAlerts = alerts.filter((a) => !a.is_read);

  const topAlert =
    unreadAlerts.find((a) => !a.task_id) ??
    unreadAlerts.find((a) => a.type === "task_blocked") ??
    unreadAlerts[0] ??
    null;

  void topAlert;

  const tasksWithoutDates = tasks.filter((t) => !t.start_date && !t.due_date);

  // ── Distribution bars by status ──────────────────────────────────────────────
  const statusDist = total === 0 ? null : {
    completada:  tasks.filter(t => t.status === "completada").length  / total * 100,
    en_progreso: tasks.filter(t => t.status === "en_progreso").length / total * 100,
    pendiente:   tasks.filter(t => t.status === "pendiente").length   / total * 100,
    bloqueada:   tasks.filter(t => t.status === "bloqueada").length   / total * 100,
  };

  // ── Dashboard-derived (I-01/I-02/I-03/I-04/I-09/I-10) ────────────────────────
  const progress = dashboard?.progress ?? null;
  const forecast = dashboard?.forecast ?? null;
  const dashAlerts = dashboard?.alerts ?? null;
  const bottleneck = dashboard?.bottleneck ?? null;
  const bottleneckTask = bottleneck?.task_id
    ? tasks.find((t) => t.id === bottleneck.task_id) ?? null
    : null;
  const ringPct = progress?.available ? Math.round(progress.real_percent ?? 0) : 0;
  const totalCriticalAlerts = dashAlerts?.critica ?? 0;
  const criticalPath = dashboard?.critical_path ?? null;
  const baseline = dashboard?.baseline ?? null;
  const milestones = dashboard?.milestones ?? null;
  const materials = dashboard?.materials ?? null;

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

      {/* ── I-10: banner de cuello de botella ── */}
      {bottleneck?.available && (
        <button
          onClick={() => (bottleneckTask ? onEditTask(bottleneckTask) : onViewTareas())}
          style={{
            display: "flex", alignItems: "center", gap: 12, width: "100%",
            background: "#FFF1E9", border: "1px solid #FDBFA0", borderRadius: 14,
            padding: "14px 18px", cursor: "pointer", textAlign: "left",
          }}
        >
          <AlertTriangle style={{ width: 18, height: 18, color: "#C4551C", flexShrink: 0 }} />
          <span style={{ flex: 1, fontSize: 13.5, color: "#1A2329" }}>
            <b>«{bottleneck.title}»</b> está frenando {bottleneck.blocked_task_count} tarea{bottleneck.blocked_task_count === 1 ? "" : "s"}
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12.5, fontWeight: 600, color: "#C4551C" }}>
            Ver <ArrowRight style={{ width: 12, height: 12 }} />
          </span>
        </button>
      )}

      {/* ── I-01/I-02/I-03/I-04/I-09: banda de KPIs ── */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1.4fr 1fr 1fr 1fr",
        gap: 14,
      }}>

        {/* ── Avance (I-01, con I-02 como referencia) ── */}
        <div style={kpiTileStyle}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={kpiLabelStyle}>Avance</span>
            <div
              style={kpiIconStyle("#FFF1E9", "#FF6B35")}
              title="Avance ponderado por la duración planificada de cada tarea: una tarea de 20 días pesa 20 veces más que una de 1 día. Incluye el avance parcial de las tareas en curso."
            >
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M1 8h3l2-5 3 10 2-5 4-1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <ProgressRing pct={progress?.available ? ringPct : 0} />
            <div>
              {progress?.available ? (
                <>
                  <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 22, fontWeight: 700, letterSpacing: "-0.03em", color: "#1A2329", lineHeight: 1 }}>
                    {progress.tasks_completed} de {progress.tasks_total}
                  </div>
                  <div style={{ fontSize: 11.5, color: "#5B6770", marginTop: 4 }}>
                    tareas completas
                    {progress.planned_percent !== null && ` · plan: ${Math.round(progress.planned_percent)}%`}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 11.5, color: "#5B6770" }}>Todavía no hay tareas cargadas</div>
              )}
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

        {/* ── SPI (I-03) ── */}
        <div style={kpiTileStyle}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={kpiLabelStyle}>SPI</span>
            <div style={kpiIconStyle("#E5EEFB", "#2A6FDB")}>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4" fill="none"/><path d="M8 4.5V8l2.4 1.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none"/></svg>
            </div>
          </div>
          <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 30, fontWeight: 700, letterSpacing: "-0.03em", color: spiColor(progress?.spi ?? null, progress?.spi_confidence ?? null), lineHeight: 1 }}>
            {progress?.spi != null ? progress.spi.toFixed(2) : "—"}
          </div>
          <div style={{ fontSize: 11.5, color: "#5B6770" }}>
            {spiLabel(progress?.spi ?? null, progress?.spi_confidence ?? null)}
            {progress?.days_behind != null && progress.days_behind !== 0 && (
              <> · {progress.days_behind > 0
                ? `${progress.days_behind} día${progress.days_behind === 1 ? "" : "s"} atrás`
                : `${Math.abs(progress.days_behind)} día${Math.abs(progress.days_behind) === 1 ? "" : "s"} adelante`}</>
            )}
          </div>
        </div>

        {/* ── Fin previsto (I-04) ── */}
        <div style={kpiTileStyle}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={kpiLabelStyle}>Fin previsto</span>
            <div style={kpiIconStyle("#E4F3EC", "#1F8A5B")}>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><rect x="2.5" y="3" width="11" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4" fill="none"/><path d="M5 1.5v3M11 1.5v3M2.5 6.5h11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
            </div>
          </div>
          {forecast?.available ? (
            <>
              <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 22, fontWeight: 700, letterSpacing: "-0.03em", color: "#1A2329", lineHeight: 1 }}>
                {formatDate(forecast.projected_end_date)}
              </div>
              <div style={{ fontSize: 11.5, color: (forecast.deviation_working_days ?? 0) > 0 ? "#D03A3A" : "#1F8A5B" }}>
                {forecast.deviation_working_days == null
                  ? "Sin fecha comprometida para comparar"
                  : forecast.deviation_working_days === 0
                  ? "En fecha"
                  : `${forecast.deviation_working_days > 0 ? "+" : ""}${forecast.deviation_working_days} días vs. lo previsto`}
                {forecast.capped && " (estimación imprecisa)"}
              </div>
            </>
          ) : (
            <div style={{ fontSize: 11.5, color: "#5B6770" }}>{forecastReasonLabel(forecast?.reason ?? null)}</div>
          )}
        </div>

        {/* ── Alertas por severidad (I-09) ── */}
        <div style={kpiTileStyle}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={kpiLabelStyle}>Alertas</span>
            <div style={kpiIconStyle(SEVERITY_PALETTE.critica.bg, SEVERITY_PALETTE.critica.color)}>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M8 2.5L14 13H2L8 2.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" fill="none"/><path d="M8 6.5V9.5M8 11.4v.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 30, fontWeight: 700, letterSpacing: "-0.03em", color: totalCriticalAlerts > 0 ? SEVERITY_PALETTE.critica.color : "#1A2329", lineHeight: 1 }}>
              {String(totalCriticalAlerts).padStart(2, "0")}
            </span>
            <span style={{ fontSize: 11.5, color: "#5B6770" }}>crítica{totalCriticalAlerts === 1 ? "" : "s"}</span>
          </div>
          <div style={{ fontSize: 11.5, color: "#5B6770" }}>
            {SEVERITY_ORDER.filter((s) => s !== "critica").map((s) => `${dashAlerts?.[s] ?? 0} ${SEVERITY_LABEL[s].toLowerCase()}`).join(" · ")}
          </div>
          {dashAlerts?.oldest_critical_age_days != null && dashAlerts.oldest_critical_age_days > 2 && (
            <div style={{ fontSize: 11, fontWeight: 600, color: SEVERITY_PALETTE.critica.color }}>
              la más vieja: hace {dashAlerts.oldest_critical_age_days} días
            </div>
          )}
          <button onClick={onViewAlerts} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 600, color: "#FF6B35", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
            Ver alertas <ArrowRight style={{ width: 11, height: 11 }} />
          </button>
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
          onDeleteTask={onDeleteTask}
          onStatusChange={onStatusChange}
          tasksWithoutDates={tasksWithoutDates.length}
          obraId={obraId}
          suggestionCounts={suggestionCounts}
        />
      </section>

      {/* ── I-06/I-07: ruta crítica y línea base ──────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div style={kpiTileStyle}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={kpiLabelStyle}>Ruta crítica</span>
            <div style={kpiIconStyle("#E5EEFB", "#2A6FDB")}>
              <Route style={{ width: 15, height: 15 }} />
            </div>
          </div>
          {criticalPath?.available ? (
            <>
              <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 22, fontWeight: 700, letterSpacing: "-0.03em", color: "#1A2329", lineHeight: 1 }}>
                {criticalPath.critical_task_count} crítica{criticalPath.critical_task_count === 1 ? "" : "s"}
              </div>
              <div style={{ display: "flex", height: 6, borderRadius: 99, overflow: "hidden", background: "#F0F1EF" }}>
                {criticalPath.critical_task_count > 0 && <span style={{ background: "#D03A3A", width: `${100 * criticalPath.critical_task_count / cpTotal(criticalPath)}%` }} />}
                {criticalPath.at_risk_task_count > 0 && <span style={{ background: "#D97706", width: `${100 * criticalPath.at_risk_task_count / cpTotal(criticalPath)}%` }} />}
                {criticalPath.slack_task_count > 0 && <span style={{ background: "#1F8A5B", width: `${100 * criticalPath.slack_task_count / cpTotal(criticalPath)}%` }} />}
              </div>
              <div style={{ fontSize: 11.5, color: "#5B6770" }}>
                {criticalPath.at_risk_task_count} en riesgo
                {criticalPath.median_float_days != null && ` · holgura mediana ${Math.round(criticalPath.median_float_days)}d`}
              </div>
              {criticalPath.partial && (
                <div style={{ fontSize: 11, color: "#C97D0E" }}>Cobertura parcial: {Math.round(criticalPath.coverage_percent)}% de las tareas tienen fechas</div>
              )}
            </>
          ) : (
            <div style={{ fontSize: 11.5, color: "#5B6770" }}>Cargá dependencias entre tareas para ver la ruta crítica</div>
          )}
        </div>

        <div style={kpiTileStyle}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={kpiLabelStyle}>Línea base</span>
            <div style={kpiIconStyle("#FDF1DE", "#C97D0E")}>
              <Gauge style={{ width: 15, height: 15 }} />
            </div>
          </div>
          {baseline?.available ? (
            <>
              <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 22, fontWeight: 700, letterSpacing: "-0.03em", color: (baseline.end_deviation_days ?? 0) > 0 ? "#D03A3A" : "#1F8A5B", lineHeight: 1 }}>
                {baseline.end_deviation_days == null
                  ? "—"
                  : baseline.end_deviation_days === 0
                  ? "En fecha"
                  : `${baseline.end_deviation_days > 0 ? "+" : ""}${baseline.end_deviation_days} días`}
              </div>
              <div style={{ fontSize: 11.5, color: "#5B6770" }}>
                {baseline.tasks_deviated} de {baseline.tasks_total_in_baseline} tareas desviadas
              </div>
              {baseline.tasks_added_after_baseline > 0 && (
                <div style={{ fontSize: 11, color: "#5B6770" }}>{baseline.tasks_added_after_baseline} tareas agregadas después de la línea base</div>
              )}
              <div style={{ fontSize: 11, color: "#A0ABB4" }}>guardada el {formatDate(baseline.saved_at?.slice(0, 10) ?? null)}</div>
            </>
          ) : (
            <div style={{ fontSize: 11.5, color: "#5B6770" }}>Guardá la línea base (⚙ Ajustes del Gantt) para medir el desvío del plan</div>
          )}
        </div>
      </div>

      {/* ── I-08: hitos ────────────────────────────────────────────────────────── */}
      {milestones?.available && (
        <section style={{ background: "#fff", border: "1px solid #E6E7E5", borderRadius: 14, padding: "16px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <Flag style={{ width: 15, height: 15, color: "#FF6B35" }} />
            <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 15, fontWeight: 700, color: "#1A2329", letterSpacing: "-0.01em" }}>Hitos</span>
            <span style={{ fontSize: 11.5, fontWeight: 600, padding: "2px 9px", borderRadius: 99, background: "#F0F1EF", color: "#5B6770", fontFamily: "'JetBrains Mono', monospace" }}>
              {milestones.items.length}
            </span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 18 }}>
            {milestones.items.map((m) => (
              <button
                key={m.task_id}
                type="button"
                onClick={() => {
                  const task = tasks.find((t) => t.id === m.task_id);
                  if (task) onEditTask(task);
                }}
                title={`${m.title} — ${MILESTONE_STATE_LABEL[m.state]}`}
                style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", background: "none", border: "none", padding: 0, font: "inherit" }}
              >
                <span style={{ color: MILESTONE_STATE_COLOR[m.state], fontSize: 16 }}>◆</span>
                <span style={{ fontSize: 12.5, color: "#1A2329", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.title}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ── I-11: ejecución de materiales ─────────────────────────────────────── */}
      {materials?.available && (
        <section style={{ background: "#fff", border: "1px solid #E6E7E5", borderRadius: 14, padding: "16px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <Boxes style={{ width: 15, height: 15, color: "#FF6B35" }} />
            <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 15, fontWeight: 700, color: "#1A2329", letterSpacing: "-0.01em" }}>Materiales</span>
          </div>
          <div style={{ display: "flex", height: 10, borderRadius: 99, overflow: "hidden", background: "#F0F1EF" }}>
            <span style={{ background: "#1F8A5B", width: `${materials.percent_received}%` }} />
            <span style={{ background: "#D97706", width: `${Math.max(0, materials.percent_committed - materials.percent_received)}%` }} />
          </div>
          <div style={{ fontSize: 11.5, color: "#5B6770", marginTop: 8 }}>
            {Math.round(materials.percent_committed)}% comprometido · {Math.round(materials.percent_received)}% recibido
            {materials.alignment_delta != null && (
              <> · alineación {materials.alignment_delta > 0 ? "+" : ""}{Math.round(materials.alignment_delta)} pts vs. avance real</>
            )}
          </div>
        </section>
      )}

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
