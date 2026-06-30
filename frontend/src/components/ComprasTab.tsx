import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, Brain, CheckCircle2, ChevronDown, ChevronRight, ChevronLeft,
  Clock, CreditCard, Download, Loader2, Mail, MessageCircle,
  Package, PackageCheck, Plus, SendHorizonal, ShoppingCart, Sparkles,
  ThumbsDown, ThumbsUp, Trash2, Truck, X,
} from "lucide-react";
import {
  confirmarContratistaProveedor,
  confirmarProveedor,
  createPurchaseOrder,
  createSolicitud,
  deleteSolicitud,
  exportPresupuestoExcel,
  fetchAnalisisCompras,
  fetchPresupuesto,
  fetchPurchaseOrders,
  fetchSolicitudes,
  receivePurchaseOrder,
  sendPurchaseOrder,
  type PresupuestoResponse,
  type PresupuestoRow,
  type PurchaseOrder,
} from "../api/purchaseOrders";
import { fetchSuppliers } from "../api/suppliers";
import { createMaterial } from "../api/taskMaterials";
import { fetchObraTeam } from "../api/obraTeam";
import type {
  AnalisisComparativo,
  AnalisisHistoricoCompras,
  ObraTeamMember,
  RespuestaCotizacion,
  SolicitudCotizacion,
  Supplier,
  Task,
} from "../types";

const FONT = "'Plus Jakarta Sans', sans-serif";
const MONO = "'JetBrains Mono', monospace";
const COLS = "1fr 75px 110px 105px 130px 85px";

type ModuleId = "materiales" | "cotizaciones" | "pedidos" | "analisis";

const STATUS_META: Record<string, { label: string; dot: string; bg: string; color: string }> = {
  pendiente: { label: "Pendiente", dot: "#3B82F6", bg: "#EBF3FF", color: "#2A62C9" },
  pedido:    { label: "Pedido",    dot: "#9BA3AB", bg: "#F4F5F4", color: "#5B6770" },
  recibido:  { label: "Recibido",  dot: "#1F8A5B", bg: "#E4F3EC", color: "#136E47" },
  borrador:  { label: "Borrador",  dot: "#9BA3AB", bg: "#F4F5F4", color: "#5B6770" },
  enviado:   { label: "Enviado",   dot: "#B45309", bg: "#FFFBEB", color: "#B45309" },
  cotizado:  { label: "Cotizado",  dot: "#FF6B35", bg: "#FFF0E8", color: "#B84C10" },
};

const SOL_STATUS_META: Record<string, { label: string; dot: string; bg: string; color: string }> = {
  borrador:   { label: "Borrador",   dot: "#9BA3AB", bg: "#F4F5F4", color: "#5B6770" },
  enviada:    { label: "Enviada",    dot: "#B45309", bg: "#FFFBEB", color: "#B45309" },
  respondida: { label: "Respondida", dot: "#3B82F6", bg: "#EBF3FF", color: "#2A62C9" },
  confirmada: { label: "Confirmada", dot: "#1F8A5B", bg: "#E4F3EC", color: "#136E47" },
};

function money(n: number | null | undefined): string {
  if (n == null) return "—";
  return "$" + n.toLocaleString("es-AR", { maximumFractionDigits: 2 });
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "short" });
}

function Pill({
  status,
  meta,
}: {
  status: string;
  meta?: Record<string, { label: string; dot: string; bg: string; color: string }>;
}) {
  const m = (meta ?? STATUS_META)[status] ?? STATUS_META.pendiente;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "3px 9px", borderRadius: 99,
      fontSize: 11, fontWeight: 600, background: m.bg, color: m.color,
      whiteSpace: "nowrap",
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: "50%",
        background: m.dot, flexShrink: 0,
      }} />
      {m.label}
    </span>
  );
}

// ─── Module header ────────────────────────────────────────────────────────────

function ModuleHeader({
  num, numBg, title, stats, description, actions,
}: {
  num: string;
  numBg: string;
  title: string;
  stats?: React.ReactNode;
  description: string;
  actions?: React.ReactNode;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 16,
      padding: "18px 0 16px",
    }}>
      <div style={{
        width: 52, height: 52, borderRadius: 14, background: numBg, flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <span style={{ fontSize: 18, fontWeight: 800, color: "#fff", fontFamily: MONO, lineHeight: 1 }}>{num}</span>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontSize: 19, fontWeight: 800, color: "#1A2329", lineHeight: 1.2 }}>{title}</h2>
          {stats && (
            <span style={{
              fontSize: 11, fontWeight: 600, color: "#6B7580",
              background: "#F2EFE8", padding: "2px 9px", borderRadius: 99,
            }}>
              {stats}
            </span>
          )}
        </div>
        <p style={{ margin: "3px 0 0", fontSize: 12, color: "#7A7167", lineHeight: 1.4 }}>{description}</p>
      </div>
      {actions && (
        <div style={{ display: "flex", gap: 8, flexShrink: 0, alignItems: "center" }}>
          {actions}
        </div>
      )}
    </div>
  );
}

// ─── Panel de análisis comparativo ───────────────────────────────────────────

function ConfirmarBtn({
  r,
  onConfirmar,
  onConfirmarCont,
  confirming,
  label,
}: {
  r: RespuestaCotizacion;
  onConfirmar: (id: number) => void;
  onConfirmarCont: (name: string) => void;
  confirming: boolean;
  label?: string;
}) {
  const txt = label ?? `Confirmar ${r.supplier_name}`;
  const style: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: 6,
    padding: "9px 16px", borderRadius: 10, fontSize: 12.5, fontWeight: 700, border: "none",
    background: confirming ? "#4A5A63" : "#FF6B35", color: confirming ? "#8E97A0" : "#fff",
    cursor: confirming ? "wait" : "pointer",
    boxShadow: confirming ? "none" : "0 6px 14px -6px rgba(255,107,53,0.6)",
    flexShrink: 0,
  };
  if (r.supplier_id != null) {
    return (
      <button onClick={() => onConfirmar(r.supplier_id!)} disabled={confirming} style={style}>
        {confirming ? <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} /> : <CheckCircle2 style={{ width: 13, height: 13 }} />}
        {txt}
      </button>
    );
  }
  return (
    <button onClick={() => onConfirmarCont(r.supplier_name)} disabled={confirming} style={style}>
      {confirming ? <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} /> : <CheckCircle2 style={{ width: 13, height: 13 }} />}
      {txt}
    </button>
  );
}

function AnalisisPanel({
  analisis,
  respuestas,
  onConfirmar,
  onConfirmarCont,
  confirming,
}: {
  analisis: AnalisisComparativo | null;
  respuestas: RespuestaCotizacion[];
  onConfirmar: (supplierId: number) => void;
  onConfirmarCont: (supplierName: string) => void;
  confirming: boolean;
}) {
  if (respuestas.length === 0) return null;

  // Deduplicate by supplier: keep only the most recent per supplier_id or supplier_name
  const deduped = Object.values(
    respuestas.reduce<Record<string, RespuestaCotizacion>>((acc, r) => {
      const key = r.supplier_id != null ? `id:${r.supplier_id}` : `name:${r.supplier_name}`;
      if (!acc[key] || r.created_at > acc[key].created_at) acc[key] = r;
      return acc;
    }, {})
  );

  // ── Vista para UNA sola cotización recibida ──────────────────────────────
  if (deduped.length === 1) {
    const r = deduped[0];
    const hasItems = r.items.length > 0;
    const hasMeta = r.rubro || r.fecha || r.validez || r.iva_pct != null || r.incluye_flete != null;
    const hasIncons = r.inconsistencias && r.inconsistencias.length > 0;

    return (
      <div style={{ padding: "14px 16px 16px", background: "#FAFAF8", borderTop: "1px solid #EEE9E0" }}>

        {/* Nombre del proveedor desde el PDF (si difiere) */}
        {r.proveedor_nombre && (
          <p style={{ margin: "0 0 10px", fontSize: 11, color: "#6B7580" }}>
            <span style={{ fontWeight: 700, color: "#1A2329" }}>{r.supplier_name}</span>
            {r.proveedor_nombre.toLowerCase() !== r.supplier_name.toLowerCase() && (
              <> · identificado como <em>{r.proveedor_nombre}</em> en el PDF</>
            )}
          </p>
        )}

        {/* Metadatos: Rubro, Fecha, IVA, Flete, Validez */}
        {hasMeta && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
            {r.rubro && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 99, background: "#F2EFE8", color: "#5B5347", border: "1px solid #D8D3CA" }}>
                {r.rubro}
              </span>
            )}
            {r.fecha && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 99, background: "#F2EFE8", color: "#5B5347", border: "1px solid #D8D3CA" }}>
                Fecha {r.fecha}
              </span>
            )}
            {r.validez && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 99, background: "#FFF0E8", color: "#B84C10", border: "1px solid #F0C8A8" }}>
                Válida hasta {r.validez}
              </span>
            )}
            {r.incluye_flete != null && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 99, background: r.incluye_flete ? "#E4F3EC" : "#F4F5F4", color: r.incluye_flete ? "#136E47" : "#5B6770", border: `1px solid ${r.incluye_flete ? "#B8DECA" : "#D8D3CA"}` }}>
                <Truck style={{ width: 10, height: 10 }} />
                {r.incluye_flete ? "Flete incluido" : "Sin flete"}
              </span>
            )}
            {r.iva_pct != null && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 99, background: "#F2EFE8", color: "#5B5347", border: "1px solid #D8D3CA" }}>
                IVA {r.iva_pct}%
                {r.iva_monto != null && <span style={{ fontWeight: 400, color: "#7A7167" }}> ({money(r.iva_monto)})</span>}
              </span>
            )}
          </div>
        )}

        {/* Tabla de ítems */}
        {hasItems && (
          <div style={{ marginBottom: 12 }}>
            <p style={{ margin: "0 0 6px", fontSize: 9.5, fontWeight: 700, color: "#7A7167", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Detalle de ítems ({r.items.length})
            </p>
            <div style={{ border: "1px solid #E6E7E5", borderRadius: 10, overflow: "hidden" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 65px 55px 90px 90px", background: "#F2EFE8", borderBottom: "1px solid #D8D3CA" }}>
                {["Descripción", "Cant.", "Unidad", "P. unit.", "Subtotal"].map((h, hi) => (
                  <span key={h} style={{ padding: "5px 8px", fontSize: 9, fontWeight: 700, color: "#7A7167", textTransform: "uppercase", letterSpacing: "0.08em", textAlign: hi >= 3 ? "right" : "left" }}>{h}</span>
                ))}
              </div>
              {r.items.map((item, idx) => (
                <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr 65px 55px 90px 90px", borderBottom: idx < r.items.length - 1 ? "1px solid #F0EDE7" : "none", background: idx % 2 === 0 ? "#fff" : "#FDFCFB", alignItems: "center" }}>
                  <span style={{ padding: "6px 8px", fontSize: 12, color: "#1A2329", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.nombre}</span>
                  <span style={{ padding: "6px 8px", fontSize: 11.5, color: "#5B6770", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{item.cantidad ?? "—"}</span>
                  <span style={{ padding: "6px 8px", fontSize: 11.5, color: "#5B6770", textAlign: "left" }}>{item.unidad ?? "—"}</span>
                  <span style={{ padding: "6px 8px", fontSize: 11.5, color: "#5B6770", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(item.precio_unitario)}</span>
                  <span style={{ padding: "6px 8px", fontSize: 12, fontWeight: 700, color: "#1A2329", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(item.subtotal)}</span>
                </div>
              ))}
              {/* Total row */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 65px 55px 90px 90px", background: "#1A2329", borderTop: "1px solid #0E161B" }}>
                <span style={{ padding: "7px 8px", gridColumn: "1 / 5", fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.08em", textAlign: "right" }}>Total</span>
                <span style={{ padding: "7px 8px", fontSize: 14, fontWeight: 800, color: "#fff", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(r.total)}</span>
              </div>
            </div>
          </div>
        )}

        {/* Inconsistencias */}
        {hasIncons && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 6 }}>
              <AlertTriangle style={{ width: 11, height: 11, color: "#B45309" }} />
              <span style={{ fontSize: 9.5, fontWeight: 700, color: "#B45309", textTransform: "uppercase", letterSpacing: "0.08em" }}>Inconsistencias detectadas</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {r.inconsistencias!.map((inc, i) => {
                const sevColor = inc.severidad === "alta" ? "#D03A3A" : inc.severidad === "media" ? "#B45309" : "#5B6770";
                const sevBg = inc.severidad === "alta" ? "#FCE5E5" : inc.severidad === "media" ? "#FFF3CD" : "#F4F5F4";
                return (
                  <div key={i} style={{ display: "flex", gap: 8, padding: "6px 10px", borderRadius: 8, background: sevBg }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: sevColor, flexShrink: 0 }}>{inc.tipo}</span>
                    <span style={{ fontSize: 11, color: "#3E4A52", flex: 1 }}>{inc.detalle}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* KPIs: Entrega y Pago (si no hay tabla de ítems ya mostró el total) */}
        {!hasItems && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
            {[
              { label: "Total", value: money(r.total), big: true },
              { label: "Entrega", value: r.plazo_entrega ?? "—", big: false },
              { label: "Pago", value: r.condiciones_pago ?? "—", big: false },
            ].map(kpi => (
              <div key={kpi.label} style={{ background: "#fff", border: "1px solid #E6E7E5", borderRadius: 10, padding: "10px 12px" }}>
                <p style={{ margin: "0 0 4px", fontSize: 9.5, fontWeight: 700, color: "#7A7167", textTransform: "uppercase", letterSpacing: "0.08em" }}>{kpi.label}</p>
                <p style={{ margin: 0, fontSize: kpi.big ? 16 : 12, fontWeight: 700, color: "#1A2329" }}>{kpi.value}</p>
              </div>
            ))}
          </div>
        )}
        {hasItems && (r.plazo_entrega || r.condiciones_pago) && (
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            {r.plazo_entrega && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 600, color: "#3E4A52", background: "#fff", border: "1px solid #E6E7E5", borderRadius: 8, padding: "5px 10px" }}>
                <Truck style={{ width: 11, height: 11, color: "#6B7580" }} />Entrega: {r.plazo_entrega}
              </span>
            )}
            {r.condiciones_pago && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 600, color: "#3E4A52", background: "#fff", border: "1px solid #E6E7E5", borderRadius: 8, padding: "5px 10px" }}>
                <CreditCard style={{ width: 11, height: 11, color: "#6B7580" }} />Pago: {r.condiciones_pago}
              </span>
            )}
          </div>
        )}

        {/* Acción */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11.5, color: "#8E97A0" }}>Esperando otras cotizaciones para comparar</span>
          <ConfirmarBtn r={r} onConfirmar={onConfirmar} onConfirmarCont={onConfirmarCont} confirming={confirming} />
        </div>
      </div>
    );
  }

  // ── Loader mientras la IA analiza ────────────────────────────────────────
  if (!analisis) {
    return (
      <div style={{ padding: "24px 16px", background: "#FAFAF8", borderTop: "1px solid #EEE9E0", textAlign: "center" }}>
        <Sparkles style={{ width: 20, height: 20, color: "#FF6B35", margin: "0 auto 8px" }} />
        <p style={{ margin: 0, fontSize: 12.5, color: "#6B7580" }}>Generando análisis comparativo con IA…</p>
      </div>
    );
  }

  // ── Vista comparativa con 2+ cotizaciones ────────────────────────────────
  const maxTotal = Math.max(...deduped.map(r => r.total ?? 0));
  const recomendadoId = analisis.supplier_recomendado_id;
  const recomendado = recomendadoId != null ? deduped.find(r => r.supplier_id === recomendadoId) : null;
  const noRec = deduped.filter(r => r !== recomendado);
  const diferencia = recomendado && noRec.length > 0
    ? Math.abs((noRec[0].total ?? 0) - (recomendado.total ?? 0))
    : null;

  const rKey = (r: RespuestaCotizacion) => r.supplier_id != null ? `id:${r.supplier_id}` : `name:${r.supplier_name}`;

  return (
    <div style={{ background: "#FAFAF8", borderTop: "1px solid #EEE9E0" }}>
      {/* Análisis IA header */}
      <div style={{ padding: "12px 16px 10px", background: "#1A2329", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: "rgba(255,107,53,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Sparkles style={{ width: 13, height: 13, color: "#FF6B35" }} />
          </div>
          <div>
            <span style={{ fontSize: 10, fontWeight: 700, color: "#FF6B35", textTransform: "uppercase", letterSpacing: "0.1em", display: "block" }}>Análisis IA</span>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>
              {deduped.length} cotizaciones · {analisis.comparacion_items.length} ítems comparados
            </span>
          </div>
        </div>
        {diferencia != null && diferencia > 0 && (
          <div style={{ textAlign: "right" }}>
            <span style={{ fontSize: 9.5, fontWeight: 700, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.08em", display: "block" }}>Ahorro recomendado</span>
            <span style={{ fontSize: 18, fontWeight: 800, color: "#4DD9A0", fontVariantNumeric: "tabular-nums" }}>−{money(diferencia)}</span>
          </div>
        )}
      </div>

      {/* Resumen IA */}
      {analisis.resumen && (
        <div style={{ padding: "10px 16px 0" }}>
          <p style={{ margin: 0, fontSize: 12, color: "#3E4A52", lineHeight: 1.5, fontStyle: "italic" }}>"{analisis.resumen}"</p>
        </div>
      )}

      {/* Comparativa de precios totales */}
      <div style={{ padding: "14px 16px 0" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "stretch", flexWrap: "wrap" }}>
          {deduped.map(r => {
            const esRec = recomendado === r;
            const pct = maxTotal > 0 ? ((r.total ?? 0) / maxTotal) * 100 : 100;
            return (
              <div key={rKey(r)} style={{
                flex: "1 1 140px", borderRadius: 12, padding: "14px 14px 12px",
                background: esRec ? "#1A2329" : "#fff",
                border: esRec ? "none" : "1px solid #E6E7E5",
              }}>
                {esRec && (
                  <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 6 }}>
                    <Sparkles style={{ width: 11, height: 11, color: "#FF6B35" }} />
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#FF6B35", textTransform: "uppercase", letterSpacing: "0.08em" }}>Recomendado</span>
                  </div>
                )}
                <p style={{ margin: "0 0 2px", fontSize: 11, fontWeight: 600, color: esRec ? "rgba(255,255,255,0.6)" : "#7A7167", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.supplier_name}
                </p>
                <p style={{ margin: "0 0 10px", fontSize: 22, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: esRec ? "#fff" : "#1A2329", lineHeight: 1.1 }}>
                  {money(r.total)}
                </p>
                <div style={{ height: 4, background: esRec ? "rgba(255,255,255,0.12)" : "#F0EDE7", borderRadius: 99, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${pct}%`, background: esRec ? "#4DD9A0" : "#D0C8BE", borderRadius: 99 }} />
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                  {r.plazo_entrega && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, color: esRec ? "rgba(255,255,255,0.65)" : "#6B7580" }}>
                      <Truck style={{ width: 10, height: 10 }} />{r.plazo_entrega}
                    </span>
                  )}
                  {r.condiciones_pago && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, color: esRec ? "rgba(255,255,255,0.65)" : "#6B7580" }}>
                      <CreditCard style={{ width: 10, height: 10 }} />{r.condiciones_pago}
                    </span>
                  )}
                  {r.incluye_flete != null && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, color: esRec ? "rgba(255,255,255,0.65)" : "#6B7580" }}>
                      <Truck style={{ width: 10, height: 10 }} />{r.incluye_flete ? "c/flete" : "s/flete"}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {diferencia != null && diferencia > 0 && recomendado && (
          <div style={{ textAlign: "center", padding: "10px 0 2px" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 700, color: "#1F8A5B", background: "#E4F3EC", padding: "5px 14px", borderRadius: 99, border: "1px solid #B8DECA" }}>
              <CheckCircle2 style={{ width: 12, height: 12 }} />
              Diferencia de {money(diferencia)} a favor de {recomendado.supplier_name}
            </span>
          </div>
        )}
      </div>

      {/* Tabla comparativa por ítem */}
      {analisis.comparacion_items.length > 0 && (
        <div style={{ padding: "14px 16px 0" }}>
          <p style={{ margin: "0 0 8px", fontSize: 10, fontWeight: 700, color: "#7A7167", textTransform: "uppercase", letterSpacing: "0.09em" }}>
            Desglose por ítem
          </p>
          <div style={{ border: "1px solid #E6E7E5", borderRadius: 10, overflow: "hidden", overflowX: "auto" }}>
            <div style={{ display: "grid", gridTemplateColumns: `1fr ${deduped.map(() => "130px").join(" ")}`, background: "#F2EFE8", borderBottom: "1px solid #D8D3CA", minWidth: 320 }}>
              <span style={{ padding: "6px 10px", fontSize: 9.5, fontWeight: 700, color: "#7A7167", textTransform: "uppercase", letterSpacing: "0.08em" }}>Ítem</span>
              {deduped.map(r => (
                <span key={rKey(r)} style={{ padding: "6px 10px", fontSize: 9.5, fontWeight: 700, color: "#7A7167", textTransform: "uppercase", letterSpacing: "0.08em", textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.supplier_name}
                </span>
              ))}
            </div>
            {analisis.comparacion_items.map((item, idx) => {
              const maxPrecio = Math.max(...item.precios.map(p => p.subtotal ?? 0));
              return (
                <div key={item.nombre} style={{
                  display: "grid", gridTemplateColumns: `1fr ${deduped.map(() => "130px").join(" ")}`,
                  borderBottom: idx < analisis.comparacion_items.length - 1 ? "1px solid #F0EDE7" : "none",
                  background: idx % 2 === 0 ? "#fff" : "#FDFCFB", alignItems: "center", minWidth: 320,
                }}>
                  <span style={{ padding: "8px 10px", fontSize: 12, color: "#3E4A52", fontWeight: 500 }}>{item.nombre}</span>
                  {deduped.map(r => {
                    const precio = item.precios.find(p => p.supplier_id === r.supplier_id || p.supplier_name === r.supplier_name);
                    const esMasBarato = item.mas_barato_id != null ? item.mas_barato_id === r.supplier_id : false;
                    const barPct = maxPrecio > 0 ? ((precio?.subtotal ?? 0) / maxPrecio) * 100 : 0;
                    return (
                      <div key={rKey(r)} style={{ padding: "8px 10px", textAlign: "right" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6, marginBottom: 3 }}>
                          {esMasBarato && item.diferencia != null && item.diferencia > 0 && (
                            <span style={{ fontSize: 9.5, fontWeight: 700, color: "#136E47", background: "#E4F3EC", padding: "1px 6px", borderRadius: 99 }}>
                              -{money(item.diferencia)}
                            </span>
                          )}
                          <span style={{ fontSize: 12.5, fontWeight: esMasBarato ? 700 : 400, color: esMasBarato ? "#136E47" : "#5B6770", fontVariantNumeric: "tabular-nums" }}>
                            {money(precio?.subtotal)}
                          </span>
                        </div>
                        <div style={{ height: 3, background: "#F0EDE7", borderRadius: 99, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${barPct}%`, background: esMasBarato ? "#1F8A5B" : "#C4C9C6", borderRadius: 99 }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Ganás / Perdés */}
      {(analisis.donde_ganas.length > 0 || analisis.donde_pierdes.length > 0) && (
        <div style={{ padding: "14px 16px 0", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {analisis.donde_ganas.length > 0 && (
            <div style={{ background: "#E8F5EE", border: "1px solid #B8DECA", borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 8 }}>
                <ThumbsUp style={{ width: 11, height: 11, color: "#136E47" }} />
                <span style={{ fontSize: 10, fontWeight: 700, color: "#136E47", textTransform: "uppercase", letterSpacing: "0.08em" }}>Ventajas</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {analisis.donde_ganas.map((g, i) => (
                  <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 9px", borderRadius: 99, fontSize: 11, fontWeight: 600, background: "#C8EBDA", color: "#0D4D2E" }}>
                    <CheckCircle2 style={{ width: 9, height: 9, flexShrink: 0 }} />{g}
                  </span>
                ))}
              </div>
            </div>
          )}
          {analisis.donde_pierdes.length > 0 && (
            <div style={{ background: "#FEF3E8", border: "1px solid #F0D0A8", borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 8 }}>
                <ThumbsDown style={{ width: 11, height: 11, color: "#B45309" }} />
                <span style={{ fontSize: 10, fontWeight: 700, color: "#B45309", textTransform: "uppercase", letterSpacing: "0.08em" }}>Desventajas</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {analisis.donde_pierdes.map((p, i) => (
                  <span key={i} style={{ display: "inline-flex", padding: "3px 9px", borderRadius: 99, fontSize: 11, fontWeight: 600, background: "#FAD8AB", color: "#5A2D0C" }}>{p}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Condiciones pago / Plazos */}
      {(analisis.condiciones_pago || analisis.plazos) && (
        <div style={{ padding: "10px 16px 0", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {analisis.condiciones_pago && (
            <div style={{ background: "#fff", border: "1px solid #E6E7E5", borderRadius: 8, padding: "8px 12px" }}>
              <p style={{ margin: "0 0 3px", fontSize: 9.5, fontWeight: 700, color: "#7A7167", textTransform: "uppercase", letterSpacing: "0.08em" }}>Condiciones de pago</p>
              <p style={{ margin: 0, fontSize: 11.5, color: "#3E4A52" }}>{analisis.condiciones_pago}</p>
            </div>
          )}
          {analisis.plazos && (
            <div style={{ background: "#fff", border: "1px solid #E6E7E5", borderRadius: 8, padding: "8px 12px" }}>
              <p style={{ margin: "0 0 3px", fontSize: 9.5, fontWeight: 700, color: "#7A7167", textTransform: "uppercase", letterSpacing: "0.08em" }}>Plazos de entrega</p>
              <p style={{ margin: 0, fontSize: 11.5, color: "#3E4A52" }}>{analisis.plazos}</p>
            </div>
          )}
        </div>
      )}

      {/* Riesgos */}
      {analisis.riesgos.length > 0 && (
        <div style={{ padding: "10px 16px 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 700, color: "#B45309", textTransform: "uppercase", letterSpacing: "0.08em", flexShrink: 0 }}>
              <AlertTriangle style={{ width: 11, height: 11 }} /> Riesgos
            </span>
            {analisis.riesgos.map((risk, i) => (
              <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 99, fontSize: 11, fontWeight: 600, background: "#FFF3CD", color: "#7A4200", border: "1px solid #F0D080" }}>
                <AlertTriangle style={{ width: 9, height: 9, flexShrink: 0 }} />{risk}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Recomendación + CTAs */}
      <div style={{ padding: "14px 16px 16px" }}>
        {recomendado && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, background: "linear-gradient(135deg, #1B2A34 0%, #243642 100%)", borderRadius: 12, padding: "12px 14px", marginBottom: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                <Sparkles style={{ width: 12, height: 12, color: "#FF6B35" }} />
                <span style={{ fontSize: 10, fontWeight: 700, color: "#FF6B35", textTransform: "uppercase", letterSpacing: "0.08em" }}>IA recomienda</span>
              </div>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#fff" }}>{recomendado.supplier_name}</p>
              <p style={{ margin: "2px 0 0", fontSize: 11, color: "rgba(255,255,255,0.55)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {analisis.recomendacion}
              </p>
            </div>
            <ConfirmarBtn r={recomendado} onConfirmar={onConfirmar} onConfirmarCont={onConfirmarCont} confirming={confirming} label="Confirmar" />
          </div>
        )}
        {!recomendado && analisis.recomendacion && (
          <p style={{ margin: "0 0 10px", fontSize: 12, color: "#3E4A52", lineHeight: 1.5, background: "#F2EFE8", borderRadius: 10, padding: "10px 12px" }}>
            {analisis.recomendacion}
          </p>
        )}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {deduped.filter(r => r !== recomendado).map(r => (
            <ConfirmarBtn
              key={rKey(r)}
              r={r}
              onConfirmar={onConfirmar}
              onConfirmarCont={onConfirmarCont}
              confirming={confirming}
              label={`Elegir ${r.supplier_name} igualmente`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Card de solicitud ────────────────────────────────────────────────────────

function SolicitudCard({
  sol,
  index,
  onConfirmar,
  onConfirmarCont,
  onDelete,
  confirming,
  deleting,
}: {
  sol: SolicitudCotizacion;
  index: number;
  onConfirmar: (solicitudId: number, supplierId: number) => void;
  onConfirmarCont: (solicitudId: number, supplierName: string) => void;
  onDelete: (solicitudId: number) => void;
  confirming: boolean;
  deleting: boolean;
}) {
  const [expanded, setExpanded] = useState(sol.status === "respondida");
  const hasResponses = sol.respuestas.length > 0;
  const refNum = `COT-${String(index + 1).padStart(2, "0")}`;

  return (
    <div style={{ border: "1px solid #E6E7E5", borderRadius: 12, overflow: "hidden", background: "#fff" }}>
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 10,
          padding: "11px 14px", background: "#fff", border: "none",
          borderBottom: expanded ? "1px solid #F0EBE2" : "none",
          cursor: "pointer", textAlign: "left",
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 700, color: "#FF6B35", fontFamily: MONO, flexShrink: 0 }}>
          {refNum}
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "#1A2329" }}>
            {sol.suppliers.length > 0
              ? sol.suppliers.map(s => s.supplier_name).join(", ")
              : sol.respuestas.length > 0
                ? [...new Set(sol.respuestas.map(r => r.supplier_name))].join(", ")
                : sol.contratista_phone
                  ? "Contratista directo"
                  : "Sin proveedor asignado"}
          </span>
          <span style={{ fontSize: 11, color: "#8E97A0", marginLeft: 8 }}>{fmtDate(sol.created_at)}</span>
        </span>
        <Pill status={sol.status} meta={SOL_STATUS_META} />
        <button
          onClick={e => { e.stopPropagation(); onDelete(sol.id); }}
          disabled={deleting}
          title="Eliminar solicitud"
          style={{ width: 26, height: 26, borderRadius: 7, border: "1px solid #E6E7E5", background: "#fff", cursor: deleting ? "wait" : "pointer", color: "#C4747B", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
        >
          {deleting ? <Loader2 style={{ width: 11, height: 11, animation: "spin 1s linear infinite" }} /> : <Trash2 style={{ width: 11, height: 11 }} />}
        </button>
        <span style={{ color: "#9BA3AB", flexShrink: 0, display: "flex" }}>
          {expanded ? <ChevronDown style={{ width: 14, height: 14 }} /> : <ChevronRight style={{ width: 14, height: 14 }} />}
        </span>
      </button>

      {expanded && (
        <div>
          <div style={{ padding: "10px 14px", display: "flex", gap: 12, flexWrap: "wrap", borderBottom: hasResponses ? "1px solid #F0EBE2" : "none", background: "#FAFAF8" }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, color: "#7A7167", textTransform: "uppercase", letterSpacing: "0.07em" }}>Materiales:</span>
              <span style={{ fontSize: 11.5, color: "#3E4A52" }}>{sol.material_ids.length} ítem{sol.material_ids.length !== 1 ? "s" : ""}</span>
            </div>
            {sol.notes && (
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: "#7A7167", textTransform: "uppercase", letterSpacing: "0.07em" }}>Nota:</span>
                <span style={{ fontSize: 11.5, color: "#3E4A52" }}>{sol.notes}</span>
              </div>
            )}
          </div>

          {sol.suppliers.length > 0 && (
            <div style={{ padding: "10px 14px", display: "flex", gap: 6, flexWrap: "wrap", borderBottom: hasResponses ? "1px solid #F0EBE2" : "none" }}>
              {sol.suppliers.map(s => {
                const responded = s.status === "respondida";
                return (
                  <span key={s.supplier_id} style={{
                    display: "inline-flex", alignItems: "center", gap: 5,
                    padding: "4px 10px", borderRadius: 99, fontSize: 11.5, fontWeight: 600,
                    background: responded ? "#E4F3EC" : "#FDF1DE",
                    color: responded ? "#136E47" : "#B45309",
                    border: `1px solid ${responded ? "#B8DECA" : "#F0D0A0"}`,
                  }}>
                    {responded
                      ? <CheckCircle2 style={{ width: 11, height: 11 }} />
                      : <Clock style={{ width: 11, height: 11 }} />}
                    {s.supplier_name}
                    <span style={{ fontSize: 10, opacity: 0.75 }}>
                      {responded ? "· respondió" : "· esperando"}
                    </span>
                  </span>
                );
              })}
            </div>
          )}

          {sol.status === "borrador" && (
            <div style={{ padding: "12px 14px", fontSize: 12, color: "#8E97A0" }}>
              Solicitud en borrador — todavía no fue enviada a ningún proveedor.
            </div>
          )}
          {sol.status === "enviada" && sol.respuestas.length === 0 && (
            <div style={{ padding: "12px 14px", fontSize: 12, color: "#8E97A0" }}>
              Solicitud enviada. Esperando respuesta de los proveedores…
            </div>
          )}
          {sol.respuestas.length > 0 && (
            <AnalisisPanel
              analisis={sol.analisis_ia}
              respuestas={sol.respuestas}
              onConfirmar={(supplierId) => onConfirmar(sol.id, supplierId)}
              onConfirmarCont={(supplierName) => onConfirmarCont(sol.id, supplierName)}
              confirming={confirming}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Modal: nueva solicitud de cotización (2 pasos) ───────────────────────────

function NuevaSolicitudModal({
  obraId, rows, suppliers, onClose, onCreated,
}: {
  obraId: number;
  rows: PresupuestoRow[];
  suppliers: Supplier[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const pendientes = rows.filter(r => r.status === "pendiente");
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedMaterials, setSelectedMaterials] = useState<Set<number>>(new Set(pendientes.map(r => r.material_id)));
  const [selectedSuppliers, setSelectedSuppliers] = useState<Set<number>>(new Set());
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleMat(id: number) {
    setSelectedMaterials(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleSup(id: number) {
    setSelectedSuppliers(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function handleCreate() {
    if (selectedSuppliers.size === 0) { setError("Seleccioná al menos un proveedor."); return; }
    setSaving(true); setError(null);
    try {
      await createSolicitud(obraId, {
        material_ids: Array.from(selectedMaterials),
        supplier_ids: Array.from(selectedSuppliers),
        notes: notes.trim() || null,
      });
      onCreated();
    } catch {
      setError("No se pudo crear la solicitud. El backend aún no está implementado.");
      setSaving(false);
    }
  }

  const totalSel = pendientes.filter(r => selectedMaterials.has(r.material_id)).reduce((a, r) => a + r.subtotal, 0);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 70, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(15,22,28,0.5)", backdropFilter: "blur(3px)", padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 500, boxShadow: "0 32px 64px -16px rgba(15,22,28,0.35)", fontFamily: FONT, maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
        <div style={{ background: "linear-gradient(135deg, #1B2A34 0%, #243642 100%)", padding: "18px 22px", borderRadius: "16px 16px 0 0", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
              {[1, 2].map(s => (
                <div key={s} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <div style={{ width: 20, height: 20, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, background: step >= s ? "#FF6B35" : "rgba(255,255,255,0.15)", color: step >= s ? "#fff" : "rgba(255,255,255,0.5)" }}>
                    {s}
                  </div>
                  <span style={{ fontSize: 11, color: step >= s ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.4)", fontWeight: step === s ? 700 : 400 }}>
                    {s === 1 ? "Materiales" : "Proveedores"}
                  </span>
                  {s < 2 && <ChevronRight style={{ width: 12, height: 12, color: "rgba(255,255,255,0.3)" }} />}
                </div>
              ))}
            </div>
            <h3 style={{ margin: 0, fontSize: 15.5, fontWeight: 700, color: "#fff" }}>
              {step === 1 ? "Seleccionar materiales" : "Elegir proveedores"}
            </h3>
            <p style={{ margin: "2px 0 0", fontSize: 11.5, color: "rgba(255,255,255,0.55)" }}>
              {step === 1 ? "Elegí los materiales pendientes a cotizar" : "A quiénes le vas a pedir cotización"}
            </p>
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.08)", cursor: "pointer", color: "rgba(255,255,255,0.7)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <X style={{ width: 13, height: 13 }} />
          </button>
        </div>

        <div style={{ padding: "16px 22px", overflowY: "auto", flex: 1 }}>
          {step === 1 && (
            <>
              <p style={{ margin: "0 0 8px", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#5B6770" }}>
                Materiales pendientes ({selectedMaterials.size}/{pendientes.length})
              </p>
              {pendientes.length === 0 ? (
                <p style={{ fontSize: 12.5, color: "#C97D0E", fontWeight: 600, margin: 0 }}>No hay materiales pendientes.</p>
              ) : (
                <div style={{ border: "1px solid #EFECE6", borderRadius: 10, overflow: "hidden" }}>
                  {pendientes.map((r, i) => (
                    <label key={r.material_id} style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 10px", borderBottom: i < pendientes.length - 1 ? "1px solid #F4F1EB" : "none", background: selectedMaterials.has(r.material_id) ? "#FFF8F3" : "#fff", cursor: "pointer" }}>
                      <input type="checkbox" checked={selectedMaterials.has(r.material_id)} onChange={() => toggleMat(r.material_id)} style={{ accentColor: "#FF6B35" }} />
                      <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, color: "#1A2329", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.name}<span style={{ fontWeight: 400, color: "#6B7580" }}> · {r.task_title}</span>
                      </span>
                      <span style={{ fontSize: 11.5, color: "#5B6770", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
                        {r.quantity != null ? `${r.quantity} ${r.unit ?? ""}` : ""}
                        {r.subtotal > 0 && <> · {money(r.subtotal)}</>}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <p style={{ margin: "0 0 8px", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#5B6770" }}>
                Proveedores ({selectedSuppliers.size} seleccionados)
              </p>
              {suppliers.length === 0 ? (
                <p style={{ fontSize: 12.5, color: "#C97D0E", fontWeight: 600, margin: "0 0 14px" }}>No hay proveedores cargados. Agregalos en Configuración.</p>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
                  {suppliers.map(s => {
                    const sel = selectedSuppliers.has(s.id);
                    return (
                      <button key={s.id} onClick={() => toggleSup(s.id)} style={{ padding: "7px 14px", borderRadius: 99, fontSize: 12.5, fontWeight: 600, cursor: "pointer", background: sel ? "#FF6B35" : "#fff", color: sel ? "#fff" : "#3E4A52", border: sel ? "none" : "1px solid #D0C8BE", boxShadow: sel ? "0 4px 10px -4px rgba(255,107,53,0.5)" : "none", transition: "all 0.12s" }}>
                        {s.name}
                        {s.category && <span style={{ fontSize: 10.5, opacity: 0.75, marginLeft: 4 }}>· {s.category}</span>}
                      </button>
                    );
                  })}
                </div>
              )}
              <p style={{ margin: "0 0 5px", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#5B6770" }}>Notas (opcional)</p>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Ej: necesitamos entrega antes del viernes" style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", fontSize: 12.5, border: "1px solid #E6E7E5", borderRadius: 10, fontFamily: FONT, color: "#1A2329", outline: "none", resize: "vertical" }} />
              {error && <p style={{ margin: "10px 0 0", fontSize: 12, color: "#D03A3A", fontWeight: 600 }}>{error}</p>}
            </>
          )}
        </div>

        <div style={{ padding: "14px 22px 18px", borderTop: "1px solid #F0F1EF", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 12.5, color: "#5B6770" }}>
            {step === 1 && selectedMaterials.size > 0 && <>{selectedMaterials.size} ítem{selectedMaterials.size !== 1 ? "s" : ""}{totalSel > 0 && <> · <strong style={{ color: "#1A2329" }}>{money(totalSel)}</strong></>}</>}
            {step === 2 && selectedSuppliers.size > 0 && <>Enviando a <strong style={{ color: "#1A2329" }}>{selectedSuppliers.size}</strong> proveedor{selectedSuppliers.size !== 1 ? "es" : ""}</>}
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            {step === 2 && (
              <button onClick={() => setStep(1)} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "8px 14px", borderRadius: 10, fontSize: 12.5, fontWeight: 600, color: "#5B6770", background: "#fff", border: "1px solid #E6E7E5", cursor: "pointer" }}>
                <ChevronLeft style={{ width: 13, height: 13 }} /> Anterior
              </button>
            )}
            <button onClick={onClose} disabled={saving} style={{ padding: "8px 14px", borderRadius: 10, fontSize: 12.5, fontWeight: 600, color: "#5B6770", background: "#fff", border: "1px solid #E6E7E5", cursor: "pointer" }}>Cancelar</button>
            {step === 1 ? (
              <button onClick={() => setStep(2)} disabled={selectedMaterials.size === 0} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 10, fontSize: 12.5, fontWeight: 700, border: "none", background: selectedMaterials.size === 0 ? "#E6E7E5" : "#FF6B35", color: selectedMaterials.size === 0 ? "#8E97A0" : "#fff", cursor: selectedMaterials.size === 0 ? "not-allowed" : "pointer" }}>
                Siguiente <ChevronRight style={{ width: 13, height: 13 }} />
              </button>
            ) : (
              <button onClick={handleCreate} disabled={saving || selectedSuppliers.size === 0} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 10, fontSize: 12.5, fontWeight: 700, border: "none", background: saving || selectedSuppliers.size === 0 ? "#E6E7E5" : "#FF6B35", color: saving || selectedSuppliers.size === 0 ? "#8E97A0" : "#fff", cursor: saving ? "wait" : "pointer", boxShadow: !saving && selectedSuppliers.size > 0 ? "0 6px 14px -6px rgba(255,107,53,0.5)" : "none" }}>
                {saving ? <><Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} /> Enviando...</> : <><SendHorizonal style={{ width: 12, height: 12 }} /> Generar solicitud</>}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Modal: generar pedido directo ────────────────────────────────────────────

function OrderModal({ obraId, rows, suppliers, onClose, onCreated }: {
  obraId: number;
  rows: PresupuestoRow[];
  suppliers: Supplier[];
  onClose: () => void;
  onCreated: (order: PurchaseOrder) => void;
}) {
  const pendientes = rows.filter(r => r.status === "pendiente");
  const [supplierId, setSupplierId] = useState<string>("");
  const [selected, setSelected] = useState<Set<number>>(new Set(pendientes.map(r => r.material_id)));
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleSupplierChange(v: string) {
    setSupplierId(v);
    if (v) {
      const sid = Number(v);
      setSelected(new Set(pendientes.filter(r => r.supplier_id === sid || r.supplier_id == null).map(r => r.material_id)));
    } else {
      setSelected(new Set(pendientes.map(r => r.material_id)));
    }
  }

  function toggle(id: number) {
    setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  async function handleCreate() {
    if (selected.size === 0) return;
    setSaving(true); setError(null);
    try {
      const order = await createPurchaseOrder(obraId, { supplier_id: supplierId ? Number(supplierId) : null, material_ids: Array.from(selected), notes: notes.trim() || null });
      onCreated(order);
    } catch {
      setError("No se pudo crear el pedido.");
      setSaving(false);
    }
  }

  const totalSel = pendientes.filter(r => selected.has(r.material_id)).reduce((a, r) => a + r.subtotal, 0);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 70, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(15,22,28,0.5)", padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 480, boxShadow: "0 24px 48px -12px rgba(15,22,28,0.35)", fontFamily: FONT, maxHeight: "85vh", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "18px 22px 14px", borderBottom: "1px solid #F0F1EF", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 15.5, fontWeight: 700, color: "#1A2329" }}>Generar pedido directo</h3>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "#6B7580" }}>Sin pasar por cotización — pedido inmediato al proveedor</p>
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 8, border: "1px solid #E6E7E5", background: "#fff", cursor: "pointer", color: "#6B7580", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <X style={{ width: 13, height: 13 }} />
          </button>
        </div>
        <div style={{ padding: "16px 22px", overflowY: "auto", flex: 1 }}>
          <label style={{ display: "block", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#5B6770", marginBottom: 5 }}>Proveedor</label>
          <select value={supplierId} onChange={e => handleSupplierChange(e.target.value)} style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", fontSize: 13, border: "1px solid #E6E7E5", borderRadius: 10, fontFamily: FONT, color: "#1A2329", outline: "none", cursor: "pointer", marginBottom: 14 }}>
            <option value="">Sin proveedor (pedido interno)</option>
            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}{s.category ? ` · ${s.category}` : ""}</option>)}
          </select>
          <label style={{ display: "block", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#5B6770", marginBottom: 5 }}>
            Materiales pendientes ({selected.size}/{pendientes.length})
          </label>
          <div style={{ border: "1px solid #EFECE6", borderRadius: 10, overflow: "hidden", marginBottom: 14 }}>
            {pendientes.length === 0 && <p style={{ margin: 0, padding: "10px 12px", fontSize: 12.5, color: "#6B7580" }}>No hay materiales pendientes.</p>}
            {pendientes.map((r, i) => (
              <label key={r.material_id} style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 10px", borderBottom: i < pendientes.length - 1 ? "1px solid #F4F1EB" : "none", background: selected.has(r.material_id) ? "#FFF8F3" : "#fff", cursor: "pointer" }}>
                <input type="checkbox" checked={selected.has(r.material_id)} onChange={() => toggle(r.material_id)} style={{ accentColor: "#FF6B35" }} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, color: "#1A2329", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.name}<span style={{ fontWeight: 400, color: "#6B7580" }}> · {r.task_title}</span>
                </span>
                <span style={{ fontSize: 11.5, color: "#5B6770", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
                  {r.quantity != null ? `${r.quantity} ${r.unit ?? ""}` : ""}{r.subtotal > 0 && ` · ${money(r.subtotal)}`}
                </span>
              </label>
            ))}
          </div>
          <label style={{ display: "block", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#5B6770", marginBottom: 5 }}>Notas (opcional)</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Ej: entregar en obra antes de las 10hs" style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", fontSize: 12.5, border: "1px solid #E6E7E5", borderRadius: 10, fontFamily: FONT, color: "#1A2329", outline: "none", resize: "vertical" }} />
          {error && <p style={{ margin: "10px 0 0", fontSize: 12, color: "#D03A3A", fontWeight: 600 }}>{error}</p>}
        </div>
        <div style={{ padding: "14px 22px 18px", borderTop: "1px solid #F0F1EF", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 12.5, color: "#5B6770" }}>Total: <strong style={{ color: "#1A2329" }}>{money(totalSel)}</strong></span>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose} disabled={saving} style={{ padding: "8px 14px", borderRadius: 10, fontSize: 12.5, fontWeight: 600, color: "#5B6770", background: "#fff", border: "1px solid #E6E7E5", cursor: "pointer" }}>Cancelar</button>
            <button onClick={handleCreate} disabled={saving || selected.size === 0} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 10, fontSize: 12.5, fontWeight: 700, color: saving || selected.size === 0 ? "#8E97A0" : "#fff", background: saving || selected.size === 0 ? "#E6E7E5" : "#FF6B35", border: "none", cursor: saving ? "wait" : "pointer" }}>
              {saving && <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} />}
              Crear pedido ({selected.size})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Modal: agregar material ──────────────────────────────────────────────────

function AddMaterialModal({ tasks, teamMembers, onClose, onAdded }: {
  tasks: Task[];
  teamMembers: ObraTeamMember[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const [taskId, setTaskId]         = useState<string>(tasks[0] ? String(tasks[0].id) : "");
  const [name, setName]             = useState("");
  const [qty, setQty]               = useState("");
  const [unit, setUnit]             = useState("");
  const [price, setPrice]           = useState("");
  const [contratistId, setContratistId] = useState("");
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [addAnother, setAddAnother] = useState(true);

  const contratistas = teamMembers.filter(m => m.member_type === "contratista");

  async function handleSave() {
    if (!taskId) { setError("Elegí a qué tarea pertenece el material."); return; }
    if (!name.trim()) { setError("Ingresá el nombre del material."); return; }
    setSaving(true); setError(null);
    try {
      await createMaterial(Number(taskId), { name: name.trim(), quantity: qty ? Number(qty) : null, unit: unit.trim() || null, unit_price: price ? Number(price) : null, responsible_id: contratistId ? Number(contratistId) : null });
      onAdded();
      if (addAnother) { setName(""); setQty(""); setUnit(""); setPrice(""); setContratistId(""); }
      else { onClose(); }
    } catch {
      setError("No se pudo agregar el material.");
    } finally {
      setSaving(false);
    }
  }

  const inp: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: "8px 10px", fontSize: 13, border: "1px solid #E6E7E5", borderRadius: 10, fontFamily: FONT, color: "#1A2329", outline: "none" };
  const lbl: React.CSSProperties = { display: "block", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#5B6770", marginBottom: 5 };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 70, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(15,22,28,0.5)", padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 460, boxShadow: "0 24px 48px -12px rgba(15,22,28,0.35)", fontFamily: FONT }}>
        <div style={{ padding: "18px 22px 14px", borderBottom: "1px solid #F0F1EF", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 15.5, fontWeight: 700, color: "#1A2329" }}>Agregar ítem al presupuesto</h3>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "#6B7580" }}>El material queda asociado a una tarea de la obra</p>
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 8, border: "1px solid #E6E7E5", background: "#fff", cursor: "pointer", color: "#6B7580", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <X style={{ width: 13, height: 13 }} />
          </button>
        </div>
        <div style={{ padding: "16px 22px", display: "flex", flexDirection: "column", gap: 12 }}>
          {tasks.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13, color: "#C97D0E", fontWeight: 600 }}>Esta obra todavía no tiene tareas. Creá una tarea primero en el tab Tareas.</p>
          ) : (
            <>
              <div>
                <label style={lbl}>Tarea</label>
                <select value={taskId} onChange={e => setTaskId(e.target.value)} style={{ ...inp, cursor: "pointer" }}>
                  {tasks.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Material</label>
                <input style={inp} placeholder="Ej: Cemento Portland" value={name} onChange={e => setName(e.target.value)} autoFocus />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                <div><label style={lbl}>Cantidad</label><input style={inp} type="number" min="0" placeholder="50" value={qty} onChange={e => setQty(e.target.value)} /></div>
                <div><label style={lbl}>Unidad</label><input style={inp} placeholder="bolsas" value={unit} onChange={e => setUnit(e.target.value)} /></div>
                <div><label style={lbl}>$ unit.</label><input style={inp} type="number" min="0" placeholder="8000" value={price} onChange={e => setPrice(e.target.value)} /></div>
              </div>
              <div>
                <label style={lbl}>Contratista (opcional)</label>
                <select value={contratistId} onChange={e => setContratistId(e.target.value)} style={{ ...inp, cursor: "pointer" }}>
                  <option value="">Sin asignar</option>
                  {contratistas.map(m => <option key={m.responsible_id} value={m.responsible_id}>{m.full_name}{m.role ? ` · ${m.role}` : ""}</option>)}
                </select>
              </div>
              {error && <p style={{ margin: 0, fontSize: 12, color: "#D03A3A", fontWeight: 600 }}>{error}</p>}
            </>
          )}
        </div>
        {tasks.length > 0 && (
          <div style={{ padding: "14px 22px 18px", borderTop: "1px solid #F0F1EF", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#5B6770", cursor: "pointer" }}>
              <input type="checkbox" checked={addAnother} onChange={e => setAddAnother(e.target.checked)} style={{ accentColor: "#FF6B35" }} />
              Seguir agregando
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={onClose} disabled={saving} style={{ padding: "8px 14px", borderRadius: 10, fontSize: 12.5, fontWeight: 600, color: "#5B6770", background: "#fff", border: "1px solid #E6E7E5", cursor: "pointer" }}>Cerrar</button>
              <button onClick={handleSave} disabled={saving || !name.trim()} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 10, fontSize: 12.5, fontWeight: 700, color: saving || !name.trim() ? "#8E97A0" : "#fff", background: saving || !name.trim() ? "#E6E7E5" : "#FF6B35", border: "none", cursor: saving ? "wait" : "pointer" }}>
                {saving && <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} />}
                Agregar ítem
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Modal: solicitud unificada ──────────────────────────────────────────────

function SolicitudAllModal({
  rows, teamMembers, suppliers, obraId, obraName, onClose, onCreated,
}: {
  rows: PresupuestoRow[];
  teamMembers: ObraTeamMember[];
  suppliers: Supplier[];
  obraId: number;
  obraName: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const allPending = useMemo(() => rows.filter(r => r.status === "pendiente"), [rows]);
  const [selected, setSelected] = useState<Set<number>>(() => new Set(allPending.map(r => r.material_id)));
  const [providerKey, setProviderKey] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdSol, setCreatedSol] = useState<{
    refCode: string;
    contratistaName: string | null;
    waMessage: string | null;
  } | null>(null);
  const [manualPhone, setManualPhone] = useState("");

  const contratistas = teamMembers.filter(m => m.member_type === "contratista");
  const hasProviders = suppliers.length > 0 || contratistas.length > 0;

  const groups = useMemo(() => {
    const map = new Map<number, { taskId: number; title: string; rows: PresupuestoRow[] }>();
    for (const r of allPending) {
      if (!map.has(r.task_id)) map.set(r.task_id, { taskId: r.task_id, title: r.task_title, rows: [] });
      map.get(r.task_id)!.rows.push(r);
    }
    return Array.from(map.values());
  }, [allPending]);

  function removeGroup(taskId: number) {
    const ids = allPending.filter(r => r.task_id === taskId).map(r => r.material_id);
    setSelected(prev => { const n = new Set(prev); ids.forEach(id => n.delete(id)); return n; });
  }
  function restoreGroup(taskId: number) {
    const ids = allPending.filter(r => r.task_id === taskId).map(r => r.material_id);
    setSelected(prev => { const n = new Set(prev); ids.forEach(id => n.add(id)); return n; });
  }
  function toggleMat(id: number) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  const providerName = providerKey.startsWith("s:")
    ? suppliers.find(s => s.id === Number(providerKey.slice(2)))?.name
    : contratistas.find(m => m.responsible_id === Number(providerKey.slice(2)))?.full_name;

  const selectedTotal = allPending.filter(r => selected.has(r.material_id)).reduce((a, r) => a + r.subtotal, 0);

  async function handleCreate() {
    if (selected.size === 0) { setError("Seleccioná al menos un material."); return; }
    if (!providerKey) { setError("Seleccioná un proveedor o contratista."); return; }
    setSaving(true); setError(null);

    let supplierIds: number[] = [];
    let contratistaPhones: string[] = [];
    let contratistaName: string | null = null;
    let contratistaHasPhone = false;

    if (providerKey.startsWith("s:")) {
      supplierIds = [Number(providerKey.slice(2))];
    } else {
      const cId = Number(providerKey.slice(2));
      const contratista = contratistas.find(m => m.responsible_id === cId);
      const match = suppliers.find(s => s.name.toLowerCase() === (contratista?.full_name ?? "").toLowerCase());
      supplierIds = match ? [match.id] : [];
      if (contratista && !match) {
        contratistaName = contratista.full_name;
        if (contratista.whatsapp_number) {
          contratistaPhones = [contratista.whatsapp_number];
          contratistaHasPhone = true;
        }
      }
    }

    try {
      const sol = await createSolicitud(obraId, {
        material_ids: Array.from(selected),
        supplier_ids: supplierIds,
        notes: notes.trim() || null,
        ...(contratistaPhones.length > 0 ? { contratista_phones: contratistaPhones } : {}),
      });

      if (contratistaName && !contratistaHasPhone) {
        // No phone registered — show success screen with manual phone input
        const matLines = allPending
          .filter(r => selected.has(r.material_id))
          .map(r => `• ${r.name}${r.quantity != null ? ` (${r.quantity} ${r.unit ?? ""})` : ""}`)
          .join("\n");
        const waMsg = `Solicitud de cotización ${sol.ref_code} — ${obraName}\n\nNecesitamos cotización para los siguientes materiales:\n${matLines}${notes.trim() ? `\n\nNotas: ${notes.trim()}` : ""}\n\nPor favor envianos tu cotización. Gracias.`;
        setCreatedSol({ refCode: sol.ref_code, contratistaName, waMessage: waMsg });
      } else {
        // Supplier formal o contratista con phone (backend ya envió Twilio)
        onCreated();
      }
    } catch {
      setError("No se pudo crear la solicitud.");
      setSaving(false);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 70, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(15,22,28,0.5)", backdropFilter: "blur(3px)", padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 520, boxShadow: "0 32px 64px -16px rgba(15,22,28,0.35)", fontFamily: FONT, maxHeight: "88vh", display: "flex", flexDirection: "column" }}>

        <div style={{ background: "linear-gradient(135deg, #1B2A34 0%, #243642 100%)", padding: "18px 22px", borderRadius: "16px 16px 0 0", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <SendHorizonal style={{ width: 14, height: 14, color: "#FF6B35" }} />
              <span style={{ fontSize: 10, fontWeight: 700, color: "#FF6B35", textTransform: "uppercase", letterSpacing: "0.1em" }}>Solicitud de cotización</span>
            </div>
            <h3 style={{ margin: 0, fontSize: 15.5, fontWeight: 700, color: "#fff" }}>Presupuesto completo</h3>
            <p style={{ margin: "2px 0 0", fontSize: 11.5, color: "rgba(255,255,255,0.55)" }}>
              {allPending.length} material{allPending.length !== 1 ? "es" : ""} pendiente{allPending.length !== 1 ? "s" : ""}
              {selectedTotal > 0 && ` · ${money(selectedTotal)}`}
            </p>
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.08)", cursor: "pointer", color: "rgba(255,255,255,0.7)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <X style={{ width: 13, height: 13 }} />
          </button>
        </div>

        {createdSol ? (
          <>
            <div style={{ padding: "28px 22px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 16, textAlign: "center" }}>
              <div style={{ width: 54, height: 54, borderRadius: "50%", background: "#E8F7EF", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <CheckCircle2 style={{ width: 28, height: 28, color: "#1F8A5B" }} />
              </div>
              <div>
                <h4 style={{ margin: "0 0 4px", fontSize: 15.5, fontWeight: 700, color: "#1A2329", fontFamily: FONT }}>Solicitud creada</h4>
                <p style={{ margin: 0, fontSize: 12.5, color: "#5B6770", fontFamily: FONT }}>
                  <span style={{ fontFamily: MONO, fontWeight: 700, color: "#1A2329" }}>{createdSol.refCode}</span> guardada como borrador
                </p>
              </div>
              {createdSol.contratistaName && createdSol.waMessage && (
                <div style={{ background: "#F7F5F0", borderRadius: 12, padding: "14px 18px", width: "100%", boxSizing: "border-box", textAlign: "left" }}>
                  <p style={{ margin: "0 0 8px", fontSize: 12, color: "#5B6770", fontFamily: FONT }}>
                    <strong style={{ color: "#1A2329" }}>{createdSol.contratistaName}</strong> no tiene WhatsApp registrado en el sistema. Ingresá su número para enviar la solicitud:
                  </p>
                  <input
                    type="tel"
                    value={manualPhone}
                    onChange={e => setManualPhone(e.target.value)}
                    placeholder="+54 9 351 000 0000"
                    style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", fontSize: 13, border: "1px solid #D0C8BE", borderRadius: 8, fontFamily: FONT, color: "#1A2329", outline: "none", marginBottom: 10 }}
                  />
                  {manualPhone.trim() && (
                    <a
                      href={`https://wa.me/${manualPhone.replace(/\D/g, "")}?text=${encodeURIComponent(createdSol.waMessage)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "9px 18px", borderRadius: 10, background: "#25D366", color: "#fff", textDecoration: "none", fontSize: 13, fontWeight: 700, fontFamily: FONT }}
                    >
                      <MessageCircle style={{ width: 14, height: 14 }} /> Enviar por WhatsApp
                    </a>
                  )}
                </div>
              )}
            </div>
            <div style={{ padding: "10px 22px 18px", borderTop: "1px solid #F0F1EF", display: "flex", justifyContent: "flex-end" }}>
              <button onClick={onCreated} style={{ padding: "8px 20px", borderRadius: 10, fontSize: 12.5, fontWeight: 700, color: "#fff", background: "#1A2329", border: "none", cursor: "pointer", fontFamily: FONT }}>
                Cerrar
              </button>
            </div>
          </>
        ) : (
          <>
          <div style={{ padding: "16px 22px", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 18 }}>

          {/* Materials grouped by task */}
          <div>
            <p style={{ margin: "0 0 8px", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#5B6770" }}>
              Materiales a cotizar
              <span style={{ fontWeight: 400, fontSize: 10, marginLeft: 6, color: "#9BA3AB" }}>({selected.size} seleccionados)</span>
            </p>
            {allPending.length === 0 ? (
              <p style={{ fontSize: 12.5, color: "#C97D0E", fontWeight: 600, margin: 0 }}>No hay materiales pendientes.</p>
            ) : (
              <div style={{ border: "1px solid #EFECE6", borderRadius: 10, overflow: "hidden" }}>
                {groups.map((g, gi) => {
                  const gSel = g.rows.filter(r => selected.has(r.material_id));
                  const allSel = gSel.length === g.rows.length;
                  const noneSel = gSel.length === 0;
                  return (
                    <div key={g.taskId} style={{ borderTop: gi > 0 ? "1px solid #EFECE6" : "none" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", background: "#F7F5F0" }}>
                        <span style={{ width: 3, height: 14, borderRadius: 99, background: "#FF6B35", flexShrink: 0 }} />
                        <span style={{ flex: 1, fontSize: 11, fontWeight: 700, color: "#3E4A52", textTransform: "uppercase", letterSpacing: "0.06em" }}>{g.title}</span>
                        <span style={{ fontSize: 10, color: "#9BA3AB" }}>{gSel.length}/{g.rows.length}</span>
                        {allSel ? (
                          <button onClick={() => removeGroup(g.taskId)} style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10.5, fontWeight: 600, color: "#D03A3A", background: "#FCE5E5", border: "none", borderRadius: 6, padding: "2px 7px", cursor: "pointer" }}>
                            <X style={{ width: 9, height: 9 }} /> Quitar todo
                          </button>
                        ) : noneSel ? (
                          <button onClick={() => restoreGroup(g.taskId)} style={{ fontSize: 10.5, fontWeight: 600, color: "#2A62C9", background: "#EBF3FF", border: "none", borderRadius: 6, padding: "2px 7px", cursor: "pointer" }}>Agregar todo</button>
                        ) : (
                          <button onClick={() => restoreGroup(g.taskId)} style={{ fontSize: 10.5, fontWeight: 600, color: "#2A62C9", background: "#EBF3FF", border: "none", borderRadius: 6, padding: "2px 7px", cursor: "pointer" }}>Restaurar</button>
                        )}
                      </div>
                      {g.rows.map((r, ri) => {
                        const isSel = selected.has(r.material_id);
                        return (
                          <div key={r.material_id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderTop: "1px solid #F4F1EB", background: isSel ? (ri % 2 === 0 ? "#fff" : "#FDFCFB") : "#F9F8F7", opacity: isSel ? 1 : 0.45, transition: "opacity 0.1s" }}>
                            <input type="checkbox" checked={isSel} onChange={() => toggleMat(r.material_id)} style={{ accentColor: "#FF6B35", flexShrink: 0 }} />
                            <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, color: "#1A2329", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
                            <span style={{ fontSize: 11, color: "#8E97A0", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
                              {r.quantity != null ? `${r.quantity} ${r.unit ?? ""}` : ""}
                              {r.subtotal > 0 && <> · {money(r.subtotal)}</>}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Provider picker: suppliers + contratistas */}
          <div>
            <p style={{ margin: "0 0 8px", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#5B6770" }}>
              Proveedor / Contratista <span style={{ color: "#D03A3A", fontWeight: 400 }}>*</span>
            </p>
            {!hasProviders ? (
              <p style={{ fontSize: 12.5, color: "#C97D0E", fontWeight: 600, margin: 0 }}>
                No hay proveedores ni contratistas. Agregalos en Configuración.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {suppliers.length > 0 && (
                  <div>
                    <p style={{ margin: "0 0 6px", fontSize: 10, fontWeight: 700, color: "#9BA3AB", textTransform: "uppercase", letterSpacing: "0.07em" }}>Proveedores</p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                      {suppliers.map(s => {
                        const k = `s:${s.id}`;
                        const sel = providerKey === k;
                        return (
                          <button key={s.id} onClick={() => { setProviderKey(k); setError(null); }} style={{ padding: "6px 13px", borderRadius: 99, fontSize: 12.5, fontWeight: 600, cursor: "pointer", background: sel ? "#FF6B35" : "#fff", color: sel ? "#fff" : "#3E4A52", border: sel ? "none" : "1px solid #D0C8BE", boxShadow: sel ? "0 4px 10px -4px rgba(255,107,53,0.5)" : "none", transition: "all 0.12s" }}>
                            {s.name}
                            {s.category && <span style={{ fontSize: 10.5, opacity: 0.75, marginLeft: 4 }}>· {s.category}</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                {contratistas.length > 0 && (
                  <div>
                    <p style={{ margin: "0 0 6px", fontSize: 10, fontWeight: 700, color: "#9BA3AB", textTransform: "uppercase", letterSpacing: "0.07em" }}>Contratistas del equipo</p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                      {contratistas.map(m => {
                        const k = `c:${m.responsible_id}`;
                        const sel = providerKey === k;
                        return (
                          <button key={m.responsible_id} onClick={() => { setProviderKey(k); setError(null); }} style={{ padding: "6px 13px", borderRadius: 99, fontSize: 12.5, fontWeight: 600, cursor: "pointer", background: sel ? "#1A2329" : "#fff", color: sel ? "#fff" : "#3E4A52", border: sel ? "none" : "1px solid #D0C8BE", boxShadow: sel ? "0 4px 10px -4px rgba(26,35,41,0.4)" : "none", transition: "all 0.12s" }}>
                            {m.full_name}
                            {m.role && <span style={{ fontSize: 10.5, opacity: 0.75, marginLeft: 4 }}>· {m.role}</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Notes */}
          <div>
            <p style={{ margin: "0 0 5px", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#5B6770" }}>
              Notas <span style={{ fontSize: 10, fontWeight: 400, color: "#9BA3AB", textTransform: "none" }}>(opcional)</span>
            </p>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Ej: necesitamos entrega antes del viernes" style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", fontSize: 12.5, border: "1px solid #E6E7E5", borderRadius: 10, fontFamily: FONT, color: "#1A2329", outline: "none", resize: "vertical" }} />
          </div>

          {error && <p style={{ margin: 0, fontSize: 12, color: "#D03A3A", fontWeight: 600 }}>{error}</p>}
        </div>

        <div style={{ padding: "14px 22px 18px", borderTop: "1px solid #F0F1EF", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 12, color: providerKey ? "#5B6770" : "#C97D0E" }}>
            {providerKey
              ? <>{selected.size} ítem{selected.size !== 1 ? "s" : ""} · <strong style={{ color: "#1A2329" }}>{providerName}</strong></>
              : "Seleccioná un proveedor para continuar"}
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose} disabled={saving} style={{ padding: "8px 14px", borderRadius: 10, fontSize: 12.5, fontWeight: 600, color: "#5B6770", background: "#fff", border: "1px solid #E6E7E5", cursor: "pointer" }}>Cancelar</button>
            <button
              onClick={handleCreate}
              disabled={saving || !providerKey || selected.size === 0}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px",
                borderRadius: 10, fontSize: 12.5, fontWeight: 700, border: "none",
                background: saving || !providerKey || selected.size === 0 ? "#E6E7E5" : "#FF6B35",
                color: saving || !providerKey || selected.size === 0 ? "#8E97A0" : "#fff",
                cursor: saving ? "wait" : (!providerKey || selected.size === 0) ? "not-allowed" : "pointer",
                boxShadow: !saving && providerKey && selected.size > 0 ? "0 6px 14px -6px rgba(255,107,53,0.5)" : "none",
              }}
            >
              {saving
                ? <><Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} /> Enviando...</>
                : <><SendHorizonal style={{ width: 12, height: 12 }} /> Generar solicitud</>}
            </button>
          </div>
        </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Tab principal ────────────────────────────────────────────────────────────

export function ComprasTab({ obraId, obraName, tasks = [] }: { obraId: number; obraName: string; tasks?: Task[] }) {
  const [data, setData]                 = useState<PresupuestoResponse | null>(null);
  const [orders, setOrders]             = useState<PurchaseOrder[]>([]);
  const [solicitudes, setSolicitudes]   = useState<SolicitudCotizacion[]>([]);
  const [suppliers, setSuppliers]       = useState<Supplier[]>([]);
  const [teamMembers, setTeamMembers]   = useState<ObraTeamMember[]>([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState<string | null>(null);

  const [activeModule, setActiveModule] = useState<ModuleId>("materiales");
  const [statusFilter, setStatusFilter] = useState("todos");
  const [taskFilter, setTaskFilter]     = useState("todas");
  const [search, setSearch]             = useState("");
  const [collapsed, setCollapsed]       = useState<Set<number>>(new Set());

  const [showOrderModal, setShowOrderModal]           = useState(false);
  const [showAddMaterial, setShowAddMaterial]         = useState(false);
  const [showSolicitudAll, setShowSolicitudAll]       = useState(false);
  const [exporting, setExporting]                     = useState(false);
  const [actingOrder, setActingOrder]                 = useState<number | null>(null);
  const [actionError, setActionError]                 = useState<string | null>(null);
  const [confirmingSol, setConfirmingSol]             = useState<number | null>(null);
  const [deletingSol, setDeletingSol]                 = useState<number | null>(null);
  const [analisisIA, setAnalisisIA]                   = useState<AnalisisHistoricoCompras | null>(null);
  const [loadingAnalisis, setLoadingAnalisis]         = useState(false);
  const [analisisError, setAnalisisError]             = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [pres, ords, sups, team, sols] = await Promise.all([
        fetchPresupuesto(obraId),
        fetchPurchaseOrders(obraId),
        fetchSuppliers(),
        fetchObraTeam(obraId),
        fetchSolicitudes(obraId),
      ]);
      setData(pres);
      setOrders(ords);
      setSuppliers(sups);
      setTeamMembers(team);
      setSolicitudes(sols);
      setError(null);
    } catch {
      setError("No se pudo cargar el módulo de compras.");
    } finally {
      setLoading(false);
    }
  }, [obraId]);

  useEffect(() => { load(); }, [load]);

  // Auto-poll solicitudes when on cotizaciones tab and any are still "enviada"
  const hasEnviadaRef = useRef(false);
  useEffect(() => {
    hasEnviadaRef.current = solicitudes.some(s => s.status === "enviada");
  }, [solicitudes]);
  useEffect(() => {
    if (activeModule !== "cotizaciones") return;
    const tid = setInterval(async () => {
      if (!hasEnviadaRef.current) return;
      try { setSolicitudes(await fetchSolicitudes(obraId)); } catch { /* silent */ }
    }, 8000);
    return () => clearInterval(tid);
  }, [activeModule, obraId]);

  const groups = useMemo(() => {
    if (!data) return [];
    const map = new Map<number, { taskId: number; title: string; rows: PresupuestoRow[]; subtotal: number }>();
    for (const r of data.rows) {
      if (!map.has(r.task_id)) map.set(r.task_id, { taskId: r.task_id, title: r.task_title, rows: [], subtotal: 0 });
      const g = map.get(r.task_id)!;
      g.rows.push(r);
      g.subtotal += r.subtotal;
    }
    return Array.from(map.values());
  }, [data]);

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return groups
      .map(g => ({
        ...g,
        rows: g.rows.filter(r => {
          const matchSearch = !q || r.name.toLowerCase().includes(q) || (r.responsible_name ?? "").toLowerCase().includes(q) || (r.supplier_name ?? "").toLowerCase().includes(q);
          const matchStatus = statusFilter === "todos" || r.status === statusFilter;
          const matchTask   = taskFilter === "todas" || String(r.task_id) === taskFilter;
          return matchSearch && matchStatus && matchTask;
        }),
      }))
      .filter(g => {
        if (taskFilter !== "todas" && String(g.taskId) !== taskFilter) return false;
        return !q || g.title.toLowerCase().includes(q) || g.rows.length > 0;
      });
  }, [groups, search, statusFilter, taskFilter]);

  async function handleSend(order: PurchaseOrder, channel: "whatsapp" | "email") {
    setActingOrder(order.id); setActionError(null);
    try {
      const updated = await sendPurchaseOrder(order.id, channel);
      setOrders(prev => prev.map(o => o.id === updated.id ? updated : o));
    } catch (e: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const detail = (e as any)?.response?.data?.detail;
      setActionError(typeof detail === "string" ? detail : "No se pudo enviar el pedido.");
    } finally { setActingOrder(null); }
  }

  async function handleReceive(order: PurchaseOrder) {
    setActingOrder(order.id); setActionError(null);
    try { await receivePurchaseOrder(order.id); await load(); }
    catch { setActionError("No se pudo marcar como recibido."); }
    finally { setActingOrder(null); }
  }

  async function handleConfirmarProveedor(solicitudId: number, supplierId: number) {
    setConfirmingSol(solicitudId);
    try { await confirmarProveedor(solicitudId, supplierId); await load(); }
    catch { setActionError("No se pudo confirmar el proveedor."); }
    finally { setConfirmingSol(null); }
  }

  async function handleConfirmarContratista(solicitudId: number, supplierName: string) {
    setConfirmingSol(solicitudId);
    try { await confirmarContratistaProveedor(solicitudId, supplierName, null); await load(); }
    catch { setActionError("No se pudo confirmar el contratista."); }
    finally { setConfirmingSol(null); }
  }

  async function handleDeleteSolicitud(solicitudId: number) {
    if (!window.confirm("¿Borrar esta solicitud? Esta acción no se puede deshacer.")) return;
    setDeletingSol(solicitudId);
    try { await deleteSolicitud(solicitudId); setSolicitudes(prev => prev.filter(s => s.id !== solicitudId)); }
    catch { setActionError("No se pudo eliminar la solicitud."); }
    finally { setDeletingSol(null); }
  }

  async function handleAnalisisIA() {
    setLoadingAnalisis(true); setAnalisisError(null);
    try { setAnalisisIA(await fetchAnalisisCompras(obraId)); }
    catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setAnalisisError(typeof msg === "string" ? msg : "No se pudo generar el análisis.");
    }
    finally { setLoadingAnalisis(false); }
  }

  if (loading) return <p style={{ padding: 24, fontSize: 13, color: "#6B7580", fontFamily: FONT }}>Cargando compras…</p>;
  if (error || !data) return <p style={{ padding: 24, fontSize: 13, color: "#D03A3A", fontFamily: FONT }}>{error}</p>;

  const pendientesCount = data.rows.filter(r => r.status === "pendiente").length;
  const tareasUnicas = groups.length;

  // ── Módulos tab bar ──────────────────────────────────────────────────────────
  const MODULE_TABS = [
    {
      id: "materiales" as ModuleId,
      num: "01", numBg: "#1A2329",
      label: "Materiales",
      count: data.rows.length,
    },
    {
      id: "cotizaciones" as ModuleId,
      num: "02", numBg: "#FF6B35",
      label: "Cotizaciones",
      count: solicitudes.length,
    },
    {
      id: "pedidos" as ModuleId,
      num: "03", numBg: "#1F8A5B",
      label: "Pedidos",
      count: orders.length,
    },
    {
      id: "analisis" as ModuleId,
      num: "04", numBg: "#7C3AED",
      label: "Inteligencia",
      count: 0,
    },
  ];

  const selBtn = (active: boolean): React.CSSProperties => ({
    display: "inline-flex", alignItems: "center", gap: 8,
    padding: "9px 14px", border: "none", cursor: "pointer",
    background: "none", fontFamily: FONT,
    borderBottom: active ? "2px solid #FF6B35" : "2px solid transparent",
    marginBottom: -1,
    transition: "border-color 0.15s",
  });

  const selDrop: React.CSSProperties = {
    padding: "7px 10px", fontSize: 12.5, border: "1px solid #E6E7E5",
    borderRadius: 8, fontFamily: FONT, color: "#3E4A52",
    background: "#fff", cursor: "pointer", outline: "none",
  };

  return (
    <div style={{ fontFamily: FONT, display: "flex", flexDirection: "column", gap: 0 }}>

      {/* ── KPIs ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
        {[
          { label: "Total estimado", value: data.total_estimado, color: "#1A2329", dot: "#9BA3AB" },
          { label: "Comprometido",   value: data.total_pedido,   color: "#B45309",  dot: "#B45309" },
          { label: "Gasto real",     value: data.total_recibido, color: "#1F8A5B",  dot: "#1F8A5B" },
        ].map(kpi => (
          <div key={kpi.label} style={{ background: "#fff", border: "1px solid #ECE7DD", borderRadius: 14, padding: "14px 16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: kpi.dot, flexShrink: 0 }} />
              <p style={{ margin: 0, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#6B7580" }}>{kpi.label}</p>
            </div>
            <p style={{ margin: 0, fontSize: 20, fontWeight: 800, color: kpi.color, fontVariantNumeric: "tabular-nums" }}>
              ${kpi.value.toLocaleString("es-AR", { maximumFractionDigits: 0 })}
            </p>
          </div>
        ))}
      </div>

      {/* ── Tabs de módulos ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 0,
        borderBottom: "1px solid #E6E7E5", marginBottom: 0,
        overflowX: "auto",
      }}>
        <span style={{
          fontSize: 9.5, fontWeight: 700, color: "#9BA3AB",
          textTransform: "uppercase", letterSpacing: "0.1em",
          padding: "0 14px 0 0", flexShrink: 0, paddingBottom: 12,
        }}>
          Módulos
        </span>
        {MODULE_TABS.map(m => (
          <button
            key={m.id}
            onClick={() => setActiveModule(m.id)}
            style={selBtn(activeModule === m.id)}
          >
            <span style={{
              width: 22, height: 22, borderRadius: 7, flexShrink: 0,
              background: activeModule === m.id ? m.numBg : "#E8E5DF",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 10, fontWeight: 800,
              color: activeModule === m.id ? "#fff" : "#7A7167",
              fontFamily: MONO, transition: "background 0.15s",
            }}>
              {m.num}
            </span>
            <span style={{
              fontSize: 12.5, fontWeight: activeModule === m.id ? 700 : 500,
              color: activeModule === m.id ? "#1A2329" : "#6B7580",
              whiteSpace: "nowrap",
            }}>
              {m.label}
            </span>
            {m.count > 0 && (
              <span style={{
                fontSize: 10.5, fontWeight: 700,
                padding: "1px 7px", borderRadius: 99,
                background: activeModule === m.id ? "#F2EFE8" : "#F4F5F4",
                color: activeModule === m.id ? "#5B5347" : "#8E97A0",
              }}>
                {m.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ════════ MÓDULO 01: MATERIALES ════════ */}
      {activeModule === "materiales" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <ModuleHeader
            num="01"
            numBg="#1A2329"
            title="Materiales"
            stats={data.rows.length > 0 ? `${data.rows.length} ítem${data.rows.length !== 1 ? "s" : ""} · ${tareasUnicas} tarea${tareasUnicas !== 1 ? "s" : ""}` : undefined}
            description="Planilla de obra — cantidades, precios y estado de cada material."
            actions={
              <>
                <button
                  onClick={() => setShowAddMaterial(true)}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 10, fontSize: 12.5, fontWeight: 600, color: "#1A2329", background: "#fff", border: "1px solid #D8D3CA", cursor: "pointer" }}
                >
                  <Plus style={{ width: 13, height: 13 }} /> Agregar ítem
                </button>
                <button
                  onClick={async () => { setExporting(true); try { await exportPresupuestoExcel(obraId, obraName); } finally { setExporting(false); } }}
                  disabled={exporting || data.rows.length === 0}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 10, fontSize: 12.5, fontWeight: 600, color: "#5B6770", background: "#fff", border: "1px solid #D8D3CA", cursor: "pointer", opacity: data.rows.length === 0 ? 0.5 : 1 }}
                >
                  <Download style={{ width: 13, height: 13 }} /> {exporting ? "Exportando…" : "Exportar Excel"}
                </button>
                <button
                  onClick={() => setShowSolicitudAll(true)}
                  disabled={pendientesCount === 0}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px",
                    borderRadius: 10, fontSize: 12.5, fontWeight: 700,
                    background: pendientesCount === 0 ? "#E6E7E5" : "#FF6B35", border: "none",
                    color: pendientesCount === 0 ? "#8E97A0" : "#fff",
                    cursor: pendientesCount === 0 ? "not-allowed" : "pointer",
                    boxShadow: pendientesCount === 0 ? "none" : "0 6px 14px -6px rgba(255,107,53,0.5)",
                  }}
                >
                  <SendHorizonal style={{ width: 13, height: 13 }} /> Generar solicitud
                </button>
              </>
            }
          />

          {/* Barra de filtros */}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#9BA3AB", pointerEvents: "none" }}>
                <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.4" />
                <path d="M9.5 9.5L12 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
              <input
                value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Buscar tarea, material o contratista…"
                style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px 8px 30px", borderRadius: 10, border: "1px solid #E6E7E5", background: "#fff", fontSize: 12.5, color: "#1A2329", fontFamily: FONT, outline: "none" }}
              />
              {search && (
                <button onClick={() => setSearch("")} style={{ position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#9BA3AB", padding: 0, display: "flex" }}>
                  <X style={{ width: 12, height: 12 }} />
                </button>
              )}
            </div>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={selDrop}>
              <option value="todos">Estado: Todos</option>
              <option value="pendiente">Pendiente</option>
              <option value="pedido">Pedido</option>
              <option value="recibido">Recibido</option>
            </select>
            <select value={taskFilter} onChange={e => setTaskFilter(e.target.value)} style={selDrop}>
              <option value="todas">Tarea</option>
              {groups.map(g => <option key={g.taskId} value={String(g.taskId)}>{g.title}</option>)}
            </select>
          </div>

          {/* Tabla de materiales */}
          {groups.length === 0 ? (
            <div style={{ background: "#fff", border: "1px solid #ECE7DD", borderRadius: 14, padding: "44px 24px", textAlign: "center" }}>
              <div style={{ width: 48, height: 48, borderRadius: 14, background: "#FFF0E8", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
                <ShoppingCart style={{ width: 22, height: 22, color: "#E76A2D" }} />
              </div>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#3E4A52" }}>Todavía no hay materiales cargados</p>
              <p style={{ margin: "4px 0 16px", fontSize: 12.5, color: "#6B7580" }}>
                Empezá agregando un ítem y elegí a qué tarea de la obra pertenece.
              </p>
              <button
                onClick={() => setShowAddMaterial(true)}
                disabled={tasks.length === 0}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 18px", borderRadius: 10, fontSize: 13, fontWeight: 700, color: tasks.length === 0 ? "#8E97A0" : "#fff", background: tasks.length === 0 ? "#E6E7E5" : "#FF6B35", border: "none", cursor: tasks.length === 0 ? "not-allowed" : "pointer", boxShadow: tasks.length === 0 ? "none" : "0 6px 14px -6px rgba(255,107,53,0.5)" }}>
                <Plus style={{ width: 14, height: 14 }} /> Agregar primer ítem
              </button>
              {tasks.length === 0 && <p style={{ margin: "10px 0 0", fontSize: 11.5, color: "#C97D0E" }}>Necesitás al menos una tarea. Creala en el tab Tareas.</p>}
            </div>
          ) : (
            <div style={{ background: "#fff", border: "1px solid #D8D3CA", borderRadius: 12, overflow: "hidden" }}>
              {/* Encabezado columnas */}
              <div style={{ display: "grid", gridTemplateColumns: COLS, columnGap: 8, padding: "8px 16px", background: "#F7F5F0", borderBottom: "1px solid #E2DDD5" }}>
                {["Descripción", "Cant.", "Precio unit.", "Subtotal", "Pedido por", "Estado"].map((h, hi) => (
                  <span key={h} style={{ fontSize: 9.5, fontWeight: 700, color: "#7A7167", letterSpacing: "0.09em", textTransform: "uppercase", textAlign: hi >= 1 && hi <= 3 ? "right" : "left", overflow: "hidden", whiteSpace: "nowrap", display: "block" }}>{h}</span>
                ))}
              </div>

              {filteredGroups.length === 0 && (
                <div style={{ padding: "24px 16px", textAlign: "center", fontSize: 13, color: "#8E97A0" }}>
                  Sin resultados para "<b>{search || statusFilter !== "todos" ? (statusFilter !== "todos" ? statusFilter : search) : taskFilter}</b>"
                </div>
              )}

              {filteredGroups.map((g, gi) => {
                const isOpen = !collapsed.has(gi);
                const pendCount = g.rows.filter(r => r.status === "pendiente").length;
                const uniqueContratistas = [...new Set(g.rows.map(r => r.responsible_name).filter((n): n is string => Boolean(n)))];
                const contratistaLabel = uniqueContratistas.length === 1 ? uniqueContratistas[0] : uniqueContratistas.length > 1 ? `${uniqueContratistas.length} contrat.` : null;
                return (
                  <div key={g.title} style={{ borderTop: gi > 0 ? "1px solid #E2DDD5" : "none" }}>
                    {/* Fila de sección */}
                    <div style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", background: "#FAFAF7", borderBottom: isOpen ? "1px solid #EDE9E1" : "none", boxSizing: "border-box" }}>
                      <button
                        onClick={() => setCollapsed(prev => { const n = new Set(prev); n.has(gi) ? n.delete(gi) : n.add(gi); return n; })}
                        style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, background: "none", border: "none", cursor: "pointer", padding: 0, textAlign: "left", minWidth: 0 }}
                      >
                        <span style={{ color: "#9BA3AB", flexShrink: 0, display: "flex" }}>
                          {isOpen ? <ChevronDown style={{ width: 13, height: 13 }} /> : <ChevronRight style={{ width: 13, height: 13 }} />}
                        </span>
                        <span style={{ width: 3, height: 16, borderRadius: 99, background: "#FF6B35", flexShrink: 0 }} />
                        <span style={{ fontSize: 11.5, fontWeight: 700, color: "#3E4A52", flex: 1, textTransform: "uppercase", letterSpacing: "0.06em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.title}</span>
                      </button>
                      {contratistaLabel && (
                        <span style={{ display: "inline-flex", alignItems: "center", fontSize: 10.5, fontWeight: 500, padding: "2px 8px", borderRadius: 99, background: "#F2EFE8", color: "#5B6770", flexShrink: 0, whiteSpace: "nowrap", maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis" }}>
                          {contratistaLabel}
                        </span>
                      )}
                      {pendCount > 0 && (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 99, background: "#EBF3FF", color: "#2A62C9", flexShrink: 0 }}>
                          <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#3B82F6" }} />
                          {pendCount} pend.
                        </span>
                      )}
                      {!isOpen && <span style={{ fontSize: 13, fontWeight: 800, color: "#1A2329", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{money(g.subtotal)}</span>}
                    </div>

                    {/* Filas de materiales */}
                    {isOpen && g.rows.map((r, i) => (
                      <div key={r.material_id} style={{ display: "grid", gridTemplateColumns: COLS, columnGap: 8, alignItems: "center", padding: "9px 16px", borderBottom: "1px solid #F4F1EB", background: i % 2 === 0 ? "#fff" : "#FDFCFB" }}>
                        <span style={{ fontSize: 13, color: "#1A2329", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.name}>{r.name}</span>
                        <span style={{ fontSize: 12.5, color: "#5B6770", fontVariantNumeric: "tabular-nums", textAlign: "right" }}>{r.quantity != null ? `${r.quantity} ${r.unit ?? ""}` : "—"}</span>
                        <span style={{ fontSize: 12.5, color: "#5B6770", fontVariantNumeric: "tabular-nums", textAlign: "right" }}>{money(r.unit_price)}</span>
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: "#1A2329", fontVariantNumeric: "tabular-nums", textAlign: "right" }}>{r.subtotal > 0 ? money(r.subtotal) : "—"}</span>
                        <span style={{ fontSize: 12, color: r.created_by_name ? "#5B6770" : "#C4C9C6", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.created_by_name ?? "—"}</span>
                        <span><Pill status={r.status} /></span>
                      </div>
                    ))}

                    {/* Subtotal sección */}
                    {isOpen && (
                      <div style={{ display: "grid", gridTemplateColumns: COLS, columnGap: 8, alignItems: "center", padding: "7px 16px", background: "#F2EFE8", borderTop: "1px solid #E2DDD5" }}>
                        <span style={{ gridColumn: "1 / 4", fontSize: 10, fontWeight: 700, color: "#7A7167", textTransform: "uppercase", letterSpacing: "0.07em", textAlign: "right" }}>
                          Subtotal {g.title}
                        </span>
                        <span style={{ fontSize: 13, fontWeight: 800, color: "#1A2329", fontVariantNumeric: "tabular-nums", textAlign: "right" }}>{money(g.subtotal)}</span>
                        <span /><span />
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Total general */}
              <div style={{ display: "grid", gridTemplateColumns: COLS, columnGap: 8, alignItems: "center", padding: "13px 16px", background: "#1A2329", borderTop: "2px solid #0E161B" }}>
                <span style={{ gridColumn: "1 / 4", fontSize: 10.5, fontWeight: 700, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.1em", textAlign: "right" }}>
                  Total general
                </span>
                <span style={{ fontSize: 17, fontWeight: 800, color: "#fff", fontVariantNumeric: "tabular-nums", textAlign: "right" }}>{money(data.total_estimado)}</span>
                <span /><span />
              </div>
            </div>
          )}
        </div>
      )}

      {/* ════════ MÓDULO 02: SOLICITUDES DE COTIZACIÓN ════════ */}
      {activeModule === "cotizaciones" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <ModuleHeader
            num="02"
            numBg="#FF6B35"
            title="Solicitudes de cotización"
            stats={solicitudes.length > 0 ? `${solicitudes.length} solicitud${solicitudes.length !== 1 ? "es" : ""}` : undefined}
            description="Pedís presupuesto a proveedores. Cuando llegan 2+ respuestas, la IA compara y recomienda."
            actions={
              <button
                onClick={() => setShowSolicitudAll(true)}
                disabled={pendientesCount === 0}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px",
                  borderRadius: 10, fontSize: 12.5, fontWeight: 700,
                  background: pendientesCount === 0 ? "#E6E7E5" : "#FF6B35", border: "none",
                  color: pendientesCount === 0 ? "#8E97A0" : "#fff",
                  cursor: pendientesCount === 0 ? "not-allowed" : "pointer",
                  boxShadow: pendientesCount === 0 ? "none" : "0 6px 14px -6px rgba(255,107,53,0.5)",
                }}
              >
                <SendHorizonal style={{ width: 13, height: 13 }} /> Nueva solicitud
              </button>
            }
          />

          {solicitudes.length === 0 ? (
            <div style={{ background: "#fff", border: "1px dashed #D0C8BE", borderRadius: 14, padding: "44px 24px", textAlign: "center" }}>
              <div style={{ width: 48, height: 48, borderRadius: 14, background: "#FFF0E8", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
                <SendHorizonal style={{ width: 20, height: 20, color: "#E76A2D" }} />
              </div>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#3E4A52" }}>No hay solicitudes de cotización</p>
              <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "#6B7580" }}>
                {pendientesCount === 0
                  ? "Primero cargá materiales pendientes en el módulo Materiales."
                  : `Tenés ${pendientesCount} material${pendientesCount !== 1 ? "es" : ""} pendiente${pendientesCount !== 1 ? "s" : ""}. Creá una solicitud para cotizarlos.`}
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {solicitudes.map((sol, i) => (
                <SolicitudCard
                  key={sol.id}
                  sol={sol}
                  index={i}
                  onConfirmar={handleConfirmarProveedor}
                  onConfirmarCont={handleConfirmarContratista}
                  onDelete={handleDeleteSolicitud}
                  confirming={confirmingSol === sol.id}
                  deleting={deletingSol === sol.id}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ════════ MÓDULO 03: PEDIDOS CONFIRMADOS ════════ */}
      {activeModule === "pedidos" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <ModuleHeader
            num="03"
            numBg="#1F8A5B"
            title="Pedidos confirmados"
            stats={orders.length > 0 ? `${orders.length} orden${orders.length !== 1 ? "es" : ""}` : undefined}
            description="Historial de órdenes de compra ya generadas."
            actions={
              <button
                onClick={() => setShowOrderModal(true)}
                disabled={pendientesCount === 0}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px",
                  borderRadius: 10, fontSize: 12.5, fontWeight: 600,
                  background: "#fff", border: "1px solid #D8D3CA",
                  color: pendientesCount === 0 ? "#8E97A0" : "#1A2329",
                  cursor: pendientesCount === 0 ? "not-allowed" : "pointer",
                }}
              >
                <ShoppingCart style={{ width: 13, height: 13 }} /> Generar pedido directo
              </button>
            }
          />

          {orders.length === 0 ? (
            <div style={{ background: "#fff", border: "1px dashed #D0C8BE", borderRadius: 14, padding: "44px 24px", textAlign: "center" }}>
              <div style={{ width: 48, height: 48, borderRadius: 14, background: "#E4F3EC", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
                <Package style={{ width: 22, height: 22, color: "#1F8A5B" }} />
              </div>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#3E4A52" }}>No hay pedidos todavía</p>
              <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "#6B7580" }}>
                Los pedidos confirmados desde cotizaciones o directo aparecen acá.
              </p>
            </div>
          ) : (
            <div style={{ background: "#fff", border: "1px solid #D8D3CA", borderRadius: 12, overflow: "hidden" }}>
              {orders.map((o, i) => (
                <div key={o.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: i < orders.length - 1 ? "1px solid #F0EDE7" : "none", background: i % 2 === 0 ? "#fff" : "#FDFCFB" }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: o.status === "recibido" ? "#E4F3EC" : "#F2EFE8", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {o.status === "recibido"
                      ? <PackageCheck style={{ width: 16, height: 16, color: "#1F8A5B" }} />
                      : <Package style={{ width: 16, height: 16, color: "#8E97A0" }} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: "#1A2329" }}>
                      Pedido #{o.id}
                      <span style={{ fontWeight: 400, color: "#6B7580" }}>
                        {" · "}{o.supplier_name ?? "sin proveedor"}
                        {" · "}{o.items.length} ítem{o.items.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: "#8E97A0", marginTop: 2 }}>
                      {fmtDate(o.created_at)}
                      {o.items.length > 0 && (
                        <span style={{ color: "#9BA3AB" }}> · {o.items.map(it => `${it.name}${it.quantity ? ` · ${it.quantity} ${it.unit ?? ""}` : ""}`).join(", ").slice(0, 60)}{o.items.map(it => it.name).join(", ").length > 60 ? "…" : ""}</span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    {o.total > 0 && (
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#1A2329", fontVariantNumeric: "tabular-nums" }}>{money(o.total)}</span>
                    )}
                    <Pill status={o.status} />
                  </div>
                  {o.status !== "recibido" && (
                    <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
                      {o.status === "borrador" && o.supplier_phone && (
                        <button onClick={() => handleSend(o, "whatsapp")} disabled={actingOrder === o.id} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 10px", borderRadius: 8, fontSize: 11.5, fontWeight: 600, color: "#136E47", background: "#E4F3EC", border: "none", cursor: "pointer" }}>
                          <MessageCircle style={{ width: 12, height: 12 }} /> WA
                        </button>
                      )}
                      {o.status === "borrador" && o.supplier_email && (
                        <button onClick={() => handleSend(o, "email")} disabled={actingOrder === o.id} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 10px", borderRadius: 8, fontSize: 11.5, fontWeight: 600, color: "#2A62C9", background: "#EBF3FF", border: "none", cursor: "pointer" }}>
                          <Mail style={{ width: 12, height: 12 }} /> Email
                        </button>
                      )}
                      <button onClick={() => handleReceive(o)} disabled={actingOrder === o.id} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 10px", borderRadius: 8, fontSize: 11.5, fontWeight: 700, color: "#fff", background: "#1F8A5B", border: "none", cursor: "pointer" }}>
                        {actingOrder === o.id ? <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} /> : <PackageCheck style={{ width: 12, height: 12 }} />}
                        Recibido
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ════════ MÓDULO 04: INTELIGENCIA IA ════════ */}
      {activeModule === "analisis" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <ModuleHeader
            num="04" numBg="#7C3AED"
            title="Inteligencia de Compras"
            description="Análisis estadístico histórico de cotizaciones. El análisis con IA es opcional y se genera bajo demanda."
            actions={null}
          />

          {/* Stats rápidas sin IA */}
          {(() => {
            const respondidas = solicitudes.filter(s => s.respuestas.length > 0);
            const todasResp = respondidas.flatMap(s => s.respuestas);
            const porProveedor = todasResp.reduce<Record<string, { count: number; totales: number[] }>>((acc, r) => {
              const k = r.supplier_name;
              if (!acc[k]) acc[k] = { count: 0, totales: [] };
              acc[k].count++;
              if (r.total != null) acc[k].totales.push(r.total);
              return acc;
            }, {});
            const provEntries = Object.entries(porProveedor).sort((a, b) => b[1].count - a[1].count);

            return (
              <>
                {/* KPIs rápidos */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                  {[
                    { label: "Solicitudes totales", value: solicitudes.length },
                    { label: "Con respuesta", value: respondidas.length },
                    { label: "Proveedores únicos", value: provEntries.length },
                  ].map(k => (
                    <div key={k.label} style={{ background: "#fff", border: "1px solid #E6E7E5", borderRadius: 12, padding: "12px 16px" }}>
                      <p style={{ margin: "0 0 4px", fontSize: 9.5, fontWeight: 700, color: "#7A7167", textTransform: "uppercase", letterSpacing: "0.08em" }}>{k.label}</p>
                      <p style={{ margin: 0, fontSize: 26, fontWeight: 800, color: "#1A2329", fontVariantNumeric: "tabular-nums" }}>{k.value}</p>
                    </div>
                  ))}
                </div>

                {/* Tabla estadística por proveedor */}
                {provEntries.length > 0 && (
                  <div>
                    <p style={{ margin: "0 0 8px", fontSize: 10, fontWeight: 700, color: "#7A7167", textTransform: "uppercase", letterSpacing: "0.09em" }}>Resumen por proveedor</p>
                    <div style={{ background: "#fff", border: "1px solid #E6E7E5", borderRadius: 12, overflow: "hidden" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 100px 100px 100px", background: "#F2EFE8", borderBottom: "1px solid #D8D3CA" }}>
                        {["Proveedor", "Resp.", "Promedio", "Mínimo", "Máximo"].map((h, i) => (
                          <span key={h} style={{ padding: "7px 12px", fontSize: 9.5, fontWeight: 700, color: "#7A7167", textTransform: "uppercase", letterSpacing: "0.08em", textAlign: i > 0 ? "right" : "left" }}>{h}</span>
                        ))}
                      </div>
                      {provEntries.map(([nombre, stats], idx) => {
                        const avg = stats.totales.length > 0 ? stats.totales.reduce((a, b) => a + b, 0) / stats.totales.length : null;
                        const min = stats.totales.length > 0 ? Math.min(...stats.totales) : null;
                        const max = stats.totales.length > 0 ? Math.max(...stats.totales) : null;
                        return (
                          <div key={nombre} style={{ display: "grid", gridTemplateColumns: "1fr 80px 100px 100px 100px", borderBottom: idx < provEntries.length - 1 ? "1px solid #F0EDE7" : "none", background: idx % 2 === 0 ? "#fff" : "#FDFCFB", alignItems: "center" }}>
                            <span style={{ padding: "9px 12px", fontSize: 12.5, fontWeight: 600, color: "#1A2329" }}>{nombre}</span>
                            <span style={{ padding: "9px 12px", fontSize: 12, color: "#5B6770", textAlign: "right" }}>{stats.count}</span>
                            <span style={{ padding: "9px 12px", fontSize: 12, fontWeight: 700, color: "#1A2329", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(avg)}</span>
                            <span style={{ padding: "9px 12px", fontSize: 11.5, color: "#1F8A5B", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(min)}</span>
                            <span style={{ padding: "9px 12px", fontSize: 11.5, color: "#B45309", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(max)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Botón de análisis IA */}
                <div style={{ background: "linear-gradient(135deg, #F5F3FF 0%, #EDE9FE 100%)", border: "1px solid #DDD6FE", borderRadius: 14, padding: "20px 22px" }}>
                  {!analisisIA && !loadingAnalisis && (
                    <>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                        <div style={{ width: 38, height: 38, borderRadius: 11, background: "#7C3AED", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <Brain style={{ width: 18, height: 18, color: "#fff" }} />
                        </div>
                        <div>
                          <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: "#1A2329" }}>Análisis estratégico con IA</p>
                          <p style={{ margin: 0, fontSize: 11.5, color: "#6B7580" }}>Comparación histórica · recomendación · materiales críticos · alertas</p>
                        </div>
                      </div>
                      <p style={{ margin: "0 0 14px", fontSize: 11.5, color: "#5B5347" }}>
                        Genera un análisis completo sobre el historial de compras de esta obra.
                        {" "}<strong>Se consumen tokens de IA.</strong>
                      </p>
                      <button
                        onClick={handleAnalisisIA}
                        disabled={respondidas.length === 0}
                        style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 18px", borderRadius: 10, fontSize: 13, fontWeight: 700, border: "none", background: respondidas.length === 0 ? "#E6E7E5" : "#7C3AED", color: respondidas.length === 0 ? "#8E97A0" : "#fff", cursor: respondidas.length === 0 ? "not-allowed" : "pointer", boxShadow: respondidas.length > 0 ? "0 6px 16px -6px rgba(124,58,237,0.55)" : "none" }}
                      >
                        <Sparkles style={{ width: 14, height: 14 }} /> Generar análisis
                      </button>
                      {respondidas.length === 0 && <p style={{ margin: "8px 0 0", fontSize: 11, color: "#C97D0E" }}>Necesitás al menos una cotización respondida.</p>}
                      {analisisError && <p style={{ margin: "8px 0 0", fontSize: 12, color: "#D03A3A", fontWeight: 600 }}>{analisisError}</p>}
                    </>
                  )}

                  {loadingAnalisis && (
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <Loader2 style={{ width: 18, height: 18, color: "#7C3AED", animation: "spin 1s linear infinite" }} />
                      <span style={{ fontSize: 13, color: "#5B5347", fontWeight: 600 }}>Analizando historial con IA…</span>
                    </div>
                  )}

                  {analisisIA && !loadingAnalisis && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                      {/* Recomendado + motivo */}
                      {analisisIA.proveedor_recomendado && (
                        <div style={{ display: "flex", alignItems: "center", gap: 12, background: "#1A2329", borderRadius: 11, padding: "12px 16px" }}>
                          <div style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(124,58,237,0.25)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                            <Sparkles style={{ width: 15, height: 15, color: "#A78BFA" }} />
                          </div>
                          <div>
                            <span style={{ fontSize: 10, fontWeight: 700, color: "#A78BFA", textTransform: "uppercase", letterSpacing: "0.08em", display: "block" }}>IA recomienda</span>
                            <span style={{ fontSize: 15, fontWeight: 800, color: "#fff", display: "block" }}>{analisisIA.proveedor_recomendado}</span>
                            <span style={{ fontSize: 11.5, color: "rgba(255,255,255,0.55)" }}>{analisisIA.motivo}</span>
                          </div>
                          {analisisIA.ahorro_potencial != null && analisisIA.ahorro_potencial > 0 && (
                            <div style={{ marginLeft: "auto", textAlign: "right" }}>
                              <span style={{ fontSize: 9.5, fontWeight: 700, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.08em", display: "block" }}>Ahorro potencial</span>
                              <span style={{ fontSize: 20, fontWeight: 800, color: "#4DD9A0", fontVariantNumeric: "tabular-nums" }}>{money(analisisIA.ahorro_potencial)}</span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Stats por proveedor con tendencia */}
                      {analisisIA.por_proveedor.length > 0 && (
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {analisisIA.por_proveedor.map(p => {
                            const tendColor = p.tendencia === "competitivo" ? "#136E47" : p.tendencia === "caro" ? "#D03A3A" : "#B45309";
                            const tendBg = p.tendencia === "competitivo" ? "#E4F3EC" : p.tendencia === "caro" ? "#FCE5E5" : "#FFF3CD";
                            return (
                              <div key={p.nombre} style={{ flex: "1 1 150px", background: "#fff", border: "1px solid #E6E7E5", borderRadius: 11, padding: "12px 14px" }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                                  <span style={{ fontSize: 12.5, fontWeight: 700, color: "#1A2329", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, marginRight: 6 }}>{p.nombre}</span>
                                  <span style={{ display: "inline-flex", padding: "2px 7px", borderRadius: 99, fontSize: 10, fontWeight: 700, background: tendBg, color: tendColor, flexShrink: 0 }}>{p.tendencia.replace("_", " ")}</span>
                                </div>
                                <p style={{ margin: "0 0 2px", fontSize: 11.5, color: "#6B7580" }}>
                                  {p.cotizaciones_respondidas} resp. · avg {money(p.precio_promedio)}
                                </p>
                                <p style={{ margin: 0, fontSize: 10.5, color: "#8E97A0" }}>{p.fortaleza}</p>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Materiales críticos */}
                      {analisisIA.materiales_criticos.length > 0 && (
                        <div>
                          <p style={{ margin: "0 0 7px", fontSize: 10, fontWeight: 700, color: "#7A7167", textTransform: "uppercase", letterSpacing: "0.09em" }}>Materiales con mayor diferencia de precio</p>
                          <div style={{ background: "#fff", border: "1px solid #E6E7E5", borderRadius: 10, overflow: "hidden" }}>
                            {analisisIA.materiales_criticos.map((m, idx) => (
                              <div key={m.nombre} style={{ display: "grid", gridTemplateColumns: "1fr 130px 80px 60px", alignItems: "center", borderBottom: idx < analisisIA.materiales_criticos.length - 1 ? "1px solid #F0EDE7" : "none", background: idx % 2 === 0 ? "#fff" : "#FDFCFB" }}>
                                <span style={{ padding: "8px 12px", fontSize: 12, color: "#1A2329", fontWeight: 500 }}>{m.nombre}</span>
                                <span style={{ padding: "8px 12px", fontSize: 11.5, color: "#136E47", fontWeight: 600 }}>{m.proveedor_mas_barato ?? "—"}</span>
                                {m.diferencia_pct != null ? (
                                  <span style={{ padding: "8px 12px", fontSize: 12, fontWeight: 700, color: "#1F8A5B", textAlign: "right" }}>−{m.diferencia_pct.toFixed(0)}%</span>
                                ) : <span />}
                                <span style={{ padding: "8px 12px", fontSize: 11, color: "#8E97A0", textAlign: "right" }}>{m.veces_cotizado}×</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Alertas */}
                      {analisisIA.alertas.length > 0 && (
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 700, color: "#B45309", textTransform: "uppercase", letterSpacing: "0.08em", flexShrink: 0 }}>
                            <AlertTriangle style={{ width: 11, height: 11 }} /> Alertas
                          </span>
                          {analisisIA.alertas.map((a, i) => (
                            <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 99, fontSize: 11, fontWeight: 600, background: "#FFF3CD", color: "#7A4200", border: "1px solid #F0D080" }}>
                              <AlertTriangle style={{ width: 9, height: 9, flexShrink: 0 }} />{a}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Regenerar */}
                      <button onClick={() => setAnalisisIA(null)} style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 8, fontSize: 11.5, fontWeight: 600, background: "#fff", border: "1px solid #DDD6FE", color: "#7C3AED", cursor: "pointer" }}>
                        <Sparkles style={{ width: 11, height: 11 }} /> Regenerar análisis
                      </button>
                    </div>
                  )}
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* ── Error de acción ── */}
      {actionError && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#FCE5E5", border: "1px solid #F0B0B0", borderRadius: 11, padding: "9px 12px", marginTop: 8 }}>
          <span style={{ fontSize: 12.5, color: "#A82B2B", fontWeight: 600, flex: 1 }}>{actionError}</span>
          <button onClick={() => setActionError(null)} style={{ border: "none", background: "none", cursor: "pointer", color: "#A82B2B", fontSize: 14, fontWeight: 700, padding: 0 }}>×</button>
        </div>
      )}

      {/* ── Modales ── */}
      {showOrderModal && data && (
        <OrderModal
          obraId={obraId} rows={data.rows} suppliers={suppliers}
          onClose={() => setShowOrderModal(false)}
          onCreated={() => { setShowOrderModal(false); load(); setActiveModule("pedidos"); }}
        />
      )}
      {showAddMaterial && (
        <AddMaterialModal
          tasks={tasks} teamMembers={teamMembers}
          onClose={() => setShowAddMaterial(false)}
          onAdded={load}
        />
      )}
      {showSolicitudAll && data && (
        <SolicitudAllModal
          rows={data.rows}
          teamMembers={teamMembers}
          suppliers={suppliers}
          obraId={obraId}
          obraName={obraName}
          onClose={() => setShowSolicitudAll(false)}
          onCreated={() => { setShowSolicitudAll(false); load(); setActiveModule("cotizaciones"); }}
        />
      )}
    </div>
  );
}
