import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createTask, updateTask } from "../api/tasks";
import type { Responsible, Task, TaskStatus } from "../types";
import { parseClipboardRows, type ParsedRow } from "../utils/clipboardParser";

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<TaskStatus, { label: string; bg: string; color: string; dot: string }> = {
  pendiente:   { label: "Pendiente",   bg: "#F0F1EF", color: "#5B6770", dot: "#8E97A0" },
  en_progreso: { label: "En progreso", bg: "#E4F3EC", color: "#136E47", dot: "#1F8A5B" },
  bloqueada:   { label: "Bloqueada",   bg: "#FCE5E5", color: "#A82B2B", dot: "#D03A3A" },
  completada:  { label: "Completada",  bg: "#E4F3EC", color: "#136E47", dot: "#1F8A5B" },
  cancelada:   { label: "Cancelada",   bg: "#F0F1EF", color: "#5B6770", dot: "#8E97A0" },
};

const COLS = ["#", "Título", "Responsable", "Inicio", "Vencimiento", "Estado"] as const;
const COL_WIDTHS = ["40px", "1fr", "180px", "140px", "140px", "130px"];

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface EditState {
  taskId: number | null; // null = new row
  title: string;
  responsibleId: string;
  startDate: string;
  dueDate: string;
  saving: boolean;
  error: string | null;
}

interface Props {
  tasks: Task[];
  responsibles: Responsible[];
  obraId: number;
  onTaskSaved: (task: Task) => void;
  onTaskDeleted?: (taskId: number) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TaskSheetView({ tasks, responsibles, obraId, onTaskSaved }: Props) {
  const activeResponsibles = responsibles.filter((r) => r.is_active);

  const blankEdit = (): EditState => ({
    taskId: null,
    title: "",
    responsibleId: "",
    startDate: "",
    dueDate: "",
    saving: false,
    error: null,
  });

  const [editing, setEditing] = useState<EditState | null>(null);
  const [showNewRow, setShowNewRow] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Clipboard paste state ──────────────────────────────────────────────────
  const [pastePreview, setPastePreview] = useState<ParsedRow[] | null>(null);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  // Focus title when a row enters edit mode
  useEffect(() => {
    if (editing !== null) {
      setTimeout(() => titleInputRef.current?.focus(), 30);
    }
  }, [editing?.taskId]);

  // Intercept paste on the container (only when no input inside has focus)
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const active = document.activeElement;
      // If focus is inside a form element, let the native paste work
      if (active && (active.tagName === "INPUT" || active.tagName === "SELECT" || active.tagName === "TEXTAREA")) return;
      // Only intercept if the event originates within our container
      if (!containerRef.current?.contains(active) && active !== containerRef.current) return;

      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (!text.trim()) return;

      const { rows } = parseClipboardRows(text);
      if (rows.length === 0) return;

      e.preventDefault();
      setPastePreview(rows);
      setBulkError(null);
    }

    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  // ── helpers ────────────────────────────────────────────────────────────────

  function startEdit(task: Task) {
    if (editing?.taskId === task.id) return;
    setShowNewRow(false);
    setEditing({
      taskId: task.id,
      title: task.title,
      responsibleId: task.responsible_id ? String(task.responsible_id) : "",
      startDate: task.start_date ?? "",
      dueDate: task.due_date ?? "",
      saving: false,
      error: null,
    });
  }

  function startNewRow() {
    setEditing(null);
    setShowNewRow(true);
    setEditing({ ...blankEdit(), taskId: null });
    setTimeout(() => titleInputRef.current?.focus(), 30);
  }

  function cancelEdit() {
    setEditing(null);
    setShowNewRow(false);
  }

  // ── Bulk create from paste preview ────────────────────────────────────────

  const confirmPaste = useCallback(async () => {
    if (!pastePreview || pastePreview.length === 0) return;
    setBulkSaving(true);
    setBulkError(null);
    try {
      for (const row of pastePreview) {
        const saved = await createTask({
          obra_id: obraId,
          title: row.title,
          responsible_id: null, // name matching happens in a future phase
          start_date: row.startDate,
          due_date: row.dueDate,
        });
        onTaskSaved(saved);
      }
      setPastePreview(null);
    } catch {
      setBulkError("No se pudieron crear algunas tareas. Revisá la conexión e intentá de nuevo.");
    } finally {
      setBulkSaving(false);
    }
  }, [pastePreview, obraId, onTaskSaved]);

  const saveEdit = useCallback(
    async (state: EditState, andNewRow = false) => {
      if (!state.title.trim()) {
        setEditing((e) => e ? { ...e, error: "El título es obligatorio." } : e);
        return;
      }
      if (state.dueDate && state.startDate && state.dueDate < state.startDate) {
        setEditing((e) => e ? { ...e, error: "La fecha de vencimiento debe ser posterior al inicio." } : e);
        return;
      }

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
          });
        }
        onTaskSaved(saved);
        if (andNewRow) {
          setEditing({ ...blankEdit(), taskId: null });
          setShowNewRow(true);
          setTimeout(() => titleInputRef.current?.focus(), 30);
        } else {
          setEditing(null);
          setShowNewRow(false);
        }
      } catch {
        setEditing((e) => e ? { ...e, saving: false, error: "No se pudo guardar la tarea." } : e);
      }
    },
    [obraId, onTaskSaved]
  );

  // ── keyboard navigation ────────────────────────────────────────────────────

  function handleKeyDown(e: KeyboardEvent, field: "title" | "responsible" | "start" | "due") {
    if (!editing) return;

    if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      saveEdit(editing, true);
      return;
    }

    if (e.key === "Tab") {
      e.preventDefault();
      const fields = ["title", "responsible", "start", "due"] as const;
      const idx = fields.indexOf(field);
      const next = fields[idx + 1];
      if (next) {
        const el = document.querySelector<HTMLElement>(`[data-sheet-field="${next}"]`);
        el?.focus();
      } else {
        // Tab past last field → save and new row
        saveEdit(editing, true);
      }
    }
  }

  // ─── cell styles ──────────────────────────────────────────────────────────

  const cellStyle: React.CSSProperties = {
    padding: "0 14px",
    height: 44,
    display: "flex",
    alignItems: "center",
    fontSize: 13,
    color: "#1A2329",
    borderBottom: "1px solid #F0F1EF",
    overflow: "hidden",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    border: "none",
    outline: "none",
    background: "transparent",
    fontSize: 13,
    color: "#1A2329",
    fontFamily: "'Plus Jakarta Sans', sans-serif",
  };

  const selectStyle: React.CSSProperties = {
    ...inputStyle,
    appearance: "none",
    cursor: "pointer",
  };

  const rowBase: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: COL_WIDTHS.join(" "),
    transition: "background 0.1s",
  };

  // ─── render ───────────────────────────────────────────────────────────────

  const isEditingRow = (id: number) => editing?.taskId === id;
  const isNewRow = editing?.taskId === null && showNewRow;

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      style={{
        background: "#fff",
        border: "1px solid #E6E7E5",
        borderRadius: 14,
        overflow: "hidden",
        fontFamily: "'Plus Jakarta Sans', sans-serif",
        outline: "none",
      }}
    >

      {/* ── Header row ── */}
      <div style={{
        ...rowBase,
        background: "#F8F9F8",
        borderBottom: "1px solid #E6E7E5",
      }}>
        {COLS.map((col) => (
          <div key={col} style={{
            padding: "0 14px", height: 36,
            display: "flex", alignItems: "center",
            fontSize: 10.5, fontWeight: 700,
            color: "#8E97A0",
            textTransform: "uppercase",
            letterSpacing: "0.07em",
          }}>
            {col}
          </div>
        ))}
      </div>

      {/* ── Task rows ── */}
      {tasks.map((task, idx) => {
        const st = STATUS_STYLE[task.status];
        const responsible = responsibles.find((r) => r.id === task.responsible_id);
        const isEditing = isEditingRow(task.id);
        const isOverdue = !!task.due_date && task.due_date < new Date().toISOString().slice(0, 10) && task.status !== "completada" && task.status !== "cancelada";

        return (
          <div
            key={task.id}
            style={{
              ...rowBase,
              background: isEditing ? "#FFFBF8" : idx % 2 === 0 ? "#fff" : "#FAFAFA",
              cursor: isEditing ? "default" : "pointer",
              outline: isEditing ? "2px solid #FF6B35" : "none",
              outlineOffset: -2,
            }}
            onClick={() => !isEditing && startEdit(task)}
          >
            {/* Nº */}
            <div style={{ ...cellStyle, color: "#8E97A0", fontSize: 11.5, fontWeight: 600, justifyContent: "center" }}>
              {idx + 1}
            </div>

            {/* Título */}
            <div style={cellStyle}>
              {isEditing ? (
                <input
                  ref={titleInputRef}
                  data-sheet-field="title"
                  value={editing.title}
                  onChange={(e) => setEditing((s) => s ? { ...s, title: e.target.value, error: null } : s)}
                  onKeyDown={(e) => handleKeyDown(e, "title")}
                  onBlur={() => { /* save handled by explicit actions */ }}
                  style={{ ...inputStyle, fontWeight: 600 }}
                  placeholder="Título de la tarea"
                />
              ) : (
                <span style={{
                  fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  textDecoration: task.status === "completada" ? "line-through" : "none",
                  color: task.status === "cancelada" ? "#8E97A0" : "#1A2329",
                }}>
                  {task.title}
                </span>
              )}
            </div>

            {/* Responsable */}
            <div style={cellStyle}>
              {isEditing ? (
                <select
                  data-sheet-field="responsible"
                  value={editing.responsibleId}
                  onChange={(e) => setEditing((s) => s ? { ...s, responsibleId: e.target.value } : s)}
                  onKeyDown={(e) => handleKeyDown(e, "responsible")}
                  style={selectStyle}
                >
                  <option value="">Sin responsable</option>
                  {activeResponsibles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.full_name}{r.role ? ` · ${r.role}` : ""}
                    </option>
                  ))}
                </select>
              ) : (
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: responsible ? "#1A2329" : "#8E97A0" }}>
                  {responsible?.full_name ?? "Sin asignar"}
                </span>
              )}
            </div>

            {/* Inicio */}
            <div style={cellStyle}>
              {isEditing ? (
                <input
                  type="date"
                  data-sheet-field="start"
                  value={editing.startDate}
                  onChange={(e) => setEditing((s) => s ? { ...s, startDate: e.target.value } : s)}
                  onKeyDown={(e) => handleKeyDown(e, "start")}
                  style={inputStyle}
                />
              ) : (
                <span style={{ color: task.start_date ? "#1A2329" : "#C4C9C6" }}>
                  {fmtDate(task.start_date)}
                </span>
              )}
            </div>

            {/* Vencimiento */}
            <div style={cellStyle}>
              {isEditing ? (
                <input
                  type="date"
                  data-sheet-field="due"
                  value={editing.dueDate}
                  onChange={(e) => setEditing((s) => s ? { ...s, dueDate: e.target.value } : s)}
                  onKeyDown={(e) => handleKeyDown(e, "due")}
                  style={inputStyle}
                />
              ) : (
                <span style={{
                  color: isOverdue ? "#D03A3A" : task.due_date ? "#1A2329" : "#C4C9C6",
                  fontWeight: isOverdue ? 600 : 400,
                }}>
                  {fmtDate(task.due_date)}
                  {isOverdue && " ▲"}
                </span>
              )}
            </div>

            {/* Estado */}
            <div style={{ ...cellStyle }}>
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                padding: "3px 9px", borderRadius: 99,
                fontSize: 11.5, fontWeight: 600,
                background: st.bg, color: st.color,
              }}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: st.dot, flexShrink: 0 }} />
                {st.label}
              </span>
            </div>
          </div>
        );
      })}

      {/* ── Error / save bar for existing task edit ── */}
      {editing && editing.taskId !== null && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 14px",
          background: "#FFFBF8",
          borderBottom: "1px solid #FFE0C8",
          fontSize: 12,
        }}>
          <span style={{ color: editing.error ? "#D03A3A" : "#8E97A0" }}>
            {editing.error ?? "Tab para moverse entre campos · Enter para guardar y nueva fila · Esc para cancelar"}
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={cancelEdit}
              style={{
                padding: "4px 12px", borderRadius: 7, border: "1px solid #E6E7E5",
                fontSize: 12, fontWeight: 600, color: "#5B6770",
                background: "#fff", cursor: "pointer",
              }}
            >
              Cancelar
            </button>
            <button
              onClick={() => saveEdit(editing)}
              disabled={editing.saving}
              style={{
                padding: "4px 12px", borderRadius: 7, border: "none",
                fontSize: 12, fontWeight: 600, color: "#fff",
                background: editing.saving ? "#FFAA80" : "#FF6B35",
                cursor: editing.saving ? "not-allowed" : "pointer",
              }}
            >
              {editing.saving ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </div>
      )}

      {/* ── New row ── */}
      {isNewRow && (
        <>
          <div style={{
            ...rowBase,
            background: "#FFFBF8",
            outline: "2px solid #FF6B35",
            outlineOffset: -2,
          }}>
            {/* Nº */}
            <div style={{ ...cellStyle, color: "#8E97A0", fontSize: 11.5, fontWeight: 600, justifyContent: "center" }}>
              {tasks.length + 1}
            </div>

            {/* Título */}
            <div style={cellStyle}>
              <input
                ref={titleInputRef}
                data-sheet-field="title"
                value={editing?.title ?? ""}
                onChange={(e) => setEditing((s) => s ? { ...s, title: e.target.value, error: null } : s)}
                onKeyDown={(e) => editing && handleKeyDown(e, "title")}
                style={{ ...inputStyle, fontWeight: 600 }}
                placeholder="Nuevo título…"
              />
            </div>

            {/* Responsable */}
            <div style={cellStyle}>
              <select
                data-sheet-field="responsible"
                value={editing?.responsibleId ?? ""}
                onChange={(e) => setEditing((s) => s ? { ...s, responsibleId: e.target.value } : s)}
                onKeyDown={(e) => editing && handleKeyDown(e, "responsible")}
                style={selectStyle}
              >
                <option value="">Sin responsable</option>
                {activeResponsibles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.full_name}{r.role ? ` · ${r.role}` : ""}
                  </option>
                ))}
              </select>
            </div>

            {/* Inicio */}
            <div style={cellStyle}>
              <input
                type="date"
                data-sheet-field="start"
                value={editing?.startDate ?? ""}
                onChange={(e) => setEditing((s) => s ? { ...s, startDate: e.target.value } : s)}
                onKeyDown={(e) => editing && handleKeyDown(e, "start")}
                style={inputStyle}
              />
            </div>

            {/* Vencimiento */}
            <div style={cellStyle}>
              <input
                type="date"
                data-sheet-field="due"
                value={editing?.dueDate ?? ""}
                onChange={(e) => setEditing((s) => s ? { ...s, dueDate: e.target.value } : s)}
                onKeyDown={(e) => editing && handleKeyDown(e, "due")}
                style={inputStyle}
              />
            </div>

            {/* Estado */}
            <div style={cellStyle}>
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                padding: "3px 9px", borderRadius: 99,
                fontSize: 11.5, fontWeight: 600,
                background: "#F0F1EF", color: "#5B6770",
              }}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#8E97A0", flexShrink: 0 }} />
                Pendiente
              </span>
            </div>
          </div>

          {/* Action bar for new row */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "8px 14px",
            background: "#FFFBF8",
            borderBottom: "1px solid #FFE0C8",
            fontSize: 12,
          }}>
            <span style={{ color: editing?.error ? "#D03A3A" : "#8E97A0" }}>
              {editing?.error ?? "Tab para moverse · Enter para guardar y agregar otra · Esc para cancelar"}
            </span>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={cancelEdit}
                style={{
                  padding: "4px 12px", borderRadius: 7, border: "1px solid #E6E7E5",
                  fontSize: 12, fontWeight: 600, color: "#5B6770",
                  background: "#fff", cursor: "pointer",
                }}
              >
                Cancelar
              </button>
              <button
                onClick={() => editing && saveEdit(editing)}
                disabled={editing?.saving}
                style={{
                  padding: "4px 12px", borderRadius: 7, border: "none",
                  fontSize: 12, fontWeight: 600, color: "#fff",
                  background: editing?.saving ? "#FFAA80" : "#FF6B35",
                  cursor: editing?.saving ? "not-allowed" : "pointer",
                }}
              >
                {editing?.saving ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Paste preview banner ── */}
      {pastePreview && (
        <div style={{ borderTop: "2px solid #FF6B35" }}>
          {/* Banner header */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "10px 14px",
            background: "#FFF6F1",
            borderBottom: "1px solid #FFE0C8",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                <rect x="3" y="1" width="10" height="14" rx="1.5" stroke="#FF6B35" strokeWidth="1.4" fill="none"/>
                <path d="M6 1v2h4V1" stroke="#FF6B35" strokeWidth="1.4" strokeLinejoin="round"/>
                <path d="M5.5 7h5M5.5 10h3" stroke="#FF6B35" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#1A2329" }}>
                {pastePreview.length} {pastePreview.length === 1 ? "tarea detectada" : "tareas detectadas"} desde el portapapeles
              </span>
              <span style={{ fontSize: 11.5, color: "#8E97A0" }}>— Revisá antes de confirmar</span>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={() => { setPastePreview(null); setBulkError(null); }}
                style={{
                  padding: "5px 12px", borderRadius: 7, border: "1px solid #E6E7E5",
                  fontSize: 12, fontWeight: 600, color: "#5B6770",
                  background: "#fff", cursor: "pointer",
                }}
              >
                Cancelar
              </button>
              <button
                onClick={confirmPaste}
                disabled={bulkSaving}
                style={{
                  padding: "5px 14px", borderRadius: 7, border: "none",
                  fontSize: 12, fontWeight: 600, color: "#fff",
                  background: bulkSaving ? "#FFAA80" : "#FF6B35",
                  cursor: bulkSaving ? "not-allowed" : "pointer",
                  boxShadow: bulkSaving ? "none" : "0 3px 8px -2px rgba(255,107,53,0.45)",
                }}
              >
                {bulkSaving ? "Importando…" : `Importar ${pastePreview.length} ${pastePreview.length === 1 ? "tarea" : "tareas"}`}
              </button>
            </div>
          </div>

          {bulkError && (
            <div style={{ padding: "6px 14px", background: "#FCE5E5", fontSize: 12, color: "#D03A3A", fontWeight: 600 }}>
              {bulkError}
            </div>
          )}

          {/* Preview rows */}
          {pastePreview.map((row, i) => (
            <div key={i} style={{
              display: "grid",
              gridTemplateColumns: COL_WIDTHS.join(" "),
              background: i % 2 === 0 ? "#FFFBF8" : "#FFF6F1",
              opacity: bulkSaving ? 0.5 : 1,
            }}>
              <div style={{ ...{ padding: "0 14px", height: 40, display: "flex", alignItems: "center", fontSize: 11.5, fontWeight: 600, color: "#8E97A0", justifyContent: "center", borderBottom: "1px solid #FFE8D8" } }}>
                {tasks.length + i + 1}
              </div>
              <div style={{ padding: "0 14px", height: 40, display: "flex", alignItems: "center", fontSize: 13, fontWeight: 600, color: "#1A2329", borderBottom: "1px solid #FFE8D8", overflow: "hidden" }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.title}</span>
              </div>
              <div style={{ padding: "0 14px", height: 40, display: "flex", alignItems: "center", fontSize: 12.5, color: row.responsibleName ? "#1A2329" : "#C4C9C6", borderBottom: "1px solid #FFE8D8" }}>
                {row.responsibleName ?? "Sin asignar"}
              </div>
              <div style={{ padding: "0 14px", height: 40, display: "flex", alignItems: "center", fontSize: 12.5, color: row.startDate ? "#1A2329" : "#C4C9C6", borderBottom: "1px solid #FFE8D8" }}>
                {row.startDate ? fmtDate(row.startDate) : "—"}
              </div>
              <div style={{ padding: "0 14px", height: 40, display: "flex", alignItems: "center", fontSize: 12.5, color: row.dueDate ? "#1A2329" : "#C4C9C6", borderBottom: "1px solid #FFE8D8" }}>
                {row.dueDate ? fmtDate(row.dueDate) : "—"}
              </div>
              <div style={{ padding: "0 14px", height: 40, display: "flex", alignItems: "center", borderBottom: "1px solid #FFE8D8" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 99, fontSize: 11.5, fontWeight: 600, background: "#F0F1EF", color: "#5B6770" }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#8E97A0", flexShrink: 0 }} />
                  Pendiente
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Add row button ── */}
      {!isNewRow && (
        <button
          onClick={startNewRow}
          style={{
            width: "100%", padding: "10px 14px",
            background: "transparent", border: "none",
            display: "flex", alignItems: "center", gap: 6,
            fontSize: 12.5, fontWeight: 600, color: "#8E97A0",
            cursor: "pointer", textAlign: "left",
            transition: "background 0.1s, color 0.1s",
          }}
          onMouseEnter={e => { e.currentTarget.style.background = "#F8F9F8"; e.currentTarget.style.color = "#FF6B35"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#8E97A0"; }}
        >
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
            <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
          Agregar fila
        </button>
      )}
    </div>
  );
}
