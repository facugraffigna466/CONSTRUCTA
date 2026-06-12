import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { Clock, RefreshCw, CheckCircle2, AlertOctagon, XCircle } from "lucide-react";
import { bulkCreateTasks, createTask, deleteTask, updateTask, updateTaskStatus } from "../api/tasks";
import { UpgradeModal, getPlanLimitError, type PlanLimitInfo } from "./UpgradeModal";
import type { Responsible, Task, TaskStatus } from "../types";
import { parseClipboardRows, type ParsedRow } from "../utils/clipboardParser";

// ─── Constants ────────────────────────────────────────────────────────────────

// Paleta unificada con TaskTable / Gantt / Alertas
const STATUS_STYLE: Record<TaskStatus, { label: string; bg: string; color: string; dot: string; Icon: React.ComponentType<{ style?: React.CSSProperties }> }> = {
  pendiente:   { label: "Pendiente",   bg: "#EBF3FF", color: "#2A62C9", dot: "#3B82F6", Icon: Clock },
  en_progreso: { label: "En progreso", bg: "#FFFBEB", color: "#B45309", dot: "#D97706", Icon: RefreshCw },
  bloqueada:   { label: "Bloqueada",   bg: "#FCE5E5", color: "#A82B2B", dot: "#D03A3A", Icon: AlertOctagon },
  completada:  { label: "Completada",  bg: "#E4F3EC", color: "#136E47", dot: "#1F8A5B", Icon: CheckCircle2 },
  cancelada:   { label: "Cancelada",   bg: "#F4F5F4", color: "#5B6770", dot: "#8E97A0", Icon: XCircle },
};

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: "pendiente",   label: "Pendiente" },
  { value: "en_progreso", label: "En progreso" },
  { value: "bloqueada",   label: "Bloqueada" },
  { value: "completada",  label: "Completada" },
  { value: "cancelada",   label: "Cancelada" },
];

const COLS = ["#", "Tarea", "Responsable", "Inicio", "Duración", "Fin", "% Avance", "Estado"] as const;
const COL_WIDTHS = ["44px", "1fr", "170px", "118px", "88px", "118px", "108px", "130px"];
const LAST_COL = COLS.length - 1;

const CELL_BORDER = "1px solid #E2E4E2";
const HEADER_BORDER = "1px solid #D5D9D5";
const ACTIVE_CELL_SHADOW = "inset 0 0 0 2px #1A73E8";

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function diffDays(a: string, b: string): number {
  return Math.round(
    (new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime()) / 86_400_000
  );
}

function calcDuration(start: string, due: string): string {
  if (!start || !due) return "1";
  const d = diffDays(start, due) + 1;
  return d > 0 ? String(d) : "1";
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

function StatusPill({ status }: { status: TaskStatus }) {
  const st = STATUS_STYLE[status];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "3px 9px", borderRadius: 99,
      fontSize: 11.5, fontWeight: 600,
      background: st.bg, color: st.color,
      pointerEvents: "none",
    }}>
      <st.Icon style={{ width: 11, height: 11, flexShrink: 0 }} />
      {st.label}
    </span>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

const FIELD_ORDER = ["title", "responsible", "start", "duration", "due", "progress", "taskStatus"] as const;
type Field = typeof FIELD_ORDER[number];

interface EditState {
  taskId: number | null;
  activeField: Field;
  title: string;
  responsibleId: string;
  startDate: string;
  duration: string;
  dueDate: string;
  progress: string;       // "0"–"100"
  taskStatus: TaskStatus;
  saving: boolean;
  error: string | null;
}

export interface SheetViewHandle {
  startNewRow: () => void;
  focusTask: (taskId: number, field: Field) => void;
}

interface Props {
  tasks: Task[];
  responsibles: Responsible[];
  obraId: number;
  onTaskSaved: (task: Task) => void;
  onTaskDeleted?: (taskId: number) => void;
  onBulkImported?: () => void;
}

// ─── ResponsableCombobox ──────────────────────────────────────────────────────

interface ComboboxProps {
  currentId: string;
  options: Responsible[];
  autoFocus?: boolean;
  onSelect: (id: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

function ResponsableCombobox({ currentId, options, onSelect, onKeyDown }: ComboboxProps) {
  const currentLabel = options.find(r => String(r.id) === currentId)?.full_name ?? "";
  const [text, setText] = useState(currentLabel);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [listPos, setListPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const all = [{ id: 0, full_name: "Sin responsable", role: null } as unknown as Responsible, ...options];
  const filtered = text.trim()
    ? all.filter(r => r.full_name.toLowerCase().includes(text.toLowerCase()) || (r.role ?? "").toLowerCase().includes(text.toLowerCase()))
    : all;

  // Enfocar al montar y abrir la lista
  useEffect(() => {
    inputRef.current?.focus();
    openList();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function openList() {
    const rect = inputRef.current?.closest("[data-task-row]")?.querySelector("[data-combobox-anchor]")?.getBoundingClientRect()
      ?? inputRef.current?.getBoundingClientRect();
    if (rect) {
      setListPos({ top: rect.bottom + window.scrollY + 2, left: rect.left + window.scrollX, width: Math.max(rect.width, 230) });
    }
    setOpen(true);
  }

  function commit(opt: Responsible) {
    const id = opt.id ? String(opt.id) : "";
    setText(id ? opt.full_name : "");
    onSelect(id);
    setOpen(false);
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlighted(h => Math.min(h + 1, filtered.length - 1)); return; }
    if (e.key === "ArrowUp")   { e.preventDefault(); setHighlighted(h => Math.max(h - 1, 0)); return; }
    if (e.key === "Enter" && open && filtered[highlighted]) { e.preventDefault(); commit(filtered[highlighted]); return; }
    if (e.key === "Escape")    { setOpen(false); return; }
    onKeyDown?.(e);
  }

  const list = open && filtered.length > 0 && listPos ? createPortal(
    <div
      onMouseDown={e => e.preventDefault()}
      style={{
        position: "absolute",
        top: listPos.top, left: listPos.left,
        width: listPos.width,
        zIndex: 99999,
        background: "#fff", border: "1px solid #E6E7E5", borderRadius: 10,
        boxShadow: "0 6px 24px -6px rgba(0,0,0,0.18)",
        maxHeight: 220, overflowY: "auto", padding: 4,
      }}
    >
      {filtered.map((r, i) => (
        <div
          key={r.id || "none"}
          onMouseDown={() => commit(r)}
          onMouseEnter={() => setHighlighted(i)}
          style={{
            padding: "7px 12px", borderRadius: 7, cursor: "pointer",
            background: i === highlighted ? "#EBF3FE" : "transparent",
            fontSize: 13, color: r.id ? "#1A2329" : "#9BA3AB",
            fontFamily: "'Plus Jakarta Sans', sans-serif",
            display: "flex", alignItems: "center", gap: 6,
          }}
        >
          {String(r.id || "") === currentId && (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="#2A6FDB" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
          <span style={{ flex: 1 }}>
            {r.full_name}{r.role && <span style={{ color: "#8E97A0" }}> · {r.role}</span>}
          </span>
        </div>
      ))}
    </div>,
    document.body
  ) : null;

  return (
    <div data-combobox-anchor style={{ width: "100%" }}>
      <input
        ref={inputRef}
        data-sheet-field="responsible"
        value={text}
        placeholder="Sin responsable"
        onChange={e => { const v = e.target.value; setText(v); setHighlighted(0); openList(); if (!v.trim()) onSelect(""); }}
        onFocus={openList}
        onBlur={() => setTimeout(() => { setOpen(false); if (!text.trim()) onSelect(""); }, 150)}
        onKeyDown={handleKey}
        style={{
          width: "100%", boxSizing: "border-box",
          background: "transparent", border: "none", outline: "none",
          fontSize: 13, fontFamily: "'Plus Jakarta Sans', sans-serif",
          color: "#1A2329", padding: 0,
        }}
      />
      {list}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export const TaskSheetView = forwardRef<SheetViewHandle, Props>(
  ({ tasks, responsibles, obraId, onTaskSaved, onTaskDeleted, onBulkImported }, ref) => {
    const activeResponsibles = responsibles.filter((r) => r.is_active);

    function makeEdit(task: Task, field: Field): EditState {
      return {
        taskId: task.id,
        activeField: field,
        title: task.title,
        responsibleId: task.responsible_id ? String(task.responsible_id) : "",
        startDate: task.start_date ?? "",
        duration: task.start_date && task.due_date ? calcDuration(task.start_date, task.due_date) : "1",
        dueDate: task.due_date ?? "",
        progress: String(task.estimated_progress ?? 0),
        taskStatus: task.status,
        saving: false,
        error: null,
      };
    }

    const blankEdit = (): EditState => ({
      taskId: null,
      activeField: "title",
      title: "",
      responsibleId: "",
      startDate: "",
      duration: "1",
      dueDate: "",
      progress: "0",
      taskStatus: "pendiente",
      saving: false,
      error: null,
    });

    const [editing, setEditing] = useState<EditState | null>(null);
    const [showNewRow, setShowNewRow] = useState(false);
    const [openDropdownFor, setOpenDropdownFor] = useState<number | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // ── Anchos de columna (resize manual, persistido por obra) ───────────────
    const [colWidths, setColWidths] = useState<string[]>(() => {
      try {
        const saved = localStorage.getItem(`sheet_colw_${obraId}`);
        const parsed = saved ? JSON.parse(saved) : null;
        return Array.isArray(parsed) && parsed.length === COL_WIDTHS.length ? parsed : [...COL_WIDTHS];
      } catch { return [...COL_WIDTHS]; }
    });
    const colResizeRef = useRef<{ idx: number; startX: number; startW: number } | null>(null);

    function startColResize(e: React.PointerEvent, idx: number) {
      e.preventDefault();
      e.stopPropagation();
      const headerCell = (e.currentTarget as HTMLElement).parentElement;
      const startW = headerCell
        ? headerCell.getBoundingClientRect().width
        : parseInt(colWidths[idx], 10) || 100;
      colResizeRef.current = { idx, startX: e.clientX, startW };
      function onMove(ev: PointerEvent) {
        const cur = colResizeRef.current;
        if (!cur) return;
        const w = Math.max(56, Math.round(cur.startW + (ev.clientX - cur.startX)));
        setColWidths(prev => prev.map((p, i) => (i === cur.idx ? `${w}px` : p)));
      }
      function onUp() {
        colResizeRef.current = null;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        setColWidths(prev => {
          try { localStorage.setItem(`sheet_colw_${obraId}`, JSON.stringify(prev)); } catch { /* ignore */ }
          return prev;
        });
      }
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    }

    // ── Clipboard paste state ────────────────────────────────────────────────
    const [pastePreview, setPastePreview] = useState<ParsedRow[] | null>(null);
    const [bulkSaving, setBulkSaving] = useState(false);
    const [bulkError, setBulkError] = useState<string | null>(null);
    const [planLimit, setPlanLimit] = useState<PlanLimitInfo | null>(null);
    const [hoveredRow, setHoveredRow] = useState<number | null>(null);
    const [deletingId, setDeletingId] = useState<number | null>(null);

    // Focus the right input whenever activeField changes (for non-select fields)
    useEffect(() => {
      if (!editing) return;
      if (editing.activeField === "taskStatus") return;
      const el = document.querySelector<HTMLElement>(`[data-sheet-field="${editing.activeField}"]`);
      el?.focus();
    }, [editing?.taskId, editing?.activeField]);

    // Intercept paste anywhere inside the sheet.
    // Si el foco está en un input de la planilla solo interceptamos cuando el
    // texto es claramente tabular (tabs o varias líneas) — pegar una palabra
    // en una celda sigue funcionando normal.
    useEffect(() => {
      function onPaste(e: ClipboardEvent) {
        const active = document.activeElement;
        const insideSheet = !!containerRef.current && (
          containerRef.current.contains(active) || active === containerRef.current
        );
        if (!insideSheet) return;
        const text = e.clipboardData?.getData("text/plain") ?? "";
        if (!text.trim()) return;
        const isFormField = !!active && ["INPUT", "SELECT", "TEXTAREA"].includes(active.tagName);
        const looksTabular = text.includes("\t") || text.trim().split(/\r?\n/).length >= 2;
        if (isFormField && !looksTabular) return;
        const { rows } = parseClipboardRows(text);
        if (rows.length === 0) return;
        e.preventDefault();
        setPastePreview(rows);
        setBulkError(null);
      }
      document.addEventListener("paste", onPaste);
      return () => document.removeEventListener("paste", onPaste);
    }, []);

    // Botón "Pegar desde Excel" — lee el portapapeles sin depender del foco
    async function pasteFromClipboard() {
      try {
        const text = await navigator.clipboard.readText();
        if (!text.trim()) { setBulkError("El portapapeles está vacío. Copiá las filas en Excel primero."); return; }
        const { rows } = parseClipboardRows(text);
        if (rows.length === 0) { setBulkError("No se detectaron tareas en el portapapeles. Copiá filas con al menos una columna de nombre."); return; }
        setPastePreview(rows);
        setBulkError(null);
      } catch {
        setBulkError("El navegador no dio acceso al portapapeles. Hacé click en la planilla y pegá con Ctrl+V / Cmd+V.");
      }
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    function startEdit(task: Task, field: Field = "title") {
      if (editing?.taskId === task.id) {
        setEditing((s) => s ? { ...s, activeField: field } : s);
        return;
      }
      setShowNewRow(false);
      setEditing(makeEdit(task, field));
    }

    function startNewRow() {
      setEditing(null);
      setShowNewRow(true);
      setEditing(blankEdit());
    }

    function cancelEdit() {
      setEditing(null);
      setShowNewRow(false);
    }

    useImperativeHandle(ref, () => ({
      startNewRow,
      focusTask: (taskId: number, field: Field) => {
        const task = tasks.find(t => t.id === taskId);
        if (!task) return;
        startEdit(task, field);
        if (field === "responsible") setOpenDropdownFor(taskId);
        setTimeout(() => {
          const row = containerRef.current?.querySelector(`[data-task-row="${taskId}"]`);
          row?.scrollIntoView({ behavior: "smooth", block: "center" });
          if (field !== "responsible") {
            const el = row?.querySelector<HTMLElement>(`[data-sheet-field="${field}"]`);
            el?.focus();
          }
        }, 80);
      },
    }));

    // ── Bulk create from paste preview ────────────────────────────────────────

    // Matchea el nombre de responsable parseado contra el equipo de la obra
    const matchResponsible = useCallback((name: string | null): Responsible | null => {
      if (!name?.trim()) return null;
      const n = name.trim().toLowerCase();
      return (
        activeResponsibles.find(r => r.full_name.toLowerCase() === n) ??
        activeResponsibles.find(r => r.full_name.toLowerCase().includes(n) || n.includes(r.full_name.toLowerCase())) ??
        null
      );
    }, [activeResponsibles]);

    const confirmPaste = useCallback(async () => {
      if (!pastePreview || pastePreview.length === 0) return;
      setBulkSaving(true);
      setBulkError(null);
      try {
        // Un solo request: transacción única + un solo evento de historial
        const result = await bulkCreateTasks(
          obraId,
          pastePreview.map(row => ({
            title: row.title,
            start_date: row.startDate,
            due_date: row.dueDate,
            responsible_id: matchResponsible(row.responsibleName)?.id ?? null,
            depends_on_row: row.dependsOnRow,
          })),
        );
        setPastePreview(null);
        onBulkImported?.();
        if (result.failed > 0) {
          setBulkError(
            `${result.failed} fila${result.failed !== 1 ? "s" : ""} no se pudo crear` +
            (result.errors[0] ? ` (${result.errors[0]})` : "") +
            `. Las otras ${result.created} quedaron cargadas.`
          );
        }
      } catch (err) {
        const limitInfo = getPlanLimitError(err);
        if (limitInfo) {
          setPlanLimit(limitInfo);
          setPastePreview(null);
          return;
        }
        setBulkError("No se pudo importar el lote. Revisá la conexión e intentá de nuevo.");
      } finally {
        setBulkSaving(false);
      }
    }, [pastePreview, obraId, matchResponsible, onBulkImported]);

    async function handleDeleteRow(task: Task) {
      if (!confirm(`¿Eliminar la tarea «${task.title}»?`)) return;
      setDeletingId(task.id);
      try {
        await deleteTask(task.id);
        onTaskDeleted?.(task.id);
      } catch { /* noop */ } finally {
        setDeletingId(null);
      }
    }

    const saveEdit = useCallback(
      async (state: EditState, andNewRow = false, nextEdit?: { taskId: number; field: Field }) => {
        if (!state.title.trim()) {
          setEditing((e) => e ? { ...e, error: "El título es obligatorio." } : e);
          return;
        }
        if (state.dueDate && state.startDate && state.dueDate < state.startDate) {
          setEditing((e) => e ? { ...e, error: "La fecha de fin debe ser posterior al inicio." } : e);
          return;
        }
        const prog = Math.min(100, Math.max(0, parseInt(state.progress, 10) || 0));
        setEditing((e) => e ? { ...e, saving: true, error: null } : e);
        try {
          let saved: Task;
          if (state.taskId === null) {
            saved = await createTask({
              obra_id: obraId,
              title: state.title.trim(),
              responsible_id: state.responsibleId ? Number(state.responsibleId) : null,
              start_date: state.startDate || null,
              due_date: state.dueDate || null,
            });
          } else {
            saved = await updateTask(state.taskId, {
              title: state.title.trim(),
              responsible_id: state.responsibleId ? Number(state.responsibleId) : null,
              start_date: state.startDate || null,
              due_date: state.dueDate || null,
              estimated_progress: prog,
            });
            // El estado va por su propio endpoint (PATCH no acepta status)
            const original = tasks.find(t => t.id === state.taskId);
            if (original && original.status !== state.taskStatus) {
              saved = await updateTaskStatus(state.taskId, state.taskStatus);
            }
          }
          onTaskSaved(saved);
          if (nextEdit) {
            const nt = tasks.find(t => t.id === nextEdit.taskId);
            if (nt) {
              setShowNewRow(false);
              setEditing(makeEdit(nt, nextEdit.field));
              return;
            }
          }
          if (andNewRow) {
            setEditing(blankEdit());
            setShowNewRow(true);
          } else {
            setEditing(null);
            setShowNewRow(false);
          }
        } catch (err) {
          const limitInfo = getPlanLimitError(err);
          if (limitInfo) {
            setPlanLimit(limitInfo);
            setEditing((e) => e ? { ...e, saving: false, error: null } : e);
            return;
          }
          setEditing((e) => e ? { ...e, saving: false, error: "No se pudo guardar la tarea." } : e);
        }
      },
      [obraId, onTaskSaved, tasks]
    );

    // ── keyboard navigation ──────────────────────────────────────────────────

    function handleKeyDown(e: KeyboardEvent, field: Field) {
      if (!editing) return;
      if (e.key === "Escape") { e.preventDefault(); cancelEdit(); return; }

      const isExistingRow = editing.taskId !== null;
      const rowIdx = isExistingRow ? tasks.findIndex(t => t.id === editing.taskId) : -1;

      if (e.key === "Enter") {
        e.preventDefault();
        // Como Excel: guardar y seguir editando la fila de abajo en la MISMA columna
        if (isExistingRow && rowIdx >= 0 && rowIdx < tasks.length - 1) {
          saveEdit(editing, false, { taskId: tasks[rowIdx + 1].id, field });
        } else {
          saveEdit(editing, true); // última fila (o fila nueva) → guardar y abrir fila nueva
        }
        return;
      }

      if (e.key === "Tab") {
        e.preventDefault();
        const idx = FIELD_ORDER.indexOf(field);
        if (e.shiftKey) {
          const prev = FIELD_ORDER[idx - 1];
          if (prev) setEditing((s) => s ? { ...s, activeField: prev } : s);
          return;
        }
        const next = FIELD_ORDER[idx + 1];
        if (next) {
          setEditing((s) => s ? { ...s, activeField: next } : s);
        } else {
          saveEdit(editing, true);
        }
        return;
      }

      // ↑/↓ navegan entre filas (solo en el título, para no pisar los inputs de número/fecha)
      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && field === "title" && isExistingRow && rowIdx >= 0) {
        const target = tasks[rowIdx + (e.key === "ArrowDown" ? 1 : -1)];
        if (target) {
          e.preventDefault();
          saveEdit(editing, false, { taskId: target.id, field });
        }
      }
    }

    // ─── style helpers ───────────────────────────────────────────────────────

    const cellStyle = (colIdx: number, extra?: React.CSSProperties): React.CSSProperties => ({
      padding: "0 10px",
      height: 38,
      display: "flex",
      alignItems: "center",
      fontSize: 13,
      color: "#1A2329",
      borderBottom: CELL_BORDER,
      borderRight: colIdx < LAST_COL ? CELL_BORDER : "none",
      overflow: "hidden",
      ...extra,
    });

    const headerCellStyle = (colIdx: number): React.CSSProperties => ({
      padding: "0 10px",
      height: 32,
      display: "flex",
      alignItems: "center",
      fontSize: 10.5,
      fontWeight: 700,
      color: "#6B7580",
      textTransform: "uppercase",
      letterSpacing: "0.065em",
      borderBottom: HEADER_BORDER,
      borderRight: colIdx < LAST_COL ? HEADER_BORDER : "none",
      whiteSpace: "nowrap",
    });

    const inputStyle: React.CSSProperties = {
      width: "100%",
      border: "none",
      outline: "none",
      background: "transparent",
      fontSize: 13,
      color: "#1A2329",
      fontFamily: "'Plus Jakarta Sans', sans-serif",
    };

    const rowBase: React.CSSProperties = {
      display: "grid",
      gridTemplateColumns: colWidths.join(" "),
    };

    // ─── per-cell helpers ─────────────────────────────────────────────────────

    const levelMap = buildLevelMap(tasks);

    const isEditingRow = (id: number) => editing?.taskId === id;
    const isActiveCell = (id: number, field: Field) => editing?.taskId === id && editing.activeField === field;
    const isNewRow = editing?.taskId === null && showNewRow;

    function activeCellStyle(taskId: number, field: Field, colIdx: number, extra?: React.CSSProperties): React.CSSProperties {
      const active = isActiveCell(taskId, field);
      return {
        ...cellStyle(colIdx, extra),
        cursor: "pointer",
        boxShadow: active ? ACTIVE_CELL_SHADOW : "none",
        background: active ? "#EBF3FE" : undefined,
      };
    }

    // ─── render ──────────────────────────────────────────────────────────────

    return (
      <div
        ref={containerRef}
        tabIndex={-1}
        style={{
          background: "#fff",
          border: "1px solid #D5D9D5",
          borderRadius: 14,
          overflowX: "auto",
          overflowY: "clip",
          fontFamily: "'Plus Jakarta Sans', sans-serif",
          outline: "none",
        }}
      >
        <div style={{ minWidth: 760 }}>
        {/* ── Header row — sticky al scroll vertical ── */}
        <div style={{ ...rowBase, background: "#F0F2F0", position: "sticky", top: 0, zIndex: 5 }}>
          {COLS.map((col, i) => (
            <div key={col} style={{ ...headerCellStyle(i), position: "relative" }}>
              {col}
              {/* Handle de resize — arrastrá el borde derecho */}
              {i >= 2 && (
                <div
                  onPointerDown={e => startColResize(e, i)}
                  title="Arrastrá para ajustar el ancho"
                  style={{
                    position: "absolute", right: -4, top: 0, bottom: 0, width: 8,
                    cursor: "col-resize", zIndex: 2, touchAction: "none",
                  }}
                />
              )}
            </div>
          ))}
        </div>

        {/* ── Empty state: el momento de vender el paste ── */}
        {tasks.length === 0 && !isNewRow && !pastePreview && (
          <div style={{ padding: "36px 24px", textAlign: "center" }}>
            <p style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 700, color: "#1A2329" }}>
              Cargá el plan de obra como en Excel
            </p>
            <p style={{ margin: "0 0 16px", fontSize: 12.5, color: "#6B7580", lineHeight: 1.5 }}>
              Escribí fila por fila, o directamente copiá tu listado desde Excel / Project y pegalo acá.
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={startNewRow}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 7, padding: "10px 18px",
                  borderRadius: 10, fontSize: 13, fontWeight: 700, color: "#fff",
                  background: "#FF6B35", border: "none", cursor: "pointer",
                  fontFamily: "'Plus Jakarta Sans', sans-serif",
                  boxShadow: "0 6px 14px -6px rgba(255,107,53,0.5)",
                }}
              >
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
                Agregar primera fila
              </button>
              <button
                type="button"
                onClick={pasteFromClipboard}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 7, padding: "10px 18px",
                  borderRadius: 10, fontSize: 13, fontWeight: 600, color: "#1A2329",
                  background: "#fff", border: "1.5px solid #E6E7E5", cursor: "pointer",
                  fontFamily: "'Plus Jakarta Sans', sans-serif",
                }}
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="3" y="1" width="10" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.4"/><path d="M6 1v2h4V1" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/><path d="M5.5 7h5M5.5 10h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                Pegar desde Excel
              </button>
            </div>
            {bulkError && (
              <p style={{ margin: "12px 0 0", fontSize: 12, color: "#C97D0E", fontWeight: 600 }}>{bulkError}</p>
            )}
          </div>
        )}

        {/* ── Task rows ── */}
        {tasks.map((task, idx) => {
          const level = levelMap.get(task.id) ?? 0;
          const isEditing = isEditingRow(task.id);
          const isOverdue =
            !!task.due_date &&
            task.due_date < new Date().toISOString().slice(0, 10) &&
            task.status !== "completada" &&
            task.status !== "cancelada";
          const durDays = task.start_date && task.due_date ? diffDays(task.start_date, task.due_date) + 1 : null;

          // When editing this row, use draft values for display
          const dTitle   = isEditing ? editing!.title      : task.title;
          const dStart   = isEditing ? editing!.startDate  : task.start_date;
          const dDue     = isEditing ? editing!.dueDate    : task.due_date;
          const dDur     = isEditing ? (editing!.duration ? `${editing!.duration}d` : "—") : (durDays !== null ? `${durDays}d` : "—");
          const dStatus  = isEditing ? editing!.taskStatus : task.status;
          const dProg    = isEditing ? (parseInt(editing!.progress, 10) || 0) : task.estimated_progress;
          const isCompleted = dStatus === "completada";

          return (
            <div
              key={task.id}
              data-task-row={task.id}
              onMouseEnter={() => setHoveredRow(task.id)}
              onMouseLeave={() => setHoveredRow(prev => (prev === task.id ? null : prev))}
              style={{ ...rowBase, background: idx % 2 === 0 ? "#fff" : "#F8F9F8", position: "relative" }}
            >
              {/* Eliminar fila — visible al hover */}
              {hoveredRow === task.id && !isEditing && onTaskDeleted && (
                <button
                  type="button"
                  aria-label={`Eliminar tarea ${task.title}`}
                  title="Eliminar tarea"
                  disabled={deletingId === task.id}
                  onClick={e => { e.stopPropagation(); handleDeleteRow(task); }}
                  style={{
                    position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)",
                    width: 26, height: 26, borderRadius: 7, border: "1px solid #F0B0B0",
                    background: "#fff", cursor: "pointer", zIndex: 4,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    boxShadow: "0 2px 6px rgba(0,0,0,0.08)",
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                    <path d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9.3a1 1 0 001 .95h4.6a1 1 0 001-.95L12 4M6.6 7v4.5M9.4 7v4.5" stroke="#D03A3A" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              )}

              {/* # */}
              <div style={cellStyle(0, { color: "#9BA3AB", fontSize: 11.5, fontWeight: 600, justifyContent: "center", cursor: "default" })}>
                {idx + 1}
              </div>

              {/* Tarea */}
              <div
                style={activeCellStyle(task.id, "title", 1, {
                  paddingLeft: 10 + level * 16,
                  position: "relative",
                })}
                onClick={() => startEdit(task, "title")}
              >
                {/* Conector visual de subtarea (└) */}
                {level > 0 && (
                  <div style={{
                    position: "absolute",
                    left: 10 + level * 16 - 12, top: 0, bottom: "50%",
                    width: 9,
                    borderLeft: "1.5px solid #D8D2C6",
                    borderBottom: "1.5px solid #D8D2C6",
                    borderBottomLeftRadius: 5,
                    pointerEvents: "none",
                  }} />
                )}
                {isActiveCell(task.id, "title") ? (
                  <input
                    data-sheet-field="title"
                    value={editing!.title}
                    onChange={(e) => setEditing((s) => s ? { ...s, title: e.target.value, error: null } : s)}
                    onKeyDown={(e) => handleKeyDown(e, "title")}
                    style={{ ...inputStyle, fontWeight: 600 }}
                    placeholder="Título de la tarea"
                  />
                ) : (
                  <span style={{
                    fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    textDecoration: task.status === "completada" ? "line-through" : "none",
                    color: task.status === "cancelada" ? "#9BA3AB" : "#1A2329",
                  }}>
                    {dTitle}
                  </span>
                )}
              </div>

              {/* Responsable — combobox con búsqueda */}
              <div style={{
                ...cellStyle(2), position: "relative",
                boxShadow: isActiveCell(task.id, "responsible") ? ACTIVE_CELL_SHADOW : "none",
                background: isActiveCell(task.id, "responsible") ? "#EBF3FE" : undefined,
                cursor: "text",
              }}
                onClick={() => startEdit(task, "responsible")}
              >
                {isEditing && editing!.taskId === task.id ? (
                  <ResponsableCombobox
                    currentId={editing!.responsibleId}
                    options={activeResponsibles}
                    autoFocus={openDropdownFor === task.id}
                    onSelect={(id) => {
                      setEditing(s => s ? { ...s, responsibleId: id } : s);
                      setOpenDropdownFor(null);
                    }}
                    onKeyDown={(e) => handleKeyDown(e as unknown as KeyboardEvent<HTMLInputElement>, "responsible")}
                  />
                ) : (
                  <span style={{ fontSize: 13, fontFamily: "'Plus Jakarta Sans', sans-serif", color: task.responsible_id ? "#1A2329" : "#9BA3AB", userSelect: "none" }}>
                    {task.responsible_id
                      ? (() => { const r = activeResponsibles.find(x => x.id === task.responsible_id); return r ? `${r.full_name}${r.role ? ` · ${r.role}` : ""}` : "Sin responsable"; })()
                      : "Sin responsable"
                    }
                  </span>
                )}
              </div>

              {/* Inicio */}
              <div style={activeCellStyle(task.id, "start", 3)} onClick={() => startEdit(task, "start")}>
                {isActiveCell(task.id, "start") ? (
                  <input
                    type="date"
                    data-sheet-field="start"
                    value={editing!.startDate}
                    onChange={(e) => {
                      const v = e.target.value;
                      const d = parseInt(editing!.duration, 10);
                      const newDue = v && d > 0 ? addDays(v, d - 1) : editing!.dueDate;
                      setEditing((s) => s ? { ...s, startDate: v, dueDate: newDue } : s);
                    }}
                    onKeyDown={(e) => handleKeyDown(e, "start")}
                    style={inputStyle}
                  />
                ) : (
                  <span style={{ color: dStart ? "#1A2329" : "#C4C9C6", fontVariantNumeric: "tabular-nums" }}>
                    {fmtDate(dStart ?? null)}
                  </span>
                )}
              </div>

              {/* Duración */}
              <div style={activeCellStyle(task.id, "duration", 4)} onClick={() => startEdit(task, "duration")}>
                {isActiveCell(task.id, "duration") ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 4, width: "100%" }}>
                    <input
                      type="number" min={1}
                      data-sheet-field="duration"
                      value={editing!.duration}
                      onChange={(e) => {
                        const v = e.target.value;
                        const d = parseInt(v, 10);
                        const newDue = editing!.startDate && d > 0 ? addDays(editing!.startDate, d - 1) : editing!.dueDate;
                        setEditing((s) => s ? { ...s, duration: v, dueDate: newDue } : s);
                      }}
                      onKeyDown={(e) => handleKeyDown(e, "duration")}
                      style={{ ...inputStyle, width: "50px", fontVariantNumeric: "tabular-nums" }}
                    />
                    <span style={{ fontSize: 11, color: "#9BA3AB", whiteSpace: "nowrap" }}>días</span>
                  </div>
                ) : (
                  <span style={{ color: dDur !== "—" ? "#1A2329" : "#C4C9C6", fontVariantNumeric: "tabular-nums" }}>
                    {dDur}
                  </span>
                )}
              </div>

              {/* Fin */}
              <div style={activeCellStyle(task.id, "due", 5)} onClick={() => startEdit(task, "due")}>
                {isActiveCell(task.id, "due") ? (
                  <input
                    type="date"
                    data-sheet-field="due"
                    value={editing!.dueDate}
                    onChange={(e) => {
                      const v = e.target.value;
                      const newDur = v && editing!.startDate ? calcDuration(editing!.startDate, v) : editing!.duration;
                      setEditing((s) => s ? { ...s, dueDate: v, duration: newDur } : s);
                    }}
                    onKeyDown={(e) => handleKeyDown(e, "due")}
                    style={inputStyle}
                  />
                ) : (
                  <span style={{
                    color: isOverdue && !isEditing ? "#D03A3A" : dDue ? "#1A2329" : "#C4C9C6",
                    fontWeight: isOverdue && !isEditing ? 600 : 400,
                    fontVariantNumeric: "tabular-nums",
                  }}>
                    {fmtDate(dDue ?? null)}{isOverdue && !isEditing && " ▲"}
                  </span>
                )}
              </div>

              {/* % Avance — per-cell editable */}
              <div
                style={activeCellStyle(task.id, "progress", 6, { gap: 6 })}
                onClick={() => !isCompleted && startEdit(task, "progress")}
                title={isCompleted ? "Completada — 100%" : undefined}
              >
                {isActiveCell(task.id, "progress") && !isCompleted ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 5, width: "100%" }}>
                    <input
                      type="number" min={0} max={100}
                      data-sheet-field="progress"
                      value={editing!.progress}
                      onChange={(e) => setEditing((s) => s ? { ...s, progress: e.target.value } : s)}
                      onKeyDown={(e) => handleKeyDown(e, "progress")}
                      style={{ ...inputStyle, width: "44px", fontVariantNumeric: "tabular-nums" }}
                    />
                    <span style={{ fontSize: 11, color: "#9BA3AB" }}>%</span>
                  </div>
                ) : task.is_milestone ? (
                  <span style={{ fontSize: 12, color: "#8E97A0" }}>◆ Hito</span>
                ) : (
                  <>
                    <div style={{ flex: 1, height: 4, borderRadius: 99, background: "#E8EAEB", overflow: "hidden" }}>
                      <div style={{
                        height: "100%", borderRadius: 99,
                        width: `${dProg}%`,
                        background: dProg === 100 ? "#1F8A5B" : "#FF6B35",
                        transition: "width 0.2s",
                      }} />
                    </div>
                    <span style={{ fontSize: 11.5, fontWeight: 600, color: "#5B6770", minWidth: 28, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {dProg}%
                    </span>
                  </>
                )}
              </div>

              {/* Estado — per-cell editable */}
              <div
                style={activeCellStyle(task.id, "taskStatus", 7)}
                onClick={() => startEdit(task, "taskStatus")}
              >
                {isActiveCell(task.id, "taskStatus") ? (
                  <select
                    data-sheet-field="taskStatus"
                    value={editing!.taskStatus}
                    onChange={(e) => {
                      const v = e.target.value as TaskStatus;
                      setEditing((s) => s ? {
                        ...s,
                        taskStatus: v,
                        progress: v === "completada" ? "100" : s.progress,
                      } : s);
                    }}
                    onKeyDown={(e) => handleKeyDown(e, "taskStatus")}
                    onFocus={() => setEditing((s) => s ? { ...s, activeField: "taskStatus" } : s)}
                    style={{ ...inputStyle, width: "100%", appearance: "auto" }}
                  >
                    {STATUS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                ) : (
                  <StatusPill status={dStatus} />
                )}
              </div>
            </div>
          );
        })}

        {/* ── Save bar — shows when editing a row ── */}
        {editing && editing.taskId !== null && (
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "7px 12px", background: "#F8F9F8", borderBottom: CELL_BORDER, fontSize: 12,
          }}>
            <span style={{ color: editing.error ? "#D03A3A" : "#8E97A0" }}>
              {editing.error ?? "Tab/Shift+Tab entre celdas · Enter guarda y baja · ↑/↓ cambian de fila · Esc cancela"}
            </span>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={cancelEdit} style={{ padding: "4px 12px", borderRadius: 7, border: "1px solid #E6E7E5", fontSize: 12, fontWeight: 600, color: "#5B6770", background: "#fff", cursor: "pointer" }}>
                Cancelar
              </button>
              <button onClick={() => saveEdit(editing)} disabled={editing.saving} style={{ padding: "4px 12px", borderRadius: 7, border: "none", fontSize: 12, fontWeight: 600, color: "#fff", background: editing.saving ? "#FFAA80" : "#FF6B35", cursor: editing.saving ? "not-allowed" : "pointer" }}>
                {editing.saving ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
        )}

        {/* ── New row ── */}
        {isNewRow && (
          <>
            <div style={{ ...rowBase, background: "#fff" }}>
              <div style={cellStyle(0, { color: "#9BA3AB", fontSize: 11.5, fontWeight: 600, justifyContent: "center" })}>
                {tasks.length + 1}
              </div>
              {/* Tarea */}
              <div style={{ ...cellStyle(1), boxShadow: editing?.activeField === "title" ? ACTIVE_CELL_SHADOW : "none", background: editing?.activeField === "title" ? "#EBF3FE" : undefined }}>
                <input data-sheet-field="title" value={editing?.title ?? ""} onChange={(e) => setEditing((s) => s ? { ...s, title: e.target.value, error: null } : s)} onKeyDown={(e) => editing && handleKeyDown(e, "title")} onFocus={() => setEditing((s) => s ? { ...s, activeField: "title" } : s)} style={{ ...inputStyle, fontWeight: 600 }} placeholder="Nuevo título…" />
              </div>
              {/* Responsable */}
              <div style={{ ...cellStyle(2), boxShadow: editing?.activeField === "responsible" ? ACTIVE_CELL_SHADOW : "none", background: editing?.activeField === "responsible" ? "#EBF3FE" : undefined, cursor: "text" }}
                onClick={() => setEditing((s) => s ? { ...s, activeField: "responsible" } : s)}
              >
                <ResponsableCombobox
                  currentId={editing?.responsibleId ?? ""}
                  options={activeResponsibles}
                  onSelect={(id) => setEditing((s) => s ? { ...s, responsibleId: id } : s)}
                  onKeyDown={(e) => editing && handleKeyDown(e as unknown as KeyboardEvent<HTMLInputElement>, "responsible")}
                />
              </div>
              {/* Inicio */}
              <div style={{ ...cellStyle(3), boxShadow: editing?.activeField === "start" ? ACTIVE_CELL_SHADOW : "none", background: editing?.activeField === "start" ? "#EBF3FE" : undefined }}>
                <input type="date" data-sheet-field="start" value={editing?.startDate ?? ""} onChange={(e) => { const v = e.target.value; const d = parseInt(editing?.duration ?? "1", 10); setEditing((s) => s ? { ...s, startDate: v, dueDate: v && d > 0 ? addDays(v, d - 1) : (s.dueDate) } : s); }} onKeyDown={(e) => editing && handleKeyDown(e, "start")} onFocus={() => setEditing((s) => s ? { ...s, activeField: "start" } : s)} style={inputStyle} />
              </div>
              {/* Duración */}
              <div style={{ ...cellStyle(4), boxShadow: editing?.activeField === "duration" ? ACTIVE_CELL_SHADOW : "none", background: editing?.activeField === "duration" ? "#EBF3FE" : undefined }}>
                <div style={{ display: "flex", alignItems: "center", gap: 4, width: "100%" }}>
                  <input type="number" min={1} data-sheet-field="duration" value={editing?.duration ?? "1"} onChange={(e) => { const v = e.target.value; const d = parseInt(v, 10); setEditing((s) => s ? { ...s, duration: v, dueDate: s.startDate && d > 0 ? addDays(s.startDate, d - 1) : s.dueDate } : s); }} onKeyDown={(e) => editing && handleKeyDown(e, "duration")} onFocus={() => setEditing((s) => s ? { ...s, activeField: "duration" } : s)} style={{ ...inputStyle, width: "50px", fontVariantNumeric: "tabular-nums" }} />
                  <span style={{ fontSize: 11, color: "#9BA3AB", whiteSpace: "nowrap" }}>días</span>
                </div>
              </div>
              {/* Fin */}
              <div style={{ ...cellStyle(5), boxShadow: editing?.activeField === "due" ? ACTIVE_CELL_SHADOW : "none", background: editing?.activeField === "due" ? "#EBF3FE" : undefined }}>
                <input type="date" data-sheet-field="due" value={editing?.dueDate ?? ""} onChange={(e) => { const v = e.target.value; setEditing((s) => s ? { ...s, dueDate: v, duration: v && s.startDate ? calcDuration(s.startDate, v) : s.duration } : s); }} onKeyDown={(e) => editing && handleKeyDown(e, "due")} onFocus={() => setEditing((s) => s ? { ...s, activeField: "due" } : s)} style={inputStyle} />
              </div>
              {/* % Avance — not editable for new row */}
              <div style={cellStyle(6, { color: "#C4C9C6", fontSize: 12 })}>—</div>
              {/* Estado — not editable for new row */}
              <div style={cellStyle(7)}>
                <StatusPill status="pendiente" />
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 12px", background: "#F8F9F8", borderBottom: CELL_BORDER, fontSize: 12 }}>
              <span style={{ color: editing?.error ? "#D03A3A" : "#8E97A0" }}>
                {editing?.error ?? "Tab entre celdas · Enter para guardar y agregar otra · Esc para cancelar"}
              </span>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={cancelEdit} style={{ padding: "4px 12px", borderRadius: 7, border: "1px solid #E6E7E5", fontSize: 12, fontWeight: 600, color: "#5B6770", background: "#fff", cursor: "pointer" }}>Cancelar</button>
                <button onClick={() => editing && saveEdit(editing)} disabled={editing?.saving} style={{ padding: "4px 12px", borderRadius: 7, border: "none", fontSize: 12, fontWeight: 600, color: "#fff", background: editing?.saving ? "#FFAA80" : "#FF6B35", cursor: editing?.saving ? "not-allowed" : "pointer" }}>
                  {editing?.saving ? "Guardando…" : "Guardar"}
                </button>
              </div>
            </div>
          </>
        )}

        {/* ── Paste preview ── */}
        {pastePreview && (
          <div style={{ borderTop: "2px solid #FF6B35" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: "#FFF6F1", borderBottom: "1px solid #FFE0C8" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><rect x="3" y="1" width="10" height="14" rx="1.5" stroke="#FF6B35" strokeWidth="1.4" fill="none"/><path d="M6 1v2h4V1" stroke="#FF6B35" strokeWidth="1.4" strokeLinejoin="round"/><path d="M5.5 7h5M5.5 10h3" stroke="#FF6B35" strokeWidth="1.3" strokeLinecap="round"/></svg>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#1A2329" }}>{pastePreview.length} {pastePreview.length === 1 ? "tarea detectada" : "tareas detectadas"} desde el portapapeles</span>
                <span style={{ fontSize: 11.5, color: "#8E97A0" }}>— Revisá antes de confirmar</span>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => { setPastePreview(null); setBulkError(null); }} style={{ padding: "5px 12px", borderRadius: 7, border: "1px solid #E6E7E5", fontSize: 12, fontWeight: 600, color: "#5B6770", background: "#fff", cursor: "pointer" }}>Cancelar</button>
                <button onClick={confirmPaste} disabled={bulkSaving} style={{ padding: "5px 14px", borderRadius: 7, border: "none", fontSize: 12, fontWeight: 600, color: "#fff", background: bulkSaving ? "#FFAA80" : "#FF6B35", cursor: bulkSaving ? "not-allowed" : "pointer" }}>
                  {bulkSaving ? `Importando ${pastePreview.length} tareas…` : `Importar ${pastePreview.length} ${pastePreview.length === 1 ? "tarea" : "tareas"}`}
                </button>
              </div>
            </div>
            {bulkError && <div style={{ padding: "6px 14px", background: "#FCE5E5", fontSize: 12, color: "#D03A3A", fontWeight: 600 }}>{bulkError}</div>}
            {pastePreview.map((row, i) => {
              const previewDur = row.startDate && row.dueDate ? `${diffDays(row.startDate, row.dueDate) + 1}d` : "—";
              return (
                <div key={i} style={{ ...rowBase, background: i % 2 === 0 ? "#FFFBF8" : "#FFF6F1", opacity: bulkSaving ? 0.5 : 1 }}>
                  <div style={{ padding: "0 10px", height: 38, display: "flex", alignItems: "center", fontSize: 11.5, fontWeight: 600, color: "#9BA3AB", justifyContent: "center", borderBottom: "1px solid #FFE8D8", borderRight: CELL_BORDER }}>{tasks.length + i + 1}</div>
                  <div style={{ padding: "0 10px", height: 38, display: "flex", alignItems: "center", fontSize: 13, fontWeight: 600, color: "#1A2329", borderBottom: "1px solid #FFE8D8", borderRight: CELL_BORDER, overflow: "hidden" }}><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.title}</span></div>
                  {(() => {
                    const m = matchResponsible(row.responsibleName);
                    return (
                      <div style={{ padding: "0 10px", height: 38, display: "flex", alignItems: "center", fontSize: 12.5, color: m ? "#1A2329" : "#C4C9C6", borderBottom: "1px solid #FFE8D8", borderRight: CELL_BORDER, overflow: "hidden" }}>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {m ? m.full_name : row.responsibleName ? `${row.responsibleName} (no está en el equipo)` : "Sin asignar"}
                        </span>
                      </div>
                    );
                  })()}
                  <div style={{ padding: "0 10px", height: 38, display: "flex", alignItems: "center", fontSize: 12.5, color: row.startDate ? "#1A2329" : "#C4C9C6", borderBottom: "1px solid #FFE8D8", borderRight: CELL_BORDER, fontVariantNumeric: "tabular-nums" }}>{row.startDate ? fmtDate(row.startDate) : "—"}</div>
                  <div style={{ padding: "0 10px", height: 38, display: "flex", alignItems: "center", fontSize: 12.5, color: previewDur !== "—" ? "#1A2329" : "#C4C9C6", borderBottom: "1px solid #FFE8D8", borderRight: CELL_BORDER }}>{previewDur}</div>
                  <div style={{ padding: "0 10px", height: 38, display: "flex", alignItems: "center", fontSize: 12.5, color: row.dueDate ? "#1A2329" : "#C4C9C6", borderBottom: "1px solid #FFE8D8", borderRight: CELL_BORDER, fontVariantNumeric: "tabular-nums" }}>{row.dueDate ? fmtDate(row.dueDate) : "—"}</div>
                  <div style={{ padding: "0 10px", height: 38, display: "flex", alignItems: "center", fontSize: 12, color: "#C4C9C6", borderBottom: "1px solid #FFE8D8", borderRight: CELL_BORDER }}>—</div>
                  <div style={{ padding: "0 10px", height: 38, display: "flex", alignItems: "center", borderBottom: "1px solid #FFE8D8" }}>
                    <StatusPill status="pendiente" />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Totals footer ── */}
        {tasks.length > 0 && (() => {
          const withDates  = tasks.filter(t => t.start_date && t.due_date);
          const totalDays  = withDates.reduce((acc, t) => acc + diffDays(t.start_date!, t.due_date!) + 1, 0);
          const measurable = tasks.filter(t => !t.is_milestone && t.status !== "cancelada");
          const avg        = measurable.length
            ? Math.round(measurable.reduce((a, t) => a + (t.estimated_progress ?? 0), 0) / measurable.length)
            : 0;
          return (
            <div style={{
              display: "flex", alignItems: "center", gap: 18,
              padding: "8px 12px", background: "#F6F7F6",
              borderTop: HEADER_BORDER, borderBottom: CELL_BORDER,
              fontSize: 11.5, color: "#5B6770",
            }}>
              <span style={{ fontWeight: 700, color: "#3E4A52" }}>
                Σ {tasks.length} tarea{tasks.length !== 1 ? "s" : ""}
              </span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>
                <strong style={{ color: "#3E4A52" }}>{totalDays}</strong> días planificados
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                Avance promedio
                <span style={{ width: 64, height: 4, borderRadius: 99, background: "#E2E4E2", overflow: "hidden", display: "inline-block" }}>
                  <span style={{
                    display: "block", height: "100%", borderRadius: 99,
                    width: `${avg}%`,
                    background: avg === 100 ? "#1F8A5B" : "#FF6B35",
                  }} />
                </span>
                <strong style={{ color: "#3E4A52", fontVariantNumeric: "tabular-nums" }}>{avg}%</strong>
              </span>
            </div>
          );
        })()}

        {/* ── Add row button ── */}
        {!isNewRow && (
          <button
            onClick={startNewRow}
            style={{ width: "100%", padding: "9px 12px", background: "transparent", border: "none", display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: "#8E97A0", cursor: "pointer", textAlign: "left", transition: "background 0.1s, color 0.1s" }}
            onMouseEnter={e => { e.currentTarget.style.background = "#F8F9F8"; e.currentTarget.style.color = "#FF6B35"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#8E97A0"; }}
          >
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
            Agregar fila
            <span style={{ marginLeft: "auto", fontSize: 11, color: "#8E97A0", fontWeight: 500 }}>
              Tip: copiá filas en Excel y pegalas acá (Ctrl+V)
            </span>
          </button>
        )}

        {planLimit && <UpgradeModal info={planLimit} onClose={() => setPlanLimit(null)} />}
        </div>
      </div>
    );
  }
);

TaskSheetView.displayName = "TaskSheetView";
