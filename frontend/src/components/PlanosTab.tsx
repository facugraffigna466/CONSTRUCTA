import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FileText, UploadCloud, Loader2, Trash2, Download,
  MessageCircle, ChevronDown, ChevronRight, X, Plus, CheckCircle2,
  Building2, Layers, Zap, Droplets, Flame,
  ShieldAlert, Thermometer, CloudRain, Wrench, Crosshair,
  type LucideIcon,
} from "lucide-react";
import { fetchPlanos, uploadPlano, deletePlano, setPlanoVigente } from "../api/planos";
import type { Plano } from "../types";
import { useConfirm } from "./ConfirmProvider";
import { useCan } from "../hooks/usePermission";

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
const iconOf = (key: string) => DISCIPLINES.find(d => d.key === key)?.Icon ?? FileText;

const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.gif,.dwg,.dxf";

function fmtSize(n: number | null): string {
  if (!n) return "";
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
/** Fecha corta: omite el año cuando es el actual — en el historial de un plano
 *  casi todo es del año en curso y repetirlo es ruido. */
function fmtCorta(iso: string): string {
  const d = new Date(iso);
  const opts: Intl.DateTimeFormatOptions = d.getFullYear() === new Date().getFullYear()
    ? { day: "numeric", month: "short" }
    : { day: "numeric", month: "short", year: "numeric" };
  return d.toLocaleDateString("es-AR", opts);
}
function hace(iso: string): string {
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (dias <= 0) return "hoy";
  if (dias === 1) return "ayer";
  if (dias < 30) return `hace ${dias} días`;
  const meses = Math.floor(dias / 30);
  return meses === 1 ? "hace 1 mes" : `hace ${meses} meses`;
}

function errorMessage(err: unknown, fallback: string): string {
  const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof detail === "string" ? detail : fallback;
}

/** Un "plano" es el conjunto de versiones que comparten disciplina y sector: la
 *  vigente más su historial. El usuario piensa en planos, no en archivos sueltos. */
type Documento = {
  key: string;
  discipline: string;
  name: string | null;
  vigente: Plano;
  historial: Plano[];
};

function agrupar(planos: Plano[]): Map<string, Documento[]> {
  const grupos = new Map<string, Plano[]>();
  for (const p of planos) {
    const key = `${p.discipline}||${p.name ?? ""}`;
    const actual = grupos.get(key);
    if (actual) actual.push(p);
    else grupos.set(key, [p]);
  }

  const porDisciplina = new Map<string, Documento[]>();
  for (const [key, versiones] of grupos) {
    const ordenadas = [...versiones].sort((a, b) => b.version - a.version);
    const vigente = ordenadas.find(p => p.is_latest) ?? ordenadas[0];
    const doc: Documento = {
      key,
      discipline: vigente.discipline,
      name: vigente.name,
      vigente,
      historial: ordenadas.filter(p => p.id !== vigente.id),
    };
    const docs = porDisciplina.get(doc.discipline);
    if (docs) docs.push(doc);
    else porDisciplina.set(doc.discipline, [doc]);
  }
  for (const docs of porDisciplina.values()) {
    docs.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  }
  // Orden fijo (el canónico de obra) en vez del de inserción: si dependiera de
  // cuál se subió último, las secciones saltarían de lugar en cada carga.
  const orden = DISCIPLINES.map(d => d.key);
  const posicion = (k: string) => {
    const i = orden.indexOf(k);
    return i === -1 ? orden.length : i;
  };
  return new Map(
    [...porDisciplina.entries()].sort((a, b) => posicion(a[0]) - posicion(b[0])),
  );
}

// ── Estilos compartidos ───────────────────────────────────────────────────────
const inputStyle = (disabled: boolean): React.CSSProperties => ({
  width: "100%", boxSizing: "border-box",
  border: `1px solid ${C.line}`, borderRadius: 10, padding: "9px 12px",
  fontSize: 13, fontFamily: "'Plus Jakarta Sans', sans-serif",
  color: C.text, background: disabled ? C.bg : C.surface, outline: "none",
});
const labelStyle: React.CSSProperties = {
  margin: "0 0 8px", fontSize: 11.5, fontWeight: 700, color: C.text3,
  textTransform: "uppercase", letterSpacing: "0.05em",
};
const iconBtn: React.CSSProperties = {
  width: 30, height: 30, borderRadius: 8, flexShrink: 0,
  border: `1px solid ${C.line}`, background: C.surface, color: C.text2,
  cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center",
  textDecoration: "none",
};
const textBtn: React.CSSProperties = {
  height: 30, padding: "0 11px", borderRadius: 8, flexShrink: 0,
  border: `1px solid ${C.line}`, background: C.surface, color: C.text,
  cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5,
  fontSize: 11.5, fontWeight: 600, fontFamily: "'Plus Jakarta Sans', sans-serif",
};

function ModalShell({
  title, subtitle, uploading, onCancel, children,
}: {
  title: string; subtitle: string; uploading: boolean;
  onCancel: () => void; children: React.ReactNode;
}) {
  return (
    <div
      onClick={e => { if (e.target === e.currentTarget && !uploading) onCancel(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(26,35,41,0.45)", backdropFilter: "blur(3px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }}
    >
      <div style={{
        background: C.surface, borderRadius: 18, width: "100%", maxWidth: 480,
        maxHeight: "90vh", display: "flex", flexDirection: "column",
        boxShadow: "0 20px 60px rgba(0,0,0,0.18)",
        fontFamily: "'Plus Jakarta Sans', sans-serif", overflow: "hidden",
      }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "18px 20px 16px", borderBottom: `1px solid ${C.line}`, flexShrink: 0,
        }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.text }}>{title}</p>
            <p style={{
              margin: "2px 0 0", fontSize: 12, color: C.text3,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>{subtitle}</p>
          </div>
          {!uploading && (
            <button onClick={onCancel} aria-label="Cerrar" style={{ ...iconBtn, color: C.text3 }}>
              <X size={15} />
            </button>
          )}
        </div>
        <div style={{ padding: "18px 20px 20px", overflowY: "auto", flex: 1 }}>{children}</div>
      </div>
    </div>
  );
}

function ArchivoPreview({ file }: { file: File }) {
  return (
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
  );
}

function SubmitButtons({
  uploading, disabled, label, loadingLabel, onCancel, onConfirm,
}: {
  uploading: boolean; disabled?: boolean; label: string; loadingLabel: string;
  onCancel: () => void; onConfirm: () => void;
}) {
  const ok = !uploading && !disabled;
  return (
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
        onClick={onConfirm} disabled={!ok}
        style={{
          flex: 2, padding: "10px 0", borderRadius: 10, border: "none",
          background: ok ? C.primary : "rgba(255,107,53,0.5)",
          fontSize: 13, fontWeight: 700, color: "#fff",
          cursor: ok ? "pointer" : "default",
          fontFamily: "'Plus Jakarta Sans', sans-serif",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
        }}
      >
        {uploading
          ? <><Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> {loadingLabel}</>
          : label}
      </button>
    </div>
  );
}

// ── Modal: plano nuevo (pide disciplina y sector una sola vez) ────────────────
function NuevoPlanoModal({
  file, uploading, onConfirm, onCancel,
}: {
  file: File; uploading: boolean;
  onConfirm: (p: { discipline: string; name: string }) => void;
  onCancel: () => void;
}) {
  const [discipline, setDiscipline] = useState("arquitectura");
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState(false);

  function confirmar() {
    if (!name.trim()) { setNameError(true); return; }
    onConfirm({ discipline, name: name.trim() });
  }

  return (
    <ModalShell title="Plano nuevo" subtitle="¿A qué disciplina pertenece?" uploading={uploading} onCancel={onCancel}>
      <ArchivoPreview file={file} />

      <p style={{ ...labelStyle, margin: "0 0 10px" }}>Tipo de plano</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 18 }}>
        {DISCIPLINES.map(d => {
          const active = discipline === d.key;
          return (
            <button
              key={d.key} onClick={() => setDiscipline(d.key)} disabled={uploading}
              style={{
                display: "flex", alignItems: "flex-start", gap: 10,
                padding: "10px 12px", borderRadius: 10, cursor: "pointer", textAlign: "left",
                fontFamily: "'Plus Jakarta Sans', sans-serif",
                border: `1.5px solid ${active ? C.primary : C.line}`,
                background: active ? "rgba(255,107,53,0.06)" : C.surface,
                transition: "all 0.12s", opacity: uploading ? 0.6 : 1,
              }}
            >
              <span style={{
                width: 28, height: 28, borderRadius: 7, flexShrink: 0,
                background: active ? "rgba(255,107,53,0.12)" : C.bg,
                display: "flex", alignItems: "center", justifyContent: "center",
                color: active ? C.primary : C.text3,
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

      <p style={labelStyle}>Nombre del plano</p>
      <input
        value={name}
        onChange={e => { setName(e.target.value); if (nameError) setNameError(false); }}
        disabled={uploading} maxLength={255}
        placeholder='Ej: "Planta baja", "Tablero principal", "IE-01"'
        style={{
          ...inputStyle(uploading),
          marginBottom: nameError ? 6 : 18,
          borderColor: nameError ? "#A82B2B" : C.line,
        }}
      />
      {nameError && (
        <p style={{ margin: "0 0 18px", fontSize: 12, color: "#A82B2B", fontWeight: 600 }}>
          Poné un nombre para identificar el plano.
        </p>
      )}

      <SubmitButtons
        uploading={uploading} label="Subir plano" loadingLabel="Subiendo…"
        onCancel={onCancel} onConfirm={confirmar}
      />
    </ModalShell>
  );
}

// ── Fila de un plano, con su vigente y su historial ──────────────────────────
function DocumentoRow({
  doc, canDelete, onNuevaVersion, onDelete, onMarkVigente,
}: {
  doc: Documento;
  canDelete: boolean;
  onNuevaVersion: (doc: Documento) => void;
  onDelete: (p: Plano) => void;
  onMarkVigente: (p: Plano) => void;
}) {
  const [open, setOpen] = useState(false);
  const v = doc.vigente;
  const titulo = doc.name || v.original_filename || labelOf(doc.discipline);

  return (
    <div style={{ padding: "11px 16px", borderTop: `1px solid ${C.line}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
        <FileText size={16} color={C.primary} style={{ flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
            <span style={{
              fontSize: 13, fontWeight: 600, color: C.text,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>{titulo}</span>
            <span style={{
              fontSize: 10.5, fontWeight: 700, flexShrink: 0, color: C.good,
              background: "rgba(31,138,91,0.12)", padding: "2px 7px", borderRadius: 99,
            }}>vigente</span>
          </div>
          <div style={{ fontSize: 11.5, color: C.text3, marginTop: 2 }}>
            {doc.historial.length === 0 ? "Única versión" : `v${v.version}`}
            {" · "}actualizado {hace(v.created_at)}
            {v.file_size ? ` · ${fmtSize(v.file_size)}` : ""}
          </div>
        </div>
        {v.file_url && (
          <a href={v.file_url} target="_blank" rel="noreferrer" title="Descargar" style={iconBtn}>
            <Download size={14} />
          </a>
        )}
        <button onClick={() => onNuevaVersion(doc)} style={textBtn}>
          <Plus size={13} /> Nueva versión
        </button>
        {canDelete && (
          <button onClick={() => onDelete(v)} title="Eliminar" style={{ ...iconBtn, color: C.text3 }}>
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {doc.historial.length > 0 && (
        <>
          <button
            onClick={() => setOpen(o => !o)}
            style={{
              display: "flex", alignItems: "center", gap: 5, marginTop: 9,
              background: "transparent", border: "none", padding: 0, cursor: "pointer",
              fontSize: 11.5, fontWeight: 600, color: C.text2,
              fontFamily: "'Plus Jakarta Sans', sans-serif",
            }}
          >
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            {doc.historial.length} {doc.historial.length === 1 ? "versión anterior" : "versiones anteriores"}
          </button>
          {open && (
            <div style={{ marginLeft: 27, marginTop: 4 }}>
              {doc.historial.map(p => (
                <div key={p.id} style={{
                  display: "flex", alignItems: "center", gap: 9,
                  padding: "8px 0", borderTop: `1px solid ${C.line}`,
                }}>
                  {/* Una sola línea de texto a la izquierda: la versión ancla con
                      un poco más de peso y el resto la acompaña en el mismo tono.
                      El espacio flexible va después, para empujar las acciones. */}
                  <span style={{
                    flex: 1, minWidth: 0, fontSize: 12, color: C.text2,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    <span style={{ fontWeight: 600 }}>v{p.version}</span>
                    {p.uploaded_by_name ? ` · ${p.uploaded_by_name}` : ""}
                    {` · ${fmtCorta(p.created_at)}`}
                  </span>
                  {p.file_url && (
                    <a href={p.file_url} target="_blank" rel="noreferrer" title="Descargar"
                       style={{ ...iconBtn, width: 27, height: 27 }}>
                      <Download size={13} />
                    </a>
                  )}
                  {canDelete && (
                    <button
                      onClick={() => onMarkVigente(p)}
                      title="Pasa a ser la versión que se descarga y la que manda el bot"
                      style={{ ...textBtn, height: 27, color: C.text2 }}
                    >
                      <CheckCircle2 size={12} /> Usar esta versión
                    </button>
                  )}
                  {canDelete && (
                    <button onClick={() => onDelete(p)} title="Eliminar"
                            style={{ ...iconBtn, width: 27, height: 27, color: C.text3 }}>
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────
export function PlanosTab({ obraId }: { obraId: number }) {
  const { confirm } = useConfirm();
  const can = useCan();
  const canDelete = can("documentos.delete");

  const [planos, setPlanos] = useState<Plano[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [nuevoFile, setNuevoFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const nuevoRef = useRef<HTMLInputElement>(null);
  const versionRef = useRef<HTMLInputElement>(null);
  const versionTarget = useRef<Documento | null>(null);

  const load = useCallback(async () => {
    try { setPlanos(await fetchPlanos(obraId)); }
    catch { setError("No se pudieron cargar los planos."); }
    finally { setLoading(false); }
  }, [obraId]);

  useEffect(() => { load(); }, [load]);

  const porDisciplina = useMemo(() => agrupar(planos), [planos]);
  const total = planos.length;

  async function subirNuevo(p: { discipline: string; name: string }) {
    if (!nuevoFile) return;
    setUploading(true);
    try {
      await uploadPlano(obraId, nuevoFile, { discipline: p.discipline, name: p.name });
      await load();
      setNuevoFile(null);
    } catch (err) {
      setError(errorMessage(err, "No se pudo subir el plano. Probá con un archivo de hasta 25 MB."));
      setNuevoFile(null);
    } finally { setUploading(false); }
  }

  /** Sube directo: el plano ya quedó decidido al tocar "Nueva versión" en su fila,
   *  y no hay ningún dato más que pedir. La lista se recarga y muestra la vN nueva. */
  async function subirVersion(doc: Documento, file: File) {
    setUploading(true);
    try {
      await uploadPlano(obraId, file, {
        discipline: doc.discipline,
        replacesPlanoId: doc.vigente.id,
      });
      await load();
    } catch (err) {
      setError(errorMessage(err, "No se pudo subir la nueva versión."));
    } finally { setUploading(false); }
  }

  function pedirVersion(doc: Documento) {
    setError(null);
    versionTarget.current = doc;
    versionRef.current?.click();
  }

  async function remove(p: Plano) {
    const etiqueta = p.name || labelOf(p.discipline);
    if (!(await confirm({
      title: "Eliminar versión",
      message: `¿Eliminar "${etiqueta}" v${p.version}?`,
      confirmLabel: "Eliminar", danger: true,
    }))) return;
    try { await deletePlano(p.id); await load(); }
    catch (err) { setError(errorMessage(err, "No se pudo eliminar el plano.")); }
  }

  async function markVigente(p: Plano) {
    setError(null);
    try { await setPlanoVigente(p.id); await load(); }
    catch (err) { setError(errorMessage(err, "No se pudo cambiar a esa versión.")); }
  }

  const card: React.CSSProperties = {
    background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14,
  };

  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      {nuevoFile && (
        <NuevoPlanoModal
          file={nuevoFile} uploading={uploading}
          onConfirm={subirNuevo}
          onCancel={() => { if (!uploading) setNuevoFile(null); }}
        />
      )}

      {/* inputs ocultos: uno por acción, para no confundir los flujos */}
      <input
        ref={nuevoRef} type="file" hidden accept={ACCEPT}
        onChange={e => { const f = e.target.files?.[0]; if (f) { setError(null); setNuevoFile(f); } e.target.value = ""; }}
      />
      <input
        ref={versionRef} type="file" hidden accept={ACCEPT}
        onChange={e => {
          const f = e.target.files?.[0];
          const doc = versionTarget.current;
          if (f && doc) subirVersion(doc, f);
          e.target.value = "";
        }}
      />

      {/* ── Encabezado ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 12, marginBottom: 14,
      }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.text }}>Planos de obra</p>
          <p style={{ margin: "2px 0 0", fontSize: 12, color: C.text3 }}>
            {total === 0 ? "Todavía no hay planos cargados" : "Cada plano guarda su historial de revisiones"}
          </p>
        </div>
        <button
          onClick={() => { setError(null); nuevoRef.current?.click(); }}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0,
            background: C.primary, color: "#fff", border: "none", borderRadius: 10,
            padding: "9px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer",
            fontFamily: "'Plus Jakarta Sans', sans-serif",
          }}
        >
          <Plus size={15} /> Plano nuevo
        </button>
      </div>

      {error && (
        <p style={{ margin: "0 0 12px", fontSize: 12.5, color: "#A82B2B", fontWeight: 600 }}>{error}</p>
      )}

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
          y el bot les manda la versión vigente.
        </span>
      </div>

      {/* ── Lista ── */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 36, color: C.text3 }}>
          <Loader2 size={20} style={{ animation: "spin 1s linear infinite" }} />
        </div>
      ) : total === 0 ? (
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => {
            e.preventDefault(); setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) { setError(null); setNuevoFile(f); }
          }}
          onClick={() => nuevoRef.current?.click()}
          style={{
            ...card, padding: "40px 24px", textAlign: "center", cursor: "pointer",
            border: `1.5px dashed ${dragOver ? C.primary : C.line}`,
            background: dragOver ? "rgba(255,107,53,0.04)" : C.surface,
            transition: "all 0.15s",
          }}
        >
          <UploadCloud size={28} color={dragOver ? C.primary : C.text3} style={{ marginBottom: 8 }} />
          <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.text }}>Subí el primer plano</p>
          <p style={{ margin: "4px 0 0", fontSize: 12.5, color: C.text2 }}>
            Arrastralo acá o hacé click · PDF, imagen o CAD
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[...porDisciplina.entries()].map(([disc, docs]) => {
            const Icon = iconOf(disc);
            return (
              <div key={disc} style={card}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px" }}>
                  <Icon size={15} color={C.primary} style={{ flexShrink: 0 }} />
                  <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{labelOf(disc)}</span>
                  <span style={{
                    marginLeft: "auto", fontSize: 11, fontWeight: 600, color: C.text3,
                    background: C.bg, border: `1px solid ${C.line}`,
                    borderRadius: 99, padding: "2px 8px",
                  }}>
                    {docs.length} {docs.length === 1 ? "plano" : "planos"}
                  </span>
                </div>
                {docs.map(doc => (
                  <DocumentoRow
                    key={doc.key} doc={doc} canDelete={canDelete}
                    onNuevaVersion={pedirVersion}
                    onDelete={remove}
                    onMarkVigente={markVigente}
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
