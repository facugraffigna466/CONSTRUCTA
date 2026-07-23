import { useRef, useState } from "react";
import { confirmImport, detectMapping, previewImport, type AiMappingResult, type ImportPreviewRow } from "../api/imports";
import { downloadTemplateExcel } from "../api/exports";
import { useDialog } from "../hooks/useDialog";
import { Sparkles, Database, Zap } from "lucide-react";

interface Props {
  obraId: number;
  onClose: () => void;
  onImported: (count: number) => void;
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export function ImportModal({ obraId, onClose, onImported }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<"upload" | "mapping" | "preview" | "done">("upload");
  const [aiMapping, setAiMapping] = useState<AiMappingResult | null>(null);
  const [editedMapping, setEditedMapping] = useState<Record<string, string | null>>({});
  const [rows, setRows] = useState<ImportPreviewRow[]>([]);
  const [columnMap, setColumnMap] = useState<Record<string, string>>({});
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null);
  const [source, setSource] = useState<string>("excel");
  const [downloadingTpl, setDownloadingTpl] = useState(false);
  const [lastFile, setLastFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [showRemap, setShowRemap] = useState(false);
  const [remap, setRemap] = useState<Record<string, string>>({});

  // Esc + foco atrapado + role=dialog (reemplaza el listener manual de Esc).
  const dialogRef = useDialog(onClose);

  async function handleFile(file: File, columnMap?: Record<string, string>) {
    setLoading(true);
    setError(null);
    const isXml = file.name.toLowerCase().endsWith(".xml");
    try {
      // XML de MS Project → saltar paso de mapeo, ir directo al preview
      if (isXml) {
        const preview = await previewImport(file, columnMap);
        setLastFile(file);
        setHeaders(preview.headers ?? []);
        setRows(preview.rows);
        setColumnMap(preview.column_map);
        setSource("msproject");
        setStep("preview");
        return;
      }
      // Excel / CSV → detectar columnas con IA primero
      const result = await detectMapping(file);
      setLastFile(file);
      setAiMapping(result);
      setEditedMapping(result.mapping);
      setStep("mapping");
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg ?? "No se pudo procesar el archivo. Verificá que sea un .xlsx o .csv válido.");
    } finally {
      setLoading(false);
    }
  }

  const [retrying, setRetrying] = useState(false);

  async function retryWithAi() {
    if (!lastFile) return;
    setRetrying(true);
    setError(null);
    try {
      // Forzamos nueva llamada subiendo el archivo de nuevo
      const result = await detectMapping(lastFile);
      setAiMapping(result);
      setEditedMapping(result.mapping);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg ?? "No se pudo usar la IA. Verificá que tengas una API key configurada.");
    } finally {
      setRetrying(false);
    }
  }

  async function handleConfirmMapping() {
    if (!lastFile) return;
    setLoading(true);
    setError(null);
    try {
      // Construir column_overrides desde el mapeo editado por el usuario
      const overrides: Record<string, string> = {};
      for (const [field, col] of Object.entries(editedMapping)) {
        if (col) overrides[field] = col;
      }
      const preview = await previewImport(lastFile, overrides);
      setHeaders(preview.headers ?? []);
      setRows(preview.rows);
      setColumnMap(preview.column_map);
      setSource(preview.source ?? "excel");
      setStep("preview");
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg ?? "No se pudo procesar el archivo.");
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm() {
    const importableRows = rows.filter(r => !r.error);
    setConfirming(true);
    setError(null);
    try {
      const res = await confirmImport(obraId, importableRows);
      setResult({ created: res.created, skipped: res.skipped });
      setStep("done");
      onImported(res.created);
    } catch {
      setError("Error al importar. Intentá de nuevo.");
    } finally {
      setConfirming(false);
    }
  }

  const importableCount = rows.filter(r => !r.error).length;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 60,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(15,22,28,0.55)", backdropFilter: "blur(3px)", padding: 16,
    }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Importar tareas" style={{
        background: "#fff", borderRadius: 18, width: "100%", maxWidth: 620,
        boxShadow: "0 32px 64px -16px rgba(15,22,28,0.30), 0 8px 24px -8px rgba(15,22,28,0.12)",
        maxHeight: "90vh", display: "flex", flexDirection: "column",
        fontFamily: "'Plus Jakarta Sans', sans-serif",
      }}>
        {/* Header */}
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid #F0F1EF", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#1A2329", letterSpacing: "-0.02em" }}>
              Importar desde MS Project / Excel
            </h2>
            <p style={{ margin: "3px 0 0", fontSize: 12.5, color: "#5B6770" }}>
              Subí un .xlsx exportado de Project o cualquier planilla con columnas de tareas
            </p>
          </div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid #E6E7E5", background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#6B7580" }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>

          {/* ── Step 1: Upload ── */}
          {step === "upload" && (
            <div
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
              onClick={() => inputRef.current?.click()}
              style={{
                border: `2px dashed ${dragging ? "#FF6B35" : "#D5D7D3"}`,
                borderRadius: 14, padding: "40px 20px",
                textAlign: "center", cursor: "pointer",
                background: dragging ? "#FFF6F1" : "#FAFAFA",
                transition: "all 0.15s",
              }}
            >
              <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv,.xml" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
              <svg width="36" height="36" viewBox="0 0 40 40" fill="none" style={{ margin: "0 auto 12px" }}>
                <rect width="40" height="40" rx="12" fill="#FFF0E8"/>
                <path d="M20 12v12M14 16l6-6 6 6" stroke="#E76A2D" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M12 28h16" stroke="#E76A2D" strokeWidth="2" strokeLinecap="round"/>
              </svg>
              {loading ? (
                <p style={{ margin: 0, fontSize: 14, color: "#5B6770" }}>Procesando archivo…</p>
              ) : (
                <>
                  <p style={{ margin: "0 0 6px", fontSize: 14, fontWeight: 600, color: "#1A2329" }}>
                    Arrastrá el archivo aquí o hacé click para seleccionarlo
                  </p>
                  <p style={{ margin: 0, fontSize: 12, color: "#6B7580" }}>.xml o .xlsx exportado de MS Project · .csv · máx. 10 MB</p>
                </>
              )}
            </div>
          )}

          {/* ── Step 2: Mapping ── */}
          {step === "mapping" && aiMapping && (() => {
            const FIELD_LABELS: Record<string, string> = {
              title: "Título de la tarea",
              start_date: "Fecha de inicio",
              due_date: "Fecha de fin",
              responsible: "Responsable",
              predecessors: "Predecesoras",
            };
            const sourceInfo = {
              ai:    { Icon: Sparkles, label: "Detectado con IA",  color: "#7C3AED", bg: "#F3F0FF" },
              cache: { Icon: Database, label: "Desde caché",       color: "#1D6FA4", bg: "#EBF3FF" },
              alias: { Icon: Zap,      label: "Detección automática", color: "#1F8A5B", bg: "#E4F3EC" },
            }[aiMapping.source] ?? { Icon: Zap, label: "Automático", color: "#1F8A5B", bg: "#E4F3EC" };
            const { Icon, label, color, bg } = sourceInfo;
            const { used, limit, plan } = aiMapping.usage;
            // Mostrar botón IA solo cuando la detección automática dejó campos vacíos
            const hasNullFields = Object.values(editedMapping).some(v => !v);
            const showAiButton = aiMapping.source === "alias" && hasNullFields;
            return (
              <div>
                {/* Fuente + uso + botón reintentar */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 99, background: bg, fontSize: 12, fontWeight: 700, color }}>
                      <Icon size={12} /> {label}
                    </span>
                    {/* Botón reintentar con IA solo cuando hay campos sin detectar automáticamente */}
                    {showAiButton && (
                      <button
                        onClick={retryWithAi}
                        disabled={retrying}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 5,
                          padding: "4px 10px", borderRadius: 99, cursor: retrying ? "default" : "pointer",
                          fontSize: 12, fontWeight: 700,
                          border: "1.5px solid #7C3AED",
                          background: retrying ? "#F3F0FF" : "#fff",
                          color: "#7C3AED",
                          opacity: retrying ? 0.7 : 1,
                        }}
                      >
                        <Sparkles size={12} />
                        {retrying ? "Analizando…" : "Detectar con IA"}
                      </button>
                    )}
                  </div>
                  {/* Mostrar contador solo cuando hay uso de IA (source ai/cache) o cuando el botón IA es visible */}
                  {(showAiButton || aiMapping.source === "ai" || aiMapping.source === "cache") && limit !== null && (
                    <span style={{ fontSize: 11.5, color: "#8E97A0" }}>
                      {used} de {limit} detecciones IA · plan <b>{plan}</b>
                    </span>
                  )}
                </div>

                {/* Tabla de mapeo editable */}
                <div style={{ border: "1px solid #E6E7E5", borderRadius: 12, overflow: "hidden", marginBottom: 14 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", background: "#F8F9F8", borderBottom: "1px solid #E6E7E5" }}>
                    <div style={{ padding: "8px 14px", fontSize: 10.5, fontWeight: 700, color: "#6B7580", textTransform: "uppercase", letterSpacing: "0.07em" }}>Campo en CONSTRUCTA</div>
                    <div style={{ padding: "8px 14px", fontSize: 10.5, fontWeight: 700, color: "#6B7580", textTransform: "uppercase", letterSpacing: "0.07em" }}>Columna en tu archivo</div>
                  </div>
                  {Object.entries(FIELD_LABELS).map(([field, label], i, arr) => {
                    const val = editedMapping[field] ?? null;
                    const isRequired = field === "title";
                    return (
                      <div key={field} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", borderBottom: i < arr.length - 1 ? "1px solid #F0F1EF" : "none", background: i % 2 === 0 ? "#fff" : "#FAFAFA" }}>
                        <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: "#1A2329" }}>{label}</span>
                          {isRequired && <span style={{ fontSize: 10, fontWeight: 700, color: "#D03A3A", background: "#FCE5E5", padding: "1px 5px", borderRadius: 4 }}>requerido</span>}
                        </div>
                        <div style={{ padding: "7px 12px", display: "flex", alignItems: "center" }}>
                          <select
                            value={val ?? ""}
                            onChange={e => setEditedMapping(prev => ({ ...prev, [field]: e.target.value || null }))}
                            style={{
                              width: "100%", padding: "6px 8px", fontSize: 12.5,
                              border: `1px solid ${val ? "#E6E7E5" : isRequired ? "#F5A8A8" : "#E6E7E5"}`,
                              borderRadius: 8, background: "#fff", color: val ? "#1A2329" : "#8E97A0",
                              fontFamily: "'Plus Jakarta Sans', sans-serif", cursor: "pointer",
                            }}
                          >
                            <option value="">— sin columna —</option>
                            {aiMapping.headers.map(h => <option key={h} value={h}>{h}</option>)}
                          </select>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <p style={{ margin: 0, fontSize: 12, color: "#8E97A0" }}>
                  Revisá que cada campo apunte a la columna correcta de tu archivo. Podés corregirlo antes de continuar.
                </p>
              </div>
            );
          })()}

          {/* ── Step 3: Preview ── */}
          {step === "preview" && (
            <div>
              {source === "msproject" && (
                <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 12, padding: "4px 10px", borderRadius: 99, background: "#EBF3FF", border: "1px solid #B8CCF5", fontSize: 11.5, fontWeight: 700, color: "#2A62C9" }}>
                  <svg width="11" height="11" viewBox="0 0 14 14" fill="none"><rect x="1" y="1" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.4"/><path d="M4 9.5V4.5l3 3 3-3v5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  MS Project — se importan subtareas, hitos y dependencias con lag
                </div>
              )}
              {/* Column map detected — "Campo ← Columna" */}
              {source !== "msproject" && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    {(["title", "start_date", "due_date", "responsible", "predecessors"] as const).map(field => {
                      const LABELS: Record<string, string> = { title: "Título", start_date: "Inicio", due_date: "Fin", responsible: "Responsable", predecessors: "Predecesoras" };
                      const col = columnMap[field];
                      return (
                        <span key={field} style={{
                          fontSize: 11.5, padding: "3px 8px", borderRadius: 6, fontWeight: 600,
                          background: col ? "#E4F3EC" : "#F4F5F4",
                          color: col ? "#136E47" : "#8E97A0",
                        }}>
                          {LABELS[field]} ← {col ?? "no detectada"}
                        </span>
                      );
                    })}
                    {headers.length > 0 && (
                      <button
                        onClick={() => setShowRemap(v => !v)}
                        style={{ fontSize: 11.5, fontWeight: 700, color: "#2A62C9", background: "none", border: "none", cursor: "pointer", padding: "3px 6px" }}
                      >
                        {showRemap ? "Ocultar remapeo" : "Remapear columnas"}
                      </button>
                    )}
                  </div>

                  {showRemap && (
                    <div style={{ marginTop: 10, padding: "12px 14px", background: "#F8F9F8", borderRadius: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                      {(["title", "start_date", "due_date", "responsible", "predecessors"] as const).map(field => {
                        const LABELS: Record<string, string> = { title: "Título", start_date: "Inicio", due_date: "Fin", responsible: "Responsable", predecessors: "Predecesoras" };
                        return (
                          <div key={field} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: "#3E4A52", width: 110 }}>{LABELS[field]}</span>
                            <select
                              value={remap[field] ?? columnMap[field] ?? ""}
                              onChange={e => setRemap(prev => ({ ...prev, [field]: e.target.value }))}
                              style={{ flex: 1, padding: "5px 8px", fontSize: 12, borderRadius: 7, border: "1px solid #E6E7E5", cursor: "pointer" }}
                            >
                              <option value="">— sin columna —</option>
                              {headers.map(h => <option key={h} value={h}>{h}</option>)}
                            </select>
                          </div>
                        );
                      })}
                      <button
                        onClick={() => { if (lastFile) { setShowRemap(false); handleFile(lastFile, { ...Object.fromEntries(Object.entries(columnMap)), ...remap }); } }}
                        disabled={loading || !lastFile}
                        style={{ alignSelf: "flex-end", padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 700, color: "#fff", background: "#FF6B35", border: "none", cursor: "pointer" }}
                      >
                        {loading ? "Reprocesando…" : "Aplicar mapeo"}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Preview table */}
              <div style={{ borderRadius: 10, border: "1px solid #E6E7E5", overflow: "hidden" }}>
                {/* Header */}
                <div style={{ display: "grid", gridTemplateColumns: "32px 1fr 140px 110px 110px", background: "#F8F9F8", borderBottom: "1px solid #E6E7E5" }}>
                  {["#", "Título", "Responsable", "Inicio", "Vencimiento"].map(h => (
                    <div key={h} style={{ padding: "8px 10px", fontSize: 10.5, fontWeight: 700, color: "#6B7580", textTransform: "uppercase", letterSpacing: "0.07em" }}>{h}</div>
                  ))}
                </div>
                {rows.map((row, i) => (
                  <div key={i} style={{
                    display: "grid", gridTemplateColumns: "32px 1fr 140px 110px 110px",
                    background: row.error ? "#FFFAFA" : row.warning ? "#FFFBF0" : i % 2 === 0 ? "#fff" : "#FAFAFA",
                    borderBottom: i < rows.length - 1 ? "1px solid #F0F1EF" : "none",
                  }}>
                    <div style={{ padding: "9px 10px", fontSize: 11.5, color: "#6B7580", fontWeight: 600, display: "flex", alignItems: "center" }}>{i + 1}</div>
                    <div style={{ padding: "9px 10px", display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: row.error ? "#D03A3A" : "#1A2329", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.title}</span>
                      {row.error && <span style={{ fontSize: 11, color: "#D03A3A" }}>{row.error}</span>}
                      {row.warning && !row.error && <span style={{ fontSize: 11, color: "#C97D0E" }}>{row.warning}</span>}
                    </div>
                    <div style={{ padding: "9px 10px", fontSize: 12.5, color: row.responsible_name ? "#1A2329" : "#C4C9C6", display: "flex", alignItems: "center", overflow: "hidden" }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.responsible_name ?? "—"}</span>
                    </div>
                    <div style={{ padding: "9px 10px", fontSize: 12.5, color: row.start_date ? "#1A2329" : "#C4C9C6", display: "flex", alignItems: "center" }}>{fmtDate(row.start_date)}</div>
                    <div style={{ padding: "9px 10px", fontSize: 12.5, color: row.due_date ? "#1A2329" : "#C4C9C6", display: "flex", alignItems: "center" }}>{fmtDate(row.due_date)}</div>
                  </div>
                ))}
              </div>

              {/* Summary */}
              <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12.5, padding: "4px 10px", borderRadius: 6, background: "#E4F3EC", color: "#136E47", fontWeight: 600 }}>
                  ✓ {importableCount} listas para importar
                </span>
                {rows.filter(r => r.warning && !r.error).length > 0 && (
                  <span style={{ fontSize: 12.5, padding: "4px 10px", borderRadius: 6, background: "#FDF1DE", color: "#C97D0E", fontWeight: 600 }}>
                    ⚠ {rows.filter(r => r.warning && !r.error).length} con advertencias
                  </span>
                )}
                {rows.filter(r => r.error).length > 0 && (
                  <span style={{ fontSize: 12.5, padding: "4px 10px", borderRadius: 6, background: "#FCE5E5", color: "#D03A3A", fontWeight: 600 }}>
                    ✕ {rows.filter(r => r.error).length} serán omitidas
                  </span>
                )}
              </div>
            </div>
          )}

          {/* ── Step 3: Done ── */}
          {step === "done" && result && (
            <div style={{ textAlign: "center", padding: "24px 0" }}>
              <div style={{ width: 56, height: 56, borderRadius: 16, background: "#E4F3EC", border: "1px solid #BFE3CE", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="#1F8A5B" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
              <h3 style={{ margin: "0 0 6px", fontSize: 18, fontWeight: 700, color: "#1A2329" }}>
                {result.created} {result.created === 1 ? "tarea importada" : "tareas importadas"}
              </h3>
              {result.skipped > 0 && (
                <p style={{ margin: 0, fontSize: 13, color: "#6B7580" }}>{result.skipped} filas omitidas</p>
              )}
            </div>
          )}

          {error && (
            <div style={{ marginTop: 14, padding: "10px 14px", background: "#FCE5E5", borderRadius: 10, fontSize: 12.5, color: "#D03A3A", fontWeight: 600 }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "14px 24px 20px", borderTop: "1px solid #F0F1EF", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          {step === "upload" && (
            <button
              onClick={async () => {
                setDownloadingTpl(true);
                try { await downloadTemplateExcel(); } catch { setError("No se pudo descargar la plantilla."); }
                setDownloadingTpl(false);
              }}
              disabled={downloadingTpl}
              style={{ marginRight: "auto", display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 14px", borderRadius: 10, fontSize: 12.5, fontWeight: 600, color: "#5B6770", background: "#fff", border: "1px solid #E6E7E5", cursor: "pointer", opacity: downloadingTpl ? 0.6 : 1 }}
            >
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M7 1v8M3.5 6L7 9.5 10.5 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M2 12.5h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              {downloadingTpl ? "Descargando…" : "Descargar plantilla"}
            </button>
          )}
          <button
            onClick={() => step === "mapping" ? (setStep("upload"), setAiMapping(null)) : onClose()}
            style={{ padding: "9px 18px", borderRadius: 10, fontSize: 13, fontWeight: 600, color: "#5B6770", background: "#fff", border: "1px solid #E6E7E5", cursor: "pointer" }}
          >
            {step === "done" ? "Cerrar" : step === "mapping" ? "← Volver" : "Cancelar"}
          </button>
          {step === "mapping" && (
            <button
              onClick={handleConfirmMapping}
              disabled={loading || !editedMapping["title"]}
              style={{
                padding: "9px 20px", borderRadius: 10, fontSize: 13, fontWeight: 600, color: "#fff",
                background: loading || !editedMapping["title"] ? "#FFAA80" : "#FF6B35",
                border: "none", cursor: loading || !editedMapping["title"] ? "not-allowed" : "pointer",
                boxShadow: "0 4px 12px -4px rgba(255,107,53,0.4)",
              }}
            >
              {loading ? "Procesando…" : "Confirmar y previsualizar →"}
            </button>
          )}
          {step === "preview" && importableCount > 0 && (
            <button
              onClick={handleConfirm}
              disabled={confirming}
              style={{
                padding: "9px 20px", borderRadius: 10, fontSize: 13, fontWeight: 600, color: "#fff",
                background: confirming ? "#FFAA80" : "#FF6B35", border: "none",
                cursor: confirming ? "not-allowed" : "pointer",
                boxShadow: confirming ? "none" : "0 4px 12px -4px rgba(255,107,53,0.5)",
              }}
            >
              {confirming ? "Importando…" : `Importar ${importableCount} ${importableCount === 1 ? "tarea" : "tareas"}`}
            </button>
          )}
          {step === "upload" && (
            <button
              onClick={() => inputRef.current?.click()}
              disabled={loading}
              style={{
                padding: "9px 20px", borderRadius: 10, fontSize: 13, fontWeight: 600, color: "#fff",
                background: "#FF6B35", border: "none", cursor: "pointer",
                opacity: loading ? 0.6 : 1,
              }}
            >
              Seleccionar archivo
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
