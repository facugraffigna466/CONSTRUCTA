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

// "15/06/2026" → "2026-06-15" (para pegar fechas en formato local). null si no parsea.
function toIso(s: string): string | null {
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const yy = y.length === 2 ? "20" + y : y;
  return `${yy}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
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

// ── Grilla estilo Excel: columnas seleccionables (orden visual = orden de FIELD_ORDER) ──
// gridCol 0..6 ↔ field. domCol = índice en la grilla CSS de 8 columnas (0 es "#").
const GRID_FIELDS: { field: Field; domCol: number }[] = [
  { field: "title",      domCol: 1 },
  { field: "responsible", domCol: 2 },
  { field: "start",      domCol: 3 },
  { field: "duration",   domCol: 4 },
  { field: "due",        domCol: 5 },
  { field: "progress",   domCol: 6 },
  { field: "taskStatus", domCol: 7 },
];
const GC_COUNT = GRID_FIELDS.length;
const SEL_BG = "rgba(26,115,232,0.10)";

// Patch parcial que se manda al backend por celda/relleno/pegado
interface FieldPatch {
  title?: string;
  responsible_id?: number | null;
  start_date?: string | null;
  due_date?: string | null;
  estimated_progress?: number;
  status?: TaskStatus;
}

// Valor "crudo" de un campo de una tarea (para fuente de relleno y copiar)
function readField(task: Task, field: Field): string {
  switch (field) {
    case "title":       return task.title;
    case "responsible": return task.responsible_id ? String(task.responsible_id) : "";
    case "start":       return task.start_date ?? "";
    case "due":         return task.due_date ?? "";
    case "duration":    return task.start_date && task.due_date ? calcDuration(task.start_date, task.due_date) : "";
    case "progress":    return String(task.estimated_progress ?? 0);
    case "taskStatus":  return task.status;
  }
}

// Texto legible para copiar al portapapeles (TSV)
function displayField(task: Task, field: Field, respName: (id: number | null) => string): string {
  switch (field) {
    case "title":       return task.title;
    case "responsible": return respName(task.responsible_id);
    case "start":       return task.start_date ? fmtDate(task.start_date) : "";
    case "due":         return task.due_date ? fmtDate(task.due_date) : "";
    case "duration":    return task.start_date && task.due_date ? calcDuration(task.start_date, task.due_date) : "";
    case "progress":    return String(task.estimated_progress ?? 0);
    case "taskStatus":  return STATUS_STYLE[task.status].label;
  }
}

// Convierte (campo, valor crudo) en un patch, respetando el acople fecha/duración
function patchFor(field: Field, raw: string, task: Task): FieldPatch | null {
  switch (field) {
    case "title":
      return raw.trim() ? { title: raw.trim() } : null; // nunca borrar un título
    case "responsible":
      return { responsible_id: raw ? Number(raw) : null };
    case "start": {
      const start = raw || null;
      let due = task.due_date ?? null;
      if (start && task.start_date && task.due_date) {
        due = addDays(start, diffDays(task.start_date, task.due_date));
      } else if (start && !task.due_date) {
        due = start;
      }
      return { start_date: start, due_date: due };
    }
    case "due":
      return { due_date: raw || null };
    case "duration": {
      const d = parseInt(raw, 10);
      if (!task.start_date || !(d > 0)) return null;
      return { due_date: addDays(task.start_date, d - 1) };
    }
    case "progress":
      return { estimated_progress: Math.min(100, Math.max(0, parseInt(raw, 10) || 0)) };
    case "taskStatus":
      return STATUS_OPTIONS.some(o => o.value === raw) ? { status: raw as TaskStatus } : null;
  }
}

function fullPatch(task: Task): FieldPatch {
  return {
    title: task.title,
    responsible_id: task.responsible_id ?? null,
    start_date: task.start_date ?? null,
    due_date: task.due_date ?? null,
    estimated_progress: task.estimated_progress ?? 0,
    status: task.status,
  };
}

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

function ResponsableCombobox({ currentId, options, autoFocus, onSelect, onKeyDown }: ComboboxProps) {
  const currentLabel = options.find(r => String(r.id) === currentId)?.full_name ?? "";
  const [text, setText] = useState(currentLabel);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [listPos, setListPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const committed = useRef(false);

  const all = [{ id: 0, full_name: "Sin responsable", role: null } as unknown as Responsible, ...options];
  const filtered = text.trim()
    ? all.filter(r => r.full_name.toLowerCase().includes(text.toLowerCase()) || (r.role ?? "").toLowerCase().includes(text.toLowerCase()))
    : all;

  // Auto-enfocar SÓLO cuando responsable es el campo que se está editando
  // (antes se enfocaba al montar siempre → robaba el cursor al editar otra columna).
  // Cuando responsable es el campo activo por Tab, el efecto de foco del padre
  // enfoca este input (data-sheet-field="responsible") y onFocus abre la lista.
  useEffect(() => {
    if (autoFocus) {
      inputRef.current?.focus();
      openList();
    }
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
    committed.current = true;
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
            {r.full_name}{r.role && <span style={{ color: "#6B7580" }}> · {r.role}</span>}
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
        onBlur={() => setTimeout(() => { setOpen(false); if (!committed.current && !text.trim()) onSelect(""); }, 150)}
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

    function startColResize(e: React.MouseEvent, idx: number) {
      e.preventDefault();
      e.stopPropagation();
      const headerCell = (e.currentTarget as HTMLElement).parentElement;
      const startW = headerCell
        ? headerCell.getBoundingClientRect().width
        : parseInt(colWidths[idx], 10) || 100;
      colResizeRef.current = { idx, startX: e.clientX, startW };
      function onMove(ev: MouseEvent) {
        const cur = colResizeRef.current;
        if (!cur) return;
        const w = Math.max(56, Math.round(cur.startW + (ev.clientX - cur.startX)));
        setColWidths(prev => prev.map((p, i) => (i === cur.idx ? `${w}px` : p)));
      }
      function onUp() {
        colResizeRef.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        setColWidths(prev => {
          try { localStorage.setItem(`sheet_colw_${obraId}`, JSON.stringify(prev)); } catch { /* ignore */ }
          return prev;
        });
      }
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
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
        // Pegar bloque interno en celdas (Ctrl+C dentro de la grilla → Ctrl+V)
        if (handleCellPasteRef.current()) { e.preventDefault(); return; }
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

    // ─── selección estilo Excel (celda activa + rango) ────────────────────────

    const [sel, setSel] = useState<{ a: { r: number; c: number }; f: { r: number; c: number } } | null>(null);
    const selDragRef = useRef(false);
    const fillDragRef = useRef(false);
    const [fillTo, setFillTo] = useState<number | null>(null);
    const undoRef = useRef<{ taskId: number; patch: FieldPatch }[][]>([]);
    const clipRef = useRef<string[][] | null>(null);

    function selRect(s = sel) {
      if (!s) return null;
      return { r0: Math.min(s.a.r, s.f.r), r1: Math.max(s.a.r, s.f.r), c0: Math.min(s.a.c, s.f.c), c1: Math.max(s.a.c, s.f.c) };
    }
    const inSel = (r: number, c: number) => { const x = selRect(); return !!x && r >= x.r0 && r <= x.r1 && c >= x.c0 && c <= x.c1; };
    const isSelAnchor = (r: number, c: number) => !!sel && sel.a.r === r && sel.a.c === c;
    const inFillPreview = (r: number, c: number) => {
      if (fillTo === null) return false;
      const x = selRect(); if (!x) return false;
      return r > x.r1 && r <= fillTo && c >= x.c0 && c <= x.c1;
    };

    const respName = (id: number | null) => {
      if (!id) return "";
      const r = activeResponsibles.find((x) => x.id === id);
      return r ? r.full_name : "";
    };

    function focusGrid() { containerRef.current?.focus(); }

    function selectCell(r: number, c: number, extend: boolean) {
      if (editing) return;
      setSel((prev) => (extend && prev ? { a: prev.a, f: { r, c } } : { a: { r, c }, f: { r, c } }));
      focusGrid();
    }

    function beginEdit(r: number, c: number, initialChar?: string) {
      const task = tasks[r]; if (!task) return;
      const field = GRID_FIELDS[c].field;
      startEdit(task, field);
      if (initialChar != null) {
        if (field === "title") setEditing((s) => s ? { ...s, title: initialChar } : s);
        else if (field === "progress") setEditing((s) => s ? { ...s, progress: initialChar.replace(/[^0-9]/g, "") } : s);
        else if (field === "duration") setEditing((s) => s ? { ...s, duration: initialChar.replace(/[^0-9]/g, "") } : s);
      }
    }

    const applyPatches = useCallback(async (patches: { taskId: number; patch: FieldPatch }[]) => {
      for (const { taskId, patch } of patches) {
        try {
          const { status, ...rest } = patch;
          let saved: Task | null = null;
          if (Object.keys(rest).length > 0) saved = await updateTask(taskId, rest);
          if (status) saved = await updateTaskStatus(taskId, status);
          if (saved) onTaskSaved(saved);
        } catch (err) {
          const limitInfo = getPlanLimitError(err);
          if (limitInfo) { setPlanLimit(limitInfo); return; }
        }
      }
    }, [onTaskSaved]);

    function pushUndo(taskIds: number[]) {
      const group = Array.from(new Set(taskIds)).map((id) => ({ taskId: id, patch: fullPatch(tasks.find((x) => x.id === id)!) }));
      undoRef.current.push(group);
      if (undoRef.current.length > 30) undoRef.current.shift();
    }

    async function doFill(toRow: number) {
      const x = selRect(); if (!x || toRow <= x.r1) { setFillTo(null); return; }
      const targetRows: number[] = [];
      for (let r = x.r1 + 1; r <= toRow && r < tasks.length; r++) targetRows.push(r);
      if (targetRows.length === 0) { setFillTo(null); return; }

      pushUndo(targetRows.map((r) => tasks[r].id));
      const byTask = new Map<number, FieldPatch>();
      const merge = (id: number, p: FieldPatch | null) => { if (p) byTask.set(id, { ...(byTask.get(id) ?? {}), ...p }); };

      const cols: number[] = [];
      for (let c = x.c0; c <= x.c1; c++) cols.push(c);
      const hasDate = cols.some((c) => GRID_FIELDS[c].field === "start" || GRID_FIELDS[c].field === "due");

      if (hasDate) {
        const src = tasks[x.r0];
        const dur = src.start_date && src.due_date ? diffDays(src.start_date, src.due_date) : 0;
        let prevEnd: string | null = src.due_date ?? src.start_date ?? null;
        if (prevEnd) {
          for (const r of targetRows) {
            const ns = addDays(prevEnd, 1);
            const ne = addDays(ns, dur);
            merge(tasks[r].id, { start_date: ns, due_date: ne });
            prevEnd = ne;
          }
        }
      }
      cols.forEach((c) => {
        const field = GRID_FIELDS[c].field;
        if (field === "start" || field === "due") return;
        const srcRaw = readField(tasks[x.r0], field);
        targetRows.forEach((r) => merge(tasks[r].id, patchFor(field, srcRaw, tasks[r])));
      });

      setFillTo(null);
      setSel({ a: { r: x.r0, c: x.c0 }, f: { r: toRow, c: x.c1 } });
      await applyPatches(Array.from(byTask, ([taskId, patch]) => ({ taskId, patch })));
    }

    function doCopy() {
      const x = selRect(); if (!x) return;
      const grid: string[][] = [];
      for (let r = x.r0; r <= x.r1; r++) {
        const line: string[] = [];
        for (let c = x.c0; c <= x.c1; c++) line.push(displayField(tasks[r], GRID_FIELDS[c].field, respName));
        grid.push(line);
      }
      clipRef.current = grid;
      navigator.clipboard?.writeText(grid.map((l) => l.join("\t")).join("\n")).catch(() => {});
    }

    async function doPasteBlock(grid: string[][]) {
      if (!sel) return;
      const startR = sel.a.r, startC = sel.a.c;
      const ids: number[] = [];
      const byTask = new Map<number, FieldPatch>();
      grid.forEach((line, i) => {
        const r = startR + i; if (r >= tasks.length) return;
        line.forEach((val, j) => {
          const c = startC + j; if (c >= GC_COUNT) return;
          const field = GRID_FIELDS[c].field;
          const raw = field === "responsible"
            ? (activeResponsibles.find((rr) => rr.full_name.toLowerCase() === val.trim().toLowerCase())?.id?.toString() ?? "")
            : (field === "start" || field === "due") ? (toIso(val) ?? "")
            : (field === "taskStatus") ? (STATUS_OPTIONS.find((o) => o.label.toLowerCase() === val.trim().toLowerCase())?.value ?? "")
            : val;
          const p = patchFor(field, raw, tasks[r]);
          if (p) { byTask.set(tasks[r].id, { ...(byTask.get(tasks[r].id) ?? {}), ...p }); ids.push(tasks[r].id); }
        });
      });
      if (ids.length === 0) return;
      pushUndo(ids);
      await applyPatches(Array.from(byTask, ([taskId, patch]) => ({ taskId, patch })));
    }

    async function doUndo() {
      const group = undoRef.current.pop();
      if (group) await applyPatches(group);
    }

    async function clearCells() {
      const x = selRect(); if (!x) return;
      const ids: number[] = [];
      const byTask = new Map<number, FieldPatch>();
      for (let r = x.r0; r <= x.r1; r++) {
        for (let c = x.c0; c <= x.c1; c++) {
          const field = GRID_FIELDS[c].field;
          const p: FieldPatch | null =
            field === "responsible" ? { responsible_id: null }
            : field === "start" ? { start_date: null }
            : field === "due" ? { due_date: null }
            : field === "progress" ? { estimated_progress: 0 }
            : null;
          if (p) { byTask.set(tasks[r].id, { ...(byTask.get(tasks[r].id) ?? {}), ...p }); ids.push(tasks[r].id); }
        }
      }
      if (ids.length === 0) return;
      pushUndo(ids);
      await applyPatches(Array.from(byTask, ([taskId, patch]) => ({ taskId, patch })));
    }

    function gridKeyDown(e: React.KeyboardEvent) {
      if (editing || !sel) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "c") { e.preventDefault(); doCopy(); return; }
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); doUndo(); return; }
      if (mod) return; // Ctrl+V lo intercepta el handler de paste
      const { r, c } = sel.a;
      if (["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        e.preventDefault();
        const dr = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
        const dc = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (e.shiftKey) setSel((s) => s ? { a: s.a, f: { r: Math.max(0, Math.min(tasks.length - 1, s.f.r + dr)), c: Math.max(0, Math.min(GC_COUNT - 1, s.f.c + dc)) } } : s);
        else { const nr = Math.max(0, Math.min(tasks.length - 1, r + dr)), nc = Math.max(0, Math.min(GC_COUNT - 1, c + dc)); setSel({ a: { r: nr, c: nc }, f: { r: nr, c: nc } }); }
        return;
      }
      if (e.key === "Enter") { e.preventDefault(); beginEdit(r, c); return; }
      if (e.key === "Backspace" || e.key === "Delete") { e.preventDefault(); clearCells(); return; }
      if (e.key.length === 1 && !e.altKey) { e.preventDefault(); beginEdit(r, c, e.key); }
    }

    // Finalizar drag de selección / relleno al soltar el mouse en cualquier lado.
    // El target del relleno y la extensión del rango se siguen por elementFromPoint
    // (más robusto que enter/leave celda a celda, sobre todo al arrastrar rápido).
    const doFillRef = useRef<() => void>(() => {});
    doFillRef.current = () => { if (fillTo !== null) doFill(fillTo); else setFillTo(null); };
    const tasksRef = useRef(tasks);
    tasksRef.current = tasks;
    useEffect(() => {
      function rowIdxAt(x: number, y: number): number {
        const el = document.elementFromPoint(x, y) as HTMLElement | null;
        const rowEl = el?.closest?.("[data-task-row]");
        if (!rowEl) return -1;
        const id = Number(rowEl.getAttribute("data-task-row"));
        return tasksRef.current.findIndex((t) => t.id === id);
      }
      function onMove(e: MouseEvent) {
        if (fillDragRef.current) {
          const idx = rowIdxAt(e.clientX, e.clientY);
          if (idx >= 0) setFillTo(idx);
        } else if (selDragRef.current) {
          const cellEl = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest?.("[data-gc]");
          if (cellEl) {
            const idx = rowIdxAt(e.clientX, e.clientY);
            const gc = Number(cellEl.getAttribute("data-gc"));
            if (idx >= 0 && gc >= 0) setSel((s) => s ? { a: s.a, f: { r: idx, c: gc } } : s);
          }
        }
      }
      function onUp() {
        if (fillDragRef.current) { fillDragRef.current = false; doFillRef.current(); }
        selDragRef.current = false;
      }
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    }, []);

    // Pegar bloque interno (Ctrl+C dentro de la grilla → Ctrl+V en celdas).
    // El pegar-desde-Excel que crea filas nuevas sigue intacto (clipRef vacío).
    const handleCellPasteRef = useRef<() => boolean>(() => false);
    handleCellPasteRef.current = () => {
      if (editing || !sel || !clipRef.current) return false;
      doPasteBlock(clipRef.current);
      return true;
    };

    function cellSel(rowIdx: number, gc: number, base: React.CSSProperties): React.CSSProperties {
      const editingRow = editing?.taskId === tasks[rowIdx]?.id;
      if (editingRow) return { ...base, position: "relative" };
      const anchor = isSelAnchor(rowIdx, gc);
      const on = inSel(rowIdx, gc);
      const prev = inFillPreview(rowIdx, gc);
      return {
        ...base,
        position: "relative",
        cursor: "cell",
        background: anchor ? "#E3EEFD" : on ? SEL_BG : prev ? "#EAF6EE" : base.background,
        boxShadow: anchor ? "inset 0 0 0 2px #1A73E8" : on ? "inset 0 0 0 1px rgba(26,115,232,0.4)" : base.boxShadow,
      };
    }
    function cellHandlers(rowIdx: number, gc: number) {
      return {
        "data-gc": gc,
        onMouseDown: (e: React.MouseEvent) => {
          if (editing) {
            // clickear otra celda mientras editás: confirmar y seleccionar la nueva (como Excel)
            if (editing.taskId !== null) saveEdit(editing); else cancelEdit();
            setSel({ a: { r: rowIdx, c: gc }, f: { r: rowIdx, c: gc } });
            focusGrid();
            return;
          }
          selDragRef.current = true;
          selectCell(rowIdx, gc, e.shiftKey);
        },
        onDoubleClick: () => beginEdit(rowIdx, gc),
      };
    }
    function fillHandle(rowIdx: number, gc: number) {
      const x = selRect(); if (!x || editing) return null;
      if (rowIdx !== x.r1 || gc !== x.c1) return null;
      return (
        <div
          data-fill-handle
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); fillDragRef.current = true; setFillTo(x.r1); }}
          title="Arrastrá para rellenar hacia abajo"
          style={{ position: "absolute", right: -3, bottom: -3, width: 8, height: 8, background: "#1A73E8", border: "1.5px solid #fff", borderRadius: 2, cursor: "crosshair", zIndex: 6 }}
        />
      );
    }

    // ─── render ──────────────────────────────────────────────────────────────

    return (
      <div
        ref={containerRef}
        tabIndex={-1}
        onKeyDown={gridKeyDown}
        style={{
          background: "#fff",
          border: "1px solid #D5D9D5",
          borderRadius: 14,
          // Scrollport propio: el header sticky ahora sí se pega al scrollear
          maxHeight: "calc(100vh - 210px)",
          overflow: "auto",
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
                  onMouseDown={e => startColResize(e, i)}
                  title="Arrastrá para ajustar el ancho"
                  style={{
                    position: "absolute", right: -4, top: 0, bottom: 0, width: 8,
                    cursor: "col-resize", zIndex: 2,
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
                style={cellSel(idx, 0, activeCellStyle(task.id, "title", 1, {
                  paddingLeft: 10 + level * 16,
                  position: "relative",
                }))}
                {...cellHandlers(idx, 0)}
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
                {fillHandle(idx, 0)}
              </div>

              {/* Responsable — combobox con búsqueda, abre con un click */}
              <div style={cellSel(idx, 1, {
                ...cellStyle(2), position: "relative",
                boxShadow: isActiveCell(task.id, "responsible") ? ACTIVE_CELL_SHADOW : "none",
                background: isActiveCell(task.id, "responsible") ? "#EBF3FE" : undefined,
                cursor: "pointer",
              })}
                {...cellHandlers(idx, 1)}
                onClick={() => beginEdit(idx, 1)}
              >
                {isEditing && editing!.taskId === task.id ? (
                  <ResponsableCombobox
                    currentId={editing!.responsibleId}
                    options={activeResponsibles}
                    autoFocus={editing!.activeField === "responsible"}
                    onSelect={(id) => {
                      // Auto-guardar al elegir del dropdown
                      const updated = editing ? { ...editing, responsibleId: id } : null;
                      if (updated) { setEditing(updated); saveEdit(updated); }
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
                {fillHandle(idx, 1)}
              </div>

              {/* Inicio */}
              <div style={cellSel(idx, 2, activeCellStyle(task.id, "start", 3))} {...cellHandlers(idx, 2)}>
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
                {fillHandle(idx, 2)}
              </div>

              {/* Duración */}
              <div style={cellSel(idx, 3, activeCellStyle(task.id, "duration", 4))} {...cellHandlers(idx, 3)}>
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
                {fillHandle(idx, 3)}
              </div>

              {/* Fin */}
              <div style={cellSel(idx, 4, activeCellStyle(task.id, "due", 5))} {...cellHandlers(idx, 4)}>
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
                {fillHandle(idx, 4)}
              </div>

              {/* % Avance — per-cell editable */}
              <div
                style={cellSel(idx, 5, activeCellStyle(task.id, "progress", 6, { gap: 6 }))}
                {...cellHandlers(idx, 5)}
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
                  <span style={{ fontSize: 12, color: "#6B7580" }}>◆ Hito</span>
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
                {fillHandle(idx, 5)}
              </div>

              {/* Estado — per-cell editable */}
              <div
                style={cellSel(idx, 6, activeCellStyle(task.id, "taskStatus", 7))}
                {...cellHandlers(idx, 6)}
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
                {fillHandle(idx, 6)}
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
                <span style={{ fontSize: 11.5, color: "#6B7580" }}>— Revisá antes de confirmar</span>
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
            style={{ width: "100%", padding: "9px 12px", background: "transparent", border: "none", display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: "#6B7580", cursor: "pointer", textAlign: "left", transition: "background 0.1s, color 0.1s" }}
            onMouseEnter={e => { e.currentTarget.style.background = "#F8F9F8"; e.currentTarget.style.color = "#FF6B35"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#8E97A0"; }}
          >
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
            Agregar fila
            <span style={{ marginLeft: "auto", fontSize: 11, color: "#6B7580", fontWeight: 500 }}>
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
