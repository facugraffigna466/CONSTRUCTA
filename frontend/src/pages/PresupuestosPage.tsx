import { useCallback, useEffect, useRef, useState } from "react";
import {
  FileText, UploadCloud, Loader2, Trash2, AlertTriangle, X, GitCompare,
  CheckCircle2, Building2, Sparkles,
} from "lucide-react";
import {
  fetchBudgets, uploadBudget, createBudgetFromText, deleteBudget, compareBudgets,
} from "../api/budgets";
import { fetchObras } from "../api/obras";
import type { Budget, BudgetComparison, BudgetInconsistency, Obra } from "../types";

const C = {
  text: "#1A2329", text2: "#5B6770", text3: "#8E97A0",
  line: "#E6E7E5", surface: "#fff", bg: "#F4F5F4",
  primary: "#FF6B35", good: "#1F8A5B", warn: "#C97D0E", danger: "#D03A3A",
};

const SEV: Record<BudgetInconsistency["severidad"], { bg: string; color: string; label: string }> = {
  alta:  { bg: "#FCE5E5", color: "#A82B2B", label: "Alta" },
  media: { bg: "#FFF4E0", color: "#B45309", label: "Media" },
  baja:  { bg: "#EEF1F4", color: "#5B6770", label: "Baja" },
};

const SOURCE_LABEL: Record<Budget["source_type"], string> = {
  pdf: "PDF", image: "Imagen", excel: "Excel", texto: "Texto",
};

function money(n: number | null | undefined, cur = "ARS"): string {
  if (n == null) return "—";
  try {
    return new Intl.NumberFormat("es-AR", { style: "currency", currency: cur || "ARS", maximumFractionDigits: 0 }).format(n);
  } catch {
    return `$${Math.round(n).toLocaleString("es-AR")}`;
  }
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
}

export function PresupuestosPage() {
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [obras, setObras] = useState<Obra[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [text, setText] = useState("");
  const [obraId, setObraId] = useState<number | "">("");
  const [supplierName, setSupplierName] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [detail, setDetail] = useState<Budget | null>(null);
  const [comparison, setComparison] = useState<BudgetComparison | null>(null);
  const [comparing, setComparing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [b, o] = await Promise.all([fetchBudgets(), fetchObras()]);
      setBudgets(b);
      setObras(o);
    } catch {
      setError("No se pudieron cargar los presupuestos.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function runText() {
    if (!text.trim()) return;
    setProcessing(true); setError(null);
    try {
      const b = await createBudgetFromText({
        text: text.trim(),
        obra_id: obraId === "" ? null : obraId,
        supplier_name: supplierName.trim() || null,
      });
      setBudgets(prev => [b, ...prev]);
      setText(""); setSupplierName("");
      if (b.status === "error") setError(b.error ?? "La IA no pudo leer el presupuesto.");
    } catch {
      setError("No se pudo procesar el presupuesto. ¿Está cargada la ANTHROPIC_API_KEY en el backend?");
    } finally { setProcessing(false); }
  }

  async function runFile(file: File) {
    setProcessing(true); setError(null);
    try {
      const b = await uploadBudget(file, {
        obra_id: obraId === "" ? null : obraId,
        supplier_name: supplierName.trim() || null,
      });
      setBudgets(prev => [b, ...prev]);
      setSupplierName("");
      if (b.status === "error") setError(b.error ?? "La IA no pudo leer el archivo.");
    } catch {
      setError("No se pudo procesar el archivo. Probá con PDF, imagen, Excel o pegá el texto.");
    } finally { setProcessing(false); }
  }

  async function remove(id: number) {
    if (!confirm("¿Eliminar este presupuesto?")) return;
    try {
      await deleteBudget(id);
      setBudgets(prev => prev.filter(b => b.id !== id));
      setSelected(prev => { const n = new Set(prev); n.delete(id); return n; });
    } catch { /* noop */ }
  }

  function toggle(id: number) {
    setSelected(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  async function doCompare() {
    setComparing(true); setError(null);
    try {
      const result = await compareBudgets([...selected]);
      setComparison(result);
    } catch {
      setError("No se pudo comparar. Probá de nuevo.");
    } finally { setComparing(false); }
  }

  const card: React.CSSProperties = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16 };

  return (
    <div style={{ maxWidth: 880, margin: "0 auto", padding: "12px 0 48px", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 22 }}>
        <div style={{
          width: 48, height: 48, borderRadius: 13, flexShrink: 0,
          background: "linear-gradient(135deg, rgba(255,107,53,0.15), rgba(255,107,53,0.06))",
          border: "1px solid rgba(255,107,53,0.2)",
          display: "flex", alignItems: "center", justifyContent: "center", color: C.primary,
        }}>
          <FileText size={22} />
        </div>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: C.text, letterSpacing: "-0.02em" }}>
            Gestión de Presupuestos
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 13.5, color: C.text2, lineHeight: 1.5 }}>
            Cargá presupuestos de proveedores (PDF, Excel, imagen o texto) y la IA los lee, estructura y compara por vos.
          </p>
        </div>
      </div>

      {/* Upload / paste card */}
      <div style={{ ...card, padding: 20, marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
          <select
            value={obraId}
            onChange={e => setObraId(e.target.value === "" ? "" : Number(e.target.value))}
            style={selStyle}
          >
            <option value="">Sin obra asociada</option>
            {obras.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <input
            value={supplierName}
            onChange={e => setSupplierName(e.target.value)}
            placeholder="Proveedor (opcional — la IA lo detecta)"
            style={{ ...selStyle, flex: 1, minWidth: 200 }}
          />
        </div>

        {/* Drop zone */}
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => {
            e.preventDefault(); setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f && !processing) runFile(f);
          }}
          onClick={() => !processing && fileRef.current?.click()}
          style={{
            border: `1.5px dashed ${dragOver ? C.primary : C.line}`,
            background: dragOver ? "rgba(255,107,53,0.04)" : C.bg,
            borderRadius: 12, padding: "22px 16px", textAlign: "center",
            cursor: processing ? "default" : "pointer", transition: "all 0.15s", marginBottom: 12,
          }}
        >
          <input
            ref={fileRef} type="file" hidden
            accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,image/*"
            onChange={e => { const f = e.target.files?.[0]; if (f) runFile(f); e.target.value = ""; }}
          />
          <UploadCloud size={26} color={C.primary} style={{ marginBottom: 6 }} />
          <div style={{ fontSize: 13.5, fontWeight: 700, color: C.text }}>
            Arrastrá el presupuesto o hacé click para subirlo
          </div>
          <div style={{ fontSize: 12, color: C.text3, marginTop: 2 }}>
            PDF · imagen (foto del papel) · Excel — cualquier formato del proveedor
          </div>
        </div>

        {/* Or paste text */}
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="…o pegá el texto del presupuesto acá (lo que te mandó el proveedor por WhatsApp, mail, etc.)"
          rows={3}
          style={{
            width: "100%", boxSizing: "border-box", resize: "vertical",
            border: `1px solid ${C.line}`, borderRadius: 10, padding: "10px 12px",
            fontSize: 13, fontFamily: "'Plus Jakarta Sans', sans-serif", color: C.text, outline: "none",
          }}
        />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10, gap: 12 }}>
          <span style={{ fontSize: 12, color: C.text3, display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Sparkles size={13} color={C.primary} /> La IA detecta proveedor, ítems, IVA, plazos e inconsistencias.
          </span>
          <button
            onClick={runText}
            disabled={processing || !text.trim()}
            style={{
              display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 16px",
              borderRadius: 10, fontSize: 13, fontWeight: 700, border: "none",
              color: processing || !text.trim() ? "#8E97A0" : "#fff",
              background: processing || !text.trim() ? "#E6E7E5" : C.primary,
              cursor: processing || !text.trim() ? "default" : "pointer",
            }}
          >
            {processing ? <><Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Leyendo…</> : <>Leer con IA</>}
          </button>
        </div>
        {error && (
          <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "flex-start", background: "#FCE5E5", border: "1px solid #F3C6C6", borderRadius: 10, padding: "10px 12px" }}>
            <AlertTriangle size={15} color={C.danger} style={{ flexShrink: 0, marginTop: 1 }} />
            <span style={{ fontSize: 12.5, color: "#A82B2B" }}>{error}</span>
          </div>
        )}
      </div>

      {/* Compare bar */}
      {selected.size >= 2 && (
        <div style={{
          position: "sticky", top: 8, zIndex: 10, marginBottom: 16,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          background: C.text, color: "#fff", borderRadius: 12, padding: "10px 14px",
          boxShadow: "0 8px 24px -8px rgba(0,0,0,0.3)",
        }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>
            {selected.size} presupuestos seleccionados para comparar
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setSelected(new Set())} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.25)", background: "transparent", color: "#fff", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
              Limpiar
            </button>
            <button onClick={doCompare} disabled={comparing} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 8, border: "none", background: C.primary, color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
              {comparing ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <GitCompare size={13} />}
              Comparar
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: C.text3 }}>
          <Loader2 size={22} style={{ animation: "spin 1s linear infinite" }} />
        </div>
      ) : budgets.length === 0 ? (
        <div style={{ ...card, padding: "40px 24px", textAlign: "center" }}>
          <FileText size={30} color={C.text3} style={{ marginBottom: 8 }} />
          <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.text }}>Todavía no cargaste presupuestos</p>
          <p style={{ margin: "4px 0 0", fontSize: 12.5, color: C.text2 }}>
            Subí el primero arriba — la IA lo lee en segundos y te marca lo que falta.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {budgets.map(b => {
            const inc = b.inconsistencies?.length ?? 0;
            const sel = selected.has(b.id);
            return (
              <div key={b.id} style={{
                ...card, padding: "14px 16px", display: "flex", alignItems: "center", gap: 14,
                borderColor: sel ? C.primary : C.line,
                boxShadow: sel ? "0 0 0 1px #FF6B35" : "none",
              }}>
                <input
                  type="checkbox" checked={sel} onChange={() => toggle(b.id)}
                  title="Seleccionar para comparar"
                  style={{ width: 17, height: 17, accentColor: C.primary, cursor: "pointer", flexShrink: 0 }}
                />
                <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => setDetail(b)}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {b.supplier_name || "Proveedor sin identificar"}
                    </span>
                    {b.rubro && <span style={{ fontSize: 11, fontWeight: 600, color: C.primary, background: "rgba(255,107,53,0.1)", padding: "2px 8px", borderRadius: 99 }}>{b.rubro}</span>}
                    <span style={{ fontSize: 10.5, fontWeight: 600, color: C.text3, background: C.bg, padding: "2px 7px", borderRadius: 99 }}>{SOURCE_LABEL[b.source_type]}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4, fontSize: 12, color: C.text2 }}>
                    {b.obra_name && <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Building2 size={12} /> {b.obra_name}</span>}
                    <span>{fmtDate(b.created_at)}</span>
                    {b.status === "error" && <span style={{ color: C.danger, fontWeight: 600 }}>Error de lectura</span>}
                    {inc > 0 && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: C.warn, fontWeight: 600 }}>
                        <AlertTriangle size={12} /> {inc} {inc === 1 ? "alerta" : "alertas"}
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: C.text, fontVariantNumeric: "tabular-nums" }}>
                    {money(b.total, b.currency)}
                  </div>
                </div>
                <button onClick={() => remove(b.id)} title="Eliminar" style={{ flexShrink: 0, width: 30, height: 30, borderRadius: 8, border: `1px solid ${C.line}`, background: C.surface, color: C.text3, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {detail && <BudgetDetailModal budget={detail} onClose={() => setDetail(null)} />}
      {comparison && <ComparisonModal data={comparison} onClose={() => setComparison(null)} />}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

const selStyle: React.CSSProperties = {
  border: `1px solid ${C.line}`, borderRadius: 10, padding: "9px 11px",
  fontSize: 13, fontFamily: "'Plus Jakarta Sans', sans-serif", color: C.text,
  background: C.surface, outline: "none",
};

// ─── Detail modal ──────────────────────────────────────────────────────────────

function BudgetDetailModal({ budget, onClose }: { budget: Budget; onClose: () => void }) {
  const d = budget.data;
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={e => e.stopPropagation()} style={{ ...modal, maxWidth: 640 }}>
        <ModalHeader title={budget.supplier_name || "Presupuesto"} subtitle={budget.rubro ?? undefined} onClose={onClose} />
        <div style={{ padding: "18px 22px", overflowY: "auto" }}>
          {!d ? (
            <p style={{ fontSize: 13, color: C.danger }}>{budget.error ?? "No se pudo leer este presupuesto."}</p>
          ) : (
            <>
              {/* Items table */}
              {d.items.length > 0 && (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, marginBottom: 16 }}>
                  <thead>
                    <tr style={{ textAlign: "left", color: C.text3 }}>
                      <th style={th}>Ítem</th>
                      <th style={{ ...th, textAlign: "right" }}>Cant.</th>
                      <th style={{ ...th, textAlign: "right" }}>P. unit.</th>
                      <th style={{ ...th, textAlign: "right" }}>Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.items.map((it, i) => (
                      <tr key={i} style={{ borderTop: `1px solid ${C.line}` }}>
                        <td style={td}>{it.descripcion}</td>
                        <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>{it.cantidad ?? "—"} {it.unidad ?? ""}</td>
                        <td style={{ ...td, textAlign: "right" }}>{money(it.precio_unitario, d.moneda)}</td>
                        <td style={{ ...td, textAlign: "right", fontWeight: 600 }}>{money(it.subtotal, d.moneda)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {/* Totals */}
              <div style={{ background: C.bg, borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
                <Row label="Subtotal" value={money(d.subtotal, d.moneda)} />
                <Row label={`IVA${d.iva_pct ? ` (${d.iva_pct}%)` : ""}`} value={money(d.iva_monto, d.moneda)} />
                <div style={{ borderTop: `1px solid ${C.line}`, margin: "8px 0" }} />
                <Row label="Total" value={money(d.total, d.moneda)} bold />
              </div>

              {/* Conditions */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: d.inconsistencias.length ? 16 : 0 }}>
                <Cond label="Plazo de entrega" value={d.plazo_entrega} />
                <Cond label="Condiciones de pago" value={d.condiciones_pago} />
                <Cond label="Validez" value={d.validez} />
                <Cond label="Flete" value={d.incluye_flete == null ? null : d.incluye_flete ? "Incluido" : "No incluido"} />
              </div>

              {/* Inconsistencies */}
              {d.inconsistencias.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: C.text3, textTransform: "uppercase", marginBottom: 8 }}>
                    Inconsistencias detectadas
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {d.inconsistencias.map((x, i) => (
                      <div key={i} style={{ display: "flex", gap: 9, alignItems: "flex-start", background: SEV[x.severidad].bg, borderRadius: 10, padding: "9px 11px" }}>
                        <AlertTriangle size={14} color={SEV[x.severidad].color} style={{ flexShrink: 0, marginTop: 1 }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 700, color: SEV[x.severidad].color }}>{x.tipo}</div>
                          <div style={{ fontSize: 12, color: C.text2, marginTop: 1 }}>{x.detalle}</div>
                        </div>
                        <span style={{ fontSize: 10, fontWeight: 700, color: SEV[x.severidad].color, opacity: 0.8 }}>{SEV[x.severidad].label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Comparison modal ───────────────────────────────────────────────────────────

function ComparisonModal({ data, onClose }: { data: BudgetComparison; onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={e => e.stopPropagation()} style={{ ...modal, maxWidth: 720 }}>
        <ModalHeader title="Comparación de presupuestos" subtitle={data.promedio != null ? `Promedio: ${money(data.promedio)}` : undefined} onClose={onClose} />
        <div style={{ padding: "18px 22px", overflowY: "auto" }}>
          {/* Recommendation */}
          {data.recomendacion && (
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start", background: "rgba(255,107,53,0.06)", border: "1px solid rgba(255,107,53,0.2)", borderRadius: 12, padding: "13px 15px", marginBottom: 16 }}>
              <Sparkles size={16} color={C.primary} style={{ flexShrink: 0, marginTop: 1 }} />
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: C.primary, textTransform: "uppercase", marginBottom: 3 }}>
                  Recomendación de la IA
                </div>
                <div style={{ fontSize: 13, color: C.text, lineHeight: 1.55 }}>
                  {data.recomendacion.replace(/\*\*/g, "")}
                </div>
              </div>
            </div>
          )}

          {/* Cards */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {data.rows.map(r => (
              <div key={r.budget_id} style={{
                border: `1px solid ${r.es_mas_barato ? C.good : C.line}`,
                background: r.es_mas_barato ? "rgba(31,138,91,0.04)" : C.surface,
                borderRadius: 12, padding: "13px 15px",
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{r.supplier_name || "Proveedor"}</span>
                    {r.es_mas_barato && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, fontWeight: 700, color: C.good, background: "rgba(31,138,91,0.12)", padding: "2px 8px", borderRadius: 99 }}>
                        <CheckCircle2 size={11} /> Más económico
                      </span>
                    )}
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: C.text, fontVariantNumeric: "tabular-nums" }}>{money(r.total, r.currency)}</div>
                    {r.pct_vs_promedio != null && r.pct_vs_promedio !== 0 && (
                      <div style={{ fontSize: 11, fontWeight: 600, color: r.pct_vs_promedio > 0 ? C.danger : C.good }}>
                        {r.pct_vs_promedio > 0 ? "+" : ""}{r.pct_vs_promedio}% vs promedio
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px", marginTop: 8, fontSize: 12, color: C.text2 }}>
                  <span><b style={{ color: C.text3, fontWeight: 600 }}>Plazo:</b> {r.plazo_entrega || "—"}</span>
                  <span><b style={{ color: C.text3, fontWeight: 600 }}>Pago:</b> {r.condiciones_pago || "—"}</span>
                  <span><b style={{ color: C.text3, fontWeight: 600 }}>Validez:</b> {r.validez || "—"}</span>
                  <span><b style={{ color: C.text3, fontWeight: 600 }}>Flete:</b> {r.incluye_flete == null ? "—" : r.incluye_flete ? "Sí" : "No"}</span>
                </div>
                {r.flags.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 9 }}>
                    {r.flags.map((f, i) => (
                      <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, color: C.warn, background: "#FFF4E0", padding: "3px 9px", borderRadius: 99 }}>
                        <AlertTriangle size={11} /> {f}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Shared bits ────────────────────────────────────────────────────────────────

const overlay: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 80, background: "rgba(15,22,28,0.5)",
  display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
};
const modal: React.CSSProperties = {
  background: "#fff", borderRadius: 18, width: "100%", maxHeight: "88vh",
  display: "flex", flexDirection: "column", overflow: "hidden",
  fontFamily: "'Plus Jakarta Sans', sans-serif",
  boxShadow: "0 32px 64px -16px rgba(15,22,28,0.4)",
};
const th: React.CSSProperties = { padding: "0 8px 6px", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" };
const td: React.CSSProperties = { padding: "8px", color: C.text, verticalAlign: "top" };

function ModalHeader({ title, subtitle, onClose }: { title: string; subtitle?: string; onClose: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 22px", borderBottom: `1px solid ${C.line}` }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: C.text }}>{title}</h2>
        {subtitle && <p style={{ margin: "2px 0 0", fontSize: 12.5, color: C.text2 }}>{subtitle}</p>}
      </div>
      <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 8, border: `1px solid ${C.line}`, background: "#fff", color: C.text2, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
        <X size={16} />
      </button>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: bold ? 14 : 12.5, padding: "2px 0" }}>
      <span style={{ color: bold ? C.text : C.text2, fontWeight: bold ? 700 : 400 }}>{label}</span>
      <span style={{ color: C.text, fontWeight: bold ? 800 : 600, fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );
}

function Cond({ label, value }: { label: string; value: string | null }) {
  return (
    <div style={{ background: C.bg, borderRadius: 9, padding: "8px 11px" }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: C.text3, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontSize: 12.5, color: value ? C.text : C.text3, marginTop: 2 }}>{value || "No especificado"}</div>
    </div>
  );
}
