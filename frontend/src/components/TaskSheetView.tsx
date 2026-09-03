/**
 * TaskSheetView — planilla de tareas estilo Excel, sobre react-datasheet-grid.
 *
 * La librería aporta selección de rango, fill-handle (arrastrar la esquina),
 * copiar/pegar contra Excel/Sheets, navegación por teclado y virtualización.
 * Lo propio de CONSTRUCTA va en celdas a medida: calendario, responsable,
 * estado, duración derivada, predecesoras estilo MS Project y materiales.
 */
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  DataSheetGrid,
  type DataSheetGridRef,
  keyColumn,
  intColumn,
  createContextMenuComponent,
  type CellProps,
  type Column,
  type ContextMenuItem,
  type ContextMenuComponentProps,
} from "react-datasheet-grid";
import "react-datasheet-grid/dist/style.css";
import { AlertOctagon, CheckCircle2, Clock, RefreshCw, XCircle } from "lucide-react";
import type { DependencyLink, DependencyType, MaterialStatus, Responsible, Task, TaskMaterial, TaskStatus } from "../types";
import { createTask, deleteTask, reorderTasks, updateTask, updateTaskStatus, type TaskUpdatePayload } from "../api/tasks";
import { createMaterial, deleteMaterial, fetchMaterials, updateMaterial } from "../api/taskMaterials";

/** La librería no re-exporta estos tipos desde la raíz del paquete. */
type CellWithId = { colId?: string; col: number; row: number };
type SelectionWithId = { min: CellWithId; max: CellWithId };

type Operation = {
  type: "UPDATE" | "DELETE" | "CREATE";
  fromRowIndex: number;
  toRowIndex: number;
};

const FONT = "'Plus Jakarta Sans', sans-serif";

/** El menú de click derecho viene en inglés; lo traducimos. */
const ContextMenuBase = createContextMenuComponent((item: ContextMenuItem) => {
  switch (item.type) {
    case "COPY":               return <>Copiar</>;
    case "CUT":                return <>Cortar</>;
    case "PASTE":              return <>Pegar</>;
    case "INSERT_ROW_BELLOW":  return <>Insertar fila debajo</>;
    case "DUPLICATE_ROW":      return <>Duplicar fila</>;
    case "DELETE_ROW":         return <>Eliminar fila</>;
    case "DUPLICATE_ROWS":     return <>Duplicar filas {item.fromRow} a {item.toRow}</>;
    case "DELETE_ROWS":        return <>Eliminar filas {item.fromRow} a {item.toRow}</>;
    default:                   return <>{(item as { type: string }).type}</>;
  }
});
// Envoltorio: el FC de la librería devuelve ReactNode y el prop espera
// ReactElement — los tipos de React 19 son más estrictos.
const ContextMenu = (props: ContextMenuComponentProps) => <ContextMenuBase {...props} />;
const UNDO_LIMIT = 50;

const STATUS_STYLE: Record<TaskStatus, { label: string; bg: string; color: string; Icon: React.ComponentType<{ style?: React.CSSProperties }> }> = {
  pendiente:   { label: "Pendiente",   bg: "#EBF3FF", color: "#2A62C9", Icon: Clock },
  en_progreso: { label: "En progreso", bg: "#FFFBEB", color: "#B45309", Icon: RefreshCw },
  bloqueada:   { label: "Bloqueada",   bg: "#FCE5E5", color: "#A82B2B", Icon: AlertOctagon },
  completada:  { label: "Completada",  bg: "#E4F3EC", color: "#136E47", Icon: CheckCircle2 },
  cancelada:   { label: "Cancelada",   bg: "#F4F5F4", color: "#5B6770", Icon: XCircle },
};
const STATUS_VALUES = Object.keys(STATUS_STYLE) as TaskStatus[];

// ─── helpers de fecha (mismos que la planilla actual) ────────────────────────

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

/** "15/06/2026" o "2026-06-15" → "2026-06-15". null si no parsea. */
function toIsoDate(raw: unknown): string | null {
  const t = String(raw ?? "").trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const yy = y.length === 2 ? "20" + y : y;
  return `${yy}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function durationOf(start: string | null, due: string | null): number | null {
  if (!start || !due) return null;
  const d = diffDays(start, due) + 1;
  return d > 0 ? d : null;
}

function buildLevelMap(tasks: Task[]): Map<number, number> {
  const parentOf = new Map(tasks.map((t) => [t.id, t.parent_task_id]));
  const memo = new Map<number, number>();
  function level(id: number): number {
    if (memo.has(id)) return memo.get(id)!;
    const pid = parentOf.get(id);
    const result = pid ? 1 + level(pid) : 0;
    memo.set(id, result);
    return result;
  }
  tasks.forEach((t) => level(t.id));
  return memo;
}

// ─── fila de la grilla ───────────────────────────────────────────────────────

interface Row {
  id: number | null;          // null = fila nueva todavía no persistida
  title: string;
  responsible_id: number | null;
  start_date: string | null;
  due_date: string | null;
  estimated_progress: number | null;
  status: TaskStatus;
  is_milestone: boolean;
  dependency_links: DependencyLink[];
  level: number;              // profundidad WBS, para indentar el título
  // Materiales: derivados del módulo de Compras, sólo lectura acá.
  materials_cost: number;
  materials_count: number;
  materials_pending: number;
  saving?: boolean;
  error?: string | null;
}

function taskToRow(t: Task, level: number): Row {
  return {
    id: t.id,
    title: t.title,
    responsible_id: t.responsible_id,
    start_date: t.start_date,
    due_date: t.due_date,
    estimated_progress: t.estimated_progress ?? 0,
    status: t.status,
    is_milestone: t.is_milestone,
    dependency_links: t.dependency_links ?? [],
    level,
    materials_cost: t.materials_cost ?? 0,
    materials_count: t.materials_count ?? 0,
    materials_pending: t.materials_pending ?? 0,
  };
}

const emptyRow = (): Row => ({
  id: null,
  title: "",
  responsible_id: null,
  start_date: null,
  due_date: null,
  estimated_progress: 0,
  status: "pendiente",
  is_milestone: false,
  dependency_links: [],
  level: 0,
  materials_cost: 0,
  materials_count: 0,
  materials_pending: 0,
});

const fmtMoney = (n: number) => "$" + Math.round(n).toLocaleString("es-AR");

/** Una fila "fantasma" es la de abajo de todo: sin persistir y sin ningún dato. */
function isGhost(r: Row): boolean {
  return r.id === null && !r.title.trim() && !r.responsible_id && !r.start_date && !r.due_date;
}

/** Filas vacías mínimas: la grilla se ve como una hoja, no como una lista corta. */
const MIN_ROWS = 14;

/**
 * Rellena con filas vacías al final, como una hoja de cálculo: siempre hay
 * dónde escribir sin apretar ningún botón, y una obra recién creada muestra
 * un lienzo en vez de un renglón solo. La librería no lo trae (`autoAddRow`
 * recién agrega DESPUÉS de editar la última fila).
 */
function withGhost(rows: Row[]): Row[] {
  const out = [...rows];
  while (out.length < MIN_ROWS || !isGhost(out[out.length - 1])) out.push(emptyRow());
  return out;
}

/**
 * Valor numérico de una celda para la barra de estado. Devuelve null en las
 * columnas que no son números (Excel también las ignora al sumar).
 */
function numericCell(row: Row, colId: string | undefined): number | null {
  switch (colId) {
    case "estimated_progress": return row.estimated_progress ?? 0;
    case "duration":           return durationOf(row.start_date, row.due_date);
    case "materials_cost":     return row.materials_count > 0 ? row.materials_cost : null;
    default:                   return null;
  }
}

// ─── celda: Título (indenta subtareas — la librería no trae árbol nativo) ────

const TitleCell = React.memo(({ rowData, setRowData, focus, active }: CellProps<Row, unknown>) => {
  const ref = useRef<HTMLInputElement>(null);
  // focus() + select(): sin el focus() el input nunca recibe el teclado y
  // escribir sobre la celda seleccionada no hace nada (así lo hace textColumn).
  React.useLayoutEffect(() => {
    if (focus) { ref.current?.focus(); ref.current?.select(); }
    else ref.current?.blur();
  }, [focus]);

  const indent = (rowData.level ?? 0) * 16;
  return (
    <div style={{ display: "flex", alignItems: "center", width: "100%", paddingLeft: 8 + indent, paddingRight: 8, gap: 6 }}>
      {rowData.level > 0 && (
        <span style={{ color: "#C4C9C6", fontSize: 11, flexShrink: 0 }}>└</span>
      )}
      <input
        ref={ref}
        value={rowData.title}
        onChange={(e) => setRowData({ ...rowData, title: e.target.value })}
        placeholder={active ? "Título de la tarea" : ""}
        style={{
          width: "100%", border: "none", outline: "none", background: "transparent",
          font: "inherit", fontFamily: FONT, fontSize: 13, fontWeight: 600, color: "#1A2329",
          pointerEvents: focus ? "auto" : "none",
        }}
      />
      {rowData.saving && <span style={{ fontSize: 10, color: "#9BA3AB", flexShrink: 0 }}>·</span>}
      {rowData.error && <span title={rowData.error} style={{ fontSize: 11, color: "#D03A3A", flexShrink: 0 }}>⚠</span>}
    </div>
  );
});

// ─── celda: Responsable ──────────────────────────────────────────────────────
// Select nativo a propósito: es accesible por teclado sin código propio y no
// reintroduce el combobox custom que hoy da problemas. Se puede cambiar luego
// por uno con búsqueda sin tocar el resto de la grilla.

interface RespData { options: Responsible[] }

const ResponsableCell = React.memo(({ rowData, setRowData, focus, columnData }: CellProps<Row, RespData>) => {
  const ref = useRef<HTMLSelectElement>(null);
  React.useLayoutEffect(() => {
    if (focus) ref.current?.focus();
    else ref.current?.blur();
  }, [focus]);

  const current = columnData.options.find((r) => r.id === rowData.responsible_id);
  return (
    <select
      ref={ref}
      value={rowData.responsible_id ?? ""}
      onChange={(e) => setRowData({ ...rowData, responsible_id: e.target.value ? Number(e.target.value) : null })}
      style={{
        width: "100%", height: "100%", padding: "0 8px",
        border: "none", outline: "none", background: "transparent",
        fontFamily: FONT, fontSize: 13,
        color: current ? "#1A2329" : "#9BA3AB",
        appearance: focus ? "auto" : "none",
        cursor: "pointer",
      }}
    >
      <option value="">Sin responsable</option>
      {columnData.options.map((r) => (
        <option key={r.id} value={r.id}>
          {r.full_name}{r.role ? ` · ${r.role}` : ""}
        </option>
      ))}
    </select>
  );
});

// ─── calendario propio ───────────────────────────────────────────────────────
// El picker nativo de <input type="date"> lo posiciona el browser y no se puede
// forzar hacia arriba, así que en las últimas filas quedaba cortado. Con uno
// propio decidimos nosotros: si no entra abajo, se abre hacia arriba.

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const WEEKDAYS = ["L", "M", "M", "J", "V", "S", "D"];

const POPUP_W = 250;
const POPUP_H = 290;

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Celdas del mes, alineadas a semana que arranca lunes. */
function monthCells(y: number, m: number): (string | null)[] {
  const startDow = (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7; // lunes = 0
  const total = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const cells: (string | null)[] = Array(startDow).fill(null);
  for (let d = 1; d <= total; d++) cells.push(iso(y, m, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function todayIso(): string {
  const n = new Date();
  return iso(n.getFullYear(), n.getMonth(), n.getDate());
}

interface PopupProps {
  anchor: DOMRect;
  value: string | null;
  onPick: (v: string | null) => void;
  onClose: () => void;
}

function DatePopup({ anchor, value, onPick, onClose }: PopupProps) {
  const base = value ?? todayIso();
  const [ym, setYm] = useState(() => ({ y: Number(base.slice(0, 4)), m: Number(base.slice(5, 7)) - 1 }));
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    // capture: nos enteramos antes de que la grilla procese el click.
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  // Abrir hacia arriba si abajo no entra (las últimas filas de la planilla).
  const roomBelow = window.innerHeight - anchor.bottom;
  const up = roomBelow < POPUP_H + 8 && anchor.top > POPUP_H + 8;
  const top = up ? anchor.top - POPUP_H - 4 : anchor.bottom + 4;
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - POPUP_W - 8));

  const cells = monthCells(ym.y, ym.m);
  const today = todayIso();
  const shift = (delta: number) => setYm(({ y, m }) => {
    const n = m + delta;
    return { y: y + Math.floor(n / 12), m: ((n % 12) + 12) % 12 };
  });

  const navBtn = (label: string, delta: number) => (
    <button
      type="button"
      onClick={() => shift(delta)}
      style={{
        width: 24, height: 24, borderRadius: 6, border: "1px solid #E6E7E5",
        background: "#fff", cursor: "pointer", color: "#5B6770", fontSize: 12, lineHeight: 1,
      }}
    >{label}</button>
  );

  return createPortal(
    <div
      ref={boxRef}
      style={{
        position: "fixed", top, left, width: POPUP_W,
        background: "#fff", border: "1px solid #E6E7E5", borderRadius: 10,
        boxShadow: "0 8px 28px -8px rgba(0,0,0,0.25)",
        padding: 10, zIndex: 99999, fontFamily: FONT,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        {navBtn("‹", -1)}
        <span style={{ fontSize: 12.5, fontWeight: 700, color: "#1A2329" }}>
          {MONTHS[ym.m]} {ym.y}
        </span>
        {navBtn("›", 1)}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
        {WEEKDAYS.map((d, i) => (
          <div key={i} style={{ textAlign: "center", fontSize: 10.5, fontWeight: 700, color: "#9BA3AB", padding: "2px 0" }}>
            {d}
          </div>
        ))}
        {cells.map((c, i) => {
          if (!c) return <div key={i} />;
          const isSel = c === value;
          const isToday = c === today;
          return (
            <button
              key={i}
              type="button"
              onClick={() => { onPick(c); onClose(); }}
              style={{
                height: 28, borderRadius: 6, cursor: "pointer", fontSize: 12,
                fontFamily: FONT,
                border: isToday && !isSel ? "1px solid #FFB08A" : "1px solid transparent",
                background: isSel ? "#FF6B35" : "transparent",
                color: isSel ? "#fff" : "#1A2329",
                fontWeight: isSel ? 700 : 500,
              }}
            >
              {Number(c.slice(8, 10))}
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 6, marginTop: 9, borderTop: "1px solid #F0F1EF", paddingTop: 8 }}>
        <button
          type="button"
          onClick={() => { onPick(today); onClose(); }}
          style={{ flex: 1, padding: "5px 0", borderRadius: 7, border: "1px solid #E6E7E5", background: "#fff", cursor: "pointer", fontSize: 11.5, fontWeight: 600, color: "#5B6770", fontFamily: FONT }}
        >Hoy</button>
        <button
          type="button"
          onClick={() => { onPick(null); onClose(); }}
          style={{ flex: 1, padding: "5px 0", borderRadius: 7, border: "1px solid #E6E7E5", background: "#fff", cursor: "pointer", fontSize: 11.5, fontWeight: 600, color: "#5B6770", fontFamily: FONT }}
        >Borrar</button>
      </div>
    </div>,
    document.body
  );
}

// ─── celda: Fecha ────────────────────────────────────────────────────────────

interface DateData {
  get: (r: Row) => string | null;
  set: (r: Row, v: string | null) => Row;
}

/** ISO → dd/mm/aaaa para mostrar y para tipear. */
function fmtDate(v: string | null): string {
  if (!v) return "";
  return `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}`;
}

const DateCell = React.memo(({ rowData, setRowData, focus, active, columnData }: CellProps<Row, DateData>) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const value = columnData.get(rowData);

  // Al elegir un día la celda se re-renderiza y el input recupera el foco, lo
  // que volvía a abrir el calendario recién cerrado. Ignoramos las reaperturas
  // inmediatamente posteriores a un cierre.
  const closedAt = useRef(0);
  const closePopup = () => { closedAt.current = Date.now(); setAnchor(null); };

  // Medimos al abrir (no antes): clickear una fila de abajo hace que la grilla
  // la scrollee a la vista, así que un rect tomado antes quedaría corrido.
  const openHere = () => {
    if (Date.now() - closedAt.current < 400) return;
    const r = wrapRef.current?.getBoundingClientRect();
    if (r) setAnchor(r);
  };

  // Input NO controlado (como textColumn): el DOM maneja el tipeo, nosotros
  // sólo re-sincronizamos al entrar/salir. Sin setState → sin renders en cadena.
  React.useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    if (focus) { el.focus(); el.select(); }
    else el.blur();
  }, [focus]);

  React.useLayoutEffect(() => {
    const el = inputRef.current;
    if (el && !focus) el.value = fmtDate(value);
  }, [value, focus]);

  const commit = (v: string | null) => setRowData(columnData.set(rowData, v));

  return (
    <div
      ref={wrapRef}
      // Un solo click abre el calendario: la librería recién entra en "edición"
      // al segundo click, y para fechas eso obligaba a clickear de más.
      onClick={openHere}
      style={{ display: "flex", alignItems: "center", width: "100%", height: "100%", cursor: "pointer" }}
    >
      <input
        ref={inputRef}
        tabIndex={-1}
        defaultValue={fmtDate(value)}
        placeholder={active ? "dd/mm/aaaa" : ""}
        // Si la celda entra en edición por teclado (Enter) o si el scroll la
        // remontó tras el click, este onFocus la vuelve a abrir con el rect real.
        onFocus={openHere}
        onChange={(e) => {
          const raw = e.target.value;
          if (!raw.trim()) commit(null);
          else { const parsed = toIsoDate(raw); if (parsed) commit(parsed); }
        }}
        style={{
          width: "100%", padding: "0 8px",
          border: "none", outline: "none", background: "transparent",
          fontFamily: FONT, fontSize: 13, color: "#1A2329",
          fontVariantNumeric: "tabular-nums",
          pointerEvents: focus ? "auto" : "none",
        }}
      />
      {anchor && (
        <DatePopup
          anchor={anchor}
          value={value}
          onPick={commit}
          onClose={closePopup}
        />
      )}
    </div>
  );
});

const START_DATE: DateData = {
  get: (r) => r.start_date,
  set: (r, v) => {
    if (!v) return { ...r, start_date: null };

    // El usuario ya había cargado el fin y recién ahora pone el inicio:
    // su fecha de fin se respeta, no se pisa. Sólo la corremos si quedaría
    // ANTES del inicio, porque el backend rechaza ese rango.
    if (!r.start_date && r.due_date) {
      return { ...r, start_date: v, due_date: r.due_date < v ? v : r.due_date };
    }

    // La tarea ya tenía rango completo: moverla conserva su duración.
    const dur = durationOf(r.start_date, r.due_date);
    if (dur !== null) return { ...r, start_date: v, due_date: addDays(v, dur - 1) };

    // Fila sin fechas: arranca como tarea de 1 día.
    return { ...r, start_date: v, due_date: v };
  },
};

const DUE_DATE: DateData = {
  get: (r) => r.due_date,
  set: (r, v) => ({ ...r, due_date: v }),
};

// ─── celda: Estado (pill de color, igual que la planilla actual) ─────────────

const EstadoCell = React.memo(({ rowData, setRowData, focus }: CellProps<Row, unknown>) => {
  const ref = useRef<HTMLSelectElement>(null);
  React.useLayoutEffect(() => {
    if (focus) ref.current?.focus();
    else ref.current?.blur();
  }, [focus]);

  const st = STATUS_STYLE[rowData.status];
  if (!focus) {
    return (
      <div style={{ display: "flex", alignItems: "center", width: "100%", padding: "0 8px" }}>
        <span style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          padding: "3px 9px", borderRadius: 99,
          fontSize: 11.5, fontWeight: 600, fontFamily: FONT,
          background: st.bg, color: st.color,
        }}>
          <st.Icon style={{ width: 11, height: 11, flexShrink: 0 }} />
          {st.label}
        </span>
      </div>
    );
  }
  return (
    <select
      ref={ref}
      value={rowData.status}
      onChange={(e) => setRowData({ ...rowData, status: e.target.value as TaskStatus })}
      style={{
        width: "100%", height: "100%", padding: "0 8px",
        border: "none", outline: "none", background: "transparent",
        fontFamily: FONT, fontSize: 13, cursor: "pointer",
      }}
    >
      {STATUS_VALUES.map((s) => (
        <option key={s} value={s}>{STATUS_STYLE[s].label}</option>
      ))}
    </select>
  );
});

// ─── celda: Duración (derivada — al editarla se recalcula la fecha de fin) ───

// Input NO controlado, igual que `textColumn` de la librería: mientras tipeás,
// el valor lo maneja el DOM; nosotros sólo lo re-sincronizamos al entrar/salir.
// Así "5" reemplaza a "1" sin quedar a mitad de camino entre dos fuentes de verdad.
const DuracionCell = React.memo(({ rowData, setRowData, focus }: CellProps<Row, unknown>) => {
  const ref = useRef<HTMLInputElement>(null);
  const dur = durationOf(rowData.start_date, rowData.due_date);
  const text = dur === null ? "" : String(dur);

  // OJO: seleccionar sólo al ENTRAR en edición. Si `text` estuviera en las
  // dependencias, cada tecla re-parsea → cambia `text` → select() → la tecla
  // siguiente pisa lo tipeado ("15" terminaba siendo "5").
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (focus) { el.focus(); el.select(); }
    else el.blur();
  }, [focus]);

  // El valor mostrado se re-sincroniza sólo mientras NO estás editando.
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (el && !focus) el.value = text;
  }, [text, focus]);

  const commit = (raw: string) => {
    const n = parseInt(raw, 10);
    if (!rowData.start_date || !Number.isFinite(n) || n < 1) return;
    setRowData({ ...rowData, due_date: addDays(rowData.start_date, n - 1) });
  };

  return (
    <div style={{ display: "flex", alignItems: "center", width: "100%", padding: "0 8px", gap: 4 }}>
      <input
        ref={ref}
        defaultValue={text}
        onChange={(e) => commit(e.target.value)}
        placeholder={rowData.start_date ? "" : "—"}
        inputMode="numeric"
        style={{
          width: "100%", border: "none", outline: "none", background: "transparent",
          fontFamily: FONT, fontSize: 13, color: "#1A2329",
          fontVariantNumeric: "tabular-nums",
          pointerEvents: focus ? "auto" : "none",
        }}
      />
      {dur !== null && <span style={{ fontSize: 11, color: "#9BA3AB", flexShrink: 0 }}>d</span>}
    </div>
  );
});

// ─── celda: Predecesoras (estilo MS Project) ─────────────────────────────────
// Se escriben por NÚMERO DE FILA, como en MS Project: "3" = depende de la fila 3
// (Fin→Comienzo, sin demora). Se le puede sumar el tipo y los días de demora:
//   3        → FS sin lag (lo más común; por eso se muestra sólo el número)
//   3FS+2    → arranca 2 días después de que termine la 3
//   5SS      → arranca junto con la 5
//   7FF-1    → termina 1 día antes que la 7
// Varias separadas por coma: "3, 5SS, 7FF-1"

interface DepData {
  /** id de tarea por índice de fila; null = fila sin guardar todavía. */
  ids: (number | null)[];
}

/** links → "3, 5SS+2". Las filas que ya no existen se omiten. */
function formatDeps(links: DependencyLink[], ids: (number | null)[]): string {
  return links
    .map((l) => {
      const idx = ids.indexOf(l.depends_on_id);
      if (idx < 0) return null;
      const type = l.dependency_type ?? "FS";
      const lag = l.lag_days ?? 0;
      // MS Project omite "FS" y el lag 0 para que lo habitual se lea corto.
      const typePart = type === "FS" ? "" : type;
      const lagPart = lag === 0 ? "" : (lag > 0 ? `+${lag}` : String(lag));
      return `${idx + 1}${typePart}${lagPart}`;
    })
    .filter(Boolean)
    .join(", ");
}

interface ParsedDeps { links: DependencyLink[]; error: string | null }

/** "3, 5SS+2" → links. Devuelve el primer problema encontrado, si hay. */
function parseDeps(text: string, ids: (number | null)[], selfIdx: number): ParsedDeps {
  const raw = text.trim();
  if (!raw) return { links: [], error: null };

  const links: DependencyLink[] = [];
  const seen = new Set<number>();

  for (const token of raw.split(/[,;]/)) {
    const t = token.trim();
    if (!t) continue;
    const m = t.match(/^(\d+)\s*(FS|SS|FF|SF)?\s*([+-]\s*\d+)?$/i);
    if (!m) return { links: [], error: `No entiendo "${t}". Usá por ejemplo 3, 5SS o 7FF-1.` };

    const rowNum = Number(m[1]);
    const idx = rowNum - 1;
    if (idx === selfIdx) return { links: [], error: "Una tarea no puede depender de sí misma." };
    if (idx < 0 || idx >= ids.length) return { links: [], error: `No existe la fila ${rowNum}.` };

    const depId = ids[idx];
    if (depId === null) return { links: [], error: `La fila ${rowNum} todavía no está guardada.` };
    if (seen.has(depId)) continue; // repetida: la ignoramos en silencio
    seen.add(depId);

    links.push({
      depends_on_id: depId,
      dependency_type: (m[2]?.toUpperCase() as DependencyType) ?? "FS",
      lag_days: m[3] ? Number(m[3].replace(/\s/g, "")) : 0,
    });
  }
  return { links, error: null };
}

const PredecesorasCell = React.memo(({ rowData, setRowData, rowIndex, focus, active, columnData }: CellProps<Row, DepData>) => {
  const ref = useRef<HTMLInputElement>(null);
  const text = formatDeps(rowData.dependency_links, columnData.ids);

  // Uncontrolado, como el resto. Igual que en Duración: `text` NO va en las
  // dependencias del efecto de foco, o cada tecla se comería a la anterior.
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (focus) { el.focus(); el.select(); }
    else el.blur();
  }, [focus]);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (el && !focus) el.value = text;
  }, [text, focus]);

  return (
    <input
      ref={ref}
      defaultValue={text}
      placeholder={active ? "ej: 3, 5SS+2" : ""}
      title="Número de fila. Opcional: tipo (FS/SS/FF/SF) y demora en días. Ej: 3, 5SS+2"
      onChange={(e) => {
        const { links, error } = parseDeps(e.target.value, columnData.ids, rowIndex);
        // Mientras tipeás puede quedar a medias: sólo aplicamos lo que parsea.
        if (!error) setRowData({ ...rowData, dependency_links: links, error: null });
        else setRowData({ ...rowData, error });
      }}
      style={{
        width: "100%", padding: "0 8px",
        border: "none", outline: "none", background: "transparent",
        fontFamily: FONT, fontSize: 13, color: "#1A2329",
        fontVariantNumeric: "tabular-nums",
        pointerEvents: focus ? "auto" : "none",
      }}
    />
  );
});

// ─── celda: Hito ─────────────────────────────────────────────────────────────
// Un hito es un punto en el tiempo, no trabajo con duración: se dibuja como ◆
// en el Gantt y queda FUERA del promedio de avance de la obra.

const HitoCell = React.memo(({ rowData, setRowData }: CellProps<Row, unknown>) => (
  <div
    onClick={() => setRowData({ ...rowData, is_milestone: !rowData.is_milestone })}
    title={rowData.is_milestone ? "Quitar hito" : "Marcar como hito"}
    style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      width: "100%", height: "100%", cursor: "pointer", userSelect: "none",
      fontSize: 15, color: rowData.is_milestone ? "#FF6B35" : "#D5D9D5",
    }}
  >
    ◆
  </div>
));

// ─── celda: Costo (materiales) ───────────────────────────────────────────────
// Los materiales se editan en un panel anclado a la celda, sin sacarte de la
// planilla (mismo criterio que el calendario). El formulario completo de la
// tarea queda para lo demás: proveedor, responsable del material, etc.

const MAT_STATUS: Record<MaterialStatus, { label: string; bg: string; color: string }> = {
  pendiente: { label: "Pendiente", bg: "#FFF4E5", color: "#A85B12" },
  pedido:    { label: "Pedido",    bg: "#EBF3FF", color: "#2A62C9" },
  recibido:  { label: "Recibido",  bg: "#E4F3EC", color: "#136E47" },
};

const POPUP_MAT_W = 510;
const POPUP_MAT_H = 330;

interface MatDraft { name: string; quantity: string; unit: string; unit_price: string }
const emptyDraft = (): MatDraft => ({ name: "", quantity: "", unit: "", unit_price: "" });
const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));

/** Mismo cálculo que `materials_summary_by_obra()` en el backend. */
interface MatSummary { cost: number; count: number; pending: number }
function summarize(items: TaskMaterial[]): MatSummary {
  return {
    count: items.length,
    cost: items.reduce((a, m) => a + (m.quantity ?? 0) * (m.unit_price ?? 0), 0),
    pending: items.filter((m) => m.status !== "recibido").length,
  };
}

interface MatPopupProps {
  anchor: DOMRect;
  taskId: number;
  taskTitle: string;
  onClose: () => void;
  onChanged: (summary: MatSummary) => void;
  onOpenBudget?: () => void;
}

function MaterialesPopup({ anchor, taskId, taskTitle, onClose, onChanged, onOpenBudget }: MatPopupProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState<TaskMaterial[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Fila en blanco para cargar un material nuevo. Vive sólo en el cliente
  // hasta que tiene nombre: así "Agregar" no ensucia la obra con placeholders.
  const [draft, setDraft] = useState<MatDraft | null>(null);

  useEffect(() => {
    let alive = true;
    fetchMaterials(taskId)
      .then((m) => { if (alive) setItems(m); })
      .catch(() => { if (alive) { setItems([]); setErr("No se pudieron cargar los materiales."); } });
    return () => { alive = false; };
  }, [taskId]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr(null);
    try {
      await fn();
      const fresh = await fetchMaterials(taskId);
      setItems(fresh);
      onChanged(summarize(fresh));
    } catch {
      setErr("No se pudo guardar el cambio.");
    } finally { setBusy(false); }
  };

  /** Guarda el borrador. Sin nombre no es un material: se descarta. */
  const commitDraft = async () => {
    const d = draft;
    if (!d) return;
    const name = d.name.trim();
    if (!name) { setDraft(null); return; }
    await run(() => createMaterial(taskId, {
      name,
      quantity: numOrNull(d.quantity),
      unit: d.unit.trim() || null,
      unit_price: numOrNull(d.unit_price),
      status: "pendiente",
    }));
    setDraft(emptyDraft()); // encadenar carga: queda otra fila lista
  };

  // Igual que el calendario: si abajo no entra, se abre hacia arriba.
  const roomBelow = window.innerHeight - anchor.bottom;
  const up = roomBelow < POPUP_MAT_H + 8 && anchor.top > POPUP_MAT_H + 8;
  const top = up ? anchor.top - POPUP_MAT_H - 4 : anchor.bottom + 4;
  const left = Math.max(8, Math.min(anchor.right - POPUP_MAT_W, window.innerWidth - POPUP_MAT_W - 8));

  const total = (items ?? []).reduce((a, m) => a + (m.quantity ?? 0) * (m.unit_price ?? 0), 0);

  const inputStyle: React.CSSProperties = {
    border: "1px solid transparent", borderRadius: 5, background: "transparent",
    fontFamily: FONT, fontSize: 12, color: "#1A2329", padding: "3px 5px", outline: "none",
    minWidth: 0,
  };

  return createPortal(
    <div
      ref={boxRef}
      style={{
        position: "fixed", top, left, width: POPUP_MAT_W, maxHeight: POPUP_MAT_H,
        display: "flex", flexDirection: "column",
        background: "#fff", border: "1px solid #E6E7E5", borderRadius: 10,
        boxShadow: "0 8px 28px -8px rgba(0,0,0,0.25)", zIndex: 99999, fontFamily: FONT,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "9px 11px", borderBottom: "1px solid #F0F1EF" }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: "#1A2329", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          Materiales · {taskTitle}
        </span>
        {onOpenBudget && (
          <button
            type="button"
            // Cerramos ANTES de navegar: si no, el popover quedaba flotando
            // sobre la pantalla nueva.
            onClick={() => { onClose(); onOpenBudget(); }}
            style={{ flexShrink: 0, border: "none", background: "none", cursor: "pointer", fontSize: 11.5, fontWeight: 600, color: "#FF6B35", fontFamily: FONT }}
          >
            Ver en Presupuesto →
          </button>
        )}
      </div>

      <div style={{ overflowY: "auto", padding: "6px 8px", flex: 1 }}>
        {items === null ? (
          <div style={{ padding: 14, fontSize: 12, color: "#9BA3AB" }}>Cargando…</div>
        ) : items.length === 0 && !draft ? (
          <div style={{ padding: "14px 6px", fontSize: 12, color: "#9BA3AB" }}>
            Sin materiales cargados en esta tarea.
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ fontSize: 10, color: "#94928D", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                <th style={{ textAlign: "left", padding: "2px 4px", fontWeight: 700 }}>Material</th>
                <th style={{ textAlign: "right", padding: "2px 4px", fontWeight: 700, width: 54 }}>Cant.</th>
                <th style={{ textAlign: "left", padding: "2px 4px", fontWeight: 700, width: 68 }}>Un.</th>
                <th style={{ textAlign: "right", padding: "2px 4px", fontWeight: 700, width: 78 }}>P. unit.</th>
                <th style={{ textAlign: "right", padding: "2px 4px", fontWeight: 700, width: 82 }}>Subtotal</th>
                <th style={{ width: 22 }} />
              </tr>
            </thead>
            <tbody>
              {items.map((m) => (
                <tr key={m.id} style={{ borderTop: "1px solid #F4F5F4" }}>
                  <td style={{ padding: "3px 2px" }}>
                    <input
                      defaultValue={m.name}
                      onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== m.name) run(() => updateMaterial(taskId, m.id, { name: v })); }}
                      style={{ ...inputStyle, width: "100%", fontWeight: 600 }}
                    />
                    <span style={{
                      display: "inline-block", marginLeft: 5, padding: "1px 6px", borderRadius: 99,
                      fontSize: 9.5, fontWeight: 700,
                      background: MAT_STATUS[m.status].bg, color: MAT_STATUS[m.status].color,
                    }}>
                      {MAT_STATUS[m.status].label}
                    </span>
                  </td>
                  <td style={{ padding: "3px 2px" }}>
                    <input
                      defaultValue={m.quantity ?? ""}
                      inputMode="decimal"
                      onBlur={(e) => { const v = e.target.value.trim() === "" ? null : Number(e.target.value); if (v !== m.quantity) run(() => updateMaterial(taskId, m.id, { quantity: v })); }}
                      style={{ ...inputStyle, width: "100%", textAlign: "right", fontVariantNumeric: "tabular-nums" }}
                    />
                  </td>
                  <td style={{ padding: "3px 2px" }}>
                    <input
                      defaultValue={m.unit ?? ""}
                      onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== m.unit) run(() => updateMaterial(taskId, m.id, { unit: v })); }}
                      style={{ ...inputStyle, width: "100%" }}
                    />
                  </td>
                  <td style={{ padding: "3px 2px" }}>
                    <input
                      defaultValue={m.unit_price ?? ""}
                      inputMode="decimal"
                      onBlur={(e) => { const v = e.target.value.trim() === "" ? null : Number(e.target.value); if (v !== m.unit_price) run(() => updateMaterial(taskId, m.id, { unit_price: v })); }}
                      style={{ ...inputStyle, width: "100%", textAlign: "right", fontVariantNumeric: "tabular-nums" }}
                    />
                  </td>
                  <td style={{ padding: "3px 6px", textAlign: "right", fontSize: 12, fontWeight: 600, color: "#1A2329", fontVariantNumeric: "tabular-nums" }}>
                    {fmtMoney((m.quantity ?? 0) * (m.unit_price ?? 0))}
                  </td>
                  <td style={{ padding: "3px 0", textAlign: "center" }}>
                    <button
                      type="button"
                      title="Quitar material"
                      onClick={() => run(() => deleteMaterial(taskId, m.id))}
                      style={{ border: "none", background: "none", cursor: "pointer", color: "#C4C9C6", fontSize: 13, lineHeight: 1, padding: 0 }}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}

              {draft && (
                <tr
                  style={{ borderTop: "1px solid #F4F5F4", background: "#FFFBF7" }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); commitDraft(); }
                    if (e.key === "Escape") { e.preventDefault(); setDraft(null); }
                  }}
                  // Al salir de la fila entera (no al pasar de campo a campo) se guarda.
                  onBlur={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) commitDraft();
                  }}
                >
                  <td style={{ padding: "3px 2px" }}>
                    <input
                      autoFocus
                      value={draft.name}
                      placeholder="Nombre del material"
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                      style={{ ...inputStyle, width: "100%", fontWeight: 600, border: "1px solid #FFD9BF", background: "#fff" }}
                    />
                  </td>
                  <td style={{ padding: "3px 2px" }}>
                    <input
                      value={draft.quantity}
                      inputMode="decimal"
                      placeholder="1"
                      onChange={(e) => setDraft({ ...draft, quantity: e.target.value })}
                      style={{ ...inputStyle, width: "100%", textAlign: "right", fontVariantNumeric: "tabular-nums", border: "1px solid #FFD9BF", background: "#fff" }}
                    />
                  </td>
                  <td style={{ padding: "3px 2px" }}>
                    <input
                      value={draft.unit}
                      placeholder="m2"
                      onChange={(e) => setDraft({ ...draft, unit: e.target.value })}
                      style={{ ...inputStyle, width: "100%", border: "1px solid #FFD9BF", background: "#fff" }}
                    />
                  </td>
                  <td style={{ padding: "3px 2px" }}>
                    <input
                      value={draft.unit_price}
                      inputMode="decimal"
                      placeholder="0"
                      onChange={(e) => setDraft({ ...draft, unit_price: e.target.value })}
                      style={{ ...inputStyle, width: "100%", textAlign: "right", fontVariantNumeric: "tabular-nums", border: "1px solid #FFD9BF", background: "#fff" }}
                    />
                  </td>
                  <td style={{ padding: "3px 6px", textAlign: "right", fontSize: 12, fontWeight: 600, color: "#9BA3AB", fontVariantNumeric: "tabular-nums" }}>
                    {fmtMoney((Number(draft.quantity) || 0) * (Number(draft.unit_price) || 0))}
                  </td>
                  <td style={{ padding: "3px 0", textAlign: "center" }}>
                    <button
                      type="button"
                      title="Descartar"
                      onClick={() => setDraft(null)}
                      style={{ border: "none", background: "none", cursor: "pointer", color: "#C4C9C6", fontSize: 13, lineHeight: 1, padding: 0 }}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 11px", borderTop: "1px solid #F0F1EF" }}>
        <button
          type="button"
          disabled={busy}
          onClick={() => setDraft(emptyDraft())}
          style={{
            padding: "5px 11px", borderRadius: 7, border: "1px solid #E6E7E5", background: "#fff",
            cursor: busy ? "not-allowed" : "pointer", fontSize: 11.5, fontWeight: 600, color: "#5B6770", fontFamily: FONT,
          }}
        >
          + Agregar material
        </button>
        {draft && (
          <span style={{ fontSize: 10.5, color: "#9BA3AB" }}>Enter guarda · Esc descarta</span>
        )}
        <span style={{ fontSize: 12, color: err ? "#D03A3A" : "#5B6770", fontVariantNumeric: "tabular-nums" }}>
          {err ?? <>Total <strong style={{ color: "#1A2329" }}>{fmtMoney(total)}</strong></>}
        </span>
      </div>
    </div>,
    document.body
  );
}

interface CostoData {
  onOpenBudget?: (taskId: number) => void;
  onChanged: (taskId: number, summary: MatSummary) => void;
}

const CostoCell = React.memo(({ rowData, columnData }: CellProps<Row, CostoData>) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const has = rowData.materials_count > 0;
  const editable = rowData.id !== null;

  return (
    <div
      ref={wrapRef}
      onClick={() => { if (editable) setAnchor(wrapRef.current?.getBoundingClientRect() ?? null); }}
      title={editable ? "Ver y editar materiales" : undefined}
      style={{
        display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6,
        width: "100%", height: "100%", padding: "0 8px",
        fontSize: 12, fontVariantNumeric: "tabular-nums",
        cursor: editable ? "pointer" : "default",
      }}
    >
      {has ? (
        <>
          {rowData.materials_pending > 0 && (
            <span
              title={`${rowData.materials_pending} sin recibir`}
              style={{ width: 7, height: 7, borderRadius: 99, background: "#E8892B", flexShrink: 0 }}
            />
          )}
          <span style={{ color: "#1A2329", fontWeight: 600 }}>{fmtMoney(rowData.materials_cost)}</span>
          <span style={{ color: "#9BA3AB" }}>· {rowData.materials_count} ít.</span>
        </>
      ) : (
        <span style={{ color: "#C4C9C6" }}>—</span>
      )}
      {anchor && rowData.id !== null && (
        <MaterialesPopup
          anchor={anchor}
          taskId={rowData.id}
          taskTitle={rowData.title}
          onClose={() => setAnchor(null)}
          onChanged={(s) => columnData.onChanged(rowData.id!, s)}
          onOpenBudget={columnData.onOpenBudget ? () => columnData.onOpenBudget!(rowData.id!) : undefined}
        />
      )}
    </div>
  );
});

// ─── header de columna con handle para redimensionar ─────────────────────────

/** Mismo vocabulario que el formulario de la tarea (TaskFormModal). */
const DEP_TYPE_HELP: { code: DependencyType; desc: string; hint: string }[] = [
  { code: "FS", desc: "Fin → Inicio", hint: "la más común: no arranca hasta que la otra termine" },
  { code: "SS", desc: "Inicio → Inicio", hint: "arrancan juntas" },
  { code: "FF", desc: "Fin → Fin", hint: "terminan juntas" },
  { code: "SF", desc: "Inicio → Fin", hint: "poco frecuente en obra" },
];

/** Ayuda de la columna Predecesoras, anclada al encabezado. */
function DepsHelpPopup({ anchor, onClose }: { anchor: DOMRect; onClose: () => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const W = 330;

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  const row = (code: string, meaning: string) => (
    <div key={code} style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
      <code style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5, fontWeight: 700, color: "#C2410C", minWidth: 58 }}>{code}</code>
      <span style={{ color: "#3E4A52" }}>{meaning}</span>
    </div>
  );

  return createPortal(
    <div
      ref={boxRef}
      style={{
        position: "fixed",
        top: anchor.bottom + 6,
        left: Math.max(8, Math.min(anchor.left, window.innerWidth - W - 8)),
        width: W, zIndex: 99999,
        background: "#fff", border: "1px solid #E6E7E5", borderRadius: 10,
        boxShadow: "0 8px 28px -8px rgba(0,0,0,0.25)",
        padding: 12, fontFamily: FONT, fontSize: 12, color: "#5B6770",
        display: "flex", flexDirection: "column", gap: 10,
        textTransform: "none", letterSpacing: 0, fontWeight: 400,
      }}
    >
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: "#1A2329", marginBottom: 5 }}>
          Se escribe por número de fila
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {row("3", "depende de la fila 3")}
          {row("3FS+2", "arranca 2 días después de que termine la 3")}
          {row("5SS", "arranca junto con la 5")}
          {row("7FF-1", "termina 1 día antes que la 7")}
          {row("3, 5SS", "varias, separadas por coma")}
        </div>
      </div>

      <div style={{ borderTop: "1px solid #F0F1EF", paddingTop: 9 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: "#1A2329", marginBottom: 5 }}>Tipos</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {DEP_TYPE_HELP.map((t) => (
            <div key={t.code} style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
              <code style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5, fontWeight: 700, color: "#C2410C", minWidth: 58 }}>{t.code}</code>
              <span style={{ color: "#3E4A52" }}>
                {t.desc} <span style={{ color: "#9BA3AB" }}>— {t.hint}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ borderTop: "1px solid #F0F1EF", paddingTop: 9, color: "#8E97A0" }}>
        Sin tipo se asume <strong style={{ color: "#5B6770" }}>FS</strong>. El <strong style={{ color: "#5B6770" }}>+n</strong> / <strong style={{ color: "#5B6770" }}>−n</strong> son días de demora.
      </div>
    </div>,
    document.body
  );
}

function ColHeader({ label, colId, onResizeStart, help }: {
  label: string;
  colId: string;
  onResizeStart: (e: React.MouseEvent, colId: string) => void;
  /** Muestra un "?" con la ayuda de la columna (hoy sólo Predecesoras). */
  help?: boolean;
}) {
  const [helpAnchor, setHelpAnchor] = useState<DOMRect | null>(null);

  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 5, width: "100%", height: "100%" }}>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      {help && (
        <button
          type="button"
          className="sheetv2-col-help"
          title="Cómo se escriben las predecesoras"
          onClick={(e) => {
            e.stopPropagation();
            // El rect se mide ACÁ: dentro del updater de setState el evento ya
            // se recicló y currentTarget es null.
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setHelpAnchor((a) => (a ? null : rect));
          }}
          // El estilo vive en index.css porque necesita :hover.
          style={helpAnchor ? { background: "#FF6B35", borderColor: "#FF6B35", color: "#fff" } : undefined}
        >
          ?
        </button>
      )}
      <div
        className="sheetv2-col-resize"
        title="Arrastrá para ajustar el ancho"
        onMouseDown={(e) => onResizeStart(e, colId)}
      />
      {helpAnchor && <DepsHelpPopup anchor={helpAnchor} onClose={() => setHelpAnchor(null)} />}
    </div>
  );
}

// ─── componente principal ────────────────────────────────────────────────────

interface Props {
  tasks: Task[];
  responsibles: Responsible[];
  obraId: number;
  onTasksChanged: () => void;
  /** Salta a la pestaña Presupuesto, filtrada por los materiales de esa tarea. */
  onOpenBudget?: (taskId: number) => void;
}

/** Campos a los que puede saltar una alerta. */
export type SheetField = "responsible" | "taskStatus" | "due";

export interface SheetViewHandle {
  /** Pone el cursor en la fila vacía del final, lista para escribir. */
  startNewRow: () => void;
  /** Salta a una tarea y deja seleccionada la celda del campo indicado. */
  focusTask: (taskId: number, field: SheetField) => void;
}

/** Los nombres que usan las alertas → ids de columna de la grilla. */
const FIELD_TO_COL: Record<SheetField, string> = {
  responsible: "responsible",
  taskStatus: "status",
  due: "due_date",
};

/** Columnas que se pueden ocultar. "Tarea" no entra: es la identidad de la fila. */
const TOGGLEABLE = ["responsible", "start_date", "duration", "due_date", "estimated_progress", "status", "dependency_links", "is_milestone", "materials_cost"] as const;
const COL_LABEL: Record<string, string> = {
  responsible: "Responsable",
  start_date: "Inicio",
  duration: "Duración",
  due_date: "Fin",
  estimated_progress: "% Avance",
  status: "Estado",
  dependency_links: "Predecesoras",
  is_milestone: "Hito",
  materials_cost: "Costo",
};

export const TaskSheetView = forwardRef<SheetViewHandle, Props>(function TaskSheetView(
  { tasks, responsibles, obraId, onTasksChanged, onOpenBudget }: Props,
  ref
) {
  // Qué columnas están ocultas, recordado por obra (igual que la planilla actual).
  const hiddenKey = `sheetv2_hidden_${obraId}`;
  const [hidden, setHidden] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(hiddenKey);
      return new Set<string>(saved ? JSON.parse(saved) : []);
    } catch { return new Set<string>(); }
  });
  const [showColMenu, setShowColMenu] = useState(false);
  const [selection, setSelection] = useState<SelectionWithId | null>(null);

  // Ancho por columna, arrastrando el borde del header. También por obra.
  const widthKey = `sheetv2_widths_${obraId}`;
  const [widths, setWidths] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem(widthKey) || "{}"); } catch { return {}; }
  });
  const dragRef = useRef<{ id: string; startX: number; startW: number } | null>(null);
  const guideRef = useRef<HTMLDivElement>(null);

  /** Arrastre del borde derecho del header para cambiar el ancho. */
  const startResize = useCallback((e: React.MouseEvent, colId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const cell = (e.currentTarget as HTMLElement).closest(".dsg-cell") as HTMLElement | null;
    const startW = cell ? cell.getBoundingClientRect().width : 120;
    dragRef.current = { id: colId, startX: e.clientX, startW };

    // La grilla no adopta anchos nuevos estando montada (hay que remontarla),
    // así que durante el arrastre mostramos una línea guía moviendo el DOM a
    // mano —sin re-render— y el ancho se aplica recién al soltar.
    let latest = startW;
    const guide = guideRef.current;
    if (guide) {
      guide.style.display = "block";
      guide.style.left = `${e.clientX}px`;
    }

    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      latest = Math.max(56, Math.round(d.startW + (ev.clientX - d.startX)));
      if (guide) guide.style.left = `${ev.clientX}px`;
    };
    const onUp = () => {
      const d = dragRef.current;
      dragRef.current = null;
      if (guide) guide.style.display = "none";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      if (!d) return;
      const wrap = containerRef.current;
      const sc = wrap?.querySelector(".dsg-container");
      if (wrap && sc) wrap.setAttribute("data-restore-scroll", `${sc.scrollTop},${sc.scrollLeft}`);
      setWidths((prev) => {
        const next = { ...prev, [d.id]: latest };
        try { localStorage.setItem(widthKey, JSON.stringify(next)); } catch { /* ignore */ }
        return next;
      });
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [widthKey]);

  const toggleCol = (id: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem(hiddenKey, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  };
  const activeResponsibles = useMemo(() => responsibles.filter((r) => r.is_active), [responsibles]);

  const levelMap = useMemo(() => buildLevelMap(tasks), [tasks]);
  const serverRows = useMemo(
    () => tasks.map((t) => taskToRow(t, levelMap.get(t.id) ?? 0)),
    [tasks, levelMap]
  );

  // La grilla es controlada localmente y se sincroniza contra el server por
  // operación. `rows` arranca del server y luego lo pisa el usuario.
  const [rows, setRows] = useState<Row[]>(() => withGhost(serverRows));
  const undoStack = useRef<Row[][]>([]);
  const rowsRef = useRef(rows);
  useEffect(() => { rowsRef.current = rows; }, [rows]);
  const containerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<DataSheetGridRef>(null);
  /** Si el último click fue dentro de la grilla — para acotar el Ctrl+Z. */
  const activeInGrid = useRef(false);

  // Sincronización con el server. Sólo re-adoptamos lo del server cuando cambia
  // el CONJUNTO de tareas (alta/baja hecha desde otro lado, recarga, websocket)
  // y no hay ninguna escritura en vuelo; si adoptáramos en cada respuesta nos
  // comeríamos las teclas de una celda que el usuario está tipeando.
  const idsKey = useMemo(() => tasks.map((t) => t.id).join(","), [tasks]);
  const prevIdsKey = useRef(idsKey);
  const inFlight = useRef(0);

  useEffect(() => {
    if (prevIdsKey.current === idsKey) return; // misma lista → no pisamos lo local
    prevIdsKey.current = idsKey;
    if (inFlight.current === 0) setRows(withGhost(serverRows));
  }, [idsKey, serverRows]);

  const tasksById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  // Números de fila ↔ ids, para las predecesoras estilo MS Project.
  const rowIds = useMemo(() => rows.map((r) => r.id), [rows]);

  // Los totales de materiales son campos derivados: la sincronización con el
  // server sólo adopta cuando cambia el CONJUNTO de tareas, así que acá
  // actualizamos la fila a mano y avisamos al resto de la app.
  const onMaterialsChanged = useCallback((taskId: number, s: MatSummary) => {
    setRows((prev) => prev.map((r) => (r.id === taskId
      ? { ...r, materials_cost: s.cost, materials_count: s.count, materials_pending: s.pending }
      : r)));
    onTasksChanged();
  }, [onTasksChanged]);

  const patchRow = useCallback((index: number, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }, []);

  /** Persiste una fila: crea si no tiene id, actualiza si ya existe. */
  const persistRow = useCallback(
    async (index: number, row: Row, prevRow?: Row) => {
      const title = row.title.trim();
      // Fila sin título y sin ningún otro dato → todavía no es una tarea.
      const hasData = !!title || !!row.responsible_id || !!row.start_date || !!row.due_date;
      if (!hasData) return;

      // Misma regla que el backend (schemas/task.py): avisamos en el momento en
      // vez de mandar el request y esperar el 422.
      if (row.start_date && row.due_date && row.due_date < row.start_date) {
        patchRow(index, { saving: false, error: "El fin no puede ser anterior al inicio." });
        return;
      }

      patchRow(index, { saving: true, error: null });
      inFlight.current += 1;
      try {
        if (row.id === null) {
          const saved = await createTask({
            obra_id: obraId,
            title: title || "Nueva tarea",
            responsible_id: row.responsible_id,
            start_date: row.start_date,
            due_date: row.due_date,
            order_index: index,
            is_milestone: row.is_milestone,
          });
          patchRow(index, { id: saved.id, saving: false });
          if (row.status !== "pendiente") await updateTaskStatus(saved.id, row.status);
          // Si la fila nueva no quedó al final (click derecho → insertar en el
          // medio), renumeramos toda la obra: el backend ordena por
          // (order_index, id) y una inserción dejaría índices repetidos, con lo
          // que la tarea aparecería una posición más abajo de donde la pusiste.
          const ids = rowsRef.current
            .map((r, i) => (i === index ? saved.id : r.id))
            .filter((x): x is number => x !== null);
          if (index < ids.length - 1) await reorderTasks(obraId, ids);
        } else {
          // Mandamos SÓLO lo que cambió. El backend usa exclude_unset, así que
          // mandar un campo de más lo cuenta como modificación: incluir siempre
          // estimated_progress hacía que editar el título de una tarea
          // completada explotara con "No se puede modificar el avance de una
          // tarea completada" (task_service.py).
          const orig = tasksById.get(row.id);
          const patch: TaskUpdatePayload = {};
          if (!orig || orig.title !== title) patch.title = title || "Nueva tarea";
          if (!orig || orig.responsible_id !== row.responsible_id) patch.responsible_id = row.responsible_id;
          if (!orig || orig.start_date !== row.start_date) patch.start_date = row.start_date;
          if (!orig || orig.due_date !== row.due_date) patch.due_date = row.due_date;
          if (!orig || orig.estimated_progress !== row.estimated_progress) {
            patch.estimated_progress = row.estimated_progress ?? 0;
          }
          if (!orig || orig.is_milestone !== row.is_milestone) patch.is_milestone = row.is_milestone;
          const depKey = (ls: DependencyLink[]) =>
            ls.map((l) => `${l.depends_on_id}:${l.dependency_type ?? "FS"}:${l.lag_days ?? 0}`).sort().join("|");
          if (!orig || depKey(orig.dependency_links ?? []) !== depKey(row.dependency_links)) {
            patch.dependency_links = row.dependency_links.map((l) => ({
              depends_on_id: l.depends_on_id,
              dependency_type: l.dependency_type,
              lag_days: l.lag_days,
            }));
          }
          if (Object.keys(patch).length > 0) await updateTask(row.id, patch);

          const prevStatus = orig?.status ?? prevRow?.status;
          if (prevStatus && prevStatus !== row.status) {
            await updateTaskStatus(row.id, row.status);
          }
          patchRow(index, { saving: false });
        }
        onTasksChanged();
      } catch (err) {
        // Mostramos el motivo real del backend (ej: reglas de negocio sobre
        // tareas completadas) en vez de un "no se pudo guardar" a ciegas.
        const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
        patchRow(index, { saving: false, error: detail || "No se pudo guardar" });
      } finally {
        inFlight.current = Math.max(0, inFlight.current - 1);
      }
    },
    [obraId, patchRow, onTasksChanged, tasksById]
  );

  // Debounce por fila: mientras tipeás no disparamos una request por tecla.
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const scheduleSave = useCallback(
    (index: number, row: Row, prevRow?: Row) => {
      const t = timers.current;
      const existing = t.get(index);
      if (existing) clearTimeout(existing);
      t.set(index, setTimeout(() => { t.delete(index); persistRow(index, row, prevRow); }, 600));
    },
    [persistRow]
  );

  const handleChange = useCallback(
    (next: Row[], operations: Operation[]) => {
      const prev = rows;
      // Snapshot para Ctrl+Z. Sólo estado de la grilla: un borrado de tarea no
      // se deshace desde acá (ver el aviso del componente).
      undoStack.current.push(prev);
      if (undoStack.current.length > UNDO_LIMIT) undoStack.current.shift();
      setRows(withGhost(next));

      for (const op of operations) {
        if (op.type === "DELETE") {
          const removed = prev.slice(op.fromRowIndex, op.toRowIndex);
          removed.forEach((r) => { if (r.id !== null) deleteTask(r.id).catch(() => {}); });
          if (removed.some((r) => r.id !== null)) onTasksChanged();
        } else {
          // CREATE y UPDATE se tratan igual: persistRow decide crear vs actualizar.
          for (let i = op.fromRowIndex; i < op.toRowIndex; i++) {
            const row = next[i];
            if (row) scheduleSave(i, row, prev[i]);
          }
        }
      }
    },
    [rows, scheduleSave, onTasksChanged]
  );

  // Ctrl+Z: volvemos al snapshot anterior y re-persistimos las filas que cambian.
  // persistRow ya arma el PATCH diffeando contra el server, así que alcanza con
  // pedirle que guarde las filas afectadas.
  const undo = useCallback(() => {
    const snapshot = undoStack.current.pop();
    if (!snapshot) return;
    const restored = withGhost(snapshot);
    setRows(restored);
    const current = rowsRef.current;
    const n = Math.max(restored.length, current.length);
    for (let i = 0; i < n; i++) {
      const a = restored[i], b = current[i];
      if (!a) continue;
      if (!b || JSON.stringify({ ...a, saving: 0, error: 0 }) !== JSON.stringify({ ...b, saving: 0, error: 0 })) {
        if (a.id !== null) scheduleSave(i, a, b);
      }
    }
  }, [scheduleSave]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
        // Si estás tipeando dentro de una celda, dejamos el undo nativo del campo.
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
        // Con una celda seleccionada el foco queda en <body>, así que no sirve
        // mirar activeElement: usamos dónde fue el último click.
        if (!activeInGrid.current) return;
        e.preventDefault();
        undo();
      }
    };
    const onDown = (e: MouseEvent) => {
      activeInGrid.current = !!containerRef.current?.contains(e.target as Node);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown, true);
    };
  }, [undo]);

  // OJO: `keyColumn` sirve sólo para celdas de UN valor — le pasa `rowData[key]`
  // al componente y pisa `columnData`. Las celdas que necesitan la fila entera
  // (título con nivel WBS, duración que combina inicio+fin, responsable con su
  // lista de opciones) van como columnas planas.
  const columns = useMemo<Column<Row>[]>(() => [
    {
      id: "title",
      title: <ColHeader label="Tarea" colId="title" onResizeStart={startResize} />,
      component: TitleCell,
      // Anclada a la izquierda: es la identidad de la fila, no se pierde al
      // scrollear horizontal (el gutter con el nº ya venía sticky).
      cellClassName: "sheetv2-sticky-title",
      headerClassName: "sheetv2-sticky-title",
      grow: 2, minWidth: 240, basis: 260, shrink: 1,
      copyValue: ({ rowData }) => rowData.title,
      pasteValue: ({ rowData, value }) => ({ ...rowData, title: String(value) }),
      isCellEmpty: ({ rowData }) => !rowData.title,
      deleteValue: ({ rowData }) => ({ ...rowData, title: "" }),
    },
    {
      id: "responsible",
      title: <ColHeader label="Responsable" colId="responsible" onResizeStart={startResize} />,
      component: ResponsableCell,
      columnData: { options: activeResponsibles } satisfies RespData,
      grow: 1, minWidth: 160, basis: 180, shrink: 1,
      // Copiar/pegar por NOMBRE, así funciona contra Excel y Sheets.
      copyValue: ({ rowData }) =>
        activeResponsibles.find((r) => r.id === rowData.responsible_id)?.full_name ?? "",
      pasteValue: ({ rowData, value }) => {
        const match = activeResponsibles.find(
          (r) => r.full_name.toLowerCase().trim() === String(value).toLowerCase().trim()
        );
        return { ...rowData, responsible_id: match?.id ?? null };
      },
      isCellEmpty: ({ rowData }) => rowData.responsible_id === null,
      deleteValue: ({ rowData }) => ({ ...rowData, responsible_id: null }),
    },
    {
      id: "start_date",
      title: <ColHeader label="Inicio" colId="start_date" onResizeStart={startResize} />,
      component: DateCell,
      columnData: START_DATE,
      grow: 0, basis: 130, minWidth: 120, shrink: 0,
      copyValue: ({ rowData }) => rowData.start_date,
      pasteValue: ({ rowData, value }) => START_DATE.set(rowData, toIsoDate(value)),
      isCellEmpty: ({ rowData }) => !rowData.start_date,
      deleteValue: ({ rowData }) => ({ ...rowData, start_date: null }),
    },
    {
      id: "duration",
      title: <ColHeader label="Duración" colId="duration" onResizeStart={startResize} />,
      component: DuracionCell,
      grow: 0, basis: 90, minWidth: 80, shrink: 0,
      copyValue: ({ rowData }) => durationOf(rowData.start_date, rowData.due_date),
      pasteValue: ({ rowData, value }) => {
        const n = parseInt(String(value), 10);
        if (!rowData.start_date || !Number.isFinite(n) || n < 1) return rowData;
        return { ...rowData, due_date: addDays(rowData.start_date, n - 1) };
      },
      isCellEmpty: ({ rowData }) => durationOf(rowData.start_date, rowData.due_date) === null,
      deleteValue: ({ rowData }) => rowData,
    },
    {
      id: "due_date",
      title: <ColHeader label="Fin" colId="due_date" onResizeStart={startResize} />,
      component: DateCell,
      columnData: DUE_DATE,
      grow: 0, basis: 130, minWidth: 120, shrink: 0,
      copyValue: ({ rowData }) => rowData.due_date,
      pasteValue: ({ rowData, value }) => DUE_DATE.set(rowData, toIsoDate(value)),
      isCellEmpty: ({ rowData }) => !rowData.due_date,
      deleteValue: ({ rowData }) => ({ ...rowData, due_date: null }),
    },
    {
      ...keyColumn<Row, "estimated_progress">("estimated_progress", intColumn),
      title: <ColHeader label="% Avance" colId="estimated_progress" onResizeStart={startResize} />,
      grow: 0, basis: 90, minWidth: 80, shrink: 0,
      // Una tarea completada queda fijada en 100%: el backend rechaza cambiarle
      // el avance (task_service.py). Lo bloqueamos también en la UI para no
      // dejar escribir algo que después va a fallar.
      // OJO: va DESPUÉS del spread de keyColumn — así recibe la fila entera y
      // no sólo el valor de la celda.
      disabled: ({ rowData }) => rowData.status === "completada",
    },
    {
      id: "status",
      title: <ColHeader label="Estado" colId="status" onResizeStart={startResize} />,
      component: EstadoCell,
      grow: 0, basis: 140, minWidth: 120, shrink: 0,
      copyValue: ({ rowData }) => STATUS_STYLE[rowData.status].label,
      pasteValue: ({ rowData, value }) => {
        const match = STATUS_VALUES.find(
          (s) => STATUS_STYLE[s].label.toLowerCase() === String(value).toLowerCase().trim()
        );
        return match ? { ...rowData, status: match } : rowData;
      },
      isCellEmpty: () => false,
      deleteValue: ({ rowData }) => rowData,
    },
    {
      id: "dependency_links",
      title: <ColHeader label="Predecesoras" colId="dependency_links" onResizeStart={startResize} help />,
      component: PredecesorasCell,
      columnData: { ids: rowIds } satisfies DepData,
      grow: 0, basis: 140, minWidth: 110, shrink: 0,
      copyValue: ({ rowData }) => formatDeps(rowData.dependency_links, rowIds),
      pasteValue: ({ rowData, value, rowIndex }) => {
        const { links, error } = parseDeps(String(value), rowIds, rowIndex);
        return error ? rowData : { ...rowData, dependency_links: links };
      },
      isCellEmpty: ({ rowData }) => rowData.dependency_links.length === 0,
      deleteValue: ({ rowData }) => ({ ...rowData, dependency_links: [] }),
    },
    {
      id: "is_milestone",
      title: <ColHeader label="Hito" colId="is_milestone" onResizeStart={startResize} />,
      component: HitoCell,
      grow: 0, basis: 62, minWidth: 55, shrink: 0,
      copyValue: ({ rowData }) => (rowData.is_milestone ? "Sí" : ""),
      pasteValue: ({ rowData, value }) => {
        const v = String(value).toLowerCase().trim();
        return { ...rowData, is_milestone: ["sí", "si", "x", "true", "1", "◆"].includes(v) };
      },
      isCellEmpty: ({ rowData }) => !rowData.is_milestone,
      deleteValue: ({ rowData }) => ({ ...rowData, is_milestone: false }),
    },
    {
      id: "materials_cost",
      title: <ColHeader label="Costo" colId="materials_cost" onResizeStart={startResize} />,
      component: CostoCell,
      columnData: { onOpenBudget, onChanged: onMaterialsChanged } satisfies CostoData,
      grow: 0, basis: 150, minWidth: 120, shrink: 0,
      // Sólo lectura: los materiales se cargan desde el formulario de la tarea.
      disabled: true,
      copyValue: ({ rowData }) => (rowData.materials_count > 0 ? rowData.materials_cost : null),
      isCellEmpty: ({ rowData }) => rowData.materials_count === 0,
      deleteValue: ({ rowData }) => rowData,
    },
  ], [activeResponsibles, onOpenBudget, rowIds, onMaterialsChanged, startResize]);

  // Ocultar = sacar la columna del array. "Tarea" siempre queda.
  // Y si el usuario redimensionó una columna, su ancho manda (grow/shrink en 0).
  const visibleColumns = useMemo(
    () => columns
      .filter((c) => !c.id || c.id === "title" || !hidden.has(c.id))
      .map((c) => (c.id && widths[c.id]
        ? { ...c, basis: widths[c.id], grow: 0, shrink: 0, minWidth: Math.min(c.minWidth ?? 56, widths[c.id]) }
        : c)),
    [columns, hidden, widths]
  );

  // Resumen de la obra (izquierda de la barra de estado).
  const stats = useMemo(() => {
    const real = rows.filter((r) => r.id !== null);
    const withDates = real.filter((r) => r.start_date && r.due_date);
    const days = withDates.reduce((a, r) => a + (durationOf(r.start_date, r.due_date) ?? 0), 0);
    // Los hitos no se promedian: son un punto en el tiempo, no trabajo.
    const measurable = real.filter((r) => !r.is_milestone && r.status !== "cancelada");
    const avg = measurable.length
      ? Math.round(measurable.reduce((a, r) => a + (r.estimated_progress ?? 0), 0) / measurable.length)
      : 0;
    return { total: real.length, days, measurable: measurable.length, avg };
  }, [rows]);

  // Agregados de la selección (derecha), como el status bar de Excel.
  const selStats = useMemo(() => {
    if (!selection) return null;
    const { min, max } = selection;
    // Resolvemos las columnas por id, no por índice: el índice de la selección
    // no arranca donde arranca nuestro array (la librería antepone el gutter).
    const iMin = visibleColumns.findIndex((c) => c.id === min.colId);
    const iMax = visibleColumns.findIndex((c) => c.id === max.colId);
    const from = iMin >= 0 ? iMin : min.col;
    const to = iMax >= 0 ? iMax : max.col;

    let count = 0, numeric = 0, sum = 0;
    for (let r = min.row; r <= max.row; r++) {
      const row = rows[r];
      if (!row) continue;
      for (let c = from; c <= to; c++) {
        count++;
        const v = numericCell(row, visibleColumns[c]?.id);
        if (v !== null) { numeric++; sum += v; }
      }
    }
    if (count <= 1) return null; // una sola celda: Excel tampoco muestra nada
    return { count, numeric, sum: Math.round(sum), avg: numeric ? Math.round(sum / numeric) : 0 };
  }, [selection, rows, visibleColumns]);

  // Remontar la grilla resetea su scroll interno; lo restauramos para que un
  // resize no te tire al principio de la planilla.
  const gridKey = useMemo(() => visibleColumns.map((c) => `${c.id}:${c.basis}`).join(","), [visibleColumns]);
  // El scroll pendiente se guarda como atributo en el wrapper (que no se
  // remonta). Evita mutar un ref capturado en hooks, que el linter rechaza.
  const SCROLL_ATTR = "data-restore-scroll";

  useLayoutEffect(() => {
    const wrap = containerRef.current;
    const raw = wrap?.getAttribute(SCROLL_ATTR);
    if (!wrap || !raw) return;
    wrap.removeAttribute(SCROLL_ATTR);
    const [top, left] = raw.split(",").map(Number);
    // Recién montada, la grilla todavía no midió su alto útil y el scroll se
    // clampea a 0; por eso insistimos un frame después.
    const apply = () => {
      const sc = wrap.querySelector(".dsg-container");
      if (!sc) return;
      sc.scrollTop = top;
      sc.scrollLeft = left;
    };
    apply();
    const raf = requestAnimationFrame(apply);
    return () => cancelAnimationFrame(raf);
  }, [gridKey]);

  useImperativeHandle(ref, () => ({
    startNewRow: () => {
      // La fila vacía es siempre la última (withGhost la garantiza).
      gridRef.current?.setActiveCell({ col: "title", row: rowsRef.current.length - 1 });
    },
    focusTask: (taskId, field) => {
      const row = rowsRef.current.findIndex((r) => r.id === taskId);
      if (row < 0) return;
      gridRef.current?.setActiveCell({ col: FIELD_TO_COL[field] ?? "title", row });
    },
  }), []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Línea guía del resize: se mueve por DOM, no dispara renders. */}
      <div
        ref={guideRef}
        style={{
          display: "none", position: "fixed", top: 0, bottom: 0, width: 2,
          background: "#FF6B35", zIndex: 99998, pointerEvents: "none",
        }}
      />
      {/* Selector de columnas visibles — cada columna extra empuja la grilla a
          scrollear al costado, así que conviene poder apagar las que no usás. */}
      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, fontFamily: FONT }}>
        <button
          type="button"
          onClick={() => setShowColMenu((v) => !v)}
          title="Mostrar u ocultar columnas"
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "4px 10px", borderRadius: 7,
            background: "#fff", border: "1px solid #E2E4E2",
            fontSize: 12, fontWeight: 600, color: "#5B6770", cursor: "pointer",
            fontFamily: FONT,
          }}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
            <rect x="2" y="2.5" width="12" height="11" rx="1.5" /><path d="M6.2 2.5v11M10 2.5v11" />
          </svg>
          Columnas
          {hidden.size > 0 && (
            <span style={{ padding: "0 5px", borderRadius: 99, background: "#FFEDE3", color: "#C2410C", fontSize: 10.5, fontWeight: 700 }}>
              {hidden.size} oculta{hidden.size !== 1 ? "s" : ""}
            </span>
          )}
        </button>
        {showColMenu && (
          <>
            <div onMouseDown={() => setShowColMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
            <div style={{
              position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 41,
              background: "#fff", border: "1px solid #E2E4E2", borderRadius: 10,
              boxShadow: "0 8px 24px rgba(20,30,40,0.16)", padding: 6, minWidth: 190,
            }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: "#94928D", textTransform: "uppercase", letterSpacing: "0.06em", padding: "4px 8px" }}>
                Columnas visibles
              </div>
              {TOGGLEABLE.map((id) => (
                <label
                  key={id}
                  style={{ display: "flex", alignItems: "center", gap: 9, padding: "6px 8px", borderRadius: 6, cursor: "pointer", fontSize: 13, color: "#1A2329" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#F2F4F2")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                >
                  <input type="checkbox" checked={!hidden.has(id)} onChange={() => toggleCol(id)} style={{ accentColor: "#FF6B35" }} />
                  {COL_LABEL[id]}
                </label>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Sin relleno extra abajo: el calendario propio se abre hacia arriba
          cuando no entra, así que ya no hace falta reservarle lugar. */}
      <div ref={containerRef} tabIndex={-1} style={{ fontFamily: FONT, outline: "none" }}>
        <DataSheetGrid<Row>
          ref={gridRef}
          // La grilla ignora cambios en `columns` estando montada: verificado
          // en el fiber —la prop nueva llega al memo pero el render interno
          // sigue con la vieja—, así que ni ocultar columnas ni cambiar anchos
          // se aplican sin remontarla. La remontamos y le devolvemos el scroll
          // (abajo) para que no se sienta una recarga.
          key={gridKey}
          value={rows}
          onChange={handleChange}
          columns={visibleColumns}
          createRow={emptyRow}
          rowKey={({ rowData, rowIndex }) => (rowData.id !== null ? `t${rowData.id}` : `new${rowIndex}`)}
          height={560}
          rowHeight={38}
          headerRowHeight={40}
          addRowsComponent={false}
          contextMenuComponent={ContextMenu}
          onSelectionChange={({ selection: sel }) => setSelection(sel)}
        />

        {/* Barra de estado, como la de Excel: a la izquierda el resumen de la
            obra; a la derecha, los agregados de lo que tengas seleccionado. */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 12, padding: "6px 12px",
          border: "1px solid #D5D9D5", borderTop: "none",
          borderRadius: "0 0 6px 6px", background: "#F6F7F6",
          fontSize: 11.5, color: "#5B6770", fontVariantNumeric: "tabular-nums",
        }}>
          <span>
            <strong style={{ color: "#3E4A52" }}>Σ {stats.total}</strong> tarea{stats.total !== 1 ? "s" : ""}
            {stats.days > 0 && <> · <strong style={{ color: "#3E4A52" }}>{stats.days}</strong> días planificados</>}
            {stats.measurable > 0 && <> · avance promedio <strong style={{ color: "#3E4A52" }}>{stats.avg}%</strong></>}
          </span>
          {selStats && (
            <span style={{ display: "flex", gap: 14 }}>
              <span>Recuento <strong style={{ color: "#3E4A52" }}>{selStats.count}</strong></span>
              {selStats.numeric > 0 && (
                <>
                  <span>Suma <strong style={{ color: "#3E4A52" }}>{selStats.sum.toLocaleString("es-AR")}</strong></span>
                  <span>Promedio <strong style={{ color: "#3E4A52" }}>{selStats.avg.toLocaleString("es-AR")}</strong></span>
                </>
              )}
            </span>
          )}
        </div>
      </div>
    </div>
  );
});
