import { useCallback, useEffect, useRef, useState } from "react";
import {
  FileText, UploadCloud, Loader2, Trash2, Download, MessageCircle,
  ChevronDown, ChevronRight, Layers,
} from "lucide-react";
import { fetchPlanos, uploadPlano, deletePlano } from "../api/planos";
import type { Plano } from "../types";

const C = {
  text: "#1A2329", text2: "#5B6770", text3: "#8E97A0",
  line: "#E6E7E5", surface: "#fff", bg: "#F4F5F4",
  primary: "#FF6B35", good: "#1F8A5B",
};

const DISCIPLINES = [
  "electricidad", "sanitarios", "gas", "estructura", "arquitectura",
  "incendio", "termomecanica", "pluviales", "instalaciones", "replanteo",
];

const DISC_LABEL: Record<string, string> = {
  electricidad: "Electricidad", sanitarios: "Sanitarios", gas: "Gas",
  estructura: "Estructura", arquitectura: "Arquitectura", incendio: "Incendio",
  termomecanica: "Termomecánica", pluviales: "Pluviales",
  instalaciones: "Instalaciones", replanteo: "Replanteo",
};

const labelOf = (d: string) => DISC_LABEL[d] ?? d.charAt(0).toUpperCase() + d.slice(1);

function fmtSize(n: number | null): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
}

export function PlanosTab({ obraId }: { obraId: number }) {
  const [planos, setPlanos] = useState<Plano[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [discipline, setDiscipline] = useState("electricidad");
  const [name, setName] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try { setPlanos(await fetchPlanos(obraId)); }
    catch { setError("No se pudieron cargar los planos."); }
    finally { setLoading(false); }
  }, [obraId]);

  useEffect(() => { load(); }, [load]);

  async function doUpload(file: File) {
    setUploading(true); setError(null);
    try {
      const p = await uploadPlano(obraId, file, { discipline, name: name.trim() || null });
      setPlanos(prev => [p, ...prev.map(x => (
        x.obra_id === p.obra_id && x.discipline === p.discipline && (x.name ?? null) === (p.name ?? null)
          ? { ...x, is_latest: false } : x
      ))]);
      setName("");
    } catch {
      setError("No se pudo subir el plano. Probá con un archivo de hasta 25 MB.");
    } finally { setUploading(false); }
  }

  async function remove(p: Plano) {
    if (!confirm(`¿Eliminar "${p.name || labelOf(p.discipline)}" v${p.version}?`)) return;
    try { await deletePlano(p.id); await load(); }
    catch { /* noop */ }
  }

  // agrupar por disciplina → cada grupo: vigentes (is_latest) + historial
  const byDiscipline = new Map<string, Plano[]>();
  for (const p of planos) {
    const arr = byDiscipline.get(p.discipline) ?? [];
    arr.push(p);
    byDiscipline.set(p.discipline, arr);
  }

  const card: React.CSSProperties = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14 };

  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      {/* Upload card */}
      <div style={{ ...card, padding: 18, marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
          <select value={discipline} onChange={e => setDiscipline(e.target.value)} style={sel}>
            {DISCIPLINES.map(d => <option key={d} value={d}>{labelOf(d)}</option>)}
          </select>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Nombre / sector (opcional, ej: Planta baja)" style={{ ...sel, flex: 1, minWidth: 200 }} />
        </div>
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f && !uploading) doUpload(f); }}
          onClick={() => !uploading && fileRef.current?.click()}
          style={{
            border: `1.5px dashed ${dragOver ? C.primary : C.line}`,
            background: dragOver ? "rgba(255,107,53,0.04)" : C.bg,
            borderRadius: 12, padding: "20px 16px", textAlign: "center",
            cursor: uploading ? "default" : "pointer", transition: "all 0.15s",
          }}
        >
          <input ref={fileRef} type="file" hidden accept=".pdf,.png,.jpg,.jpeg,.webp,.dwg,.dxf,image/*"
            onChange={e => { const f = e.target.files?.[0]; if (f) doUpload(f); e.target.value = ""; }} />
          {uploading ? <Loader2 size={24} color={C.primary} style={{ animation: "spin 1s linear infinite", marginBottom: 6 }} /> : <UploadCloud size={24} color={C.primary} style={{ marginBottom: 6 }} />}
          <div style={{ fontSize: 13.5, fontWeight: 700, color: C.text }}>
            {uploading ? "Subiendo plano…" : `Subí el plano de ${labelOf(discipline)}`}
          </div>
          <div style={{ fontSize: 12, color: C.text3, marginTop: 2 }}>
            PDF, imagen o CAD · arrastrá o hacé click · si ya existe, queda como versión nueva
          </div>
        </div>
        {error && <p style={{ margin: "10px 0 0", fontSize: 12.5, color: "#A82B2B", fontWeight: 600 }}>{error}</p>}
      </div>

      {/* Chatbot hint */}
      <div style={{ display: "flex", gap: 9, alignItems: "flex-start", background: "rgba(31,138,91,0.06)", border: "1px solid rgba(31,138,91,0.18)", borderRadius: 12, padding: "11px 14px", marginBottom: 16 }}>
        <MessageCircle size={15} color={C.good} style={{ flexShrink: 0, marginTop: 1 }} />
        <span style={{ fontSize: 12.5, color: C.text2, lineHeight: 1.5 }}>
          Los responsables pueden pedir estos planos por WhatsApp — escriben <b style={{ color: C.text }}>"mandame el plano de electricidad"</b> y el bot les manda la última versión vigente.
        </span>
      </div>

      {/* List */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 36, color: C.text3 }}><Loader2 size={20} style={{ animation: "spin 1s linear infinite" }} /></div>
      ) : planos.length === 0 ? (
        <div style={{ ...card, padding: "36px 24px", textAlign: "center" }}>
          <FileText size={28} color={C.text3} style={{ marginBottom: 8 }} />
          <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.text }}>Todavía no hay planos cargados</p>
          <p style={{ margin: "4px 0 0", fontSize: 12.5, color: C.text2 }}>Subí el primero arriba. Después tu equipo lo consulta por WhatsApp.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[...byDiscipline.entries()].map(([disc, items]) => {
            const latest = items.filter(p => p.is_latest);
            const old = items.filter(p => !p.is_latest);
            const open = expanded.has(disc);
            return (
              <div key={disc} style={card}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: `1px solid ${C.line}` }}>
                  <span style={{ width: 30, height: 30, borderRadius: 8, background: "rgba(255,107,53,0.1)", color: C.primary, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                    <Layers size={15} />
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{labelOf(disc)}</span>
                  <span style={{ fontSize: 11.5, color: C.text3, marginLeft: "auto" }}>{items.length} {items.length === 1 ? "archivo" : "archivos"}</span>
                </div>

                {/* Vigentes */}
                <div style={{ padding: "4px 0" }}>
                  {latest.map(p => <PlanoRow key={p.id} p={p} onDelete={remove} />)}
                </div>

                {/* Historial */}
                {old.length > 0 && (
                  <div style={{ borderTop: `1px solid ${C.line}` }}>
                    <button onClick={() => setExpanded(prev => { const n = new Set(prev); n.has(disc) ? n.delete(disc) : n.add(disc); return n; })}
                      style={{ width: "100%", display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "transparent", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, color: C.text2 }}>
                      {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      {old.length} {old.length === 1 ? "versión anterior" : "versiones anteriores"}
                    </button>
                    {open && <div style={{ padding: "0 0 4px", opacity: 0.75 }}>{old.map(p => <PlanoRow key={p.id} p={p} onDelete={remove} old />)}</div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function PlanoRow({ p, onDelete, old }: { p: Plano; onDelete: (p: Plano) => void; old?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 16px" }}>
      <FileText size={16} color={old ? "#A0ABB4" : "#FF6B35"} style={{ flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#1A2329", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {p.name || p.original_filename || "Plano"}
          </span>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: old ? "#8E97A0" : "#1F8A5B", background: old ? "#F0F1EF" : "rgba(31,138,91,0.12)", padding: "1px 7px", borderRadius: 99, flexShrink: 0 }}>
            {old ? `v${p.version}` : `v${p.version} · vigente`}
          </span>
        </div>
        <div style={{ fontSize: 11.5, color: "#8E97A0", marginTop: 1 }}>
          {fmtDate(p.created_at)}{p.file_size ? ` · ${fmtSize(p.file_size)}` : ""}
        </div>
      </div>
      {p.file_url && (
        <a href={p.file_url} target="_blank" rel="noreferrer" title="Ver / descargar"
          style={{ width: 30, height: 30, borderRadius: 8, border: "1px solid #E6E7E5", background: "#fff", color: "#5B6770", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Download size={14} />
        </a>
      )}
      <button onClick={() => onDelete(p)} title="Eliminar" style={{ width: 30, height: 30, borderRadius: 8, border: "1px solid #E6E7E5", background: "#fff", color: "#8E97A0", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Trash2 size={14} />
      </button>
    </div>
  );
}

const sel: React.CSSProperties = {
  border: "1px solid #E6E7E5", borderRadius: 10, padding: "9px 11px",
  fontSize: 13, fontFamily: "'Plus Jakarta Sans', sans-serif", color: "#1A2329",
  background: "#fff", outline: "none",
};
