import { useState, useEffect, useRef } from "react";
import { Pencil, Trash2, AlertTriangle, ChevronDown, X } from "lucide-react";
import { useIsMobile } from "../hooks/useMediaQuery";
import type { Responsible, Task, TaskStatus } from "../types";
import type { Editor } from "../hooks/useEditingSimulation";

// ─── Design tokens (mirrors GanttTimeline) ────────────────────────────────────

const STATUS_STYLE: Record<TaskStatus, { bg: string; border: string; dot: string; label: string; stripe: string }> = {
  pendiente:   { bg: "#EBF3FF", border: "#3B82F6", dot: "#3B82F6", label: "Pendiente",   stripe: "#3B82F6" },
  en_progreso: { bg: "#FFFBEB", border: "#D97706", dot: "#D97706", label: "En progreso", stripe: "#D97706" },
  bloqueada:   { bg: "#FCE5E5", border: "#D03A3A", dot: "#D03A3A", label: "Bloqueada",   stripe: "#D03A3A" },
  completada:  { bg: "#E4F3EC", border: "#1F8A5B", dot: "#1F8A5B", label: "Completada",  stripe: "#1F8A5B" },
  cancelada:   { bg: "#F4F5F4", border: "#94928D", dot: "#94928D", label: "Cancelada",   stripe: "#94928D" },
};

const AVATAR_COLORS = ["#E76A2D", "#3A6BD9", "#1F9A5A", "#9A4DC9", "#D03A3A", "#E89B14", "#0EA5A0"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TODAY = new Date().toISOString().slice(0, 10);

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

function isOverdue(task: Task): boolean {
  return (
    task.due_date !== null &&
    task.due_date < TODAY &&
    task.status !== "completada" &&
    task.status !== "cancelada"
  );
}

const SOON_LIMIT = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 3);
  return d.toISOString().slice(0, 10);
})();

function isDueSoon(task: Task): boolean {
  return (
    task.due_date !== null &&
    task.due_date >= TODAY &&
    task.due_date <= SOON_LIMIT &&
    task.status !== "completada" &&
    task.status !== "cancelada"
  );
}

function avatarColor(name: string): string {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function getInitials(name: string): string {
  return name.split(" ").map(w => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const STATUS_ORDER: TaskStatus[] = ["pendiente", "en_progreso", "bloqueada", "completada", "cancelada"];

function StatusDropdown({
  task,
  onStatusChange,
}: {
  task: Task;
  onStatusChange?: (task: Task, newStatus: TaskStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { bg, border, dot, label } = STATUS_STYLE[task.status];
  const interactive = !!onStatusChange;

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        onClick={() => interactive && setOpen(v => !v)}
        style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          padding: "3px 7px 3px 7px", borderRadius: 99,
          fontSize: 11.5, fontWeight: 600, letterSpacing: "0.01em",
          background: bg, border: `1px solid ${border}`, color: border,
          whiteSpace: "nowrap",
          cursor: interactive ? "pointer" : "default",
          transition: "opacity 0.12s",
        }}
        onMouseEnter={e => { if (interactive) (e.currentTarget as HTMLElement).style.opacity = "0.8"; }}
        onMouseLeave={e => { if (interactive) (e.currentTarget as HTMLElement).style.opacity = "1"; }}
      >
        <span style={{ width: 6, height: 6, borderRadius: 99, background: dot, flexShrink: 0 }} />
        {label}
        {interactive && <ChevronDown style={{ width: 10, height: 10, marginLeft: 1, opacity: 0.7 }} />}
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 100,
          background: "#fff",
          border: "1px solid #E6E7E5",
          borderRadius: 10,
          boxShadow: "0 8px 24px -4px rgba(15,22,28,0.14)",
          padding: "4px",
          minWidth: 148,
        }}>
          {STATUS_ORDER.map(s => {
            const opt = STATUS_STYLE[s];
            const active = task.status === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setOpen(false);
                  if (!active) onStatusChange!(task, s);
                }}
                style={{
                  display: "flex", alignItems: "center", gap: 7,
                  width: "100%", padding: "7px 10px", borderRadius: 7,
                  fontSize: 12.5, fontWeight: active ? 700 : 500,
                  background: active ? opt.bg : "transparent",
                  color: active ? opt.border : "#3E4A52",
                  border: "none", cursor: "pointer",
                  textAlign: "left",
                  transition: "background 0.1s",
                  fontFamily: "'Plus Jakarta Sans', sans-serif",
                }}
                onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = "#F4F5F4"; }}
                onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              >
                <span style={{ width: 7, height: 7, borderRadius: 99, background: opt.dot, flexShrink: 0 }} />
                {opt.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ResponsableAvatar({
  task,
  responsibles,
}: {
  task: Task;
  responsibles?: Responsible[];
}) {
  if (!task.responsible_id) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <div style={{
          width: 26, height: 26, borderRadius: 99, flexShrink: 0,
          background: "#FDF1DE", border: "1.5px dashed #E89B14",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <AlertTriangle style={{ width: 11, height: 11, color: "#E89B14" }} />
        </div>
        <span style={{ fontSize: 11.5, color: "#C97D0E", fontWeight: 600 }}>Sin asignar</span>
      </div>
    );
  }
  const r = responsibles?.find(r => r.id === task.responsible_id);
  const name = r?.full_name ?? `#${task.responsible_id}`;
  const color = avatarColor(name);
  const initials = getInitials(name);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
      <div style={{
        width: 26, height: 26, borderRadius: 99, flexShrink: 0,
        background: color, color: "#fff",
        fontWeight: 700, fontSize: 9.5,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "'Plus Jakarta Sans', sans-serif",
      }}>
        {initials}
      </div>
      <span style={{
        fontSize: 12.5, color: "#3E4A52", fontWeight: 500,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        maxWidth: 110,
      }} title={name}>
        {name}
      </span>
    </div>
  );
}

function buildLevelMap(tasks: Task[]): Map<number, number> {
  const parentOf = new Map(tasks.map(t => [t.id, t.parent_task_id]));
  const memo = new Map<number, number>();
  function level(id: number): number {
    if (memo.has(id)) return memo.get(id)!;
    const pid = parentOf.get(id);
    const result = pid ? 1 + level(pid) : 0;
    memo.set(id, result);
    return result;
  }
  tasks.forEach(t => level(t.id));
  return memo;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface TaskTableProps {
  tasks: Task[];
  responsibles?: Responsible[];
  onEdit?: (task: Task) => void;
  onDelete?: (task: Task) => void;
  onStatusChange?: (task: Task, newStatus: TaskStatus) => void;
  editingMap?: Map<number, Editor>;
  highlightedTaskId?: number | null;
  onCreateNew?: () => void;
  onImport?: () => void;
}

export function TaskTable({
  tasks,
  responsibles,
  onEdit,
  onDelete,
  onStatusChange,
  editingMap,
  highlightedTaskId,
  onCreateNew,
  onImport,
}: TaskTableProps) {
  const hasActions = !!(onEdit || onDelete);
  const levelMap = buildLevelMap(tasks);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const isMobile = useIsMobile();

  // ── Filter state ────────────────────────────────────────────────────────────
  const [statusFilter,      setStatusFilter]      = useState<Set<TaskStatus>>(new Set());
  const [responsibleFilter, setResponsibleFilter] = useState<Set<string>>(new Set());
  const [overdueOnly,       setOverdueOnly]        = useState(false);
  const [fromDate,          setFromDate]           = useState("");
  const [toDate,            setToDate]             = useState("");
  const [openFilter,        setOpenFilter]         = useState<"estado" | "responsable" | "vencimiento" | null>(null);
  const [dropdownPos,       setDropdownPos]        = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const filterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openFilter) return;
    function onDown(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node))
        setOpenFilter(null);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [openFilter]);

  const hasFilters = statusFilter.size > 0 || responsibleFilter.size > 0 || overdueOnly || !!fromDate || !!toDate;

  function toggleStatus(s: TaskStatus) {
    setStatusFilter(prev => { const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n; });
  }
  function toggleResponsible(rid: string) {
    setResponsibleFilter(prev => { const n = new Set(prev); n.has(rid) ? n.delete(rid) : n.add(rid); return n; });
  }

  const filtered = tasks.filter(t => {
    if (statusFilter.size > 0 && !statusFilter.has(t.status)) return false;
    if (responsibleFilter.size > 0) {
      const rid = t.responsible_id == null ? "null" : String(t.responsible_id);
      if (!responsibleFilter.has(rid)) return false;
    }
    if (overdueOnly && !isOverdue(t)) return false;
    if (fromDate && (!t.due_date || t.due_date < fromDate)) return false;
    if (toDate   && (!t.due_date || t.due_date > toDate))   return false;
    return true;
  });

  // Group by responsible, sorted alphabetically by name
  const displayRows: Task[] = (() => {
    if (responsibleFilter.size === 0) return filtered;
    const groups = new Map<string, Task[]>();
    for (const t of filtered) {
      const key = t.responsible_id == null ? "null" : String(t.responsible_id);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(t);
    }
    const getName = (rid: string) => {
      if (rid === "null") return "￿"; // sort unassigned last
      return (responsibles ?? []).find(r => String(r.id) === rid)?.full_name ?? rid;
    };
    return Array.from(groups.entries())
      .sort(([a], [b]) => getName(a).localeCompare(getName(b), "es", { sensitivity: "base" }))
      .flatMap(([, tasks]) => tasks);
  })();

  const presentResponsibles = (responsibles ?? []).filter(r =>
    tasks.some(t => t.responsible_id === r.id)
  );
  const hasUnassigned = tasks.some(t => t.responsible_id == null);

  // ── Filter icon button ───────────────────────────────────────────────────────
  function FilterBtn({ col, active }: { col: "estado" | "responsable" | "vencimiento"; active: boolean }) {
    return (
      <button
        type="button"
        onClick={e => {
          e.stopPropagation();
          if (openFilter === col) { setOpenFilter(null); return; }
          const rect = e.currentTarget.getBoundingClientRect();
          setDropdownPos({ top: rect.bottom + 6, left: rect.left });
          setOpenFilter(col);
        }}
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 18, height: 18, borderRadius: 4,
          background: active ? "#FF6B35" : "transparent",
          border: "none", cursor: "pointer", padding: 0,
          flexShrink: 0,
          transition: "background 0.12s",
        }}
        title="Filtrar"
      >
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
          <path d="M1 2.5h10M3 6h6M5 9.5h2" stroke={active ? "#fff" : "#ADAAA4"} strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
      </button>
    );
  }

  if (tasks.length === 0) {
    return (
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", padding: "52px 24px", gap: 10,
      }}>
        <div style={{
          width: 42, height: 42, borderRadius: 12, background: "#F0F1EF",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#94928D" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <path d="M16 2v4M8 2v4M3 10h18" />
            <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01" />
          </svg>
        </div>
        <div style={{ textAlign: "center" }}>
          <p style={{ fontSize: 13.5, fontWeight: 600, color: "#3E4A52", margin: 0 }}>No hay tareas registradas</p>
          <p style={{ fontSize: 12, color: "#6B7580", margin: "3px 0 0" }}>Cargá el plan de obra para empezar a seguirlo.</p>
          {(onCreateNew || onImport) && (
            <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 14, flexWrap: "wrap" }}>
              {onCreateNew && (
                <button
                  type="button"
                  onClick={onCreateNew}
                  style={{
                    padding: "9px 18px", borderRadius: 10, fontSize: 12.5, fontWeight: 700,
                    color: "#fff", background: "#FF6B35", border: "none", cursor: "pointer",
                    fontFamily: "'Plus Jakarta Sans', sans-serif",
                    boxShadow: "0 6px 14px -6px rgba(255,107,53,0.5)",
                  }}
                >
                  + Nueva tarea
                </button>
              )}
              {onImport && (
                <button
                  type="button"
                  onClick={onImport}
                  style={{
                    padding: "9px 16px", borderRadius: 10, fontSize: 12.5, fontWeight: 600,
                    color: "#5B6770", background: "#fff", border: "1px solid #E6E7E5", cursor: "pointer",
                    fontFamily: "'Plus Jakarta Sans', sans-serif",
                  }}
                >
                  Importar desde Excel / Project
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div ref={filterRef} style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", position: "relative" }}>

      {/* ── Column header row (solo desktop) ── */}
      <div style={{
        display: isMobile ? "none" : "grid",
        gridTemplateColumns: hasActions
          ? "1fr 135px 95px 190px 155px 72px"
          : "1fr 135px 95px 190px 155px",
        alignItems: "center",
        padding: "8px 12px",
        borderBottom: "1px solid #F2F0EC",
        background: "#fff",
      }}>
        {/* Tarea */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: "#7D7973", letterSpacing: "0.09em", textTransform: "uppercase" as const }}>Tarea</span>
          {hasFilters && (
            <button
              type="button"
              onClick={() => { setStatusFilter(new Set()); setResponsibleFilter(new Set()); setOverdueOnly(false); setFromDate(""); setToDate(""); }}
              style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 7px", borderRadius: 99, fontSize: 10, fontWeight: 600, background: "#FFF1E9", border: "1px solid #FDBFA0", color: "#E85A26", cursor: "pointer" }}
            >
              <X style={{ width: 8, height: 8 }} />
              {filtered.length}/{tasks.length}
            </button>
          )}
        </div>

        {/* Estado */}
        <div style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: "#7D7973", letterSpacing: "0.09em", textTransform: "uppercase" as const }}>Estado</span>
          <FilterBtn col="estado" active={statusFilter.size > 0} />
          {openFilter === "estado" && (
            <div style={{ position: "fixed", top: dropdownPos.top, left: dropdownPos.left, zIndex: 9999, background: "#fff", border: "1px solid #E6E7E5", borderRadius: 12, boxShadow: "0 8px 24px -4px rgba(15,22,28,0.14)", padding: 6, minWidth: 165 }}>
              {STATUS_ORDER.map(s => {
                const st = STATUS_STYLE[s]; const on = statusFilter.has(s);
                return (
                  <button key={s} type="button" onClick={() => toggleStatus(s)} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "7px 10px", borderRadius: 7, background: on ? st.bg : "transparent", border: "none", cursor: "pointer", fontFamily: "'Plus Jakarta Sans', sans-serif" }}
                    onMouseEnter={e => { if (!on) e.currentTarget.style.background = "#F4F5F4"; }}
                    onMouseLeave={e => { if (!on) e.currentTarget.style.background = "transparent"; }}
                  >
                    <span style={{ width: 7, height: 7, borderRadius: 99, background: st.dot, flexShrink: 0 }} />
                    <span style={{ fontSize: 12.5, fontWeight: on ? 700 : 500, color: on ? st.border : "#3E4A52", flex: 1 }}>{st.label}</span>
                    {on && <span style={{ fontSize: 10, color: st.border }}>✓</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* % Avance */}
        <div style={{ display: "flex", alignItems: "center" }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: "#7D7973", letterSpacing: "0.09em", textTransform: "uppercase" as const }}>% Avance</span>
        </div>

        {/* Responsable */}
        <div style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: "#7D7973", letterSpacing: "0.09em", textTransform: "uppercase" as const }}>Responsable</span>
          <FilterBtn col="responsable" active={responsibleFilter.size > 0} />
          {openFilter === "responsable" && (
            <div style={{ position: "fixed", top: dropdownPos.top, left: dropdownPos.left, zIndex: 9999, background: "#fff", border: "1px solid #E6E7E5", borderRadius: 12, boxShadow: "0 8px 24px -4px rgba(15,22,28,0.14)", padding: 6, minWidth: 185 }}>
              {hasUnassigned && (() => { const on = responsibleFilter.has("null"); return (
                <button type="button" onClick={() => toggleResponsible("null")} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "7px 10px", borderRadius: 7, background: on ? "#FFF1E9" : "transparent", border: "none", cursor: "pointer", fontFamily: "'Plus Jakarta Sans', sans-serif" }}
                  onMouseEnter={e => { if (!on) e.currentTarget.style.background = "#F4F5F4"; }}
                  onMouseLeave={e => { if (!on) e.currentTarget.style.background = "transparent"; }}
                >
                  <span style={{ fontSize: 12.5, fontWeight: on ? 700 : 500, color: on ? "#E85A26" : "#3E4A52", flex: 1 }}>Sin asignar</span>
                  {on && <span style={{ fontSize: 10, color: "#E85A26" }}>✓</span>}
                </button>
              ); })()}
              {presentResponsibles.map(r => { const on = responsibleFilter.has(String(r.id)); return (
                <button key={r.id} type="button" onClick={() => toggleResponsible(String(r.id))} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "7px 10px", borderRadius: 7, background: on ? "#FFF1E9" : "transparent", border: "none", cursor: "pointer", fontFamily: "'Plus Jakarta Sans', sans-serif" }}
                  onMouseEnter={e => { if (!on) e.currentTarget.style.background = "#F4F5F4"; }}
                  onMouseLeave={e => { if (!on) e.currentTarget.style.background = "transparent"; }}
                >
                  <span style={{ fontSize: 12.5, fontWeight: on ? 700 : 500, color: on ? "#E85A26" : "#3E4A52", flex: 1 }}>{r.full_name}</span>
                  {on && <span style={{ fontSize: 10, color: "#E85A26" }}>✓</span>}
                </button>
              ); })}
            </div>
          )}
        </div>

        {/* Vencimiento */}
        <div style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: "#7D7973", letterSpacing: "0.09em", textTransform: "uppercase" as const }}>Vencimiento</span>
          <FilterBtn col="vencimiento" active={overdueOnly || !!fromDate || !!toDate} />
          {openFilter === "vencimiento" && (
            <div style={{ position: "fixed", top: dropdownPos.top, left: dropdownPos.left, zIndex: 9999, background: "#fff", border: "1px solid #E6E7E5", borderRadius: 12, boxShadow: "0 8px 24px -4px rgba(15,22,28,0.14)", padding: 8, minWidth: 210, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
              {/* Quick: overdue only */}
              <button type="button" onClick={() => { setOverdueOnly(v => !v); setFromDate(""); setToDate(""); }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "7px 10px", borderRadius: 7, background: overdueOnly ? "#FCE5E5" : "transparent", border: "none", cursor: "pointer", marginBottom: 4 }}
                onMouseEnter={e => { if (!overdueOnly) e.currentTarget.style.background = "#F4F5F4"; }}
                onMouseLeave={e => { if (!overdueOnly) e.currentTarget.style.background = "transparent"; }}
              >
                <AlertTriangle style={{ width: 11, height: 11, color: overdueOnly ? "#D03A3A" : "#94928D", flexShrink: 0 }} />
                <span style={{ fontSize: 12.5, fontWeight: overdueOnly ? 700 : 500, color: overdueOnly ? "#D03A3A" : "#3E4A52", flex: 1 }}>Solo vencidas</span>
                {overdueOnly && <span style={{ fontSize: 10, color: "#D03A3A" }}>✓</span>}
              </button>

              {/* Divider */}
              <div style={{ borderTop: "1px solid #F2F0EC", margin: "4px 0 8px" }} />

              {/* Date range */}
              <div style={{ padding: "0 4px", display: "flex", flexDirection: "column", gap: 6 }}>
                <p style={{ margin: 0, fontSize: 10, fontWeight: 700, color: "#7D7973", letterSpacing: "0.08em", textTransform: "uppercase" }}>Rango de fechas</p>
                <div>
                  <p style={{ margin: "0 0 3px", fontSize: 11, color: "#5B6770", fontWeight: 500 }}>Desde</p>
                  <input type="date" value={fromDate} onChange={e => { setFromDate(e.target.value); setOverdueOnly(false); }}
                    style={{ width: "100%", boxSizing: "border-box", padding: "5px 8px", fontSize: 12, borderRadius: 7, border: "1.5px solid #E6E7E5", outline: "none", fontFamily: "'Plus Jakarta Sans', sans-serif", color: "#1A2329" }}
                    onFocus={e => (e.currentTarget.style.borderColor = "#FF6B35")}
                    onBlur={e => (e.currentTarget.style.borderColor = "#E6E7E5")}
                  />
                </div>
                <div>
                  <p style={{ margin: "0 0 3px", fontSize: 11, color: "#5B6770", fontWeight: 500 }}>Hasta</p>
                  <input type="date" value={toDate} min={fromDate || undefined} onChange={e => { setToDate(e.target.value); setOverdueOnly(false); }}
                    style={{ width: "100%", boxSizing: "border-box", padding: "5px 8px", fontSize: 12, borderRadius: 7, border: "1.5px solid #E6E7E5", outline: "none", fontFamily: "'Plus Jakarta Sans', sans-serif", color: "#1A2329" }}
                    onFocus={e => (e.currentTarget.style.borderColor = "#FF6B35")}
                    onBlur={e => (e.currentTarget.style.borderColor = "#E6E7E5")}
                  />
                </div>
                {(fromDate || toDate) && (
                  <button type="button" onClick={() => { setFromDate(""); setToDate(""); }} style={{ alignSelf: "flex-end", fontSize: 11, color: "#6B7580", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                    Limpiar rango
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {hasActions && <span />}
      </div>

      {/* ── Task rows ── */}
      {filtered.length === 0 && (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", padding: "36px 24px", gap: 8,
        }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#3E4A52" }}>Sin resultados</p>
          <p style={{ margin: 0, fontSize: 12, color: "#6B7580" }}>Ninguna tarea coincide con los filtros aplicados.</p>
        </div>
      )}
      <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
        {displayRows.map((task, idx) => {
          const style       = STATUS_STYLE[task.status];
          const editor      = editingMap?.get(task.id);
          const overdue     = isOverdue(task);
          const dueSoon     = !overdue && isDueSoon(task);
          const isHighlight = highlightedTaskId === task.id;
          const isDanger    = task.status === "bloqueada" || overdue;
          const level       = levelMap.get(task.id) ?? 0;
          const isHovered   = hoveredId === task.id;

          if (isMobile) {
            return (
              <li key={task.id} style={{
                padding: "12px 14px",
                borderBottom: idx < displayRows.length - 1 ? "1px solid #F2F0EC" : "none",
                background: isHighlight ? "rgba(255,107,53,0.06)" : idx % 2 === 1 ? "#FBFAF7" : "transparent",
                position: "relative",
              }}>
                {isDanger && (
                  <div style={{ position: "absolute", left: 0, top: 8, bottom: 8, width: 3, borderRadius: "0 2px 2px 0", background: style.stripe }} />
                )}
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0, paddingLeft: level * 12 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: "#1A2329", lineHeight: 1.35 }}>{task.title}</div>
                    {task.description && (
                      <div style={{ fontSize: 11.5, color: "#6B7580", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.description}</div>
                    )}
                  </div>
                  {hasActions && (
                    <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                      {onEdit && (
                        <button onClick={() => onEdit(task)} aria-label="Editar tarea" style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid #EFECE6", background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#5B6770" }}>
                          <Pencil style={{ width: 13, height: 13 }} />
                        </button>
                      )}
                      {onDelete && (
                        <button onClick={() => onDelete(task)} aria-label="Eliminar tarea" style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid #EFECE6", background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#6B7580" }}>
                          <Trash2 style={{ width: 13, height: 13 }} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 9, flexWrap: "wrap" }}>
                  <StatusDropdown task={task} onStatusChange={onStatusChange} />
                  <span style={{ fontSize: 11.5, color: overdue ? "#D03A3A" : "#5B6770", fontWeight: overdue ? 700 : 500, fontFamily: "'JetBrains Mono', monospace" }}>
                    {fmtDate(task.due_date)}
                  </span>
                  {overdue && <span style={{ padding: "1px 5px", borderRadius: 4, fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", background: "#FCE5E5", color: "#D03A3A" }}>Vencida</span>}
                  {dueSoon && <span style={{ padding: "1px 5px", borderRadius: 4, fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", background: "#FDF1DE", color: "#C97D0E" }}>{task.due_date === TODAY ? "Vence hoy" : "Por vencer"}</span>}
                  <span style={{ marginLeft: "auto" }}>
                    <ResponsableAvatar task={task} responsibles={responsibles} />
                  </span>
                </div>
              </li>
            );
          }

          return (
            <li
              key={task.id}
              onMouseEnter={() => setHoveredId(task.id)}
              onMouseLeave={() => setHoveredId(prev => (prev === task.id ? null : prev))}
              style={{
                display: "grid",
                gridTemplateColumns: hasActions
                  ? "1fr 135px 95px 190px 155px 72px"
                  : "1fr 135px 95px 190px 155px",
                alignItems: "center",
                padding: "0 12px 0 12px",
                minHeight: 64,
                borderBottom: idx < displayRows.length - 1 ? "1px solid #F2F0EC" : "none",
                background: isHighlight
                  ? "rgba(255,107,53,0.06)"
                  : isHovered
                    ? "#F6F4EF"
                    : idx % 2 === 1
                      ? "#FBFAF7"
                      : "transparent",
                outline: isHighlight ? "1.5px solid rgba(255,107,53,0.2)" : "none",
                outlineOffset: -1,
                transition: "background 0.15s ease",
                position: "relative",
              }}
            >
              {/* Left stripe for critical tasks */}
              {isDanger && (
                <div style={{
                  position: "absolute", left: 0, top: 8, bottom: 8,
                  width: 3, borderRadius: "0 2px 2px 0",
                  background: style.stripe,
                }} />
              )}

              {/* ── Task name + description ── */}
              <div style={{ paddingLeft: level * 16, paddingRight: 8, paddingTop: 10, paddingBottom: 10, minWidth: 0, position: "relative" }}>
                {/* Conector visual de subtarea (└) */}
                {level > 0 && (
                  <div style={{
                    position: "absolute",
                    left: level * 16 - 12, top: 0, bottom: "50%",
                    width: 9,
                    borderLeft: "1.5px solid #DDD6C9",
                    borderBottom: "1.5px solid #DDD6C9",
                    borderBottomLeftRadius: 5,
                    pointerEvents: "none",
                  }} />
                )}
                <div style={{
                  fontSize: 13.5, fontWeight: 600, color: "#1A2329",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  lineHeight: 1.3,
                }} title={task.title}>
                  {task.title}
                </div>
                {task.description && (
                  <div style={{
                    fontSize: 11.5, color: "#6B7580", marginTop: 2, fontWeight: 400,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    lineHeight: 1.3,
                  }} title={task.description}>
                    {task.description}
                  </div>
                )}
                {editor && (
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 3 }}>
                    <div style={{
                      width: 14, height: 14, borderRadius: 99,
                      background: editor.color, color: "#fff",
                      fontSize: 7, fontWeight: 700, flexShrink: 0,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {editor.initials}
                    </div>
                    <span style={{ fontSize: 10.5, color: "#6B7580", fontStyle: "italic" }}>editando…</span>
                    <span style={{
                      width: 4, height: 4, borderRadius: 99,
                      background: editor.color, display: "inline-block",
                      animation: "task-editing-pulse 1.2s ease-in-out infinite",
                    }} />
                  </div>
                )}
              </div>

              {/* ── Status pill ── */}
              <div>
                <StatusDropdown task={task} onStatusChange={onStatusChange} />
              </div>

              {/* ── % Avance / Hito ── */}
              <div>
                {task.is_milestone ? (
                  <span style={{ fontSize: 13, color: "#E76A2D" }} title="Hito">◆ Hito</span>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: "#5B6770" }}>
                      {task.estimated_progress}%
                    </span>
                    <div style={{ height: 3, borderRadius: 99, background: "#F0F1EF", overflow: "hidden", width: 52 }}>
                      <div style={{
                        height: "100%", borderRadius: 99,
                        width: `${task.estimated_progress}%`,
                        background: task.estimated_progress === 100 ? "#1F8A5B" : "#FF6B35",
                      }} />
                    </div>
                  </div>
                )}
              </div>

              {/* ── Responsible ── */}
              <div style={{ paddingRight: 12 }}>
                <ResponsableAvatar task={task} responsibles={responsibles} />
              </div>

              {/* ── Due date ── */}
              <div style={{ paddingRight: 8 }}>
                <span style={{
                  fontSize: 12.5, color: overdue ? "#D03A3A" : "#5B6770",
                  fontWeight: overdue ? 600 : 400,
                  fontFamily: "'JetBrains Mono', monospace",
                }}>
                  {fmtDate(task.due_date)}
                </span>
                {overdue && (
                  <div style={{
                    display: "inline-block", marginLeft: 6,
                    padding: "1px 5px", borderRadius: 4,
                    fontSize: 9.5, fontWeight: 700, textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    background: "#FCE5E5", color: "#D03A3A",
                  }}>
                    Vencida
                  </div>
                )}
                {dueSoon && (
                  <div style={{
                    display: "inline-block", marginLeft: 6,
                    padding: "1px 5px", borderRadius: 4,
                    fontSize: 9.5, fontWeight: 700, textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    background: "#FDF1DE", color: "#C97D0E",
                  }}>
                    {task.due_date === TODAY ? "Vence hoy" : "Por vencer"}
                  </div>
                )}
              </div>

              {/* ── Actions — visibles al hover ── */}
              {hasActions && (
                <div style={{
                  display: "flex", alignItems: "center", gap: 2, paddingRight: 12,
                  opacity: isHovered ? 1 : 0,
                  transition: "opacity 0.15s ease",
                }}>
                  {onEdit && (
                    <button
                      onClick={() => onEdit(task)}
                      title="Editar tarea"
                      style={{
                        width: 30, height: 30, borderRadius: 8, border: "none",
                        background: "transparent", cursor: "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        color: "#6B7580", transition: "background 0.15s, color 0.15s",
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.background = "#EAF1FB";
                        e.currentTarget.style.color = "#2A6FDB";
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.background = "transparent";
                        e.currentTarget.style.color = "#8E97A0";
                      }}
                    >
                      <Pencil style={{ width: 13, height: 13 }} />
                    </button>
                  )}
                  {onDelete && (
                    <button
                      onClick={() => onDelete(task)}
                      title="Eliminar tarea"
                      style={{
                        width: 30, height: 30, borderRadius: 8, border: "none",
                        background: "transparent", cursor: "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        color: "#6B7580", transition: "background 0.15s, color 0.15s",
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.background = "#FCE5E5";
                        e.currentTarget.style.color = "#D03A3A";
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.background = "transparent";
                        e.currentTarget.style.color = "#8E97A0";
                      }}
                    >
                      <Trash2 style={{ width: 13, height: 13 }} />
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
