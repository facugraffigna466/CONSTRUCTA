import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, Brain, CheckCircle2, ChevronDown,
  Clock, CreditCard, Download, Layers, Loader2, Mail, MessageCircle,
  Package, PackageCheck, Plus, SendHorizonal, ShoppingCart, Sparkles,
  Target, ThumbsDown, ThumbsUp, Trash2, Trophy, Truck, X,
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
import { useConfirm } from "./ConfirmProvider";
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

type ModuleId = "materiales" | "cotizaciones" | "pedidos" | "analisis";

const STATUS_META: Record<string, { label: string; dot: string; bg: string; color: string }> = {
  pendiente: { label: "Pendiente", dot: "#3B82F6", bg: "#EBF3FF", color: "#2A62C9" },
  pedido:    { label: "Pedido",    dot: "#9BA3AB", bg: "#F4F5F4", color: "#5B6770" },
  recibido:  { label: "Recibido",  dot: "#1F8A5B", bg: "#E4F3EC", color: "#136E47" },
  borrador:  { label: "Borrador",  dot: "#9BA3AB", bg: "#F4F5F4", color: "#5B6770" },
  enviado:   { label: "Enviado",   dot: "#B45309", bg: "#FFFBEB", color: "#B45309" },
  cotizado:  { label: "Cotizado",  dot: "#FF6B35", bg: "#FFF0E8", color: "#B84C10" },
};


function money(n: number | null | undefined): string {
  if (n == null) return "—";
  return "$" + n.toLocaleString("es-AR", { maximumFractionDigits: 2 });
}

function fmtK(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1) + "M";
  if (n >= 1_000) return "$" + Math.round(n / 1_000) + "K";
  return "$" + Math.round(n);
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

const SOL_STM: Record<string, { label: string; color: string; bg: string; soft: string; rail: string; line: string }> = {
  borrador:   { label: "Borrador",   color: "#5B6770", bg: "#F4F5F4", soft: "#FAFAF8", rail: "#CDD0CC", line: "#E6E7E5" },
  enviada:    { label: "Enviada",    color: "#B45309", bg: "#FEF3E8", soft: "#FFFBF4", rail: "#E8A33D", line: "#F0D0A8" },
  respondida: { label: "Respondida", color: "#2A62C9", bg: "#EBF3FF", soft: "#F8FBFF", rail: "#2A62C9", line: "#C6DBF7" },
  confirmada: { label: "Confirmada", color: "#136E47", bg: "#E4F3EC", soft: "#F5FBF8", rail: "#1F8A5B", line: "#B8DECA" },
};

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
  const [expanded, setExpanded] = useState(sol.status === "respondida" || sol.status === "confirmada");
  const hasResponses = sol.respuestas.length > 0;
  const refNum = `COT-${String(index + 1).padStart(2, "0")}`;
  const m = SOL_STM[sol.status] ?? SOL_STM.borrador;

  const proveedoresLabel = sol.suppliers.length > 0
    ? sol.suppliers.map(s => s.supplier_name).join(", ")
    : sol.respuestas.length > 0
      ? [...new Set(sol.respuestas.map(r => r.supplier_name))].join(", ")
      : sol.contratista_phone
        ? "Contratista directo"
        : "Sin proveedor asignado";

  const respCount = sol.respuestas.length;
  const suppCount = sol.suppliers.length;

  return (
    <div style={{
      background: "#fff",
      border: `1px solid ${m.line}`,
      borderRadius: 14,
      overflow: "hidden",
      boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
      position: "relative",
    }}>
      {/* Left rail */}
      <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: m.rail, zIndex: 1 }} />

      {/* Header */}
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 12,
          padding: "14px 18px 14px 18px",
          background: expanded ? m.soft : "#fff",
          border: "none", borderBottom: expanded ? `1px solid ${m.line}` : "none",
          cursor: "pointer", textAlign: "left", fontFamily: FONT,
          boxSizing: "border-box",
        }}
      >
        {/* Chevron */}
        <span style={{ color: "#8E97A0", flexShrink: 0, display: "flex", transform: expanded ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.2s" }}>
          <ChevronDown style={{ width: 14, height: 14 }} />
        </span>
        {/* Ref code */}
        <span style={{ fontSize: 11.5, fontWeight: 800, color: "#FF6B35", fontFamily: MONO, flexShrink: 0, letterSpacing: "0.04em" }}>
          {refNum}
        </span>
        {/* Main info */}
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: "#1A2329", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
            {proveedoresLabel}
          </span>
          <span style={{ fontSize: 11, color: "#8E97A0", display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
            <span>{fmtDate(sol.created_at)}</span>
            {sol.material_ids.length > 0 && <><span style={{ color: "#D8D3CA" }}>·</span><span>{sol.material_ids.length} material{sol.material_ids.length !== 1 ? "es" : ""}</span></>}
            {suppCount > 0 && <><span style={{ color: "#D8D3CA" }}>·</span><span>{suppCount} proveedor{suppCount !== 1 ? "es" : ""}</span></>}
            {respCount > 0 && <><span style={{ color: "#D8D3CA" }}>·</span><span style={{ color: "#2A62C9", fontWeight: 600 }}>{respCount} respuesta{respCount !== 1 ? "s" : ""}</span></>}
          </span>
        </span>
        {/* Status pill */}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 99, fontSize: 11, fontWeight: 700, border: `1px solid ${m.line}`, color: m.color, background: m.bg, whiteSpace: "nowrap" as const, flexShrink: 0 }}>
          {sol.status === "confirmada"
            ? <CheckCircle2 style={{ width: 11, height: 11 }} />
            : sol.status === "respondida"
            ? <Brain style={{ width: 11, height: 11 }} />
            : sol.status === "enviada"
            ? <SendHorizonal style={{ width: 11, height: 11 }} />
            : <Clock style={{ width: 11, height: 11 }} />}
          {m.label}
        </span>
        {/* Delete button */}
        <button
          onClick={e => { e.stopPropagation(); onDelete(sol.id); }}
          disabled={deleting}
          title="Eliminar solicitud"
          style={{ width: 28, height: 28, borderRadius: 8, border: "1px solid #E6E7E5", background: "#fff", cursor: deleting ? "wait" : "pointer", color: "#C4747B", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all .14s" }}
          onMouseEnter={e => { e.currentTarget.style.background = "#FCE5E5"; e.currentTarget.style.borderColor = "#F0B0B0"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "#fff"; e.currentTarget.style.borderColor = "#E6E7E5"; }}
        >
          {deleting ? <Loader2 style={{ width: 11, height: 11, animation: "spin 1s linear infinite" }} /> : <Trash2 style={{ width: 11, height: 11 }} />}
        </button>
      </button>

      {/* Body */}
      {expanded && (
        <div style={{ background: m.soft }}>
          {/* Meta row */}
          {(sol.notes || sol.material_ids.length > 0) && (
            <div style={{ padding: "10px 18px", display: "flex", gap: 16, flexWrap: "wrap", borderBottom: `1px solid ${m.line}` }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "#5B6770" }}>
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 1.8L14 5v6l-6 3.2L2 11V5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>
                <strong style={{ color: "#1A2329" }}>{sol.material_ids.length}</strong> material{sol.material_ids.length !== 1 ? "es" : ""} incluido{sol.material_ids.length !== 1 ? "s" : ""}
              </span>
              {sol.notes && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "#5B6770", fontStyle: "italic" }}>
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 4h10M3 8h7M3 12h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
                  "{sol.notes}"
                </span>
              )}
            </div>
          )}

          {/* Supplier chips */}
          {sol.suppliers.length > 0 && (
            <div style={{ padding: "12px 18px", display: "flex", gap: 8, flexWrap: "wrap", borderBottom: hasResponses ? `1px solid ${m.line}` : "none" }}>
              {sol.suppliers.map(s => {
                const responded = s.status === "respondida";
                return (
                  <span key={s.supplier_id} style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "5px 12px", borderRadius: 99, fontSize: 12, fontWeight: 600,
                    background: responded ? "#E4F3EC" : "#FEF3E8",
                    color: responded ? "#136E47" : "#B45309",
                    border: `1px solid ${responded ? "#B8DECA" : "#F0D0A8"}`,
                  }}>
                    {responded
                      ? <CheckCircle2 style={{ width: 11, height: 11 }} />
                      : <Clock style={{ width: 11, height: 11 }} />}
                    {s.supplier_name}
                    <span style={{ fontSize: 10.5, opacity: 0.75, fontWeight: 400 }}>
                      {responded ? "· respondió" : "· esperando"}
                    </span>
                  </span>
                );
              })}
            </div>
          )}

          {/* Status messages */}
          {sol.status === "borrador" && (
            <div style={{ padding: "12px 18px", display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#8E97A0" }}>
              <Clock style={{ width: 13, height: 13 }} />
              Solicitud en borrador — todavía no fue enviada a ningún proveedor.
            </div>
          )}
          {sol.status === "enviada" && sol.respuestas.length === 0 && (
            <div style={{ padding: "12px 18px", display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#B45309" }}>
              <SendHorizonal style={{ width: 13, height: 13 }} />
              Solicitud enviada. Esperando respuesta de los proveedores…
            </div>
          )}

          {/* Responses / Analisis */}
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
  const { confirm } = useConfirm();
  const [data, setData]                 = useState<PresupuestoResponse | null>(null);
  const [orders, setOrders]             = useState<PurchaseOrder[]>([]);
  const [solicitudes, setSolicitudes]   = useState<SolicitudCotizacion[]>([]);
  const [suppliers, setSuppliers]       = useState<Supplier[]>([]);
  const [teamMembers, setTeamMembers]   = useState<ObraTeamMember[]>([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState<string | null>(null);

  const [activeModule, setActiveModule] = useState<ModuleId>("materiales");
  const [statusFilter, setStatusFilter] = useState("todos");
  const [taskFilter]                     = useState("todas");
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
    if (!(await confirm({ title: "Borrar solicitud", message: "¿Borrar esta solicitud? Esta acción no se puede deshacer.", confirmLabel: "Borrar", danger: true }))) return;
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

  return (
    <div style={{ fontFamily: FONT, display: "flex", flexDirection: "column", gap: 0 }}>

      {/* ── Tabs de módulos (ctabs) ── */}
      <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
        {MODULE_TABS.map(m => (
          <button
            key={m.id}
            onClick={() => setActiveModule(m.id)}
            style={{
              display: "flex", alignItems: "center", gap: 9, padding: "10px 15px",
              borderRadius: 12, fontFamily: FONT,
              background: activeModule === m.id ? "#1A2329" : "#fff",
              border: `1px solid ${activeModule === m.id ? "#1A2329" : "#E6E7E5"}`,
              fontSize: 13, fontWeight: 600,
              color: activeModule === m.id ? "#fff" : "#5B6770",
              cursor: "pointer", boxShadow: "0 1px 4px rgba(0,0,0,0.07)",
              transition: "all 0.14s",
            }}
          >
            <span style={{
              width: 22, height: 22, borderRadius: 7, flexShrink: 0,
              background: activeModule === m.id ? "#FF6B35" : "#F0EDE7",
              color: activeModule === m.id ? "#fff" : "#7A7167",
              fontFamily: MONO, fontSize: 10.5, fontWeight: 700,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {m.num}
            </span>
            {m.label}
            {m.count > 0 && (
              <span style={{
                fontFamily: MONO, fontSize: 10, padding: "1px 6px", borderRadius: 99,
                background: activeModule === m.id ? "rgba(255,255,255,0.16)" : "#F0EDE7",
                color: activeModule === m.id ? "#fff" : "#7A7167",
              }}>
                {m.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ════════ MÓDULO 01: MATERIALES ════════ */}
      {activeModule === "materiales" && (() => {
        const totalEst = data.total_estimado;
        const pctComp  = totalEst > 0 ? Math.round((data.total_pedido / totalEst) * 100) : 0;
        const segRecv  = totalEst > 0 ? (data.total_recibido / totalEst) * 100 : 0;
        const segPed   = totalEst > 0 ? (Math.max(0, data.total_pedido - data.total_recibido) / totalEst) * 100 : 0;
        const segRest  = Math.max(0, 100 - segRecv - segPed);
        const valPend  = Math.max(0, totalEst - data.total_pedido);

        const MAT_STM: Record<string, { label: string; color: string; bg: string; soft: string; rail: string; line: string }> = {
          pendiente: { label: "Pendiente", color: "#B45309", bg: "#FEF3E8", soft: "#FFFBF4", rail: "#E8A33D", line: "#F0D0A8" },
          pedido:    { label: "Pedido",    color: "#2A62C9", bg: "#EBF3FF", soft: "#FFFFFF", rail: "#2A62C9", line: "#C6DBF7" },
          recibido:  { label: "Recibido",  color: "#136E47", bg: "#E4F3EC", soft: "#FFFFFF", rail: "#1F8A5B", line: "#B8DECA" },
        };
        const AV_COLORS = ["#2A62C9","#1F8A5B","#9A4DC9","#C97D0E","#2C6571","#D03A3A","#6D45C7"];
        const getInitials = (name: string) => name.split(/\s+/).slice(0,2).map(w => w[0]).join("").toUpperCase();
        const getAvColor  = (name: string) => { let h = 0; for (const c of name) h = (h*31+c.charCodeAt(0))>>>0; return AV_COLORS[h % AV_COLORS.length]; };

        const counts = {
          total:     data.rows.length,
          pendiente: data.rows.filter(r => r.status === "pendiente").length,
          pedido:    data.rows.filter(r => r.status === "pedido").length,
          recibido:  data.rows.filter(r => r.status === "recibido").length,
        };

        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>

            {/* ── Summary Panel ── */}
            {data.rows.length > 0 && totalEst > 0 && (
              <div style={{ background: "#fff", border: "1px solid #E6E7E5", borderRadius: 16, padding: "18px 20px", marginBottom: 14, boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 24, marginBottom: 16 }}>
                  <div>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: MONO, fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", color: "#8E97A0", textTransform: "uppercase" as const }}>
                      PRESUPUESTO DE MATERIALES
                    </div>
                    <div style={{ fontFamily: MONO, fontSize: 34, fontWeight: 800, letterSpacing: "-0.035em", lineHeight: 1, margin: "9px 0 3px", color: "#1A2329" }}>
                      {money(totalEst)}
                    </div>
                    <div style={{ fontSize: 12, color: "#8E97A0" }}>estimado total de la obra</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 22, flexShrink: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                      <span style={{ fontFamily: MONO, fontSize: 38, fontWeight: 800, color: "#B45309", letterSpacing: "-0.04em", lineHeight: 1 }}>{pendientesCount}</span>
                      <span style={{ fontSize: 11, color: "#5B6770", fontWeight: 600, lineHeight: 1.25 }}>materiales<br/>pendientes</span>
                    </div>
                    {/* Donut ring */}
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                      <div style={{ width: 58, height: 58, borderRadius: "50%", position: "relative", display: "flex", alignItems: "center", justifyContent: "center", background: `conic-gradient(#FF6B35 ${pctComp * 3.6}deg, #F0EDE7 0deg)` }}>
                        <div style={{ position: "absolute", inset: 6, borderRadius: "50%", background: "#fff" }} />
                        <span style={{ position: "relative", zIndex: 1, fontFamily: MONO, fontSize: 13, fontWeight: 700, color: "#E85A26" }}>{pctComp}%</span>
                      </div>
                      <div style={{ fontSize: 10, color: "#8E97A0", fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.04em" }}>comprometido</div>
                    </div>
                  </div>
                </div>
                {/* Stacked bar */}
                <div style={{ display: "flex", height: 14, borderRadius: 99, overflow: "hidden", background: "#F0EDE7", gap: 2 }}>
                  {segRecv > 0 && <span style={{ width: `${segRecv}%`, height: "100%", background: "#1F8A5B", transition: "width .5s cubic-bezier(.22,.61,.36,1)" }} />}
                  {segPed  > 0 && <span style={{ width: `${segPed}%`,  height: "100%", background: "#2A62C9", transition: "width .5s cubic-bezier(.22,.61,.36,1)" }} />}
                  {segRest > 0 && <span style={{ width: `${segRest}%`, height: "100%", background: "#E3E0D8", transition: "width .5s cubic-bezier(.22,.61,.36,1)" }} />}
                </div>
                <div style={{ display: "flex", gap: 22, marginTop: 11 }}>
                  {[
                    { label: "Recibido",  val: data.total_recibido,                                   bg: "#1F8A5B" },
                    { label: "Pedido",    val: Math.max(0, data.total_pedido - data.total_recibido),   bg: "#2A62C9" },
                    { label: "Por pedir", val: valPend,                                                bg: "#CFCBC1" },
                  ].map(s => (
                    <span key={s.label} style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 11.5, color: "#5B6770" }}>
                      <span style={{ width: 9, height: 9, borderRadius: 3, background: s.bg, flexShrink: 0 }} />
                      {s.label}
                      <strong style={{ fontFamily: MONO, fontWeight: 700, color: "#1A2329" }}>{money(s.val)}</strong>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* ── Empty state ── */}
            {groups.length === 0 ? (
              <div style={{ position: "relative", overflow: "hidden", borderRadius: 16, border: "1px solid #E6E7E5", background: "#FAFAF8" }}>
                <div aria-hidden="true" style={{ position: "absolute", inset: 0, padding: "24px 24px 0", display: "flex", flexDirection: "column", gap: 10, filter: "blur(7px)", opacity: 0.1, pointerEvents: "none" }}>
                  {[80, 60, 70].map((_w, i) => (
                    <div key={i} style={{ height: 50, borderRadius: 12, background: i % 2 === 0 ? "#C8CDD0" : "#D4D8DB" }} />
                  ))}
                </div>
                <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg,rgba(250,250,248,0.5),#FAFAF8)", pointerEvents: "none" }} />
                <div style={{ position: "relative", zIndex: 1, textAlign: "center", padding: "52px 40px 48px", display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <div style={{ width: 66, height: 66, borderRadius: 18, background: "#F0EDE7", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 20 }}>
                    <svg width="32" height="32" viewBox="0 0 16 16" fill="none" style={{ color: "#8E97A0" }}>
                      <path d="M8 1.8L14 5v6l-6 3.2L2 11V5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
                      <path d="M2 5l6 3.2L14 5M8 9V14" stroke="currentColor" strokeWidth="1.3"/>
                    </svg>
                  </div>
                  <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 8, color: "#1A2329" }}>Todavía no cargaste materiales</div>
                  <p style={{ margin: "0 0 22px", fontSize: 13.5, color: "#5B6770", lineHeight: 1.5, maxWidth: 360 }}>
                    Empezá agregando los materiales que necesita la obra. Después vas a poder pedir cotizaciones y seguir el estado de cada uno.
                  </p>
                  <button
                    onClick={() => setShowAddMaterial(true)}
                    disabled={tasks.length === 0}
                    style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "12px 20px", fontSize: 14, fontWeight: 700, borderRadius: 12, border: "none", fontFamily: FONT, background: tasks.length === 0 ? "#E6E7E5" : "#FF6B35", color: tasks.length === 0 ? "#8E97A0" : "#fff", cursor: tasks.length === 0 ? "not-allowed" : "pointer", boxShadow: tasks.length === 0 ? "none" : "0 12px 24px -8px rgba(255,107,53,0.55)" }}
                  >
                    <Plus style={{ width: 14, height: 14 }} /> Agregar primer material
                  </button>
                  {tasks.length === 0 && (
                    <p style={{ margin: "12px 0 0", fontFamily: MONO, fontSize: 11, color: "#B45309" }}>
                      Necesitás al menos una tarea. Creala en el tab Tareas.
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <>
                {/* ── Filters ── */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 9, background: "#fff", border: "1px solid #E6E7E5", borderRadius: 10, padding: "0 12px", color: "#8E97A0", width: 300, boxShadow: "0 1px 4px rgba(0,0,0,0.07)", flexShrink: 0 }}>
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
                      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5"/>
                      <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                    <input
                      value={search} onChange={e => setSearch(e.target.value)}
                      placeholder="Buscar material, tarea o contratista…"
                      style={{ border: 0, outline: 0, background: "transparent", padding: "10px 0", fontSize: 13, color: "#1A2329", fontFamily: FONT, width: "100%" }}
                    />
                    {search && (
                      <button onClick={() => setSearch("")} style={{ background: "none", border: "none", cursor: "pointer", color: "#9BA3AB", padding: 0, display: "flex" }}>
                        <X style={{ width: 12, height: 12 }} />
                      </button>
                    )}
                  </div>
                  {/* Segmented status filter */}
                  <div style={{ display: "flex", gap: 2, background: "#fff", border: "1px solid #E6E7E5", borderRadius: 10, padding: 3, boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}>
                    {([
                      ["todos",     "Todos",     counts.total],
                      ["pendiente", "Pendiente", counts.pendiente],
                      ["pedido",    "Pedido",    counts.pedido],
                      ["recibido",  "Recibido",  counts.recibido],
                    ] as [string, string, number][]).map(([k, l, n]) => (
                      <button
                        key={k}
                        onClick={() => setStatusFilter(k)}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px",
                          borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                          border: "none", fontFamily: FONT, transition: "background .12s",
                          background: statusFilter === k
                            ? k === "todos"     ? "#1A2329"
                              : k === "pendiente" ? "#E8A33D"
                              : k === "pedido"    ? "#2A62C9"
                              : "#1F8A5B"
                            : "transparent",
                          color: statusFilter === k ? "#fff" : "#5B6770",
                        }}
                      >
                        {l}
                        <span style={{
                          fontFamily: MONO, fontSize: 10, padding: "0 6px", borderRadius: 99,
                          background: statusFilter === k ? "rgba(255,255,255,0.22)" : "#F0EDE7",
                          color: statusFilter === k ? "#fff" : "#7A7167",
                        }}>{n}</span>
                      </button>
                    ))}
                  </div>
                  <div style={{ flex: 1 }} />
                  <button
                    onClick={async () => { setExporting(true); try { await exportPresupuestoExcel(obraId, obraName); } finally { setExporting(false); } }}
                    disabled={exporting || data.rows.length === 0}
                    style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 14px", borderRadius: 10, fontSize: 12.5, fontWeight: 600, background: "#fff", border: "1px solid #E6E7E5", color: "#5B6770", cursor: "pointer", boxShadow: "0 1px 4px rgba(0,0,0,0.07)", fontFamily: FONT, opacity: data.rows.length === 0 ? 0.5 : 1 }}
                  >
                    <Download style={{ width: 13, height: 13 }} /> {exporting ? "Exportando…" : "Excel"}
                  </button>
                  <button
                    onClick={() => setShowAddMaterial(true)}
                    style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 14px", borderRadius: 10, fontSize: 12.5, fontWeight: 700, background: "#FF6B35", border: "none", color: "#fff", cursor: "pointer", boxShadow: "0 6px 14px -6px rgba(255,107,53,0.55)", fontFamily: FONT }}
                  >
                    <Plus style={{ width: 13, height: 13 }} /> Agregar material
                  </button>
                </div>

                {/* ── Group cards ── */}
                {filteredGroups.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "32px 16px", fontSize: 13, color: "#8E97A0", background: "#fff", borderRadius: 12, border: "1px solid #E6E7E5" }}>
                    Sin resultados para <b>"{search || statusFilter}"</b>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {filteredGroups.map((g, gi) => {
                      const isOpen = !collapsed.has(gi);
                      const mPend = g.rows.filter(r => r.status === "pendiente").length;
                      const mPed  = g.rows.filter(r => r.status === "pedido").length;
                      const mRec  = g.rows.filter(r => r.status === "recibido").length;
                      const done  = mPed + mRec;
                      const gv    = g.subtotal || 1;
                      const valR  = g.rows.filter(r => r.status === "recibido").reduce((a, r) => a + r.subtotal, 0);
                      const valP  = g.rows.filter(r => r.status === "pedido").reduce((a, r) => a + r.subtotal, 0);
                      const valPn = g.rows.filter(r => r.status === "pendiente").reduce((a, r) => a + r.subtotal, 0);

                      return (
                        <div
                          key={g.taskId}
                          style={{ background: "#fff", border: `1px solid ${mPend > 0 ? "#F0D0A8" : "#E6E7E5"}`, borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}
                        >
                          {/* Card header */}
                          <button
                            onClick={() => setCollapsed(prev => { const n = new Set(prev); n.has(gi) ? n.delete(gi) : n.add(gi); return n; })}
                            style={{ width: "100%", display: "flex", alignItems: "center", gap: 14, padding: "14px 18px", background: "none", border: "none", cursor: "pointer", textAlign: "left", boxSizing: "border-box", fontFamily: FONT }}
                          >
                            <span style={{ color: "#8E97A0", flexShrink: 0, display: "flex", transform: isOpen ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.2s" }}>
                              <ChevronDown style={{ width: 14, height: 14 }} />
                            </span>
                            <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: "-0.01em", flexShrink: 0, color: "#1A2329" }}>{g.title}</span>
                            {mPend > 0 ? (
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 99, background: "#FEF3E8", color: "#B45309", border: "1px solid #F0D0A8" }}>
                                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#E8A33D" }} />
                                {mPend} pendiente{mPend > 1 ? "s" : ""}
                              </span>
                            ) : (
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 99, background: "#E4F3EC", color: "#136E47", border: "1px solid #B8DECA" }}>
                                <CheckCircle2 style={{ width: 11, height: 11 }} /> Todo gestionado
                              </span>
                            )}
                            <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 11, flexShrink: 0 }}>
                              <span style={{ display: "flex", width: 140, height: 8, borderRadius: 99, overflow: "hidden", background: "#F0EDE7", gap: 1.5 }}>
                                <span style={{ height: "100%", width: `${(valR/gv)*100}%`, background: "#1F8A5B" }} />
                                <span style={{ height: "100%", width: `${(valP/gv)*100}%`, background: "#2A62C9" }} />
                                <span style={{ height: "100%", width: `${(valPn/gv)*100}%`, background: "#E8A33D" }} />
                              </span>
                              <span style={{ fontFamily: MONO, fontSize: 10.5, color: "#8E97A0", whiteSpace: "nowrap" }}>{done}/{g.rows.length} gestionados</span>
                            </span>
                            <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", flexShrink: 0, minWidth: 96 }}>
                              <span style={{ fontSize: 9.5, color: "#8E97A0", textTransform: "uppercase" as const, letterSpacing: "0.06em", fontFamily: MONO }}>subtotal</span>
                              <span style={{ fontFamily: MONO, fontSize: 15, fontWeight: 800, color: "#1A2329" }}>{money(g.subtotal)}</span>
                            </span>
                          </button>

                          {/* Material rows */}
                          {isOpen && (
                            <div style={{ borderTop: "1px solid #F0EDE7" }}>
                              {g.rows.map(r => {
                                const m = MAT_STM[r.status] ?? MAT_STM.pendiente;
                                const share = g.subtotal > 0 ? Math.round((r.subtotal / g.subtotal) * 100) : 0;
                                const qty = r.quantity != null ? `${r.quantity}${r.unit ? " " + r.unit : ""}` : "—";

                                return (
                                  <div
                                    key={r.material_id}
                                    style={{
                                      display: "grid",
                                      gridTemplateColumns: "118px 1fr 200px 150px 110px",
                                      alignItems: "center", gap: 14,
                                      padding: "12px 18px 12px 14px",
                                      position: "relative",
                                      background: m.soft,
                                      borderBottom: "1px solid #F0EDE7",
                                    }}
                                  >
                                    {/* Left rail */}
                                    <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: m.rail }} />
                                    {/* Status pill */}
                                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 99, fontSize: 11, fontWeight: 700, border: `1px solid ${m.line}`, color: m.color, background: m.bg, whiteSpace: "nowrap" as const }}>
                                      {r.status === "recibido"
                                        ? <CheckCircle2 style={{ width: 11, height: 11 }} />
                                        : r.status === "pedido"
                                        ? <Truck style={{ width: 11, height: 11 }} />
                                        : <Clock style={{ width: 11, height: 11 }} />}
                                      {m.label}
                                    </span>
                                    {/* Material name + qty */}
                                    <span style={{ minWidth: 0 }}>
                                      <span style={{ fontSize: 13.5, fontWeight: 700, lineHeight: 1.2, whiteSpace: "nowrap" as const, overflow: "hidden", textOverflow: "ellipsis", display: "block", color: r.status === "recibido" ? "#5B6770" : "#1A2329" }} title={r.name}>{r.name}</span>
                                      <span style={{ fontFamily: MONO, fontSize: 11, color: "#8E97A0", marginTop: 3, display: "block", whiteSpace: "nowrap" as const }}>
                                        {qty}{r.unit_price != null && <span> · {money(r.unit_price)}/u</span>}
                                      </span>
                                    </span>
                                    {/* Supplier / contratista */}
                                    <span style={{ minWidth: 0 }}>
                                      {r.supplier_name ? (
                                        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                                          <span style={{ width: 26, height: 26, borderRadius: 8, background: getAvColor(r.supplier_name), color: "#fff", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontFamily: FONT }}>
                                            {getInitials(r.supplier_name)}
                                          </span>
                                          <span style={{ minWidth: 0, lineHeight: 1.2 }}>
                                            <span style={{ fontSize: 12, fontWeight: 600, color: "#1A2329", whiteSpace: "nowrap" as const, overflow: "hidden", textOverflow: "ellipsis", display: "block" }}>{r.supplier_name}</span>
                                            {r.responsible_name && <span style={{ fontSize: 10, color: "#8E97A0" }}>{r.responsible_name}</span>}
                                          </span>
                                        </span>
                                      ) : r.responsible_name ? (
                                        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                                          <span style={{ width: 26, height: 26, borderRadius: 8, background: getAvColor(r.responsible_name), color: "#fff", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontFamily: FONT }}>
                                            {getInitials(r.responsible_name)}
                                          </span>
                                          <span style={{ fontSize: 12, fontWeight: 600, color: "#1A2329", whiteSpace: "nowrap" as const, overflow: "hidden", textOverflow: "ellipsis" }}>{r.responsible_name}</span>
                                        </span>
                                      ) : (
                                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "#8E97A0" }}>
                                          <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="6" r="2.6" stroke="currentColor" strokeWidth="1.4"/><path d="M3 13c.7-2.4 2.7-3.7 5-3.7s4.3 1.3 5 3.7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
                                          Sin asignar
                                        </span>
                                      )}
                                    </span>
                                    {/* Subtotal + share */}
                                    <span style={{ textAlign: "right" }}>
                                      <span style={{ fontFamily: MONO, fontSize: 14.5, fontWeight: 800, color: r.status === "recibido" ? "#5B6770" : "#1A2329", display: "block" }}>{money(r.subtotal)}</span>
                                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "flex-end", fontFamily: MONO, fontSize: 9.5, color: "#8E97A0", marginTop: 4 }}>
                                        <span style={{ width: 46, height: 3, borderRadius: 99, background: "#EDE9E1", overflow: "hidden", display: "block" }}>
                                          <span style={{ display: "block", height: "100%", borderRadius: 99, width: `${share}%`, background: m.rail }} />
                                        </span>
                                        {share}%
                                      </span>
                                    </span>
                                    {/* Action */}
                                    <span style={{ display: "flex", justifyContent: "flex-end" }}>
                                      {r.status === "pendiente" ? (
                                        <button
                                          onClick={() => setShowSolicitudAll(true)}
                                          style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 9, fontSize: 11.5, fontWeight: 700, cursor: "pointer", border: "1px solid #FFD9C4", color: "#E85A26", background: "#FFF1E9", fontFamily: FONT, transition: "all .14s" }}
                                          onMouseEnter={e => { e.currentTarget.style.background = "#FF6B35"; e.currentTarget.style.color = "#fff"; e.currentTarget.style.borderColor = "#FF6B35"; }}
                                          onMouseLeave={e => { e.currentTarget.style.background = "#FFF1E9"; e.currentTarget.style.color = "#E85A26"; e.currentTarget.style.borderColor = "#FFD9C4"; }}
                                        >
                                          <SendHorizonal style={{ width: 12, height: 12 }} /> Cotizar
                                        </button>
                                      ) : (
                                        <button
                                          style={{ width: 30, height: 30, borderRadius: 8, color: "#8E97A0", display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", cursor: "pointer" }}
                                          onMouseEnter={e => { e.currentTarget.style.background = "#F0EDE7"; e.currentTarget.style.color = "#1A2329"; }}
                                          onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#8E97A0"; }}
                                        >
                                          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="4" cy="8" r="1.2" fill="currentColor"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/><circle cx="12" cy="8" r="1.2" fill="currentColor"/></svg>
                                        </button>
                                      )}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* ── Total + CTA footer ── */}
                {filteredGroups.length > 0 && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginTop: 14, padding: "16px 22px", background: "linear-gradient(120deg,#1B2A34 0%,#243642 55%,#2C4150 100%)", borderRadius: 14, flexWrap: "wrap", boxShadow: "0 8px 24px -10px rgba(15,22,28,0.4)" }}>
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>Total general</div>
                      <div style={{ fontFamily: MONO, fontSize: 24, fontWeight: 800, color: "#fff", letterSpacing: "-0.03em" }}>{money(totalEst)}</div>
                    </div>
                    {pendientesCount > 0 ? (
                      <button
                        onClick={() => setShowSolicitudAll(true)}
                        style={{ position: "relative", overflow: "hidden", display: "inline-flex", alignItems: "center", gap: 9, padding: "13px 24px", borderRadius: 12, fontSize: 13, fontWeight: 700, border: "none", background: "linear-gradient(135deg,#FF8856,#E85A26)", color: "#fff", cursor: "pointer", boxShadow: "0 12px 26px -8px rgba(232,90,38,0.65)", fontFamily: FONT }}
                      >
                        <span style={{ position: "absolute", top: 0, left: "-60%", width: "50%", height: "100%", background: "linear-gradient(100deg,transparent,rgba(255,255,255,0.35),transparent)", animation: "mat01shine 3s ease-in-out infinite" }} />
                        <SendHorizonal style={{ width: 15, height: 15, flexShrink: 0 }} />
                        Cotizar {pendientesCount} pendiente{pendientesCount > 1 ? "s" : ""}
                      </button>
                    ) : (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "#4DD9A0", fontWeight: 700 }}>
                        <CheckCircle2 style={{ width: 15, height: 15 }} /> Todos los materiales cotizados
                      </span>
                    )}
                  </div>
                )}
              </>
            )}

            <style>{`
              @keyframes mat01fadeIn { from{opacity:0;transform:translateY(6px);} to{opacity:1;transform:translateY(0);} }
              @keyframes mat01shine { 0%{left:-60%;} 55%,100%{left:130%;} }
            `}</style>
          </div>
        );
      })()}

      {/* ════════ MÓDULO 02: SOLICITUDES DE COTIZACIÓN ════════ */}
      {activeModule === "cotizaciones" && (() => {
        const solByStatus = {
          borrador:   solicitudes.filter(s => s.status === "borrador").length,
          enviada:    solicitudes.filter(s => s.status === "enviada").length,
          respondida: solicitudes.filter(s => s.status === "respondida").length,
          confirmada: solicitudes.filter(s => s.status === "confirmada").length,
        };
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            {/* ── Header ── */}
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 18, fontWeight: 800, color: "#1A2329", letterSpacing: "-0.03em", fontFamily: FONT }}>
                    Cotizaciones
                  </span>
                  {solicitudes.length > 0 && (
                    <span style={{
                      fontSize: 11, fontWeight: 800, color: "#FF6B35", background: "#FFF0E8",
                      border: "1px solid #FFD9C4", borderRadius: 99, padding: "2px 9px",
                      fontFamily: MONO, letterSpacing: "0.02em",
                    }}>
                      {solicitudes.length}
                    </span>
                  )}
                </div>
                <p style={{ margin: "3px 0 0", fontSize: 12.5, color: "#6B7580", fontFamily: FONT }}>
                  Pedís presupuesto a proveedores. Con 2+ respuestas la IA compara y recomienda.
                </p>
              </div>
              <button
                onClick={() => setShowSolicitudAll(true)}
                disabled={pendientesCount === 0}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 18px",
                  borderRadius: 10, fontSize: 12.5, fontWeight: 700, border: "none",
                  background: pendientesCount === 0 ? "#E6E7E5" : "#FF6B35",
                  color: pendientesCount === 0 ? "#8E97A0" : "#fff",
                  cursor: pendientesCount === 0 ? "not-allowed" : "pointer",
                  boxShadow: pendientesCount === 0 ? "none" : "0 6px 14px -6px rgba(255,107,53,0.5)",
                  fontFamily: FONT, flexShrink: 0,
                }}
              >
                <SendHorizonal style={{ width: 13, height: 13 }} />
                Nueva solicitud
              </button>
            </div>

            {/* ── Status pills ── */}
            {solicitudes.length > 0 && (
              <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                {(Object.entries(SOL_STM) as [string, typeof SOL_STM[string]][]).map(([key, meta]) => {
                  const cnt = solByStatus[key as keyof typeof solByStatus] ?? 0;
                  if (cnt === 0) return null;
                  return (
                    <span key={key} style={{
                      display: "inline-flex", alignItems: "center", gap: 6,
                      padding: "5px 12px", borderRadius: 99, fontSize: 11.5, fontWeight: 700,
                      background: meta.bg, color: meta.color, border: `1px solid ${meta.line}`,
                      fontFamily: FONT,
                    }}>
                      <span style={{ width: 7, height: 7, borderRadius: "50%", background: meta.rail, display: "inline-block", flexShrink: 0 }} />
                      {meta.label}
                      <span style={{
                        fontSize: 10, fontWeight: 800, color: meta.color, background: "rgba(255,255,255,0.65)",
                        borderRadius: 99, padding: "0 5px", fontFamily: MONO,
                      }}>{cnt}</span>
                    </span>
                  );
                })}
              </div>
            )}

            {/* ── Empty state / list ── */}
            {solicitudes.length === 0 ? (
              <div style={{
                background: "#fff", border: "1px solid #EDE9E1", borderRadius: 16,
                padding: "52px 24px", textAlign: "center",
                boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
              }}>
                <div style={{
                  width: 52, height: 52, borderRadius: 16, background: "#FFF0E8",
                  border: "1px solid #FFD9C4", display: "flex", alignItems: "center",
                  justifyContent: "center", margin: "0 auto 16px",
                }}>
                  <SendHorizonal style={{ width: 22, height: 22, color: "#FF6B35" }} />
                </div>
                <p style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "#1A2329", letterSpacing: "-0.02em", fontFamily: FONT }}>
                  Sin solicitudes todavía
                </p>
                <p style={{ margin: "6px auto 20px", fontSize: 12.5, color: "#6B7580", maxWidth: 320, lineHeight: 1.6, fontFamily: FONT }}>
                  {pendientesCount === 0
                    ? "Primero cargá materiales pendientes en el módulo Materiales."
                    : `Tenés ${pendientesCount} material${pendientesCount !== 1 ? "es" : ""} pendiente${pendientesCount !== 1 ? "s" : ""}. Creá una solicitud para pedir presupuesto.`}
                </p>
                {pendientesCount > 0 && (
                  <button
                    onClick={() => setShowSolicitudAll(true)}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 22px",
                      borderRadius: 10, fontSize: 13, fontWeight: 700, border: "none",
                      background: "#FF6B35", color: "#fff", cursor: "pointer",
                      boxShadow: "0 6px 16px -6px rgba(255,107,53,0.55)", fontFamily: FONT,
                    }}
                  >
                    <SendHorizonal style={{ width: 14, height: 14 }} />
                    Crear primera solicitud
                  </button>
                )}
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
        );
      })()}

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
      {activeModule === "analisis" && (() => {
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

        const TEND_MAP: Record<string, { label: string; color: string; bg: string; bd: string }> = {
          competitivo: { label: "Competitivo", color: "#136E47", bg: "#E4F3EC", bd: "#B8DECA" },
          caro:        { label: "Caro",        color: "#B45309", bg: "#FEF3E8", bd: "#F0D0A8" },
          variable:    { label: "Variable",    color: "#6D45C7", bg: "#EFE7FB", bd: "#D9C8F2" },
          sin_datos:   { label: "Sin datos",   color: "#8E97A0", bg: "#F0F1EF", bd: "#E0E2DE" },
        };

        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <ModuleHeader
              num="04" numBg="#7C3AED"
              title="Inteligencia de Compras"
              description="Análisis estadístico histórico de cotizaciones. El análisis con IA es opcional y se genera bajo demanda."
              actions={null}
            />

            {/* ── KPIs ── */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
              {[
                { label: "Solicitudes totales", value: solicitudes.length },
                { label: "Con respuesta",       value: respondidas.length },
                { label: "Proveedores únicos",  value: provEntries.length },
              ].map(k => (
                <div key={k.label} style={{ background: "#fff", border: "1px solid #E6E7E5", borderRadius: 12, padding: "12px 16px" }}>
                  <p style={{ margin: "0 0 4px", fontSize: 9.5, fontWeight: 700, color: "#8E97A0", textTransform: "uppercase", letterSpacing: "0.08em" }}>{k.label}</p>
                  <p style={{ margin: 0, fontSize: 26, fontWeight: 800, color: "#1A2329", fontVariantNumeric: "tabular-nums" }}>{k.value}</p>
                </div>
              ))}
            </div>

            {/* ── Tabla por proveedor ── */}
            {provEntries.length > 0 && (
              <div>
                <p style={{ margin: "0 0 8px", fontSize: 10, fontWeight: 700, color: "#8E97A0", textTransform: "uppercase", letterSpacing: "0.09em" }}>Resumen por proveedor</p>
                <div style={{ background: "#fff", border: "1px solid #E6E7E5", borderRadius: 12, overflow: "hidden" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 100px 100px 100px", background: "#F2EFE8", borderBottom: "1px solid #D8D3CA" }}>
                    {["Proveedor", "Resp.", "Promedio", "Mínimo", "Máximo"].map((h, i) => (
                      <span key={h} style={{ padding: "7px 12px", fontSize: 9.5, fontWeight: 700, color: "#8E97A0", textTransform: "uppercase", letterSpacing: "0.08em", textAlign: i > 0 ? "right" : "left" }}>{h}</span>
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

            {/* ══════════════════════════════════════════
                PRE-ANALYSIS CTA
            ══════════════════════════════════════════ */}
            {!analisisIA && !loadingAnalisis && (
              <div style={{ position: "relative", overflow: "hidden", borderRadius: 16, border: "1px solid #E6E7E5", background: "#FAFAF8" }}>
                {/* Ghost blurred preview */}
                <div aria-hidden="true" style={{ position: "absolute", inset: 0, padding: 30, display: "flex", flexDirection: "column", gap: 14, filter: "blur(7px)", opacity: 0.11, pointerEvents: "none" }}>
                  <div style={{ height: 110, borderRadius: 14, background: "linear-gradient(135deg,#243642,#FF6B35)" }} />
                  <div style={{ display: "flex", gap: 14 }}>
                    <div style={{ flex: 2, height: 80, borderRadius: 14, background: "#C8CDD0" }} />
                    <div style={{ flex: 1, height: 80, borderRadius: 14, background: "#D8DCDE" }} />
                  </div>
                  <div style={{ display: "flex", gap: 14 }}>
                    <div style={{ flex: 2, height: 80, borderRadius: 14, background: "#C8CDD0" }} />
                    <div style={{ flex: 1, height: 80, borderRadius: 14, background: "#D8DCDE" }} />
                  </div>
                </div>
                {/* Gradient veil */}
                <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(250,250,248,0.55), #FAFAF8)", pointerEvents: "none" }} />

                {/* Core */}
                <div style={{ position: "relative", zIndex: 1, maxWidth: 680, margin: "0 auto", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", padding: "44px 36px 40px" }}>
                  {/* Radar emblem */}
                  <div style={{ position: "relative", width: 72, height: 72, borderRadius: 20, background: "linear-gradient(150deg,#1B2A34,#2C4150)", display: "flex", alignItems: "center", justifyContent: "center", color: "#FF6B35", marginBottom: 22, boxShadow: "0 16px 30px -14px rgba(24,34,42,0.5)" }}>
                    <span className="ia04-ring" />
                    <span className="ia04-ring ia04-ring-d2" />
                    <Brain style={{ width: 28, height: 28 }} />
                  </div>

                  <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: MONO, fontSize: 10, fontWeight: 700, letterSpacing: "0.16em", color: "#FF6B35", marginBottom: 12 }}>
                    <Sparkles style={{ width: 10, height: 10 }} /> INTELIGENCIA DE COMPRAS
                  </div>
                  <h2 style={{ margin: "0 0 12px", fontSize: 25, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.18, color: "#1A2329" }}>
                    Dejá que la IA analice tu historial<br />y te diga a quién comprarle
                  </h2>
                  <p style={{ margin: "0 0 26px", fontSize: 13.5, color: "#5B6770", lineHeight: 1.5, maxWidth: 500 }}>
                    Cruza todas las cotizaciones de la obra para encontrar el proveedor más conveniente, las mayores oportunidades de ahorro y los riesgos del mercado.
                  </p>

                  {/* Capability cards */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, width: "100%", marginBottom: 24 }}>
                    {[
                      { Icon: Trophy,        c: "#FF6B35", t: "Proveedor recomendado",    d: "A quién comprarle según tu historial real de cotizaciones." },
                      { Icon: Target,        c: "#1F8A5B", t: "Oportunidades de ahorro",  d: "Materiales donde un proveedor te cobra mucho menos que el resto." },
                      { Icon: AlertTriangle, c: "#B45309", t: "Alertas de mercado",        d: "Subas de precio y proveedores que dejaron de cotizar." },
                    ].map(({ Icon, c, t, d }, i) => (
                      <div key={i} style={{ textAlign: "left", background: "#fff", border: "1px solid #E6E7E5", borderRadius: 13, padding: "15px" }}>
                        <div style={{ width: 34, height: 34, borderRadius: 10, background: c + "1F", display: "flex", alignItems: "center", justifyContent: "center", color: c, marginBottom: 10 }}>
                          <Icon style={{ width: 16, height: 16 }} />
                        </div>
                        <div style={{ fontSize: 12.5, fontWeight: 700, color: "#1A2329", marginBottom: 4 }}>{t}</div>
                        <div style={{ fontSize: 11, color: "#5B6770", lineHeight: 1.45 }}>{d}</div>
                      </div>
                    ))}
                  </div>

                  {/* Data readiness row */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "center", fontSize: 12.5, color: "#5B6770", marginBottom: 22 }}>
                    <span><b style={{ fontFamily: MONO, color: "#1A2329" }}>{solicitudes.length}</b> solicitudes</span>
                    <span style={{ color: "#D8D3CA" }}>·</span>
                    <span><b style={{ fontFamily: MONO, color: "#1A2329" }}>{provEntries.length}</b> proveedores</span>
                    <span style={{ color: "#D8D3CA" }}>·</span>
                    <span><b style={{ fontFamily: MONO, color: "#1A2329" }}>{respondidas.length}</b> respondidas</span>
                    {respondidas.length >= 1 && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 99, background: "#E4F3EC", color: "#136E47", fontWeight: 700, fontSize: 11, border: "1px solid #B8DECA" }}>
                        ✓ Datos suficientes
                      </span>
                    )}
                  </div>

                  {/* CTA button */}
                  <button
                    onClick={handleAnalisisIA}
                    disabled={respondidas.length === 0}
                    style={{
                      position: "relative", overflow: "hidden",
                      display: "inline-flex", alignItems: "center", gap: 10, padding: "14px 28px",
                      borderRadius: 13, fontSize: 14, fontWeight: 700, border: "none", letterSpacing: "-0.01em",
                      background: respondidas.length === 0 ? "#E6E7E5" : "linear-gradient(135deg,#FF8856,#E85A26)",
                      color: respondidas.length === 0 ? "#8E97A0" : "#fff",
                      cursor: respondidas.length === 0 ? "not-allowed" : "pointer",
                      boxShadow: respondidas.length > 0 ? "0 14px 30px -10px rgba(232,90,38,0.6)" : "none",
                    }}
                  >
                    {respondidas.length > 0 && <span className="ia04-btn-glow" />}
                    <Sparkles style={{ width: 16, height: 16, flexShrink: 0 }} />
                    Generar análisis con IA
                  </button>
                  {respondidas.length === 0 && (
                    <p style={{ margin: "10px 0 0", fontFamily: MONO, fontSize: 10.5, color: "#8E97A0" }}>
                      Necesitás al menos una cotización respondida para activar el análisis.
                    </p>
                  )}
                  {analisisError && <p style={{ margin: "10px 0 0", fontSize: 12, color: "#D03A3A", fontWeight: 600 }}>{analisisError}</p>}
                  {respondidas.length > 0 && (
                    <p style={{ margin: "12px 0 0", fontFamily: MONO, fontSize: 10, color: "#8E97A0", letterSpacing: "0.02em" }}>
                      No se ejecuta solo · consume tokens de IA
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* ══════════════════════════════════════════
                ANALYZING STATE
            ══════════════════════════════════════════ */}
            {loadingAnalisis && (
              <div style={{ background: "#FAFAF8", border: "1px solid #E6E7E5", borderRadius: 16, padding: "80px 40px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
                <div style={{ position: "relative", width: 86, height: 86, borderRadius: "50%", background: "linear-gradient(150deg,#1B2A34,#2C4150)", display: "flex", alignItems: "center", justifyContent: "center", color: "#FF6B35", marginBottom: 26, boxShadow: "0 16px 34px -12px rgba(24,34,42,0.5)" }}>
                  <span className="ia04-az-ring" />
                  <span className="ia04-az-ring ia04-az-d2" />
                  <span className="ia04-az-ring ia04-az-d3" />
                  <Brain style={{ width: 32, height: 32, animation: "ia04azSpin 3s linear infinite" }} />
                </div>
                <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 8, color: "#1A2329" }}>Analizando tu historial de compras</div>
                <div style={{ fontSize: 13, color: "#5B6770", fontFamily: MONO, marginBottom: 24 }}>Comparando proveedores y detectando oportunidades…</div>
                <div style={{ width: 220, height: 6, borderRadius: 99, background: "#F0EDE7", overflow: "hidden" }}>
                  <span style={{ display: "block", height: "100%", width: "40%", borderRadius: 99, background: "linear-gradient(90deg,#FF8856,#E85A26)", animation: "ia04azBar 1.6s ease-in-out infinite" }} />
                </div>
              </div>
            )}

            {/* ══════════════════════════════════════════
                RESULTS
            ══════════════════════════════════════════ */}
            {analisisIA && !loadingAnalisis && (() => {
              const sorted = [...analisisIA.por_proveedor].sort((a, b) => (a.precio_promedio ?? Infinity) - (b.precio_promedio ?? Infinity));
              const prices = sorted.map(p => p.precio_promedio).filter((v): v is number => v != null);
              const gMin = prices.length ? Math.min(...prices) : 0;
              const gMax = prices.length ? Math.max(...prices) : 1;
              const span = gMax - gMin || 1;
              const pct = (v: number) => Math.round(((v - gMin) / span) * 82);

              return (
                <div style={{ display: "flex", flexDirection: "column", gap: 14, animation: "ia04fadeUp 0.4s cubic-bezier(.22,.61,.36,1)" }}>

                  {/* Hero dark card */}
                  {analisisIA.proveedor_recomendado && (
                    <div style={{ position: "relative", borderRadius: 16, overflow: "hidden", background: "linear-gradient(120deg,#16202A 0%,#22333D 55%,#2C4150 100%)", padding: "22px 24px", color: "#fff" }}>
                      <div aria-hidden="true" style={{ position: "absolute", right: -50, top: -90, width: 320, height: 320, background: "radial-gradient(circle,rgba(255,107,53,0.22),transparent 62%)", pointerEvents: "none" }} />
                      <div style={{ position: "relative", zIndex: 1 }}>
                        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
                          <button onClick={() => setAnalisisIA(null)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 11px", borderRadius: 9, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.14)", color: "rgba(255,255,255,0.8)", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                            <Sparkles style={{ width: 10, height: 10 }} /> Re-analizar
                          </button>
                        </div>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: MONO, fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", color: "#FF6B35", marginBottom: 12 }}>
                          <Sparkles style={{ width: 11, height: 11 }} /> LA IA RECOMIENDA
                        </div>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                              <div style={{ width: 44, height: 44, borderRadius: 13, background: "linear-gradient(135deg,#FF8856,#E85A26)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", flexShrink: 0, boxShadow: "0 10px 20px -8px rgba(232,90,38,0.7)" }}>
                                <Trophy style={{ width: 20, height: 20 }} />
                              </div>
                              <h2 style={{ margin: 0, fontSize: 24, fontWeight: 800, letterSpacing: "-0.03em", color: "#fff" }}>
                                {analisisIA.proveedor_recomendado}
                              </h2>
                            </div>
                            <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: "rgba(255,255,255,0.72)", maxWidth: 480 }}>
                              {analisisIA.motivo}
                            </p>
                          </div>
                          {analisisIA.ahorro_potencial != null && analisisIA.ahorro_potencial > 0 && (
                            <div style={{ textAlign: "right", flexShrink: 0 }}>
                              <div style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: 700, letterSpacing: "0.1em", color: "rgba(255,255,255,0.5)", marginBottom: 6 }}>AHORRO POTENCIAL</div>
                              <div style={{ fontSize: 36, fontWeight: 800, letterSpacing: "-0.04em", color: "#4DD9A0", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
                                {money(analisisIA.ahorro_potencial)}
                              </div>
                              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginTop: 8 }}>↓ vs. elegir el proveedor promedio</div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Price landscape */}
                  {sorted.length > 0 && (
                    <div style={{ background: "#fff", border: "1px solid #E6E7E5", borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 18px", borderBottom: "1px solid #F0EDE7" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ width: 30, height: 30, borderRadius: 9, background: "#EEF0F0", color: "#243642", display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <Layers style={{ width: 14, height: 14 }} />
                          </div>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 700 }}>Mapa de precios por proveedor</div>
                            <div style={{ fontSize: 11, color: "#8E97A0", marginTop: 1 }}>Más a la izquierda = más barato</div>
                          </div>
                        </div>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 10.5, color: "#8E97A0", fontFamily: MONO }}>
                          <span style={{ width: 9, height: 9, borderRadius: 99, background: "#fff", border: "2.5px solid #1A2329", display: "inline-block" }} />
                          precio promedio
                        </div>
                      </div>

                      {prices.length >= 2 && (
                        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 20px 4px" }}>
                          <span style={{ fontFamily: MONO, fontSize: 10, color: "#8E97A0", flexShrink: 0 }}>{fmtK(gMin)}</span>
                          <div style={{ flex: 1, height: 1, background: "repeating-linear-gradient(90deg,#D8D3CA 0 5px,transparent 5px 10px)" }} />
                          <span style={{ fontFamily: MONO, fontSize: 10, color: "#8E97A0", flexShrink: 0 }}>{fmtK(gMax)}</span>
                        </div>
                      )}

                      <div style={{ padding: "6px 18px 14px", display: "flex", flexDirection: "column", gap: 4 }}>
                        {sorted.map((p, idx) => {
                          const tend = TEND_MAP[p.tendencia] ?? TEND_MAP.sin_datos;
                          const isRec = p.nombre === analisisIA.proveedor_recomendado;
                          return (
                            <div key={p.nombre} style={{ padding: "11px 12px", borderRadius: 12, border: `1px solid ${isRec ? "#FFD9C4" : "transparent"}`, background: isRec ? "linear-gradient(180deg,#FFF7F2,#fff)" : "transparent" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 12, flexWrap: "wrap" }}>
                                <span style={{ width: 20, height: 20, borderRadius: 6, flexShrink: 0, background: isRec ? "#FF6B35" : "#F0EDE7", color: isRec ? "#fff" : "#5B6770", fontFamily: MONO, fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{idx + 1}</span>
                                <span style={{ fontSize: 13, fontWeight: 700, color: "#1A2329" }}>{p.nombre}</span>
                                {isRec && (
                                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 9.5, fontWeight: 700, fontFamily: MONO, letterSpacing: "0.04em", color: "#fff", background: "#FF6B35", padding: "2px 8px", borderRadius: 99 }}>
                                    <Trophy style={{ width: 9, height: 9 }} /> Recomendado
                                  </span>
                                )}
                                <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 99, border: `1px solid ${tend.bd}`, color: tend.color, background: tend.bg }}>{tend.label}</span>
                                <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 10, color: "#8E97A0" }}>{p.cotizaciones_respondidas} cotizadas</span>
                              </div>

                              {p.precio_promedio != null && prices.length >= 2 && (
                                <div style={{ position: "relative", height: 32, margin: "0 4px 6px" }}>
                                  <div style={{ position: "absolute", left: 0, right: 0, top: 16, height: 2, background: "#F0EDE7", borderRadius: 99 }} />
                                  <div style={{ position: "absolute", top: 4, left: `${pct(p.precio_promedio)}%`, transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center" }}>
                                    <span style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: 700, color: "#1A2329", marginBottom: 3, background: "#fff", padding: "1px 4px", borderRadius: 3, whiteSpace: "nowrap", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}>{fmtK(p.precio_promedio)}</span>
                                    <span style={{ width: 13, height: 13, borderRadius: 99, background: "#fff", border: `3px solid ${isRec ? "#FF6B35" : "#1A2329"}`, boxShadow: "0 2px 5px rgba(0,0,0,0.12)", display: "block" }} />
                                  </div>
                                </div>
                              )}

                              <div style={{ fontSize: 11, color: "#5B6770", fontStyle: "italic" }}>{p.fortaleza}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Oportunidades */}
                  {analisisIA.materiales_criticos.length > 0 && (
                    <div style={{ background: "#fff", border: "1px solid #E6E7E5", borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 18px", borderBottom: "1px solid #F0EDE7" }}>
                        <div style={{ width: 30, height: 30, borderRadius: 9, background: "#E4F3EC", color: "#1F8A5B", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <Target style={{ width: 14, height: 14 }} />
                        </div>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700 }}>Oportunidades de ahorro</div>
                          <div style={{ fontSize: 11, color: "#8E97A0", marginTop: 1 }}>Mayor diferencia de precio entre proveedores</div>
                        </div>
                      </div>
                      <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                        {analisisIA.materiales_criticos.map((m, i) => (
                          <div key={i} style={{ display: "flex", alignItems: "center", gap: 13, padding: "10px 12px", borderRadius: 11, border: "1px solid #F0EDE7", background: i % 2 === 0 ? "#fff" : "#FDFCFB" }}>
                            {m.diferencia_pct != null && (
                              <div style={{ position: "relative", width: 50, height: 50, borderRadius: "50%", flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: `conic-gradient(#1F8A5B ${Math.min(100, Math.round(m.diferencia_pct))}%, #EAEAE6 0)` }}>
                                <div style={{ position: "absolute", inset: 5, borderRadius: "50%", background: "#fff" }} />
                                <span style={{ position: "relative", zIndex: 1, fontFamily: MONO, fontSize: 12.5, fontWeight: 700, color: "#136E47", lineHeight: 1 }}>{Math.round(m.diferencia_pct)}%</span>
                                <span style={{ position: "relative", zIndex: 1, fontSize: 8, color: "#8E97A0", textTransform: "uppercase", letterSpacing: "0.04em" }}>menos</span>
                              </div>
                            )}
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 700, color: "#1A2329" }}>{m.nombre}</div>
                              {m.proveedor_mas_barato && (
                                <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "#5B6770", marginTop: 3 }}>
                                  <Trophy style={{ width: 10, height: 10, color: "#FF6B35", flexShrink: 0 }} />
                                  Más barato con <b style={{ color: "#1A2329" }}>{m.proveedor_mas_barato}</b>
                                </div>
                              )}
                              <div style={{ fontFamily: MONO, fontSize: 10, color: "#8E97A0", marginTop: 3 }}>cotizado {m.veces_cotizado}× · alta confianza</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Alertas */}
                  {analisisIA.alertas.length > 0 && (
                    <div style={{ background: "#fff", border: "1px solid #E6E7E5", borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 18px", borderBottom: "1px solid #F0EDE7" }}>
                        <div style={{ width: 30, height: 30, borderRadius: 9, background: "#FEF3E8", color: "#B45309", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <AlertTriangle style={{ width: 14, height: 14 }} />
                        </div>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700 }}>Alertas del mercado</div>
                          <div style={{ fontSize: 11, color: "#8E97A0", marginTop: 1 }}>{analisisIA.alertas.length} señales detectadas</div>
                        </div>
                      </div>
                      <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 7 }}>
                        {analisisIA.alertas.map((a, i) => (
                          <div key={i} style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 13px", borderRadius: 10, background: "#FEF3E8", border: "1px solid #F0D0A8" }}>
                            <span style={{ position: "relative", width: 8, height: 8, borderRadius: 99, background: "#B45309", flexShrink: 0, display: "inline-block" }}>
                              <span className="ia04-al-pulse" />
                            </span>
                            <span style={{ fontSize: 12, color: "#7A4200", fontWeight: 500, lineHeight: 1.4 }}>{a}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* ── Animations ── */}
            <style>{`
              .ia04-ring { position:absolute;inset:0;border-radius:20px;border:1.5px solid rgba(255,107,53,0.4);animation:ia04R 2.6s ease-out infinite; }
              .ia04-ring-d2 { animation-delay:1.3s; }
              @keyframes ia04R { 0%{transform:scale(1);opacity:0.8;} 100%{transform:scale(1.5);opacity:0;} }
              .ia04-btn-glow { position:absolute;top:0;left:-60%;width:50%;height:100%;background:linear-gradient(100deg,transparent,rgba(255,255,255,0.4),transparent);animation:ia04pbG 3s ease-in-out infinite; }
              @keyframes ia04pbG { 0%{left:-60%;} 55%,100%{left:130%;} }
              .ia04-az-ring { position:absolute;inset:0;border-radius:50%;border:2px solid rgba(255,107,53,0.4);animation:ia04azR 2.2s ease-out infinite; }
              .ia04-az-d2 { animation-delay:0.7s; } .ia04-az-d3 { animation-delay:1.4s; }
              @keyframes ia04azR { 0%{transform:scale(1);opacity:0.7;} 100%{transform:scale(1.65);opacity:0;} }
              @keyframes ia04azSpin { 0%{transform:rotate(0) scale(1);} 50%{transform:rotate(180deg) scale(1.1);} 100%{transform:rotate(360deg) scale(1);} }
              @keyframes ia04azBar { 0%{margin-left:-40%;} 100%{margin-left:100%;} }
              @keyframes ia04fadeUp { from{opacity:0;transform:translateY(8px);} to{opacity:1;transform:translateY(0);} }
              .ia04-al-pulse { position:absolute;inset:-4px;border-radius:99px;border:1.5px solid #B45309;opacity:0.4;animation:ia04alP 2s ease-out infinite; }
              @keyframes ia04alP { 0%{transform:scale(0.6);opacity:0.5;} 100%{transform:scale(1.7);opacity:0;} }
            `}</style>
          </div>
        );
      })()}

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
