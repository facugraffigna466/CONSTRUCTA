import { useState } from "react";
import { Calendar, CheckCircle2, FileText, Loader2, Plus, RefreshCw, X } from "lucide-react";
import {
  applySuggestion, dismissSuggestion,
  type Suggestion, type SuggestionEdit,
} from "../api/suggestions";

/**
 * Tarjeta de una sugerencia de IA: qué propone, por qué, y los tres botones que
 * la resuelven (Editar / Descartar / Aplicar).
 *
 * Vivía dentro de `BitacoraPage`. Salió a componente propio junto con la
 * migración 0072: la sugerencia ya no es un objeto de la bitácora sino una
 * entidad con id, y cualquier pantalla que la muestre tiene que mostrarla —y
 * resolverla— igual. Habla directo con la API por id y avisa al padre con la
 * fila actualizada; no sabe nada de la nota de origen.
 */

const FONT = "'Plus Jakarta Sans', sans-serif";

const SUGG_META: Record<
  string, { label: string; icon: React.ComponentType<{ style?: React.CSSProperties }> }
> = {
  reschedule_task: { label: "Mover fechas",   icon: Calendar },
  create_task:     { label: "Crear tarea",    icon: Plus },
  update_status:   { label: "Cambiar estado", icon: RefreshCw },
  note:            { label: "Nota",           icon: FileText },
};

const STATUS_OPTIONS = ["pendiente", "en_progreso", "bloqueada", "completada", "cancelada"];
const INPUT: React.CSSProperties = {
  fontSize: 12, padding: "4px 7px", borderRadius: 7,
  border: "1px solid #E6E7E5", fontFamily: FONT, outline: "none",
};

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

export function SuggestionCard({ s, onResolved }: {
  s: Suggestion;
  onResolved: (updated: Suggestion) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState<SuggestionEdit>({
    new_start_date: s.new_start_date,
    new_due_date: s.new_due_date,
    new_status: s.new_status,
    new_progress: s.new_progress,
    title: s.title,
    responsible_name: s.responsible_name,
  });
  const meta = SUGG_META[s.type] ?? SUGG_META.note;
  const done = s.applied || s.dismissed;
  const editable = s.type !== "note";
  // Una nota no modifica el plan: deja el acuerdo asentado en el historial.
  // Llamar "Aplicar" a eso promete un cambio en la obra que no va a ocurrir.
  const esNota = s.type === "note";
  const verboAplicar = esNota ? "Registrar" : "Aplicar";
  const verboHecho = esNota ? "registrada" : "aplicada";

  function setField(k: keyof SuggestionEdit, v: string) {
    setEdit(prev => ({ ...prev, [k]: v || null }));
  }

  async function act(fn: () => Promise<Suggestion>) {
    setBusy(true);
    setError(null);
    try {
      onResolved(await fn());
    } catch (e: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const detail = (e as any)?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : `No se pudo ${esNota ? "registrar la nota" : "aplicar la sugerencia"}.`);
    } finally {
      setBusy(false);
    }
  }

  let detail: React.ReactNode = null;
  if (s.type === "reschedule_task") {
    detail = <>«{s.task_title ?? `Tarea #${s.task_id}`}» → {s.new_start_date && <>inicio <strong>{fmtDate(s.new_start_date)}</strong></>}{s.new_start_date && s.new_due_date && " · "}{s.new_due_date && <>fin <strong>{fmtDate(s.new_due_date)}</strong></>}</>;
  } else if (s.type === "create_task") {
    detail = <>«{s.title}»{s.new_start_date && <> · {fmtDate(s.new_start_date)} → {fmtDate(s.new_due_date)}</>}{s.responsible_name && <> · {s.responsible_name}</>}</>;
  } else if (s.type === "update_status") {
    detail = <>«{s.task_title ?? `Tarea #${s.task_id}`}» → <strong>{s.new_status?.replace("_", " ")}</strong>{s.new_progress != null && <> · avance <strong>{s.new_progress}%</strong></>}</>;
  }

  let editForm: React.ReactNode = null;
  if (editing && s.type === "reschedule_task") {
    editForm = (
      <div style={{ display: "flex", gap: 10, marginTop: 5, flexWrap: "wrap" }}>
        <label style={{ fontSize: 11, color: "#6B7580", display: "flex", flexDirection: "column", gap: 2 }}>Inicio
          <input type="date" value={edit.new_start_date ?? ""} onChange={e => setField("new_start_date", e.target.value)} style={INPUT} /></label>
        <label style={{ fontSize: 11, color: "#6B7580", display: "flex", flexDirection: "column", gap: 2 }}>Fin
          <input type="date" value={edit.new_due_date ?? ""} onChange={e => setField("new_due_date", e.target.value)} style={INPUT} /></label>
      </div>
    );
  } else if (editing && s.type === "create_task") {
    editForm = (
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 5 }}>
        <input placeholder="Título de la tarea" value={edit.title ?? ""} onChange={e => setField("title", e.target.value)} style={{ ...INPUT, width: "100%", boxSizing: "border-box" }} />
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <label style={{ fontSize: 11, color: "#6B7580", display: "flex", flexDirection: "column", gap: 2 }}>Inicio
            <input type="date" value={edit.new_start_date ?? ""} onChange={e => setField("new_start_date", e.target.value)} style={INPUT} /></label>
          <label style={{ fontSize: 11, color: "#6B7580", display: "flex", flexDirection: "column", gap: 2 }}>Fin
            <input type="date" value={edit.new_due_date ?? ""} onChange={e => setField("new_due_date", e.target.value)} style={INPUT} /></label>
        </div>
        <input placeholder="Responsable (nombre)" value={edit.responsible_name ?? ""} onChange={e => setField("responsible_name", e.target.value)} style={{ ...INPUT, width: "100%", boxSizing: "border-box" }} />
      </div>
    );
  } else if (editing && s.type === "update_status") {
    editForm = (
      <div style={{ display: "flex", gap: 10, marginTop: 5, alignItems: "flex-end", flexWrap: "wrap" }}>
        <select value={edit.new_status ?? ""} onChange={e => setField("new_status", e.target.value)} style={{ ...INPUT, cursor: "pointer" }}>
          {STATUS_OPTIONS.map(o => <option key={o} value={o}>{o.replace("_", " ")}</option>)}
        </select>
        <label style={{ fontSize: 11, color: "#6B7580", display: "flex", flexDirection: "column", gap: 2 }}>% Avance
          <input type="number" min={0} max={100} placeholder="—" value={edit.new_progress ?? ""}
            onChange={e => setEdit(prev => ({ ...prev, new_progress: e.target.value === "" ? null : Math.max(0, Math.min(100, Number(e.target.value))) }))}
            style={{ ...INPUT, width: 70 }} /></label>
      </div>
    );
  }

  // Aplicada o descartada → colapsada a una sola línea, no ocupa espacio.
  if (done) {
    let short = "";
    if (s.type === "reschedule_task") short = `«${s.task_title ?? `Tarea #${s.task_id}`}»`;
    else if (s.type === "create_task") short = `«${s.title ?? ""}»`;
    else if (s.type === "update_status") short = `«${s.task_title ?? `Tarea #${s.task_id}`}» → ${s.new_status?.replace("_", " ")}${s.new_progress != null ? ` · ${s.new_progress}%` : ""}`;
    return (
      <div style={{
        display: "flex", alignItems: "center", gap: 7,
        border: `1px solid ${s.applied ? "#D7EDE0" : "#ECEAE4"}`,
        background: s.applied ? "#F4FBF7" : "#FAFAF9",
        borderRadius: 9, padding: "5px 10px",
        opacity: s.dismissed ? 0.65 : 1,
      }}>
        {s.applied
          ? <CheckCircle2 style={{ width: 12, height: 12, color: "#1F8A5B", flexShrink: 0 }} />
          : <X style={{ width: 12, height: 12, color: "#9AA0A6", flexShrink: 0 }} />}
        <span style={{ fontSize: 11, fontWeight: 700, color: s.applied ? "#1F8A5B" : "#8A9099", whiteSpace: "nowrap" }}>
          {meta.label} · {s.applied ? verboHecho : "descartada"}
        </span>
        {short && (
          <span style={{ fontSize: 11, color: "#7D8189", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
            {short}
          </span>
        )}
        {s.result_note && (
          <span title={s.result_note} style={{ marginLeft: "auto", flexShrink: 0, display: "inline-flex" }}>
            <Calendar style={{ width: 11, height: 11, color: "#2A62C9" }} />
          </span>
        )}
      </div>
    );
  }

  return (
    <div style={{
      border: "1px solid #FDDFC8",
      background: "#FFFCF9",
      borderRadius: 11, padding: "10px 12px",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 9 }}>
        <div style={{
          width: 26, height: 26, borderRadius: 8, flexShrink: 0,
          background: "#FFF0E8",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <meta.icon style={{ width: 13, height: 13, color: "#E76A2D" }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: "#E85A26" }}>
            {meta.label}
          </div>
          {!editing && detail && <div style={{ fontSize: 12.5, color: "#1A2329", marginTop: 3, lineHeight: 1.45 }}>{detail}</div>}
          {editForm}
          <div style={{ fontSize: 11.5, color: "#6B7580", marginTop: 3, lineHeight: 1.45, fontStyle: "italic" }}>
            “{s.reason}”
          </div>
          {error && <div style={{ fontSize: 11.5, color: "#D03A3A", marginTop: 5, fontWeight: 600 }}>{error}</div>}
          {s.result_note && (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 5, fontSize: 11.5, color: "#2A62C9", marginTop: 5, fontWeight: 600, lineHeight: 1.4 }}>
              <Calendar style={{ width: 11, height: 11, flexShrink: 0, marginTop: 1 }} /> {s.result_note}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
          {editable && (
            <button
              onClick={() => {
                // docs/auditoria/08-bitacora.md, hallazgo N9: `edit` se
                // inicializaba una sola vez desde `s` y nunca se
                // resincronizaba — cancelar y volver a abrir (o que la
                // entrada se reprocese mientras tanto) podía dejar
                // aplicar valores viejos sobre la sugerencia actual.
                // Refrescar siempre al abrir el editor.
                if (!editing) {
                  setEdit({
                    new_start_date: s.new_start_date,
                    new_due_date: s.new_due_date,
                    new_status: s.new_status,
                    new_progress: s.new_progress,
                    title: s.title,
                    responsible_name: s.responsible_name,
                  });
                }
                setEditing(v => !v);
              }}
              disabled={busy}
              title="Ajustar antes de aplicar"
              style={{ padding: "5px 9px", borderRadius: 8, fontSize: 11, fontWeight: 600, color: editing ? "#E85A26" : "#6B7580", background: "#fff", border: `1px solid ${editing ? "#FDDFC8" : "#E6E7E5"}`, cursor: "pointer", fontFamily: FONT }}
            >
              {editing ? "Cancelar" : "Editar"}
            </button>
          )}
          <button
            onClick={() => act(() => dismissSuggestion(s.id))}
            disabled={busy}
            style={{ padding: "5px 9px", borderRadius: 8, fontSize: 11, fontWeight: 600, color: "#6B7580", background: "#fff", border: "1px solid #E6E7E5", cursor: "pointer", fontFamily: FONT }}
          >
            Descartar
          </button>
          <button
            onClick={() => act(() => applySuggestion(s.id, editing ? edit : undefined))}
            disabled={busy}
            style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              padding: "5px 11px", borderRadius: 8, fontSize: 11, fontWeight: 700,
              color: "#fff", background: busy ? "#F0A882" : "#FF6B35", border: "none",
              cursor: busy ? "wait" : "pointer", fontFamily: FONT,
            }}
          >
            {busy && <Loader2 style={{ width: 10, height: 10, animation: "spin 1s linear infinite" }} />}
            {verboAplicar}
          </button>
        </div>
      </div>
    </div>
  );
}
