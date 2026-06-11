import { useState, useEffect, useRef, useCallback } from "react";
import { ReschedulingModal } from "./ReschedulingModal";
import { SchedulingModal } from "./SchedulingModal";
import { GanttSettingsDrawer, type GanttViewOptions } from "./GanttSettingsDrawer";
import type { Task, TaskStatus, Responsible } from "../types";
import { fetchCriticalPath, type CriticalPathResult } from "../api/criticalPath";
import { fetchBaseline, type BaselineEntry } from "../api/baseline";

// ─── Layout constants ─────────────────────────────────────────────────────────

const ROW_H      = 60;   // px per task row
const TASK_COL_W = 280;  // px for the fixed left name column
const BAR_H      = 34;   // px bar height

const _now      = new Date();
const TODAY_STR = `${_now.getFullYear()}-${String(_now.getMonth()+1).padStart(2,"0")}-${String(_now.getDate()).padStart(2,"0")}`;
const TODAY_MS  = new Date(TODAY_STR).getTime();
const DAY_MS    = 86_400_000;
const CLICK_THRESHOLD_PX = 5;
const DND_TYPE  = "application/x-constructa-task";

const DAY_NAMES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

const MONTH_NAMES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const NOW = new Date();
const currentMonthLabel = `${MONTH_NAMES[NOW.getMonth()]} · ${NOW.getFullYear()}`;

// ─── Status visual system ─────────────────────────────────────────────────────

const STATUS_STYLE: Record<TaskStatus, { bg: string; border: string; stripe: string; dot: string; label: string; badge: string | null }> = {
  pendiente:   { bg: "#EBF3FF", border: "#3B82F6", stripe: "#3B82F6", dot: "#3B82F6", label: "Pendiente",   badge: null },
  en_progreso: { bg: "#FFFBEB", border: "#D97706", stripe: "#D97706", dot: "#D97706", label: "En progreso", badge: null },
  bloqueada:   { bg: "#FCE5E5", border: "#D03A3A", stripe: "#D03A3A", dot: "#D03A3A", label: "Bloqueada",   badge: null },
  completada:  { bg: "#E4F3EC", border: "#1F8A5B", stripe: "#1F8A5B", dot: "#1F8A5B", label: "Completada",  badge: "Completada" },
  cancelada:   { bg: "#F4F5F4", border: "#94928D", stripe: "#94928D", dot: "#94928D", label: "Cancelada",   badge: "Cancelada" },
};

const AVATAR_COLORS = ["#E76A2D", "#3A6BD9", "#1F9A5A", "#9A4DC9", "#D03A3A", "#E89B14", "#0EA5A0"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ms(d: string): number { return new Date(d).getTime(); }

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

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dateToOffset(dateStr: string): number {
  return Math.round((ms(dateStr) - TODAY_MS) / DAY_MS);
}


function offsetToDate(offset: number): string {
  return new Date(TODAY_MS + offset * DAY_MS).toISOString().slice(0, 10);
}

function fmtShort(dateStr: string): string {
  const [, m, day] = dateStr.split("-");
  return `${day}/${m}`;
}

function isWeekend(d: Date): boolean { return d.getUTCDay() === 0 || d.getUTCDay() === 6; }

function avatarColor(name: string): string {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function getInitials(name: string): string {
  return name.split(" ").map(w => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

// ─── Status dot ───────────────────────────────────────────────────────────────

const STATUS_ORDER: TaskStatus[] = ["pendiente", "en_progreso", "bloqueada", "completada", "cancelada"];

function StatusDotVisual({ status }: { status: TaskStatus }) {
  const { dot } = STATUS_STYLE[status];
  const base = { width: 16, height: 16, borderRadius: 99, flexShrink: 0 } as const;
  if (status === "completada")
    return (
      <div style={{ ...base, background: dot, border: `2px solid ${dot}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
          <path d="M2 5l2 2 4-4" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
    );
  if (status === "en_progreso")
    return <div style={{ ...base, border: `2px solid ${dot}`, background: `radial-gradient(circle, ${dot} 0% 30%, transparent 30%)` }} />;
  if (status === "cancelada")
    return <div style={{ ...base, border: "2px dashed #94928D", background: "repeating-linear-gradient(45deg,transparent 0 2px,#D5D7D3 2px 3px)" }} />;
  if (status === "pendiente")
    return <div style={{ ...base, border: `2px dashed ${dot}` }} />;
  return <div style={{ ...base, border: `2px solid ${dot}` }} />;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface DragState    { taskId: number; startClientX: number; currentDeltaPx: number; }
interface ResizeState  { taskId: number; edge: "start" | "end"; startClientX: number; currentDeltaPx: number; }
interface PendingReschedule { task: Task; newStartDate: string | null; newDueDate: string | null; nearbyCount: number; mode: "move" | "resize-start" | "resize-end"; }
interface PendingSchedule   { task: Task; dropDate: string; insertIdx: number; }
interface RowDragState { taskId: number; startY: number; currentDeltaY: number; }

interface GanttTimelineProps {
  tasks: Task[];
  responsibles: Responsible[];
  obraStartDate?: string | null;
  obraExpectedEndDate?: string | null;
  onSaved: () => void;
  onEditTask: (task: Task) => void;
  onDeleteTask?: (task: Task) => void;
  onStatusChange?: (task: Task, newStatus: TaskStatus) => void;
  tasksWithoutDates?: number;
  obraId?: number;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function GanttTimeline({
  tasks,
  responsibles,
  obraStartDate,
  obraExpectedEndDate,
  onSaved,
  onEditTask,
  onDeleteTask,
  onStatusChange,
  tasksWithoutDates = 0,
  obraId,
}: GanttTimelineProps) {
  // ── View options (synced with settings drawer) ──────────────────────────────
  const [viewOptions, setViewOptions] = useState<GanttViewOptions>({
    view: "semana",
    showTasksWithoutDates: false,
    showProgress: true,
    showDependencies: true,
    highlightCritical: false,
    showBaseline: false,
  });
  const [showSettings, setShowSettings] = useState(false);

  function patchViewOptions(patch: Partial<GanttViewOptions>) {
    setViewOptions(prev => ({ ...prev, ...patch }));
  }

  const view = viewOptions.view;
  const dayW = view === "semana" ? 90 : view === "mes" ? 45 : 22;
  const dayWRef = useRef(dayW);
  dayWRef.current = dayW;

  // ── Existing state ───────────────────────────────────────────────────────────
  const [drag,            setDrag]            = useState<DragState | null>(null);
  const [resize,          setResize]          = useState<ResizeState | null>(null);
  const [pending,         setPending]         = useState<PendingReschedule | null>(null);
  const [pendingSchedule, setPendingSchedule] = useState<PendingSchedule | null>(null);
  const [selectedId,      setSelectedId]      = useState<number | null>(null);
  const [highlightedId,   setHighlightedId]   = useState<number | null>(null);
  const [filterStatuses,  setFilterStatuses]  = useState<Set<TaskStatus>>(new Set());
  const [showFilterDrop,  setShowFilterDrop]  = useState(false);
  const [isDragOver,      setIsDragOver]      = useState(false);
  const [hoveredRowId,    setHoveredRowId]    = useState<number | null>(null);
  const [statusDrop,      setStatusDrop]      = useState<{ taskId: number; x: number; y: number } | null>(null);
  const [dragOverInfo,    setDragOverInfo]    = useState<{ clientX: number; clientY: number; date: string } | null>(null);
  const [criticalData,    setCriticalData]    = useState<CriticalPathResult | null>(null);
  const [baselineMap,     setBaselineMap]     = useState<Map<number, BaselineEntry>>(new Map());
  const [collapsedIds,    setCollapsedIds]    = useState<Set<number>>(() => {
    try {
      const saved = localStorage.getItem(`gantt_collapsed_${tasks[0]?.obra_id ?? "unknown"}`);
      return saved ? new Set<number>(JSON.parse(saved)) : new Set<number>();
    } catch { return new Set<number>(); }
  });
  const [depTooltip,      setDepTooltip]      = useState<{ x: number; y: number; type: string; lag: number; violated: boolean } | null>(null);

  // ── Close status dropdown on outside click ───────────────────────────────────
  useEffect(() => {
    if (!statusDrop) return;
    function handleDown(e: MouseEvent) {
      const el = document.getElementById("gantt-status-drop");
      if (el && !el.contains(e.target as Node)) setStatusDrop(null);
    }
    document.addEventListener("mousedown", handleDown);
    return () => document.removeEventListener("mousedown", handleDown);
  }, [statusDrop]);

  // ── Close filter dropdown on outside click ───────────────────────────────────
  useEffect(() => {
    if (!showFilterDrop) return;
    function handleDown(e: MouseEvent) {
      const el = document.getElementById("gantt-filter-drop");
      if (el && !el.contains(e.target as Node)) setShowFilterDrop(false);
    }
    document.addEventListener("mousedown", handleDown);
    return () => document.removeEventListener("mousedown", handleDown);
  }, [showFilterDrop]);

  // ── Row reorder state ────────────────────────────────────────────────────────
  const storageKey  = `gantt_order_${tasks[0]?.obra_id ?? "unknown"}`;
  const collapseKey = `gantt_collapsed_${tasks[0]?.obra_id ?? "unknown"}`;

  const rowDragMovedRef = useRef(false);

  const [rowOrder,   setRowOrder]   = useState<number[]>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [rowDrag,    setRowDrag]    = useState<RowDragState | null>(null);
  const rowDragRef   = useRef<RowDragState | null>(null);
  const orderedVisRef = useRef<Task[]>([]);

  const dragRef       = useRef<DragState | null>(null);
  const resizeRef     = useRef<ResizeState | null>(null);
  const onEditRef     = useRef(onEditTask);
  const railRef           = useRef<HTMLDivElement>(null);
  const scrollRef         = useRef<HTMLDivElement>(null);
  const dateHeaderInnerRef = useRef<HTMLDivElement>(null);
  const stateRef      = useRef<{ visible: Task[]; rangeStart: number }>({ visible: [], rangeStart: 0 });
  const autoScrollRaf = useRef<number | null>(null);
  const autoScrollVel = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });

  useEffect(() => { onEditRef.current = onEditTask; }, [onEditTask]);

  // ── Critical path fetch ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!viewOptions.highlightCritical || !obraId) {
      setCriticalData(null);
      return;
    }
    let cancelled = false;
    fetchCriticalPath(obraId)
      .then(data => { if (!cancelled) setCriticalData(data); })
      .catch(() => { if (!cancelled) setCriticalData(null); });
    return () => { cancelled = true; };
  }, [viewOptions.highlightCritical, obraId, tasks.length]);

  // ── Baseline fetch ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!viewOptions.showBaseline || !obraId) {
      setBaselineMap(new Map());
      return;
    }
    let cancelled = false;
    fetchBaseline(obraId)
      .then(data => {
        if (cancelled) return;
        setBaselineMap(new Map(data.entries.map(e => [e.task_id, e])));
      })
      .catch(() => { if (!cancelled) setBaselineMap(new Map()); });
    return () => { cancelled = true; };
  }, [viewOptions.showBaseline, obraId]);

  // ── Date range ──────────────────────────────────────────────────────────────

  const visible = viewOptions.showTasksWithoutDates
    ? tasks
    : tasks.filter(t => t.start_date || t.due_date);

  // ── Ordered visible (for row reorder) ───────────────────────────────────────
  const visibleById = new Map(visible.map(t => [t.id, t]));
  const orderedVisible: Task[] = [
    ...rowOrder.filter(id => visibleById.has(id)).map(id => visibleById.get(id)!),
    ...visible.filter(t => !rowOrder.includes(t.id)),
  ];
  orderedVisRef.current = orderedVisible;

  const levelMap = buildLevelMap(tasks);

  const childrenByParent = new Map<number, number[]>();
  tasks.forEach(t => {
    if (t.parent_task_id) {
      const arr = childrenByParent.get(t.parent_task_id) ?? [];
      arr.push(t.id);
      childrenByParent.set(t.parent_task_id, arr);
    }
  });

  const filteredVisible = orderedVisible.filter(t => {
    if (filterStatuses.size > 0 && !filterStatuses.has(t.status)) return false;
    let pid: number | null | undefined = t.parent_task_id;
    while (pid != null) {
      if (collapsedIds.has(pid)) return false;
      pid = tasks.find(p => p.id === pid)?.parent_task_id;
    }
    return true;
  });

  // Sync rowOrder when visible tasks change (add new, remove deleted)
  useEffect(() => {
    setRowOrder(prev => {
      const prevSet = new Set(prev);
      const newIds  = visible.filter(t => !prevSet.has(t.id)).map(t => t.id);
      const merged  = [...prev.filter(id => visibleById.has(id)), ...newIds];
      try { localStorage.setItem(storageKey, JSON.stringify(merged)); } catch { /* ignore */ }
      return merged;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible.map(t => t.id).join(",")]);

  // Persist order to localStorage whenever the user reorders
  useEffect(() => {
    if (rowOrder.length === 0) return;
    try { localStorage.setItem(storageKey, JSON.stringify(rowOrder)); } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowOrder]);

  let rangeStart: number;
  let rangeEnd: number;

  if (visible.length > 0) {
    const offsets: number[] = [0];
    for (const t of visible) {
      if (t.start_date) offsets.push(dateToOffset(t.start_date));
      if (t.due_date)   offsets.push(dateToOffset(t.due_date));
    }
    rangeStart = Math.min(...offsets) - 4;
    rangeEnd   = Math.max(...offsets) + 8;
  } else {
    const s = obraStartDate ? dateToOffset(obraStartDate) : 0;
    const e = obraExpectedEndDate ? dateToOffset(obraExpectedEndDate) : 30;
    rangeStart = Math.min(s, 0) - 4;
    rangeEnd   = Math.max(e, s + 30) + 8;
  }

  const totalDays = rangeEnd - rangeStart + 1;
  const gridWidth = totalDays * dayW;

  stateRef.current = { visible, rangeStart };

  function offsetToLeft(offset: number): number {
    return (offset - rangeStart) * dayW;
  }

  function getEffectiveDates(task: Task, deltaDays: number, resizeEdge?: "start" | "end") {
    let start = task.start_date;
    let due   = task.due_date;
    if (deltaDays === 0) return { start, due };
    if (resizeEdge === "start") {
      if (start) {
        start = addDays(start, deltaDays);
        if (due && start > due) start = due;
      } else if (due) {
        start = addDays(due, deltaDays + 1);  // due-only: shift +1 so 1 day left = same day
        if (start > due) start = due;
      }
    } else if (resizeEdge === "end") {
      if (due) {
        due = addDays(due, deltaDays);
        if (start && due < start) due = start;
      } else if (start) {
        due = addDays(start, deltaDays - 1);  // start-only: shift -1 so 1 day right = same day
        if (due < start) due = start;
      }
    } else {
      if (start) start = addDays(start, deltaDays);
      if (due)   due   = addDays(due,   deltaDays);
    }
    return { start, due };
  }

  // ── Mouse drag ──────────────────────────────────────────────────────────────

  function startBarDrag(taskId: number, clientX: number) {
    const s: DragState = { taskId, startClientX: clientX, currentDeltaPx: 0 };
    dragRef.current = s;
    setDrag(s);
    setSelectedId(taskId);
  }

  function startEdgeResize(taskId: number, edge: "start" | "end", clientX: number) {
    const s: ResizeState = { taskId, edge, startClientX: clientX, currentDeltaPx: 0 };
    resizeRef.current = s;
    setResize(s);
    setSelectedId(taskId);
  }

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (dragRef.current) {
      const u: DragState = { ...dragRef.current, currentDeltaPx: e.clientX - dragRef.current.startClientX };
      dragRef.current = u; setDrag(u);
    } else if (resizeRef.current) {
      const u: ResizeState = { ...resizeRef.current, currentDeltaPx: e.clientX - resizeRef.current.startClientX };
      resizeRef.current = u; setResize(u);
    }
  }, []);

  const handleMouseUp = useCallback(() => {
    const curDrag   = dragRef.current;
    const curResize = resizeRef.current;
    dragRef.current = resizeRef.current = null;
    setDrag(null); setResize(null);

    const { visible: vis } = stateRef.current;
    const currentDayW = dayWRef.current;

    if (curDrag) {
      if (Math.abs(curDrag.currentDeltaPx) < CLICK_THRESHOLD_PX) {
        const task = vis.find(t => t.id === curDrag.taskId);
        if (task) onEditRef.current(task);
        return;
      }
      const deltaDays = Math.round(curDrag.currentDeltaPx / currentDayW);
      if (Math.abs(deltaDays) < 1) return;
      const task = vis.find(t => t.id === curDrag.taskId);
      if (!task) return;
      const newStart = task.start_date ? addDays(task.start_date, deltaDays) : null;
      const newDue   = task.due_date   ? addDays(task.due_date,   deltaDays) : null;
      if (newStart === task.start_date && newDue === task.due_date) return;
      const eps = [newStart, newDue].filter(Boolean).map(d => ms(d!));
      const nearbyCount = vis.filter(t => t.id !== task.id && [t.start_date, t.due_date]
        .filter(Boolean).some(d => eps.some(ep => Math.abs(ms(d!) - ep) <= 3 * DAY_MS))).length;
      setPending({ task, newStartDate: newStart, newDueDate: newDue, nearbyCount, mode: "move" });
      return;
    }

    if (curResize) {
      const deltaDays = Math.round(curResize.currentDeltaPx / currentDayW);
      if (Math.abs(deltaDays) < 1) return;
      const task = vis.find(t => t.id === curResize.taskId);
      if (!task) return;
      let newStart = task.start_date;
      let newDue   = task.due_date;
      if (curResize.edge === "start") {
        const base  = task.start_date ?? task.due_date!;
        const shift = !task.start_date ? 1 : 0;  // due-only: shift +1
        newStart = addDays(base, deltaDays + shift);
        if (newDue && newStart > newDue) newStart = newDue;
      } else {
        const base  = task.due_date ?? task.start_date!;
        const shift = !task.due_date ? -1 : 0;   // start-only: shift -1
        newDue = addDays(base, deltaDays + shift);
        if (newStart && newDue < newStart) newDue = newStart;
      }
      if (newStart === task.start_date && newDue === task.due_date) return;
      const eps = [newStart, newDue].filter(Boolean).map(d => ms(d!));
      const nearbyCount = vis.filter(t => t.id !== task.id && [t.start_date, t.due_date]
        .filter(Boolean).some(d => eps.some(ep => Math.abs(ms(d!) - ep) <= 3 * DAY_MS))).length;
      const mode: PendingReschedule["mode"] = curResize.edge === "start" ? "resize-start" : "resize-end";
      setPending({ task, newStartDate: newStart, newDueDate: newDue, nearbyCount, mode });
    }
  }, []);

  useEffect(() => {
    if (!drag && !resize) return;
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [drag, resize, handleMouseMove, handleMouseUp]);

  // ── Scroll to today on mount ────────────────────────────────────────────────

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (!scrollRef.current) return;
      const todayCol = (-rangeStart) * dayW;
      const target = todayCol - scrollRef.current.clientWidth / 3;
      scrollRef.current.scrollLeft = Math.max(0, target);
    });
    return () => cancelAnimationFrame(frame);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Row reorder drag handlers ────────────────────────────────────────────────

  function startRowDrag(e: React.PointerEvent, taskId: number) {
    e.preventDefault();
    e.stopPropagation();
    const s: RowDragState = { taskId, startY: e.clientY, currentDeltaY: 0 };
    rowDragRef.current = s;
    setRowDrag(s);
  }

  useEffect(() => {
    if (!rowDrag) return;
    function onMove(e: PointerEvent) {
      if (!rowDragRef.current) return;
      const u = { ...rowDragRef.current, currentDeltaY: e.clientY - rowDragRef.current.startY };
      rowDragRef.current = u;
      setRowDrag(u);
    }
    function onUp() {
      const cur = rowDragRef.current;
      rowDragRef.current = null;
      setRowDrag(null);
      if (!cur) return;
      if (Math.abs(cur.currentDeltaY) > 5) {
        rowDragMovedRef.current = true;
        setTimeout(() => { rowDragMovedRef.current = false; }, 0);
      }
      const ord = orderedVisRef.current;
      const origIdx = ord.findIndex(t => t.id === cur.taskId);
      const targetIdx = Math.max(0, Math.min(ord.length - 1, origIdx + Math.round(cur.currentDeltaY / ROW_H)));
      if (origIdx !== targetIdx) {
        const newOrder = ord.map(t => t.id);
        const [moved] = newOrder.splice(origIdx, 1);
        newOrder.splice(targetIdx, 0, moved);
        setRowOrder(newOrder);
      }
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup",   onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup",   onUp);
    };
  }, [rowDrag]);

  function getRowTranslate(taskId: number): number {
    if (!rowDrag) return 0;
    const ord = orderedVisRef.current;
    const origIdx = ord.findIndex(t => t.id === rowDrag.taskId);
    const thisIdx = ord.findIndex(t => t.id === taskId);
    const targetIdx = Math.max(0, Math.min(ord.length - 1, origIdx + Math.round(rowDrag.currentDeltaY / ROW_H)));
    if (taskId === rowDrag.taskId) return rowDrag.currentDeltaY;
    if (origIdx < targetIdx && thisIdx > origIdx && thisIdx <= targetIdx) return -ROW_H;
    if (origIdx > targetIdx && thisIdx >= targetIdx && thisIdx < origIdx) return ROW_H;
    return 0;
  }

  // ── HTML5 DnD ──────────────────────────────────────────────────────────────

  function stopAutoScroll() {
    if (autoScrollRaf.current !== null) {
      cancelAnimationFrame(autoScrollRaf.current);
      autoScrollRaf.current = null;
    }
    autoScrollVel.current = { dx: 0, dy: 0 };
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    if (!e.dataTransfer.types.includes(DND_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setIsDragOver(true);

    // ── Edge auto-scroll ──────────────────────────────────────────────────────
    const scrollEl = scrollRef.current;
    if (scrollEl) {
      const sr    = scrollEl.getBoundingClientRect();
      const EDGE  = 80;
      const SPEED = 14;
      let dx = 0;
      // Horizontal: Gantt grid edges → scrolls grid left/right
      const dLeft   = e.clientX - sr.left;
      const dRight  = sr.right  - e.clientX;
      if (dLeft  > 0 && dLeft  < EDGE) dx = -Math.ceil(SPEED * (1 - dLeft  / EDGE));
      if (dRight > 0 && dRight < EDGE) dx =  Math.ceil(SPEED * (1 - dRight / EDGE));
      autoScrollVel.current = { dx, dy: 0 };
      if (dx !== 0 && autoScrollRaf.current === null) {
        function loop() {
          const { dx } = autoScrollVel.current;
          if (dx === 0) { autoScrollRaf.current = null; return; }
          if (scrollRef.current) scrollRef.current.scrollLeft += dx;
          autoScrollRaf.current = requestAnimationFrame(loop);
        }
        autoScrollRaf.current = requestAnimationFrame(loop);
      } else if (dx === 0) {
        stopAutoScroll();
      }
    }

    // ── Cursor date tooltip ───────────────────────────────────────────────────
    const railRect = railRef.current?.getBoundingClientRect();
    if (railRect) {
      const xPx    = e.clientX - railRect.left;
      const offset = rangeStart + Math.floor(xPx / dayWRef.current);
      setDragOverInfo({ clientX: e.clientX, clientY: e.clientY, date: offsetToDate(offset) });
    }
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragOver(false);
    setDragOverInfo(null);
    stopAutoScroll();
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const insertIdx = orderedVisRef.current.length;
    setIsDragOver(false);
    setDragOverInfo(null);
    stopAutoScroll();
    const rawId  = e.dataTransfer.getData(DND_TYPE);
    const taskId = parseInt(rawId, 10);
    if (!rawId || isNaN(taskId)) return;
    const task = tasks.find(t => t.id === taskId);
    if (!task || task.start_date || task.due_date) return;
    const rect = railRef.current?.getBoundingClientRect();
    if (!rect) return;
    const xPx    = e.clientX - rect.left;
    const offset = rangeStart + Math.floor(xPx / dayWRef.current);
    setPendingSchedule({ task, dropDate: offsetToDate(offset), insertIdx });
  }

  function handleRescheduleSaved(task: Task) {
    setPending(null);
    setHighlightedId(task.id);
    setTimeout(() => setHighlightedId(null), 1500);
    onSaved();
  }

  function handleScheduleSaved(savedTask: Task) {
    const insertIdx = pendingSchedule?.insertIdx ?? orderedVisRef.current.length;
    setPendingSchedule(null);
    setHighlightedId(savedTask.id);
    setTimeout(() => setHighlightedId(null), 1500);
    setRowOrder(prev => {
      const without = prev.filter(id => id !== savedTask.id);
      without.splice(insertIdx, 0, savedTask.id);
      try { localStorage.setItem(storageKey, JSON.stringify(without)); } catch { /* ignore */ }
      return without;
    });
    onSaved();
  }

  // ── Collapse helpers ──────────────────────────────────────────────────────────

  function toggleCollapsed(taskId: number) {
    setCollapsedIds(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId); else next.add(taskId);
      try { localStorage.setItem(collapseKey, JSON.stringify(Array.from(next))); } catch { /* ignore */ }
      return next;
    });
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  // Insert a null ghost placeholder at the end when dragging over
  const displayItems: (Task | null)[] = isDragOver
    ? [...filteredVisible, null]
    : filteredVisible;

  return (
    <>
      {drag   && <div className="fixed inset-0 z-40 cursor-grabbing select-none" />}
      {resize && <div className="fixed inset-0 z-40 cursor-ew-resize select-none" />}

      <div style={{ background: "#fff", border: "1px solid #ECE7DD", borderRadius: 14, overflow: "clip", cursor: rowDrag ? "grabbing" : undefined, position: "relative" }}>
        {obraId && (
          <GanttSettingsDrawer
            obraId={obraId}
            isOpen={showSettings}
            onClose={() => setShowSettings(false)}
            viewOptions={viewOptions}
            onViewOptionsChange={patchViewOptions}
            onBaselineSaved={() => {
              // Reload baseline data after save
              if (obraId) {
                fetchBaseline(obraId)
                  .then(data => setBaselineMap(new Map(data.entries.map(e => [e.task_id, e]))))
                  .catch(() => {});
              }
            }}
          />
        )}

        {/* ── Section header ── */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid #F0EBE2" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {/* Calendar icon square */}
            <div style={{
              width: 32, height: 32, borderRadius: 9, flexShrink: 0,
              background: "linear-gradient(135deg, #FFF0E8 0%, #FFE0CC 100%)",
              border: "1px solid #F5D5C0",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                <rect x="1.5" y="2.5" width="13" height="12" rx="1.5" stroke="#E76A2D" strokeWidth="1.4" fill="none"/>
                <path d="M5 1.5v2M11 1.5v2M1.5 6h13" stroke="#E76A2D" strokeWidth="1.4" strokeLinecap="round"/>
                <path d="M4.5 9h1M7.5 9h1M10.5 9h1M4.5 11.5h1M7.5 11.5h1M10.5 11.5h1" stroke="#E76A2D" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
            </div>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, letterSpacing: "-0.015em", color: "#1A2329", fontFamily: "'Plus Jakarta Sans',sans-serif" }}>
              Cronograma de tareas
            </h2>
            <span style={{
              display: "inline-flex", alignItems: "center",
              padding: "2px 9px", borderRadius: 99,
              fontSize: 11.5, fontWeight: 600, color: "#5B6770",
              background: "#F0F1EF", border: "1px solid #E6E7E5",
              fontFamily: "'Plus Jakarta Sans',sans-serif",
            }}>
              {filterStatuses.size > 0 ? `${filteredVisible.length}/${visible.length}` : visible.length} {visible.length === 1 ? "tarea" : "tareas"}
            </span>
            {tasksWithoutDates > 0 && (
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                padding: "2px 8px", borderRadius: 99,
                fontSize: 11.5, fontWeight: 600, color: "#C97D0E",
                background: "#FDF1DE", border: "1px solid #F0D5A0",
              }}>
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
                  <path d="M8 2L14 14H2L8 2Z" stroke="#E89B14" strokeWidth="1.5" fill="none" strokeLinejoin="round"/>
                  <path d="M8 7v3M8 11.5v.5" stroke="#E89B14" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                {tasksWithoutDates} sin fecha
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>

            {/* ── Filter by status ── */}
            <div style={{ position: "relative" }}>
              <button
                title="Filtrar por estado"
                onClick={() => setShowFilterDrop(v => !v)}
                style={{
                  width: 30, height: 30, borderRadius: 7, cursor: "pointer",
                  background: filterStatuses.size > 0 ? "#FFF1E9" : "#fff",
                  border: filterStatuses.size > 0 ? "1.5px solid #FF6B35" : "1px solid #E6E7E5",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: filterStatuses.size > 0 ? "#FF6B35" : "#5B6770",
                  transition: "all 0.15s", position: "relative",
                }}
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                  <path d="M2 4h12M4 8h8M6 12h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                {filterStatuses.size > 0 && (
                  <span style={{
                    position: "absolute", top: -4, right: -4,
                    width: 13, height: 13, borderRadius: 99,
                    background: "#FF6B35", color: "#fff",
                    fontSize: 8, fontWeight: 700,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    border: "1.5px solid #fff",
                  }}>
                    {filterStatuses.size}
                  </span>
                )}
              </button>
              {showFilterDrop && (
                <div
                  id="gantt-filter-drop"
                  style={{
                    position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 9999,
                    background: "#fff", border: "1px solid #E6E7E5", borderRadius: 12,
                    boxShadow: "0 8px 24px -4px rgba(15,22,28,0.14)",
                    padding: 6, minWidth: 170,
                    fontFamily: "'Plus Jakarta Sans', sans-serif",
                  }}
                >
                  {(Object.keys(STATUS_STYLE) as TaskStatus[]).map(s => {
                    const st = STATUS_STYLE[s];
                    const on = filterStatuses.has(s);
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setFilterStatuses(prev => {
                          const next = new Set(prev);
                          if (on) next.delete(s); else next.add(s);
                          return next;
                        })}
                        style={{
                          display: "flex", alignItems: "center", gap: 8,
                          width: "100%", padding: "7px 10px", borderRadius: 7,
                          background: on ? st.bg : "transparent",
                          border: "none", cursor: "pointer",
                          fontFamily: "'Plus Jakarta Sans', sans-serif",
                          transition: "background 0.1s",
                        }}
                        onMouseEnter={e => { if (!on) e.currentTarget.style.background = "#F4F5F4"; }}
                        onMouseLeave={e => { if (!on) e.currentTarget.style.background = "transparent"; }}
                      >
                        <span style={{ width: 7, height: 7, borderRadius: 99, background: st.dot, flexShrink: 0 }} />
                        <span style={{ fontSize: 12.5, fontWeight: on ? 700 : 500, color: on ? st.border : "#3E4A52", flex: 1 }}>
                          {st.label}
                        </span>
                        {on && <span style={{ fontSize: 10, color: st.border }}>✓</span>}
                      </button>
                    );
                  })}
                  {filterStatuses.size > 0 && (
                    <>
                      <div style={{ borderTop: "1px solid #F0F1EF", margin: "4px 0" }} />
                      <button
                        type="button"
                        onClick={() => { setFilterStatuses(new Set()); setShowFilterDrop(false); }}
                        style={{
                          width: "100%", padding: "6px 10px", borderRadius: 7, border: "none",
                          background: "transparent", cursor: "pointer", textAlign: "left",
                          fontSize: 12, color: "#8E97A0", fontFamily: "'Plus Jakarta Sans', sans-serif",
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = "#F4F5F4"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                      >
                        Limpiar filtros
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* ── Calendar / Gantt settings ── */}
            {obraId && (
              <button
                title="Configurar calendario del Gantt"
                onClick={() => setShowSettings(v => !v)}
                style={{
                  width: 30, height: 30, borderRadius: 7, cursor: "pointer",
                  background: showSettings ? "#FF6B35" : "#fff",
                  border: showSettings ? "1.5px solid #FF6B35" : "1px solid #E6E7E5",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: showSettings ? "#fff" : "#5B6770",
                  transition: "all 0.15s",
                }}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <rect x="1.5" y="2.5" width="13" height="12" rx="2" stroke="currentColor" strokeWidth="1.4"/>
                  <path d="M1.5 6.5h13" stroke="currentColor" strokeWidth="1.4"/>
                  <path d="M5 1.5v2M11 1.5v2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                  <rect x="4" y="9" width="2" height="2" rx="0.4" fill="currentColor"/>
                  <rect x="7" y="9" width="2" height="2" rx="0.4" fill="currentColor"/>
                  <rect x="10" y="9" width="2" height="2" rx="0.4" fill="currentColor"/>
                </svg>
              </button>
            )}

            {/* ── Go to today ── */}
            <button
              title="Ir a hoy"
              onClick={() => {
                if (!scrollRef.current) return;
                const currentDayW = dayWRef.current;
                const todayCol = (-rangeStart) * currentDayW;
                scrollRef.current.scrollTo({ left: Math.max(0, todayCol - scrollRef.current.clientWidth / 3), behavior: "smooth" });
              }}
              style={{
                width: 30, height: 30, borderRadius: 7, cursor: "pointer",
                background: "#fff", border: "1px solid #E6E7E5",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "#5B6770", transition: "all 0.15s",
              }}
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="2.5" fill="#E76A2D"/>
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4"/>
              </svg>
            </button>
          </div>
        </div>

        {/* ── Body: sticky name col + scrollable grid ── */}
        <div style={{ display: "flex" }}>

          {/* ── Left task column ── */}
          <div style={{ width: TASK_COL_W, flexShrink: 0, borderRight: "1px solid #F0EBE2", background: "#FAF8F4", display: "flex", flexDirection: "column" }}>

            {/* Column header */}
            <div style={{ height: 40, display: "flex", alignItems: "center", padding: "0 16px", borderBottom: "1px solid #F0EBE2", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 7, background: "#FAF8F4" }}>
              <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.12em", color: "#94928D", textTransform: "uppercase" }}>Tarea</span>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: "#8E97A0" }}>{currentMonthLabel}</span>
            </div>

            {/* Task rows */}
            {filteredVisible.length === 0 ? (
              <div style={{ padding: "24px 16px", color: "#94928D", fontSize: 12.5, textAlign: "center" }}>Sin tareas programadas</div>
            ) : (
              displayItems.map((task, di) => {
                if (task === null) return (
                  <div key="__ghost_left__" style={{
                    height: ROW_H, display: "flex", alignItems: "center",
                    padding: "0 12px 0 8px", gap: 8,
                    background: "rgba(231,106,45,0.06)",
                    borderTop: "2px dashed #E76A2D",
                    borderBottom: "2px dashed #E76A2D",
                    boxSizing: "border-box",
                  }}>
                    <div style={{ width: 18 }} /><div style={{ width: 18 }} />
                    <span style={{ fontSize: 11.5, fontWeight: 600, color: "#E76A2D", opacity: 0.7 }}>Nueva tarea aquí</span>
                  </div>
                );
                const isSel = selectedId === task.id;
                void di;
                const isHov = hoveredRowId === task.id;
                const resp  = task.responsible_id ? responsibles.find(r => r.id === task.responsible_id) : null;
                const taskLevel = levelMap.get(task.id) ?? 0;
                const isDraggingThis = rowDrag?.taskId === task.id;
                return (
                  <div
                    key={task.id}
                    onMouseEnter={() => setHoveredRowId(task.id)}
                    onMouseLeave={() => setHoveredRowId(null)}
                    onClick={() => { if (rowDragMovedRef.current) return; setSelectedId(task.id); onEditTask(task); }}
                    style={{
                      height: ROW_H, display: "grid",
                      gridTemplateColumns: "18px 18px 16px 1fr auto",
                      alignItems: "center", gap: 8,
                      padding: "0 12px 0 8px",
                      borderBottom: "1px solid #F4F1EB",
                      cursor: "pointer",
                      background: isSel ? "#F4F1EB" : (isHov ? "#FCFBF9" : "transparent"),
                      transition: isDraggingThis ? "background 0.12s" : "background 0.12s, transform 0.22s cubic-bezier(.22,.61,.36,1)",
                      transform: `translateY(${getRowTranslate(task.id)}px)`,
                      zIndex: isDraggingThis ? 10 : "auto" as unknown as number,
                      boxShadow: isDraggingThis ? "0 8px 24px -6px rgba(24,34,42,0.18), 0 0 0 1px #D5D7D3" : "none",
                      position: "relative",
                    }}
                  >
                    {/* Grip */}
                    <GripHandle onPointerDown={(e) => startRowDrag(e, task.id)} />

                    {/* Status dot — clickable if onStatusChange provided */}
                    <button
                      type="button"
                      title="Cambiar estado"
                      onClick={e => {
                        e.stopPropagation();
                        if (!onStatusChange) return;
                        const rect = e.currentTarget.getBoundingClientRect();
                        setStatusDrop(d => d?.taskId === task.id ? null : { taskId: task.id, x: rect.left, y: rect.bottom + 6 });
                      }}
                      style={{
                        background: "none", border: "none", padding: 0, margin: 0,
                        cursor: onStatusChange ? "pointer" : "default",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        borderRadius: 99,
                        outline: "none",
                      }}
                    >
                      <StatusDotVisual status={task.status} />
                    </button>

                    {/* Chevron — solo para tareas padre */}
                    {childrenByParent.has(task.id) ? (
                      <button
                        type="button"
                        title={collapsedIds.has(task.id) ? "Expandir subtareas" : "Colapsar subtareas"}
                        onClick={e => { e.stopPropagation(); toggleCollapsed(task.id); }}
                        style={{
                          width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                          background: "none", border: "none", padding: 0, margin: 0,
                          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                          color: "#5B6770",
                        }}
                      >
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
                          style={{ transform: collapsedIds.has(task.id) ? "rotate(-90deg)" : "none", transition: "transform 0.15s" }}
                        >
                          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                    ) : (
                      <div style={{ width: 16, flexShrink: 0 }} />
                    )}

                    {/* Name + owner */}
                    <div style={{ minWidth: 0, lineHeight: 1.2, paddingLeft: taskLevel * 12 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#1A2329", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {taskLevel > 0 && <span style={{ color: "#ADAAA4", marginRight: 4, fontSize: 11 }}>└</span>}
                        {task.title}
                      </div>
                      {resp && (
                        <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 3 }}>
                          <div style={{
                            width: 14, height: 14, borderRadius: 99, flexShrink: 0,
                            background: avatarColor(resp.full_name),
                            color: "#fff", fontSize: 8, fontWeight: 700,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontFamily: "'Plus Jakarta Sans',sans-serif",
                          }}>
                            {getInitials(resp.full_name)[0]}
                          </div>
                          <span style={{ fontSize: 11, color: "#94928D", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {resp.full_name}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Hover actions */}
                    <div style={{ display: "flex", alignItems: "center", gap: 3, opacity: isHov ? 1 : 0, transition: "opacity 0.15s" }}>
                      <button
                        onClick={e => { e.stopPropagation(); onEditTask(task); }}
                        title="Editar"
                        style={{ width: 24, height: 24, borderRadius: 6, display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#8E97A0", background: "none", border: "none", cursor: "pointer" }}
                        onMouseEnter={e => (e.currentTarget.style.background = "#F4F5F4")}
                        onMouseLeave={e => (e.currentTarget.style.background = "none")}
                      >
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                          <path d="M11.5 2.5l2 2-8 8H3.5v-2z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
                        </svg>
                      </button>
                      {onDeleteTask && (
                        <button
                          onClick={e => { e.stopPropagation(); onDeleteTask(task); }}
                          title="Eliminar"
                          style={{ width: 24, height: 24, borderRadius: 6, display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#8E97A0", background: "none", border: "none", cursor: "pointer" }}
                          onMouseEnter={e => { e.currentTarget.style.background = "#FEE2E2"; e.currentTarget.style.color = "#DC2626"; }}
                          onMouseLeave={e => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "#8E97A0"; }}
                        >
                          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="2,4 14,4"/>
                            <path d="M5 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1"/>
                            <path d="M6 7v5M10 7v5"/>
                            <path d="M3 4l1 9a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-9"/>
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* ── Right scrollable grid ── */}
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>

            {/* ── Date header — sticky, outside the horizontal scroll container ── */}
            <div style={{ position: "sticky", top: 0, zIndex: 6, overflowX: "clip", flexShrink: 0, borderBottom: "1px solid #F0EBE2", background: "#FAFAF9" }}>
              <div ref={dateHeaderInnerRef} style={{ display: "flex", height: 40, width: gridWidth }}>
                {Array.from({ length: totalDays }).map((_, i) => {
                  const offset  = rangeStart + i;
                  const d       = new Date(TODAY_MS + offset * DAY_MS);
                  const isToday = offset === 0;
                  const we      = isWeekend(d);
                  return (
                    <div key={i} style={{
                      width: dayW, flexShrink: 0,
                      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                      gap: view === "semana" ? 2 : 1, padding: "6px 0",
                      borderLeft: i === 0 ? "none" : "1px solid #F0EBE2",
                      background: isToday ? "#E85A26" : (we ? "#F4F5F4" : "#FAFAF9"),
                    }}>
                      {view !== "trim" && (
                        <div style={{
                          fontSize: view === "semana" ? 9.5 : 9,
                          fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase",
                          color: isToday ? "rgba(255,255,255,0.85)" : "#94928D",
                        }}>
                          {DAY_NAMES[d.getUTCDay()]}
                        </div>
                      )}
                      <div style={{
                        fontSize: view === "semana" ? 18 : view === "mes" ? 13 : 10,
                        fontWeight: view === "semana" ? 700 : 600,
                        letterSpacing: "-0.02em", lineHeight: 1,
                        fontFamily: "'Plus Jakarta Sans',sans-serif",
                        color: isToday ? "#fff" : (we ? "#5B6770" : "#1A2329"),
                      }}>
                        {d.getUTCDate()}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── Bars horizontal scroll area ── */}
            <div ref={scrollRef} style={{ overflowX: "auto" }} onScroll={e => {
              if (dateHeaderInnerRef.current)
                dateHeaderInnerRef.current.style.transform = `translateX(-${e.currentTarget.scrollLeft}px)`;
            }}>
              <div style={{ width: gridWidth, minWidth: "100%" }}>

              {/* Bar rows */}
              <div
                ref={railRef}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                style={{
                  position: "relative",
                  outline: isDragOver ? "2px solid #E76A2D" : "none",
                  outlineOffset: -2,
                  minHeight: ROW_H * Math.max(3, displayItems.length),
                }}
              >
                {/* Weekend background columns */}
                <div style={{ position: "absolute", inset: 0, display: "flex", pointerEvents: "none", zIndex: 0 }}>
                  {Array.from({ length: totalDays }).map((_, i) => {
                    const offset = rangeStart + i;
                    const d = new Date(TODAY_MS + offset * DAY_MS);
                    return (
                      <div key={i} style={{
                        width: dayW, flexShrink: 0, height: "100%",
                        borderLeft: i === 0 ? "none" : "1px solid #F0EBE2",
                        background: isWeekend(d) ? "#F7F4EF" : "transparent",
                      }} />
                    );
                  })}
                </div>

                {/* Today vertical line */}
                {0 >= rangeStart && 0 <= rangeEnd && (
                  <div style={{
                    position: "absolute", top: 0, bottom: 0,
                    left: offsetToLeft(0),
                    width: 2,
                    background: "linear-gradient(180deg,#E76A2D 0%,rgba(231,106,45,0.35) 100%)",
                    boxShadow: "0 0 0 4px rgba(231,106,45,0.06)",
                    pointerEvents: "none", zIndex: 4,
                  }} />
                )}

                {/* Empty state */}
                {filteredVisible.length === 0 && (
                  <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 5 }}>
                    <p style={{ fontSize: 12.5, color: "#94928D" }}>
                      {"Sin tareas programadas. Arrastrá tareas desde abajo para programarlas."}
                    </p>
                  </div>
                )}

                {/* Task bar rows */}
                {displayItems.map((task, di) => {
                  if (task === null) return (
                    <div key="__ghost_right__" style={{
                      height: ROW_H, position: "relative",
                      background: "rgba(231,106,45,0.05)",
                      borderTop: "2px dashed #E76A2D",
                      borderBottom: "2px dashed #E76A2D",
                      boxSizing: "border-box",
                    }} />
                  );
                  void di;
                  const isThisDrag   = drag?.taskId   === task.id;
                  const isThisResize = resize?.taskId === task.id;
                  const isSel  = selectedId    === task.id;
                  const isHL   = highlightedId === task.id;
                  const isCritical = viewOptions.highlightCritical && !!criticalData?.critical_task_ids.includes(task.id);
                  const taskFloat  = criticalData ? Number(criticalData.float_by_task[String(task.id)] ?? 9999) : null;
                  const st     = STATUS_STYLE[task.status];
                  const isDraggingThisRow = rowDrag?.taskId === task.id;

                  let deltaDays = 0;
                  let resizeEdge: "start" | "end" | undefined;
                  if (isThisDrag   && drag)   deltaDays = Math.round(drag.currentDeltaPx   / dayW);
                  if (isThisResize && resize) { deltaDays = Math.round(resize.currentDeltaPx / dayW); resizeEdge = resize.edge; }

                  const { start, due } = getEffectiveDates(task, deltaDays, resizeEdge);
                  const hasBoth    = !!(start && due);
                  const startOff   = start ? dateToOffset(start) : null;

                  // Clamp tooltip delta to effective date change so it stops at min/max
                  let displayDelta = deltaDays;
                  if (isThisResize && resize) {
                    const origBase = resize.edge === "end"
                      ? (task.due_date ?? task.start_date!)
                      : (task.start_date ?? task.due_date!);
                    const effectiveDate = resize.edge === "end" ? due : start;
                    if (effectiveDate) displayDelta = dateToOffset(effectiveDate) - dateToOffset(origBase);
                  }
                  const dueOff     = due   ? dateToOffset(due)   : null;
                  const halfDay = Math.floor(dayW / 2);
                  const barLeftPx  = hasBoth
                    ? offsetToLeft(startOff!) + 4
                    : startOff !== null
                      ? offsetToLeft(startOff) + 4          // start-only: left half
                      : offsetToLeft(dueOff!) + halfDay;    // due-only: right half
                  const barWidthPx = hasBoth
                    ? Math.max(8, (dueOff! - startOff! + 1) * dayW - 8)
                    : halfDay - 4;                          // half-day for single-date

                  const resp     = task.responsible_id ? responsibles.find(r => r.id === task.responsible_id) : null;
                  const initials = resp ? getInitials(resp.full_name) : null;
                  const avatarBg = resp ? avatarColor(resp.full_name) : "#94928D";
                  const isOverdue = task.status !== "completada" && task.status !== "cancelada" && !!task.due_date && task.due_date < TODAY_STR;

                  const barBoxShadow = isHL
                    ? "0 0 0 2px #E76A2D"
                    : isCritical
                      ? "0 0 0 2px #D03A3A, 0 4px 14px -4px rgba(208,58,58,0.45)"
                      : isSel
                        ? `0 0 0 1.5px ${st.stripe}, 0 4px 14px -4px ${st.stripe}55`
                        : "0 1px 2px rgba(20,20,20,0.06)";

                  return (
                    <div
                      key={task.id}
                      style={{
                        position: "relative", height: ROW_H,
                        borderBottom: "1px solid #F4F1EB",
                        background: isSel ? "rgba(231,106,45,0.04)" : "transparent",
                        zIndex: isDraggingThisRow ? 10 : 1,
                        transform: `translateY(${getRowTranslate(task.id)}px)`,
                        transition: isDraggingThisRow ? "none" : "transform 0.22s cubic-bezier(.22,.61,.36,1)",
                      }}
                    >
                      {/* Bar */}
                      {(startOff !== null || dueOff !== null) && (
                        task.is_milestone ? (
                          /* Milestone diamond */
                          (() => {
                            const mOff = startOff ?? dueOff!;
                            const mCenterX = offsetToLeft(mOff) + dayW / 2;
                            const mSize = BAR_H + 4;
                            return (
                              <div
                                style={{
                                  position: "absolute",
                                  top: (ROW_H - mSize) / 2,
                                  left: mCenterX - mSize / 2,
                                  width: mSize, height: mSize,
                                  transform: "rotate(45deg)",
                                  background: isOverdue ? "#D03A3A" : st.stripe,
                                  border: `2px solid ${isOverdue ? "#A02020" : st.border}`,
                                  boxShadow: isSel
                                    ? `0 0 0 2px ${st.stripe}, 0 4px 14px -4px ${st.stripe}55`
                                    : isHL ? "0 0 0 2px #E76A2D" : "0 2px 6px rgba(0,0,0,0.12)",
                                  cursor: "pointer",
                                  zIndex: isSel ? 3 : 1,
                                }}
                                onClick={() => onTaskClick(task)}
                              />
                            );
                          })()
                        ) : (
                        <div style={{
                          position: "absolute",
                          top: (ROW_H - BAR_H) / 2,
                          height: BAR_H,
                          left: barLeftPx,
                          width: barWidthPx,
                          zIndex: isThisDrag || isThisResize ? 5 : (isSel ? 3 : 1),
                        }}>
                          {/* Bar body */}
                          <div
                            title={isCritical
                              ? "Tarea crítica — 0 días de margen"
                              : taskFloat !== null && taskFloat < 9999
                                ? `Margen: ${taskFloat} día${taskFloat === 1 ? "" : "s"}`
                                : undefined
                            }
                            style={{
                              position: "absolute", inset: 0,
                              borderRadius: 99,
                              background: isOverdue
                                ? `repeating-linear-gradient(45deg,rgba(208,58,58,0.30) 0px,rgba(208,58,58,0.30) 4px,transparent 4px,transparent 8px),${st.bg}`
                                : isCritical
                                  ? `linear-gradient(135deg, rgba(208,58,58,0.18) 0%, rgba(208,58,58,0.06) 100%), ${st.bg}`
                                  : st.bg,
                              border: isCritical ? "1.5px solid #D03A3A" : `1.5px solid ${st.border}`,
                              boxShadow: barBoxShadow,
                              cursor: isThisDrag ? "grabbing" : "grab",
                              transform: isThisDrag ? "translateY(-1px)" : "none",
                              transition: isThisDrag || isThisResize ? "none" : "box-shadow 0.15s, transform 0.15s",
                              userSelect: "none",
                            }}
                            onMouseDown={e => {
                              if ((e.target as HTMLElement).closest(".edge-handle")) return;
                              e.preventDefault();
                              startBarDrag(task.id, e.clientX);
                            }}
                          >
                            {/* Left stripe */}
                            <div style={{
                              position: "absolute", left: 0, top: 6, bottom: 6, width: 6,
                              borderRadius: 99,
                              background: isCritical ? "#D03A3A" : st.stripe,
                            }} />

                            {/* Progress fill */}
                            {viewOptions.showProgress && task.estimated_progress > 0 && (
                              <div style={{
                                position: "absolute", left: 0, top: 0, bottom: 0,
                                width: `${task.estimated_progress}%`,
                                background: st.stripe + "28",
                                borderRadius: 99,
                                pointerEvents: "none",
                              }} />
                            )}

                            {/* Text content area — clipped */}
                            {hasBoth && barWidthPx > 40 && (
                              <div style={{
                                position: "absolute",
                                left: 14,
                                right: initials ? 34 : 8,
                                top: 0, bottom: 0,
                                display: "flex", alignItems: "center", gap: 5,
                                overflow: "hidden",
                              }}>
                                <span style={{
                                  fontSize: 12, fontWeight: 600, color: "#1A2329",
                                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                                  flexShrink: 1, minWidth: 0,
                                }}>
                                  {task.title}
                                </span>
                                {/* Status badge */}
                                {st.badge && barWidthPx > 90 && (
                                  <span style={{
                                    flexShrink: 0, fontSize: 10, fontWeight: 600,
                                    padding: "2px 7px", borderRadius: 99,
                                    background: st.stripe,
                                    color: "#fff", lineHeight: 1,
                                  }}>
                                    {st.badge}
                                  </span>
                                )}
                                {/* Vencida — siempre visible */}
                                {isOverdue && (
                                  <span style={{
                                    flexShrink: 0, fontSize: 10, fontWeight: 700,
                                    padding: barWidthPx > 90 ? "2px 6px" : "2px 5px",
                                    borderRadius: 99,
                                    border: "1.5px solid #D03A3A",
                                    background: "#fff",
                                    color: "#D03A3A",
                                    lineHeight: 1,
                                    display: "flex", alignItems: "center", gap: 3,
                                  }}>
                                    <span style={{ fontSize: 9 }}>▲</span>
                                    {barWidthPx > 90 && " Vencida"}
                                  </span>
                                )}
                              </div>
                            )}

                            {/* Assignee avatar — always at right edge */}
                            {initials && hasBoth && barWidthPx > 50 && (
                              <div style={{
                                position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)",
                                width: 22, height: 22, borderRadius: 99,
                                background: avatarBg, color: "#fff", fontSize: 9.5, fontWeight: 700,
                                display: "flex", alignItems: "center", justifyContent: "center",
                                border: "2px solid #fff", boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
                                flexShrink: 0,
                              }}>
                                {initials}
                              </div>
                            )}
                          </div>

                          {/* Left resize handle */}
                          <div
                            className="edge-handle"
                            onMouseDown={e => { e.preventDefault(); e.stopPropagation(); startEdgeResize(task.id, "start", e.clientX); }}
                            style={{ position: "absolute", top: 0, bottom: 0, left: -4, width: 12, cursor: "ew-resize", display: "flex", alignItems: "center" }}
                          >
                            <div style={{ width: 3, height: 14, borderRadius: 99, background: "rgba(20,20,20,0.16)" }} />
                          </div>

                          {/* Right resize handle */}
                          <div
                            className="edge-handle"
                            onMouseDown={e => { e.preventDefault(); e.stopPropagation(); startEdgeResize(task.id, "end", e.clientX); }}
                            style={{ position: "absolute", top: 0, bottom: 0, right: -4, width: 12, cursor: "ew-resize", display: "flex", alignItems: "center", justifyContent: "flex-end" }}
                          >
                            <div style={{ width: 3, height: 14, borderRadius: 99, background: "rgba(20,20,20,0.16)" }} />
                          </div>

                          {/* Delta tooltip */}
                          {(isThisDrag || isThisResize) && deltaDays !== 0 && (start || due) && (
                            <div style={{
                              position: "absolute", top: -28, left: "50%", transform: "translateX(-50%)",
                              whiteSpace: "nowrap", background: "#1B1B1A", color: "#fff",
                              fontSize: 10.5, fontWeight: 500, fontFamily: "'JetBrains Mono',monospace",
                              padding: "3px 10px", borderRadius: 99, pointerEvents: "none", zIndex: 20,
                              boxShadow: "0 4px 12px -2px rgba(0,0,0,0.22)",
                            }}>
                              {displayDelta > 0 ? "+" : ""}{displayDelta}d
                              {start && due ? ` · ${fmtShort(start)} → ${fmtShort(due)}` : start ? ` · ${fmtShort(start)}` : ` · ${fmtShort(due!)}`}
                            </div>
                          )}
                        </div>
                        )
                      )}

                      {/* ── Baseline bar ── */}
                      {viewOptions.showBaseline && (() => {
                        const bl = baselineMap.get(task.id);
                        if (!bl || (!bl.baseline_start && !bl.baseline_finish)) return null;
                        const bsOff = bl.baseline_start ? dateToOffset(bl.baseline_start) : null;
                        const bfOff = bl.baseline_finish ? dateToOffset(bl.baseline_finish) : null;
                        if (bsOff === null && bfOff === null) return null;
                        const bHasBoth = bsOff !== null && bfOff !== null;
                        const bLeft = bHasBoth
                          ? offsetToLeft(bsOff!) + 4
                          : bsOff !== null ? offsetToLeft(bsOff!) + 4 : offsetToLeft(bfOff!) + Math.floor(dayW / 2);
                        const bWidth = bHasBoth
                          ? Math.max(8, (bfOff! - bsOff! + 1) * dayW - 8)
                          : Math.floor(dayW / 2) - 4;
                        const isLate = !!(task.start_date && bl.baseline_start && task.start_date > bl.baseline_start)
                          || !!(task.due_date && bl.baseline_finish && task.due_date > bl.baseline_finish);
                        return (
                          <div
                            title={`Línea base: ${bl.baseline_start ?? "—"} → ${bl.baseline_finish ?? "—"}`}
                            style={{
                              position: "absolute",
                              top: (ROW_H - BAR_H) / 2 + BAR_H + 2,
                              left: bLeft, width: bWidth, height: 5,
                              borderRadius: 99,
                              background: isLate ? "rgba(208,58,58,0.45)" : "rgba(100,110,120,0.35)",
                              border: `1px solid ${isLate ? "rgba(208,58,58,0.7)" : "rgba(100,110,120,0.5)"}`,
                              pointerEvents: "none",
                            }}
                          />
                        );
                      })()}
                    </div>
                  );
                })}

                {/* ── Dependency arrows SVG overlay ── */}
                {viewOptions.showDependencies && (() => {
                  const taskById    = new Map(filteredVisible.map(t => [t.id, t]));
                  const rowByTaskId = new Map(filteredVisible.map((t, i) => [t.id, i]));
                  const paths: {
                    id: string; pathD: string; arrowPoints: string;
                    color: string; violated: boolean;
                    labelX: number; labelY: number; depType: string; lagDays: number;
                    x_A: number; y_A: number; x_B: number; y_B: number;
                  }[] = [];

                  filteredVisible.forEach((taskB) => {
                    const links = taskB.dependency_links?.length
                      ? taskB.dependency_links
                      : (taskB.dependency_ids ?? []).map(id => ({ depends_on_id: id, dependency_type: "FS", lag_days: 0 }));
                    if (!links.length) return;
                    const rowB = rowByTaskId.get(taskB.id)!;

                    links.forEach(link => {
                      const taskA = taskById.get(link.depends_on_id);
                      if (!taskA) return;
                      const rowA = rowByTaskId.get(taskA.id)!;
                      const dtype = link.dependency_type ?? "FS";
                      const lagDays = link.lag_days ?? 0;

                      const startOffA = taskA.start_date ? dateToOffset(taskA.start_date) : null;
                      const dueOffA   = taskA.due_date   ? dateToOffset(taskA.due_date)   : null;
                      const startOffB = taskB.start_date ? dateToOffset(taskB.start_date) : null;
                      const dueOffB   = taskB.due_date   ? dateToOffset(taskB.due_date)   : null;

                      if (startOffA === null && dueOffA === null) return;
                      if (startOffB === null && dueOffB === null) return;

                      // Anchor points depend on dependency type
                      let x_A: number, x_B: number, violated: boolean;
                      if (dtype === "SS") {
                        x_A = offsetToLeft(startOffA ?? dueOffA!);
                        x_B = offsetToLeft(startOffB ?? dueOffB!) + 8;
                        violated = !!(taskA.start_date && taskB.start_date && taskB.start_date < taskA.start_date);
                      } else if (dtype === "FF") {
                        x_A = offsetToLeft((dueOffA ?? startOffA!) + 1);
                        x_B = offsetToLeft((dueOffB ?? startOffB!) + 1) - 8;
                        violated = !!(taskA.due_date && taskB.due_date && taskB.due_date < taskA.due_date);
                      } else if (dtype === "SF") {
                        x_A = offsetToLeft(startOffA ?? dueOffA!);
                        x_B = offsetToLeft((dueOffB ?? startOffB!) + 1) - 8;
                        violated = !!(taskA.start_date && taskB.due_date && taskB.due_date < taskA.start_date);
                      } else {
                        // FS (default)
                        x_A = offsetToLeft((dueOffA ?? startOffA!) + 1);
                        x_B = offsetToLeft(startOffB ?? dueOffB!);
                        violated = !!(taskA.due_date && taskB.start_date && taskB.start_date <= taskA.due_date);
                      }

                      const y_A = rowA * ROW_H + ROW_H / 2;
                      const y_B = rowB * ROW_H + ROW_H / 2;
                      const color = violated ? "#D03A3A" : "#7A8FA8";

                      // Rounded-corner path (r = 6) like ClickUp
                      const r = 6;
                      const dy = y_B > y_A ? r : y_B < y_A ? -r : 0;
                      let pathD: string;
                      let midX: number;
                      if (Math.abs(y_A - y_B) < 2) {
                        // Same row — straight line
                        pathD = `M ${x_A} ${y_A} H ${x_B}`;
                      } else if (x_A + 16 < x_B) {
                        midX = (x_A + x_B) / 2;
                        pathD = `M ${x_A} ${y_A} H ${midX - r} q ${r} 0 ${r} ${dy} V ${y_B - dy} q 0 ${dy} ${r} ${dy} H ${x_B}`;
                      } else {
                        midX = Math.max(x_A, x_B) + 24;
                        pathD = `M ${x_A} ${y_A} H ${midX - r} q ${r} 0 ${r} ${dy} V ${y_B - dy} q 0 ${dy} ${-r} ${dy} H ${x_B}`;
                      }

                      const arrowPoints = `${x_B + 6},${y_B} ${x_B},${y_B - 4} ${x_B},${y_B + 4}`;
                      const labelX = x_A + (x_B - x_A) / 2;
                      const labelY = (y_A + y_B) / 2;

                      paths.push({ id: `${link.depends_on_id}->${taskB.id}`, pathD, arrowPoints, color, violated, labelX, labelY, depType: dtype, lagDays, x_A, y_A, x_B, y_B });
                    });
                  });

                  if (paths.length === 0) return null;

                  return (
                    <svg style={{
                      position: "absolute", top: 0, left: 0,
                      width: gridWidth, height: filteredVisible.length * ROW_H,
                      zIndex: 3, overflow: "visible",
                    }}>
                      {paths.map(({ id, pathD, arrowPoints, color, violated, labelX, labelY, depType, lagDays, x_A, y_A, x_B, y_B }) => (
                        <g key={id}>
                          {/* Connection dot at predecessor */}
                          <circle cx={x_A} cy={y_A} r={3.5} fill={color} style={{ pointerEvents: "none" }} />
                          {/* Path */}
                          <path
                            d={pathD} stroke={color} strokeWidth={1.8} fill="none"
                            strokeDasharray={violated ? "5 3" : undefined}
                            strokeLinecap="round" strokeLinejoin="round"
                            style={{ pointerEvents: "none" }}
                          />
                          {/* Arrowhead at successor */}
                          <polygon points={arrowPoints} fill={color} style={{ pointerEvents: "none" }} />
                          {/* Connection dot at successor */}
                          <circle cx={x_B} cy={y_B} r={3} fill="#fff" stroke={color} strokeWidth={1.5} style={{ pointerEvents: "none" }} />
                          {/* Dep type label (non-FS) */}
                          {depType !== "FS" && (
                            <>
                              <rect x={labelX - 10} y={labelY - 8} width={20} height={14} rx={4} fill={color} opacity={0.9} style={{ pointerEvents: "none" }} />
                              <text x={labelX} y={labelY + 3} textAnchor="middle" fontSize={9} fontWeight={700} fill="#fff" fontFamily="sans-serif" style={{ pointerEvents: "none" }}>{depType}</text>
                            </>
                          )}
                          {/* Invisible wider path for hover detection */}
                          <path
                            d={pathD} stroke="transparent" strokeWidth={14} fill="none"
                            style={{ pointerEvents: "stroke", cursor: "default" }}
                            onMouseEnter={e => setDepTooltip({ x: e.clientX, y: e.clientY, type: depType, lag: lagDays, violated })}
                            onMouseMove={e => setDepTooltip(prev => prev ? { ...prev, x: e.clientX, y: e.clientY } : null)}
                            onMouseLeave={() => setDepTooltip(null)}
                          />
                        </g>
                      ))}
                    </svg>
                  );
                })()}

              </div>{/* end width:gridWidth */}
            </div>{/* end scrollRef */}
          </div>{/* end right flex-column */}
        </div>{/* end body flex */}

        {/* ── Legend ── */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 18px", borderTop: "1px solid #F0EBE2", background: "#FAF8F4", flexWrap: "wrap" }}>
          {(Object.entries(STATUS_STYLE) as [TaskStatus, typeof STATUS_STYLE[TaskStatus]][]).map(([, st]) => (
            <div key={st.label} style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <div style={{ width: 22, height: 12, borderRadius: 99, background: st.bg, border: `1.5px solid ${st.border}`, position: "relative", overflow: "hidden", flexShrink: 0 }}>
                <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: st.stripe, borderRadius: "99px 0 0 99px" }} />
              </div>
              <span style={{ fontSize: 11.5, color: "#6B6A66" }}>{st.label}</span>
            </div>
          ))}
          {/* Vencida — estado cruzado */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{
              width: 22, height: 12, borderRadius: 99,
              border: "1.5px solid #D03A3A",
              overflow: "hidden", flexShrink: 0,
              background: "repeating-linear-gradient(45deg,rgba(208,58,58,0.30) 0px,rgba(208,58,58,0.30) 4px,transparent 4px,transparent 8px),#FEF2F2",
            }} />
            <span style={{ fontSize: 11.5, fontWeight: 600, color: "#D03A3A", display: "flex", alignItems: "center", gap: 3 }}>
              <span style={{ fontSize: 9 }}>▲</span> Vencida
            </span>
          </div>
          <button
            title="Ir a hoy"
            onClick={() => {
              if (!scrollRef.current) return;
              const todayCol = (-rangeStart) * dayWRef.current;
              scrollRef.current.scrollTo({ left: Math.max(0, todayCol - scrollRef.current.clientWidth / 3), behavior: "smooth" });
            }}
            style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", padding: "2px 6px", borderRadius: 6, cursor: "pointer", transition: "background 0.15s" }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(231,106,45,0.08)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "none"; }}
          >
            <div style={{ width: 2, height: 14, borderRadius: 99, background: "#E76A2D" }} />
            <span style={{ fontSize: 11.5, color: "#E76A2D", fontWeight: 500, fontFamily: "'Plus Jakarta Sans',sans-serif" }}>Hoy</span>
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 5, color: "#94928D", fontSize: 11, marginLeft: 8 }}>
            {["Arrastrá", "Bordes", "Clic"].map(k => (
              <span key={k} style={{ padding: "1px 6px", borderRadius: 4, background: "#fff", border: "1px solid #ECE7DD", color: "#3A3936", fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5 }}>{k}</span>
            ))}
            <span>para mover · duración · editar</span>
          </div>
        </div>
      </div>

      {pending && (
        <ReschedulingModal
          task={pending.task}
          newStartDate={pending.newStartDate}
          newDueDate={pending.newDueDate}
          nearbyCount={pending.nearbyCount}
          mode={pending.mode}
          onClose={() => setPending(null)}
          onSaved={handleRescheduleSaved}
        />
      )}

      {pendingSchedule && (
        <SchedulingModal
          task={pendingSchedule.task}
          dropDate={pendingSchedule.dropDate}
          responsibles={responsibles}
          onClose={() => setPendingSchedule(null)}
          onSaved={handleScheduleSaved}
        />
      )}

      {/* ── Status dropdown (fixed to escape overflow:hidden) ── */}
      {statusDrop && onStatusChange && (() => {
        const task = tasks.find(t => t.id === statusDrop.taskId);
        if (!task) return null;
        return (
          <div
            id="gantt-status-drop"
            style={{
              position: "fixed",
              top: statusDrop.y,
              left: statusDrop.x,
              zIndex: 9999,
              background: "#fff",
              border: "1px solid #E6E7E5",
              borderRadius: 10,
              boxShadow: "0 8px 24px -4px rgba(15,22,28,0.14)",
              padding: "4px",
              minWidth: 148,
              fontFamily: "'Plus Jakarta Sans', sans-serif",
            }}
          >
            {STATUS_ORDER.map(s => {
              const opt = STATUS_STYLE[s];
              const active = task.status === s;
              return (
                <button
                  key={s}
                  type="button"
                  onMouseDown={e => {
                    e.stopPropagation();
                    setStatusDrop(null);
                    if (!active) onStatusChange(task, s);
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
                  }}
                  onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = "#F4F5F4"; }}
                  onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                >
                  <StatusDotVisual status={s} />
                  {opt.label}
                </button>
              );
            })}
          </div>
        );
      })()}

      {/* ── Drag-over date tooltip ── */}
      {dragOverInfo && (() => {
        const d     = new Date(dragOverInfo.date + "T00:00:00Z");
        const label = `${DAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]}`;
        return (
          <div style={{
            position: "fixed",
            top: dragOverInfo.clientY + 18,
            left: dragOverInfo.clientX + 16,
            zIndex: 9999,
            background: "#1B2A34",
            borderRadius: 10,
            padding: "7px 13px",
            pointerEvents: "none",
            boxShadow: "0 6px 20px -4px rgba(0,0,0,0.4)",
            whiteSpace: "nowrap",
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontFamily: "'Plus Jakarta Sans', sans-serif",
          }}>
            <div style={{
              width: 22, height: 22, borderRadius: 6, flexShrink: 0,
              background: "#FF6B35",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                <rect x="1.5" y="2.5" width="13" height="12" rx="1.5" stroke="#fff" strokeWidth="1.5" fill="none"/>
                <path d="M5 1.5v2M11 1.5v2M1.5 6h13" stroke="#fff" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.45)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                Programar en
              </span>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: "#fff", letterSpacing: "-0.01em" }}>
                {label}
              </span>
            </div>
          </div>
        );
      })()}

      {/* ── Dependency tooltip ── */}
      {depTooltip && (
        <div style={{
          position: "fixed", zIndex: 9999, pointerEvents: "none",
          left: depTooltip.x + 14, top: depTooltip.y - 10,
          background: "#1A2329", color: "#fff",
          borderRadius: 8, padding: "6px 10px",
          fontSize: 12, fontFamily: "'Plus Jakarta Sans', sans-serif",
          boxShadow: "0 4px 16px -4px rgba(0,0,0,0.35)",
          display: "flex", flexDirection: "column", gap: 2,
        }}>
          <span style={{ fontWeight: 700, color: depTooltip.violated ? "#FF8080" : "#7DC8A0" }}>
            {depTooltip.type === "FS" ? "Fin → Inicio" : depTooltip.type === "SS" ? "Inicio → Inicio" : depTooltip.type === "FF" ? "Fin → Fin" : "Inicio → Fin"}
            {depTooltip.violated && " ⚠ violada"}
          </span>
          {depTooltip.lag !== 0 && (
            <span style={{ color: "rgba(255,255,255,0.6)", fontSize: 11 }}>
              Lag: {depTooltip.lag > 0 ? `+${depTooltip.lag}` : depTooltip.lag} días
            </span>
          )}
        </div>
      )}
    </>
  );
}

// ─── Grip handle sub-component (hover color change) ──────────────────────────

function GripHandle({ onPointerDown }: { onPointerDown: (e: React.PointerEvent) => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <svg
      width="10" height="14" viewBox="0 0 10 14" fill="none"
      style={{ color: hovered ? "#8E97A0" : "#C9C3B6", flexShrink: 0, cursor: "grab", transition: "color 0.15s" }}
      onPointerDown={onPointerDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <circle cx="3" cy="2.5" r="1.2" fill="currentColor"/>
      <circle cx="7" cy="2.5" r="1.2" fill="currentColor"/>
      <circle cx="3" cy="7"   r="1.2" fill="currentColor"/>
      <circle cx="7" cy="7"   r="1.2" fill="currentColor"/>
      <circle cx="3" cy="11.5" r="1.2" fill="currentColor"/>
      <circle cx="7" cy="11.5" r="1.2" fill="currentColor"/>
    </svg>
  );
}
