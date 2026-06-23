import { useCallback, useEffect, useRef, useState } from "react";
import {
  FileText, UploadCloud, Loader2, Trash2, Download,
  MessageCircle, ChevronDown, ChevronRight, X,
  Building2, Layers, Zap, Droplets, Flame,
  ShieldAlert, Thermometer, CloudRain, Wrench, Crosshair,
  type LucideIcon,
} from "lucide-react";
import { fetchPlanos, uploadPlano, deletePlano } from "../api/planos";
import type { Plano } from "../types";

const C = {
  text: "#1A2329", text2: "#5B6770", text3: "#8E97A0",
  line: "#E6E7E5", surface: "#fff", bg: "#F4F5F4",
  primary: "#FF6B35", good: "#1F8A5B",
};

const DISCIPLINES: { key: string; label: string; desc: string; Icon: LucideIcon }[] = [
  { key: "arquitectura",  label: "Arquitectura",  desc: "Plantas, cortes, fachadas",      Icon: Building2    },
  { key: "estructura",    label: "Estructura",     desc: "Fundaciones, vigas, columnas",   Icon: Layers       },
  { key: "electricidad",  label: "Electricidad",   desc: "Tableros, tendidos, bocas",      Icon: Zap          },
  { key: "sanitarios",    label: "Sanitarios",     desc: "Agua fría/caliente, cloacas",    Icon: Droplets     },
  { key: "gas",           label: "Gas",            desc: "Redes, medidores, artefactos",   Icon: Flame        },
  { key: "incendio",      label: "Incendio",       desc: "Detección, supresión, salidas",  Icon: ShieldAlert  },
  { key: "termomecanica", label: "Termomecánica",  desc: "HVAC, ventilación, ductos",      Icon: Thermometer  },
  { key: "pluviales",     label: "Pluviales",      desc: "Desagüe de techos y patios",     Icon: CloudRain    },
  { key: "instalaciones", label: "Instalaciones",  desc: "Datos, telefonía, seguridad",    Icon: Wrench       },
  { key: "replanteo",     label: "Replanteo",      desc: "Cotas, ejes, niveles de obra",   Icon: Crosshair    },
];

const labelOf = (key: string) =>
  DISCIPLINES.find(d => d.key === key)?.label ?? key.charAt(0).toUpperCase() + key.slice(1);

function fmtSize(n: number | null): string {
  if (!n) return "";
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
}

// ── Modal para clasificar el plano antes de subir ─────────────────────────────
function UploadModal({
  file,
  uploading,
  onConfirm,
  onCancel,
}: {
  file: File;
  uploading: boolean;
  onConfirm: (discipline: string, name: string) => void;
  onCancel: () => void;
}) {
  const [discipline, setDiscipline] = useState("arquitectura");
  const [name, setName] = useState("");

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget && !uploading) onCancel(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(26,35,41,0.45)", backdropFilter: "blur(3px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16,
      }}
    >
      <div style={{
        background: C.surface, borderRadius: 18, width: "100%", maxWidth: 500,
        boxShadow: "0 20px 60px rgba(0,0,0,0.18)",
        fontFamily: "'Plus Jakarta Sans', sans-serif",
        overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "18px 20px 16px", borderBottom: `1px solid ${C.line}`,
        }}>
          <div>
            <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.text }}>Clasificar plano</p>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: C.text3 }}>¿A qué disciplina pertenece este archivo?</p>
          </div>
          {!uploading && (
            <button onClick={onCancel} style={{
              width: 30, height: 30, borderRadius: 8, border: `1px solid ${C.line}`,
              background: "transparent", cursor: "pointer", color: C.text3,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <X size={15} />
            </button>
          )}
        </div>

        <div style={{ padding: "18px 20px 20px" }}>
          {/* Preview del archivo */}
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            background: C.bg, border: `1px solid ${C.line}`,
            borderRadius: 10, padding: "10px 14px", marginBottom: 18,
          }}>
            <FileText size={18} color={C.primary} style={{ flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <p style={{
                margin: 0, fontSize: 13, fontWeight: 600, color: C.text,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>{file.name}</p>
              <p style={{ margin: 0, fontSize: 11.5, color: C.text3 }}>{fmtSize(file.size)}</p>
            </div>
          </div>

          {/* Chips de disciplina */}
          <p style={{ margin: "0 0 10px", fontSize: 11.5, fontWeight: 700, color: C.text3, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Tipo de plano
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 18 }}>
            {DISCIPLINES.map(d => {
              const active = discipline === d.key;
              return (
                <button
                  key={d.key}
                  onClick={() => setDiscipline(d.key)}
                  disabled={uploading}
                  style={{
                    display: "flex", alignItems: "flex-start", gap: 10,
                    padding: "10px 12px", borderRadius: 10, cursor: "pointer",
                    textAlign: "left",
                    fontFamily: "'Plus Jakarta Sans', sans-serif",
                    border: `1.5px solid ${active ? C.primary : C.line}`,
                    background: active ? "rgba(255,107,53,0.06)" : C.surface,
                    transition: "all 0.12s",
                    opacity: uploading ? 0.6 : 1,
                  }}
                >
                  <span style={{
                    width: 28, height: 28, borderRadius: 7, flexShrink: 0,
                    background: active ? "rgba(255,107,53,0.12)" : C.bg,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: active ? C.primary : C.text3,
                    transition: "all 0.12s",
                  }}>
                    <d.Icon size={14} />
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: active ? C.primary : C.text, lineHeight: 1.3 }}>
                      {d.label}
                    </span>
                    <span style={{ display: "block", fontSize: 11, color: C.text3, marginTop: 1, lineHeight: 1.3 }}>
                      {d.desc}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {/* Sector opcional */}
          <p style={{ margin: "0 0 8px", fontSize: 11.5, fontWeight: 700, color: C.text3, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Sector / descripción <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(opcional)</span>
          </p>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            disabled={uploading}
            placeholder='Ej: "Planta baja", "Subsuelo", "Tablero principal"'
            style={{
              width: "100%", boxSizing: "border-box",
              border: `1px solid ${C.line}`, borderRadius: 10,
              padding: "9px 12px", marginBottom: 20,
              fontSize: 13, fontFamily: "'Plus Jakarta Sans', sans-serif",
              color: C.text, background: uploading ? C.bg : C.surface, outline: "none",
            }}
          />

          {/* Botones */}
          <div style={{ display: "flex", gap: 8 }}>
            {!uploading && (
              <button onClick={onCancel} style={{
                flex: 1, padding: "10px 0", borderRadius: 10,
                border: `1px solid ${C.line}`, background: C.surface,
                fontSize: 13, fontWeight: 600, color: C.text2,
                cursor: "pointer", fontFamily: "'Plus Jakarta Sans', sans-serif",
              }}>
                Cancelar
              </button>
            )}
            <button
              onClick={() => onConfirm(discipline, name.trim())}
              disabled={uploading}
              style={{
                flex: 2, padding: "10px 0", borderRadius: 10, border: "none",
                background: uploading ? "rgba(255,107,53,0.5)" : C.primary,
                fontSize: 13, fontWeight: 700, color: "#fff",
                cursor: uploading ? "default" : "pointer",
                fontFamily: "'Plus Jakarta Sans', sans-serif",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
              }}
            >
              {uploading
                ? <><Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Subiendo…</>
                : "Subir plano"
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────
export function PlanosTab({ obraId }: { obraId: number }) {
  const [planos, setPlanos] = useState<Plano[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try { setPlanos(await fetchPlanos(obraId)); }
    catch { setError("No se pudieron cargar los planos."); }
    finally { setLoading(false); }
  }, [obraId]);

  useEffect(() => { load(); }, [load]);

  function pickFile(f: File) {
    setError(null);
    setPendingFile(f);
  }

  async function handleConfirm(discipline: string, name: string) {
    if (!pendingFile) return;
    setUploading(true);
    try {
      const p = await uploadPlano(obraId, pendingFile, { discipline, name: name || null });
      setPlanos(prev => [p, ...prev.map(x =>
        x.obra_id === p.obra_id && x.discipline === p.discipline && (x.name ?? null) === (p.name ?? null)
          ? { ...x, is_latest: false } : x
      )]);
      setPendingFile(null);
    } catch {
      setError("No se pudo subir el plano. Probá con un archivo de hasta 25 MB.");
      setPendingFile(null);
    } finally { setUploading(false); }
  }

  async function remove(p: Plano) {
    if (!confirm(`¿Eliminar "${p.name || labelOf(p.discipline)}" v${p.version}?`)) return;
    try { await deletePlano(p.id); await load(); }
    catch { /* noop */ }
  }

  const byDiscipline = new Map<string, Plano[]>();
  for (const p of planos) {
    const arr = byDiscipline.get(p.discipline) ?? [];
    arr.push(p);
    byDiscipline.set(p.discipline, arr);
  }

  const card: React.CSSProperties = {
    background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14,
  };

  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>

      {/* Modal de clasificación */}
      {pendingFile && (
        <UploadModal
          file={pendingFile}
          uploading={uploading}
          onConfirm={handleConfirm}
          onCancel={() => { if (!uploading) setPendingFile(null); }}
        />
      )}

      {/* ── Drop zone ── */}
      <div style={{ ...card, padding: 18, marginBottom: 16 }}>
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) pickFile(f); }}
          onClick={() => fileRef.current?.click()}
          style={{
            border: `1.5px dashed ${dragOver ? C.primary : C.line}`,
            background: dragOver ? "rgba(255,107,53,0.04)" : C.bg,
            borderRadius: 12, padding: "28px 16px", textAlign: "center",
            cursor: "pointer", transition: "all 0.15s",
          }}
        >
          <input
            ref={fileRef} type="file" hidden
            accept=".pdf,.png,.jpg,.jpeg,.webp,.dwg,.dxf,image/*"
            onChange={e => { const f = e.target.files?.[0]; if (f) pickFile(f); e.target.value = ""; }}
          />
          <UploadCloud size={24} color={dragOver ? C.primary : C.text3} style={{ marginBottom: 8 }} />
          <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Subí un plano</div>
          <div style={{ fontSize: 12, color: C.text3, marginTop: 3 }}>
            PDF, imagen o CAD · arrastrá o hacé click
          </div>
        </div>
        {error && <p style={{ margin: "10px 0 0", fontSize: 12.5, color: "#A82B2B", fontWeight: 600 }}>{error}</p>}
      </div>

      {/* ── Chatbot hint ── */}
      <div style={{
        display: "flex", gap: 9, alignItems: "flex-start",
        background: "rgba(31,138,91,0.06)", border: "1px solid rgba(31,138,91,0.18)",
        borderRadius: 12, padding: "11px 14px", marginBottom: 16,
      }}>
        <MessageCircle size={15} color={C.good} style={{ flexShrink: 0, marginTop: 1 }} />
        <span style={{ fontSize: 12.5, color: C.text2, lineHeight: 1.5 }}>
          Los responsables pueden pedir estos planos por WhatsApp — escriben{" "}
          <b style={{ color: C.text }}>"mandame el plano de electricidad"</b>{" "}
          y el bot les manda la última versión vigente.
        </span>
      </div>

      {/* ── Lista ── */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 36, color: C.text3 }}>
          <Loader2 size={20} style={{ animation: "spin 1s linear infinite" }} />
        </div>
      ) : planos.length === 0 ? (
        <div style={{ ...card, padding: "40px 24px", textAlign: "center" }}>
          <UploadCloud size={28} color={C.text3} style={{ marginBottom: 8 }} />
          <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.text }}>Todavía no hay planos cargados</p>
          <p style={{ margin: "4px 0 0", fontSize: 12.5, color: C.text2 }}>
            Subí el primero arriba. Después tu equipo lo consulta por WhatsApp.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[...byDiscipline.entries()].map(([disc, items]) => {
            const latest = items.filter(p => p.is_latest);
            const old = items.filter(p => !p.is_latest);
            const open = expanded.has(disc);
            const meta = DISCIPLINES.find(d => d.key === disc);
            return (
              <div key={disc} style={card}>
                <div style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "12px 16px", borderBottom: `1px solid ${C.line}`,
                }}>
                  {meta
                    ? <meta.Icon size={15} color={C.primary} style={{ flexShrink: 0 }} />
                    : <FileText size={15} color={C.primary} style={{ flexShrink: 0 }} />
                  }
                  <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{labelOf(disc)}</span>
                  <span style={{
                    marginLeft: "auto", fontSize: 11, fontWeight: 600, color: C.text3,
                    background: C.bg, border: `1px solid ${C.line}`,
                    borderRadius: 99, padding: "2px 8px",
                  }}>
                    {items.length} {items.length === 1 ? "archivo" : "archivos"}
                  </span>
                </div>

                <div style={{ padding: "4px 0" }}>
                  {latest.map(p => <PlanoRow key={p.id} p={p} onDelete={remove} />)}
                </div>

                {old.length > 0 && (
                  <div style={{ borderTop: `1px solid ${C.line}` }}>
                    <button
                      onClick={() => setExpanded(prev => {
                        const n = new Set(prev);
                        n.has(disc) ? n.delete(disc) : n.add(disc);
                        return n;
                      })}
                      style={{
                        width: "100%", display: "flex", alignItems: "center", gap: 6,
                        padding: "9px 16px", background: "transparent", border: "none",
                        cursor: "pointer", fontSize: 12, fontWeight: 600, color: C.text2,
                        fontFamily: "'Plus Jakarta Sans', sans-serif",
                      }}
                    >
                      {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      {old.length} {old.length === 1 ? "versión anterior" : "versiones anteriores"}
                    </button>
                    {open && (
                      <div style={{ padding: "0 0 4px", opacity: 0.72 }}>
                        {old.map(p => <PlanoRow key={p.id} p={p} onDelete={remove} old />)}
                      </div>
                    )}
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
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px" }}>
      <FileText size={15} color={old ? "#A0ABB4" : C.primary} style={{ flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{
            fontSize: 13, fontWeight: 600, color: C.text,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {p.name || p.original_filename || "Plano"}
          </span>
          <span style={{
            fontSize: 10.5, fontWeight: 700, flexShrink: 0,
            color: old ? "#8E97A0" : C.good,
            background: old ? "#F0F1EF" : "rgba(31,138,91,0.12)",
            padding: "2px 7px", borderRadius: 99,
          }}>
            {old ? `v${p.version}` : `v${p.version} · vigente`}
          </span>
        </div>
        <div style={{ fontSize: 11.5, color: C.text3, marginTop: 1 }}>
          {fmtDate(p.created_at)}{p.file_size ? ` · ${fmtSize(p.file_size)}` : ""}
        </div>
      </div>
      {p.file_url && (
        <a
          href={p.file_url} target="_blank" rel="noreferrer" title="Descargar"
          style={{
            width: 30, height: 30, borderRadius: 8,
            border: `1px solid ${C.line}`, background: C.surface, color: C.text2,
            display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            textDecoration: "none",
          }}
        >
          <Download size={14} />
        </a>
      )}
      <button
        onClick={() => onDelete(p)} title="Eliminar"
        style={{
          width: 30, height: 30, borderRadius: 8,
          border: `1px solid ${C.line}`, background: C.surface, color: C.text3,
          cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}
