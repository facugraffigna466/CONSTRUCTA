import { useEffect, useState } from "react";
import { Mic } from "lucide-react";
import { fetchTaskBitacora, type BitacoraEntry } from "../api/bitacora";

const FONT = "'Plus Jakarta Sans', sans-serif";
const BACKEND_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

const ACTION_LABEL: Record<string, string> = {
  reschedule_task: "Reprogramada",
  create_task: "Creada",
  update_status: "Estado cambiado",
  note: "Anotada",
};

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/**
 * Traza tarea → audio: dentro de una tarea muestra las notas de voz cuyas
 * sugerencias aplicadas la originaron o modificaron, con el audio reproducible.
 */
export function TaskBitacoraOrigin({ taskId }: { taskId: number }) {
  const [entries, setEntries] = useState<BitacoraEntry[]>([]);

  useEffect(() => {
    let alive = true;
    fetchTaskBitacora(taskId).then(d => { if (alive) setEntries(d); }).catch(() => { /* sin bitácora */ });
    return () => { alive = false; };
  }, [taskId]);

  if (entries.length === 0) return null;

  return (
    <div style={{ fontFamily: FONT, background: "#F6FAFF", border: "1px solid #DCEAFB", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <Mic style={{ width: 14, height: 14, color: "#2A62C9" }} />
        <span style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.07em", color: "#2A62C9" }}>
          Origen — Bitácora de obra
        </span>
      </div>

      {entries.map(e => {
        const sug = (e.suggestions ?? []).find(s => s.applied && s.result_task_id === taskId);
        const accion = ACTION_LABEL[sug?.type ?? "note"] ?? "Vinculada";
        return (
          <div key={e.id} style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: "1px solid #E6EFFA", paddingTop: 10 }}>
            <div style={{ fontSize: 12, color: "#1A2329" }}>
              <strong>{accion}</strong> por nota de voz
              {e.responsible_name ? <> de <strong>{e.responsible_name}</strong></> : ""}
              <span style={{ color: "#7D7973" }}> · {fmtDateTime(e.created_at)}</span>
            </div>
            {e.summary && (
              <p style={{ margin: 0, fontSize: 12, color: "#5B6770", lineHeight: 1.5 }}>{e.summary}</p>
            )}
            {sug?.reason && (
              <p style={{ margin: 0, fontSize: 11.5, color: "#6B7580", fontStyle: "italic", lineHeight: 1.45 }}>“{sug.reason}”</p>
            )}
            {(e.audio_url || e.audio_path) && (
              <audio controls src={`${BACKEND_URL}${e.audio_url ?? e.audio_path}`} style={{ width: "100%", height: 34 }} />
            )}
          </div>
        );
      })}
    </div>
  );
}
