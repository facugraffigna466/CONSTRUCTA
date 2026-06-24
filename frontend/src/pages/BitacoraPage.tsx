import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle, Calendar, CheckCircle2, ChevronDown, ClipboardList, FileText,
  Loader2, Mic, MicOff, Plus, RefreshCw, Sparkles, Square, Trash2, Upload, X,
} from "lucide-react";
import {
  applySuggestion, assignObra, createAudioEntry, createTextEntry, deleteEntry,
  dismissSuggestion, fetchBitacora, reprocessEntry, setTranscript,
  type BitacoraEntry, type BitacoraSuggestion,
} from "../api/bitacora";
import { fetchObras } from "../api/obras";
import type { Obra } from "../types";

const FONT = "'Plus Jakarta Sans', sans-serif";
const BACKEND_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

const STATUS_META: Record<string, { label: string; bg: string; color: string }> = {
  pendiente_transcripcion: { label: "Falta transcribir", bg: "#FDF1DE", color: "#C97D0E" },
  pendiente_analisis:      { label: "Falta analizar",    bg: "#EBF3FF", color: "#2A62C9" },
  pendiente_obra:          { label: "Falta elegir obra", bg: "#FDF1DE", color: "#C97D0E" },
  procesado:               { label: "Procesado",         bg: "#E4F3EC", color: "#136E47" },
  error:                   { label: "Error",             bg: "#FCE5E5", color: "#A82B2B" },
};

const SUGG_META: Record<string, { label: string; icon: React.ComponentType<{ style?: React.CSSProperties }> }> = {
  reschedule_task: { label: "Mover fechas",   icon: Calendar },
  create_task:     { label: "Crear tarea",    icon: Plus },
  update_status:   { label: "Cambiar estado", icon: RefreshCw },
  note:            { label: "Nota",           icon: FileText },
};

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

// ─── Tarjeta de sugerencia ────────────────────────────────────────────────────

function SuggestionCard({ s, index, entryId, onUpdated }: {
  s: BitacoraSuggestion; index: number; entryId: number;
  onUpdated: (e: BitacoraEntry) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const meta = SUGG_META[s.type] ?? SUGG_META.note;
  const done = s.applied || s.dismissed;

  async function act(fn: () => Promise<BitacoraEntry>) {
    setBusy(true);
    setError(null);
    try {
      onUpdated(await fn());
    } catch (e: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const detail = (e as any)?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "No se pudo aplicar la sugerencia.");
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
    detail = <>«{s.task_title ?? `Tarea #${s.task_id}`}» → <strong>{s.new_status?.replace("_", " ")}</strong></>;
  }

  return (
    <div style={{
      border: `1px solid ${s.applied ? "#BFE3CE" : s.dismissed ? "#EFECE6" : "#FDDFC8"}`,
      background: s.applied ? "#F4FBF7" : s.dismissed ? "#FAFAF9" : "#FFFCF9",
      borderRadius: 11, padding: "10px 12px",
      opacity: s.dismissed ? 0.55 : 1,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 9 }}>
        <div style={{
          width: 26, height: 26, borderRadius: 8, flexShrink: 0,
          background: s.applied ? "#E4F3EC" : "#FFF0E8",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {s.applied
            ? <CheckCircle2 style={{ width: 13, height: 13, color: "#1F8A5B" }} />
            : <meta.icon style={{ width: 13, height: 13, color: "#E76A2D" }} />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: s.applied ? "#1F8A5B" : "#E85A26" }}>
            {meta.label}{s.applied && " · aplicada"}{s.dismissed && " · descartada"}
          </div>
          {detail && <div style={{ fontSize: 12.5, color: "#1A2329", marginTop: 3, lineHeight: 1.45 }}>{detail}</div>}
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
        {!done && (
          <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
            <button
              onClick={() => act(() => dismissSuggestion(entryId, index))}
              disabled={busy}
              style={{ padding: "5px 9px", borderRadius: 8, fontSize: 11, fontWeight: 600, color: "#6B7580", background: "#fff", border: "1px solid #E6E7E5", cursor: "pointer", fontFamily: FONT }}
            >
              Descartar
            </button>
            <button
              onClick={() => act(() => applySuggestion(entryId, index))}
              disabled={busy}
              style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                padding: "5px 11px", borderRadius: 8, fontSize: 11, fontWeight: 700,
                color: "#fff", background: busy ? "#F0A882" : "#FF6B35", border: "none",
                cursor: busy ? "wait" : "pointer", fontFamily: FONT,
              }}
            >
              {busy && <Loader2 style={{ width: 10, height: 10, animation: "spin 1s linear infinite" }} />}
              Aplicar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Tarjeta de entrada ───────────────────────────────────────────────────────

function EntryCard({ entry, obras, onUpdated, onDeleted }: {
  entry: BitacoraEntry; obras: Obra[];
  onUpdated: (e: BitacoraEntry) => void;
  onDeleted: (id: number) => void;
}) {
  const [showTranscript, setShowTranscript] = useState(false);
  const [manualText, setManualText] = useState("");
  const [busy, setBusy] = useState(false);
  const st = STATUS_META[entry.status] ?? STATUS_META.error;
  const pendingSuggestions = (entry.suggestions ?? []).filter(s => !s.applied && !s.dismissed).length;

  async function run(fn: () => Promise<BitacoraEntry>) {
    setBusy(true);
    try { onUpdated(await fn()); } catch { /* mantener estado */ } finally { setBusy(false); }
  }

  return (
    <div style={{ background: "#fff", border: "1px solid #ECE7DD", borderRadius: 14, overflow: "hidden", fontFamily: FONT }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", borderBottom: "1px solid #F4F1EB" }}>
        <div style={{
          width: 30, height: 30, borderRadius: 9, flexShrink: 0,
          background: entry.source === "whatsapp" ? "#E4F3EC" : "#EBF3FF",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Mic style={{ width: 14, height: 14, color: entry.source === "whatsapp" ? "#1F8A5B" : "#2A62C9" }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "#1A2329" }}>
            {entry.source === "whatsapp" ? `Audio de WhatsApp${entry.responsible_name ? ` · ${entry.responsible_name}` : ""}` : "Entrada desde la app"}
            {entry.obra_name && <span style={{ fontWeight: 400, color: "#6B7580" }}> · {entry.obra_name}</span>}
          </div>
          <div style={{ fontSize: 10.5, color: "#7D7973", marginTop: 1 }}>{fmtDateTime(entry.created_at)}</div>
        </div>
        <span style={{ padding: "3px 9px", borderRadius: 99, fontSize: 10.5, fontWeight: 700, background: st.bg, color: st.color, whiteSpace: "nowrap" }}>
          {st.label}
        </span>
        {pendingSuggestions > 0 && (
          <span title={`${pendingSuggestions} sugerencias pendientes`} style={{ padding: "3px 8px", borderRadius: 99, fontSize: 10.5, fontWeight: 800, background: "#FF6B35", color: "#fff" }}>
            {pendingSuggestions}
          </span>
        )}
        <button
          onClick={async () => { if (confirm("¿Eliminar esta entrada de la bitácora?")) { await deleteEntry(entry.id); onDeleted(entry.id); } }}
          title="Eliminar"
          style={{ width: 26, height: 26, borderRadius: 7, border: "none", background: "transparent", cursor: "pointer", color: "#C4C0B8", display: "flex", alignItems: "center", justifyContent: "center" }}
          onMouseEnter={e => { e.currentTarget.style.color = "#D03A3A"; }}
          onMouseLeave={e => { e.currentTarget.style.color = "#C4C0B8"; }}
        >
          <Trash2 style={{ width: 13, height: 13 }} />
        </button>
      </div>

      <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
        {/* Audio player */}
        {entry.audio_path && (
          <audio controls src={`${BACKEND_URL}${entry.audio_path}`} style={{ width: "100%", height: 36 }} />
        )}

        {/* Sin obra asignada */}
        {!entry.obra_id && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#FDF1DE", border: "1px solid #F0D5A0", borderRadius: 10, padding: "8px 10px", flexWrap: "wrap" }}>
            <AlertTriangle style={{ width: 13, height: 13, color: "#C97D0E", flexShrink: 0 }} />
            <span style={{ fontSize: 11.5, color: "#9A5D08", flex: 1 }}>Sin obra asignada — elegila para poder aplicar acciones:</span>
            <select
              defaultValue=""
              disabled={busy}
              onChange={e => { if (e.target.value) run(() => assignObra(entry.id, Number(e.target.value))); }}
              style={{ fontSize: 11.5, padding: "4px 8px", borderRadius: 8, border: "1px solid #E8B98F", fontFamily: FONT, cursor: "pointer" }}
            >
              <option value="" disabled>Elegir obra…</option>
              {obras.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
        )}

        {/* Error / aviso */}
        {entry.error && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8, background: "#FFF8F3", border: "1px solid #FDDFC8", borderRadius: 10, padding: "8px 10px" }}>
            <AlertTriangle style={{ width: 13, height: 13, color: "#C97D0E", flexShrink: 0, marginTop: 1 }} />
            <span style={{ fontSize: 11.5, color: "#9A5D08", lineHeight: 1.45 }}>{entry.error}</span>
          </div>
        )}

        {/* Falta transcripción → carga manual */}
        {entry.status === "pendiente_transcripcion" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <textarea
              rows={2}
              placeholder="Escribí acá lo que se dijo en el audio para que la IA lo analice…"
              value={manualText}
              onChange={e => setManualText(e.target.value)}
              style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", fontSize: 12.5, border: "1px solid #E6E7E5", borderRadius: 10, fontFamily: FONT, resize: "vertical", outline: "none" }}
            />
            <button
              onClick={() => manualText.trim() && run(() => setTranscript(entry.id, manualText.trim()))}
              disabled={busy || !manualText.trim()}
              style={{ alignSelf: "flex-end", display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 13px", borderRadius: 9, fontSize: 12, fontWeight: 700, color: "#fff", background: busy || !manualText.trim() ? "#F0A882" : "#FF6B35", border: "none", cursor: "pointer", fontFamily: FONT }}
            >
              {busy ? <Loader2 style={{ width: 11, height: 11, animation: "spin 1s linear infinite" }} /> : <Sparkles style={{ width: 11, height: 11 }} />}
              Cargar texto y analizar
            </button>
          </div>
        )}

        {/* Resumen */}
        {entry.summary && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <Sparkles style={{ width: 12, height: 12, color: "#E76A2D" }} />
              <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.09em", color: "#6B7580" }}>Resumen</span>
            </div>
            <p style={{ margin: 0, fontSize: 13, color: "#1A2329", lineHeight: 1.55 }}>{entry.summary}</p>
          </div>
        )}

        {/* Puntos clave */}
        {(entry.key_points?.length ?? 0) > 0 && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
              <ClipboardList style={{ width: 12, height: 12, color: "#2A62C9" }} />
              <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.09em", color: "#6B7580" }}>Puntos clave</span>
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 3 }}>
              {entry.key_points!.map((p, i) => (
                <li key={i} style={{ fontSize: 12.5, color: "#3E4A52", lineHeight: 1.5 }}>{p}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Sugerencias */}
        {(entry.suggestions?.length ?? 0) > 0 && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <CheckCircle2 style={{ width: 12, height: 12, color: "#1F8A5B" }} />
              <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.09em", color: "#6B7580" }}>
                Acciones sugeridas por la IA
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {entry.suggestions!.map((s, i) => (
                <SuggestionCard key={i} s={s} index={i} entryId={entry.id} onUpdated={onUpdated} />
              ))}
            </div>
          </div>
        )}

        {/* Transcripción colapsable + reintentar */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {entry.transcript && (
            <button
              onClick={() => setShowTranscript(v => !v)}
              style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 0", fontSize: 11.5, fontWeight: 600, color: "#6B7580", background: "none", border: "none", cursor: "pointer", fontFamily: FONT }}
            >
              <ChevronDown style={{ width: 12, height: 12, transform: showTranscript ? "none" : "rotate(-90deg)", transition: "transform 0.15s" }} />
              Ver transcripción
            </button>
          )}
          {(entry.status === "error" || entry.status === "pendiente_analisis") && entry.transcript && (
            <button
              onClick={() => run(() => reprocessEntry(entry.id))}
              disabled={busy}
              style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 8, fontSize: 11.5, fontWeight: 600, color: "#2A62C9", background: "#EBF3FF", border: "none", cursor: "pointer", fontFamily: FONT, marginLeft: "auto" }}
            >
              {busy ? <Loader2 style={{ width: 11, height: 11, animation: "spin 1s linear infinite" }} /> : <RefreshCw style={{ width: 11, height: 11 }} />}
              Reintentar análisis
            </button>
          )}
        </div>
        {showTranscript && entry.transcript && (
          <p style={{ margin: 0, fontSize: 12, color: "#5B6770", lineHeight: 1.6, background: "#FAF8F4", borderRadius: 10, padding: "10px 12px", whiteSpace: "pre-wrap" }}>
            {entry.transcript}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────

export function BitacoraPage({ initialObraId }: { initialObraId?: number } = {}) {
  const [obras, setObras] = useState<Obra[]>([]);
  // Al entrar desde una obra, la bitácora arranca filtrada en esa obra (es un módulo de la obra).
  const [obraId, setObraId] = useState<number | "todas">(initialObraId ?? "todas");
  const [entries, setEntries] = useState<BitacoraEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"audio" | "texto">("audio");
  const [onlyPending, setOnlyPending] = useState(false);

  // Grabación con micrófono
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const [obrasData, entriesData] = await Promise.all([
        fetchObras(),
        fetchBitacora(obraId === "todas" ? undefined : obraId),
      ]);
      setObras(obrasData);
      setEntries(entriesData);
    } catch { /* backend caído */ } finally {
      setLoading(false);
    }
  }, [obraId]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  const targetObraId = obraId === "todas" ? (obras[0]?.id ?? null) : obraId;

  function replaceEntry(updated: BitacoraEntry) {
    setEntries(prev => prev.map(e => (e.id === updated.id ? updated : e)));
  }

  async function submitFile(file: File | Blob, filename?: string) {
    if (!targetObraId) { setCreateError("Primero creá una obra."); return; }
    setCreating(true);
    setCreateError(null);
    try {
      const entry = await createAudioEntry(targetObraId, file, filename);
      setEntries(prev => [entry, ...prev]);
    } catch {
      setCreateError("No se pudo subir el audio. Verificá que el backend esté corriendo.");
    } finally {
      setCreating(false);
    }
  }

  async function submitText() {
    if (!targetObraId || !text.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const entry = await createTextEntry(targetObraId, text.trim());
      setEntries(prev => [entry, ...prev]);
      setText("");
    } catch {
      setCreateError("No se pudo crear la entrada.");
    } finally {
      setCreating(false);
    }
  }

  async function startRecording() {
    setMicError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        if (blob.size > 0) submitFile(blob, "grabacion.webm");
      };
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
      setRecSeconds(0);
      timerRef.current = setInterval(() => setRecSeconds(s => s + 1), 1000);
    } catch {
      setMicError("No se pudo acceder al micrófono. Revisá los permisos del navegador.");
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  // Sugerencias sin revisar: total para el encabezado, y orden "pendientes primero".
  const hasPending = (e: BitacoraEntry) => (e.suggestions ?? []).some(s => !s.applied && !s.dismissed);
  const pendingTotal = entries.reduce(
    (n, e) => n + (e.suggestions ?? []).filter(s => !s.applied && !s.dismissed).length, 0,
  );
  const displayEntries = [...entries]
    .sort((a, b) => Number(hasPending(b)) - Number(hasPending(a)))
    .filter(e => !onlyPending || hasPending(e));

  return (
    <div style={{ fontFamily: FONT, maxWidth: 860, margin: "0 auto", display: "flex", flexDirection: "column", gap: 18 }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 21, fontWeight: 800, color: "#1A2329", letterSpacing: "-0.02em" }}>Bitácora de obra</h1>
          <p style={{ margin: "3px 0 0", fontSize: 12.5, color: "#6B7580" }}>
            Grabá o mandá un audio de WhatsApp desde la obra — la IA lo resume y te propone acciones sobre el plan.
          </p>
        </div>
        <select
          value={obraId}
          onChange={e => setObraId(e.target.value === "todas" ? "todas" : Number(e.target.value))}
          style={{ padding: "8px 12px", fontSize: 12.5, fontWeight: 600, borderRadius: 10, border: "1px solid #E6E7E5", fontFamily: FONT, cursor: "pointer", background: "#fff", color: "#1A2329" }}
        >
          <option value="todas">Todas las obras</option>
          {obras.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </div>

      {/* Creador de entradas */}
      <div style={{ background: "#fff", border: "1px solid #ECE7DD", borderRadius: 14, padding: 16 }}>
        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          {(["audio", "texto"] as const).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                padding: "6px 14px", borderRadius: 99, fontSize: 12, fontWeight: 700,
                background: mode === m ? "#1A2329" : "#F4F2EE", color: mode === m ? "#fff" : "#5B6770",
                border: "none", cursor: "pointer", fontFamily: FONT,
              }}
            >
              {m === "audio" ? "🎙️ Audio" : "✍️ Texto"}
            </button>
          ))}
          {obraId === "todas" && obras.length > 0 && (
            <span style={{ marginLeft: "auto", alignSelf: "center", fontSize: 11, color: "#7D7973" }}>
              Se registra en: <strong style={{ color: "#5B6770" }}>{obras[0]?.name}</strong> (elegí otra arriba)
            </span>
          )}
        </div>

        {mode === "audio" ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {!recording ? (
              <button
                onClick={startRecording}
                disabled={creating}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 18px",
                  borderRadius: 11, fontSize: 13, fontWeight: 700, color: "#fff",
                  background: creating ? "#F0A882" : "#FF6B35", border: "none", cursor: "pointer", fontFamily: FONT,
                  boxShadow: "0 6px 14px -6px rgba(255,107,53,0.5)",
                }}
              >
                <Mic style={{ width: 15, height: 15 }} />
                Grabar audio
              </button>
            ) : (
              <button
                onClick={stopRecording}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 18px",
                  borderRadius: 11, fontSize: 13, fontWeight: 700, color: "#fff",
                  background: "#D03A3A", border: "none", cursor: "pointer", fontFamily: FONT,
                  animation: "bitacora-pulse 1.5s ease-in-out infinite",
                }}
              >
                <Square style={{ width: 13, height: 13, fill: "#fff" }} />
                Detener ({Math.floor(recSeconds / 60)}:{String(recSeconds % 60).padStart(2, "0")})
              </button>
            )}
            <button
              onClick={() => fileRef.current?.click()}
              disabled={creating || recording}
              style={{
                display: "inline-flex", alignItems: "center", gap: 7, padding: "10px 16px",
                borderRadius: 11, fontSize: 12.5, fontWeight: 600, color: "#5B6770",
                background: "#fff", border: "1px solid #E6E7E5", cursor: "pointer", fontFamily: FONT,
              }}
            >
              <Upload style={{ width: 13, height: 13 }} />
              Subir archivo
            </button>
            <input
              ref={fileRef} type="file" accept="audio/*" style={{ display: "none" }}
              onChange={e => { const f = e.target.files?.[0]; if (f) submitFile(f); e.target.value = ""; }}
            />
            {creating && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "#E85A26", fontWeight: 600 }}>
                <Loader2 style={{ width: 13, height: 13, animation: "spin 1s linear infinite" }} />
                Procesando con IA… puede tardar un momento
              </span>
            )}
            {micError && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "#D03A3A" }}>
                <MicOff style={{ width: 12, height: 12 }} /> {micError}
              </span>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <textarea
              rows={3}
              placeholder="Ej: Hablé con el capataz, la losa del 2do piso se atrasa una semana por la lluvia. Acordamos arrancar la mampostería el lunes…"
              value={text}
              onChange={e => setText(e.target.value)}
              style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", fontSize: 13, border: "1px solid #E6E7E5", borderRadius: 11, fontFamily: FONT, resize: "vertical", outline: "none", lineHeight: 1.5 }}
            />
            <button
              onClick={submitText}
              disabled={creating || !text.trim()}
              style={{
                alignSelf: "flex-end", display: "inline-flex", alignItems: "center", gap: 7,
                padding: "9px 18px", borderRadius: 10, fontSize: 12.5, fontWeight: 700, color: "#fff",
                background: creating || !text.trim() ? "#F0A882" : "#FF6B35", border: "none",
                cursor: creating ? "wait" : "pointer", fontFamily: FONT,
              }}
            >
              {creating ? <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} /> : <Sparkles style={{ width: 12, height: 12 }} />}
              Analizar con IA
            </button>
          </div>
        )}
        {createError && (
          <p style={{ margin: "10px 0 0", fontSize: 12, color: "#D03A3A", fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
            <X style={{ width: 12, height: 12 }} /> {createError}
          </p>
        )}
      </div>

      {/* Encabezado de sugerencias sin revisar (Sí/No pendiente) */}
      {!loading && entries.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12.5, fontWeight: 600, color: pendingTotal > 0 ? "#9A5D08" : "#6B7580" }}>
            <CheckCircle2 style={{ width: 14, height: 14, color: pendingTotal > 0 ? "#E76A2D" : "#1F8A5B" }} />
            {pendingTotal > 0
              ? `Tenés ${pendingTotal} sugerencia${pendingTotal === 1 ? "" : "s"} sin revisar`
              : "No hay sugerencias pendientes"}
          </span>
          {pendingTotal > 0 && (
            <button
              onClick={() => setOnlyPending(v => !v)}
              style={{ padding: "5px 12px", borderRadius: 99, fontSize: 11.5, fontWeight: 700, border: "1px solid #E6E7E5", cursor: "pointer", fontFamily: FONT, background: onlyPending ? "#1A2329" : "#fff", color: onlyPending ? "#fff" : "#5B6770" }}
            >
              {onlyPending ? "Ver todas" : "Solo pendientes"}
            </button>
          )}
        </div>
      )}

      {/* Lista de entradas */}
      {loading ? (
        <p style={{ fontSize: 13, color: "#6B7580", textAlign: "center", padding: 24 }}>Cargando bitácora…</p>
      ) : entries.length === 0 ? (
        <div style={{ textAlign: "center", padding: "36px 24px", background: "#fff", border: "1px dashed #DDD6C9", borderRadius: 14 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: "#FFF0E8", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
            <Mic style={{ width: 20, height: 20, color: "#E76A2D" }} />
          </div>
          <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: "#3E4A52" }}>Todavía no hay entradas</p>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "#6B7580", lineHeight: 1.6 }}>
            Grabá un audio acá arriba, o mandá un audio de WhatsApp al número de CONSTRUCTA<br />
            desde un teléfono registrado como responsable — entra solo a la bitácora.
          </p>
        </div>
      ) : displayEntries.length === 0 ? (
        <p style={{ fontSize: 13, color: "#6B7580", textAlign: "center", padding: 24 }}>
          No hay entradas con sugerencias pendientes.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {displayEntries.map(e => (
            <EntryCard
              key={e.id}
              entry={e}
              obras={obras}
              onUpdated={replaceEntry}
              onDeleted={id => setEntries(prev => prev.filter(x => x.id !== id))}
            />
          ))}
        </div>
      )}

      <style>{`@keyframes bitacora-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.75; } }`}</style>
    </div>
  );
}
