import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Loader2, Mail, MessageCircle, PackageCheck, ShoppingCart, X } from "lucide-react";
import {
  createPurchaseOrder,
  exportPresupuestoExcel,
  fetchPresupuesto,
  fetchPurchaseOrders,
  receivePurchaseOrder,
  sendPurchaseOrder,
  type PresupuestoResponse,
  type PresupuestoRow,
  type PurchaseOrder,
} from "../api/purchaseOrders";
import { fetchSuppliers } from "../api/suppliers";
import type { Supplier } from "../types";

const FONT = "'Plus Jakarta Sans', sans-serif";

const STATUS_META: Record<string, { label: string; bg: string; color: string }> = {
  pendiente: { label: "Pendiente", bg: "#EBF3FF", color: "#2A62C9" },
  pedido:    { label: "Pedido",    bg: "#FFFBEB", color: "#B45309" },
  recibido:  { label: "Recibido",  bg: "#E4F3EC", color: "#136E47" },
  borrador:  { label: "Borrador",  bg: "#F4F5F4", color: "#5B6770" },
  enviado:   { label: "Enviado",   bg: "#FFFBEB", color: "#B45309" },
};

function money(n: number | null | undefined): string {
  if (n == null) return "—";
  return "$" + n.toLocaleString("es-AR", { maximumFractionDigits: 2 });
}

function Pill({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? STATUS_META.pendiente;
  return (
    <span style={{
      display: "inline-block", padding: "2px 9px", borderRadius: 99,
      fontSize: 10.5, fontWeight: 700, background: meta.bg, color: meta.color,
      whiteSpace: "nowrap",
    }}>
      {meta.label}
    </span>
  );
}

// ─── Modal: generar pedido ────────────────────────────────────────────────────

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

  // Al elegir proveedor, preseleccionar sus materiales (los sin proveedor quedan)
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
    setSaving(true);
    setError(null);
    try {
      const order = await createPurchaseOrder(obraId, {
        supplier_id: supplierId ? Number(supplierId) : null,
        material_ids: Array.from(selected),
        notes: notes.trim() || null,
      });
      onCreated(order);
    } catch {
      setError("No se pudo crear el pedido.");
      setSaving(false);
    }
  }

  const totalSel = pendientes
    .filter(r => selected.has(r.material_id))
    .reduce((a, r) => a + r.subtotal, 0);

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 70, display: "flex", alignItems: "center",
      justifyContent: "center", background: "rgba(15,22,28,0.5)", padding: 16,
    }}>
      <div style={{
        background: "#fff", borderRadius: 16, width: "100%", maxWidth: 480,
        boxShadow: "0 24px 48px -12px rgba(15,22,28,0.35)", fontFamily: FONT,
        maxHeight: "85vh", display: "flex", flexDirection: "column",
      }}>
        <div style={{ padding: "18px 22px 14px", borderBottom: "1px solid #F0F1EF", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 15.5, fontWeight: 700, color: "#1A2329" }}>Generar pedido de materiales</h3>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "#8E97A0" }}>Seleccioná los materiales pendientes a pedir</p>
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 8, border: "1px solid #E6E7E5", background: "#fff", cursor: "pointer", color: "#8E97A0", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <X style={{ width: 13, height: 13 }} />
          </button>
        </div>

        <div style={{ padding: "16px 22px", overflowY: "auto", flex: 1 }}>
          <label style={{ display: "block", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#5B6770", marginBottom: 5 }}>
            Proveedor
          </label>
          <select
            value={supplierId}
            onChange={e => handleSupplierChange(e.target.value)}
            style={{
              width: "100%", boxSizing: "border-box", padding: "8px 10px", fontSize: 13,
              border: "1px solid #E6E7E5", borderRadius: 10, fontFamily: FONT, color: "#1A2329",
              outline: "none", cursor: "pointer", marginBottom: 14,
            }}
          >
            <option value="">Sin proveedor (pedido interno)</option>
            {suppliers.map(s => (
              <option key={s.id} value={s.id}>{s.name}{s.category ? ` · ${s.category}` : ""}</option>
            ))}
          </select>

          <label style={{ display: "block", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#5B6770", marginBottom: 5 }}>
            Materiales pendientes ({selected.size}/{pendientes.length})
          </label>
          <div style={{ border: "1px solid #EFECE6", borderRadius: 10, overflow: "hidden", marginBottom: 14 }}>
            {pendientes.length === 0 && (
              <p style={{ margin: 0, padding: "10px 12px", fontSize: 12.5, color: "#8E97A0" }}>
                No hay materiales pendientes. Cargalos desde las tareas.
              </p>
            )}
            {pendientes.map((r, i) => (
              <label key={r.material_id} style={{
                display: "flex", alignItems: "center", gap: 9, padding: "7px 10px",
                borderBottom: i < pendientes.length - 1 ? "1px solid #F4F1EB" : "none",
                background: selected.has(r.material_id) ? "#FFF8F3" : "#fff",
                cursor: "pointer",
              }}>
                <input
                  type="checkbox"
                  checked={selected.has(r.material_id)}
                  onChange={() => toggle(r.material_id)}
                  style={{ accentColor: "#FF6B35" }}
                />
                <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, color: "#1A2329", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.name}
                  <span style={{ fontWeight: 400, color: "#8E97A0" }}> · {r.task_title}</span>
                </span>
                <span style={{ fontSize: 11.5, color: "#5B6770", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
                  {r.quantity != null ? `${r.quantity} ${r.unit ?? ""}` : ""} {r.subtotal > 0 && `· ${money(r.subtotal)}`}
                </span>
              </label>
            ))}
          </div>

          <label style={{ display: "block", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#5B6770", marginBottom: 5 }}>
            Notas (opcional)
          </label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={2}
            placeholder="Ej: entregar en obra antes de las 10hs"
            style={{
              width: "100%", boxSizing: "border-box", padding: "8px 10px", fontSize: 12.5,
              border: "1px solid #E6E7E5", borderRadius: 10, fontFamily: FONT, color: "#1A2329",
              outline: "none", resize: "vertical",
            }}
          />

          {error && <p style={{ margin: "10px 0 0", fontSize: 12, color: "#D03A3A", fontWeight: 600 }}>{error}</p>}
        </div>

        <div style={{ padding: "14px 22px 18px", borderTop: "1px solid #F0F1EF", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 12.5, color: "#5B6770" }}>
            Total: <strong style={{ color: "#1A2329" }}>{money(totalSel)}</strong>
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose} disabled={saving} style={{ padding: "8px 14px", borderRadius: 10, fontSize: 12.5, fontWeight: 600, color: "#5B6770", background: "#fff", border: "1px solid #E6E7E5", cursor: "pointer" }}>
              Cancelar
            </button>
            <button
              onClick={handleCreate}
              disabled={saving || selected.size === 0}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "8px 16px", borderRadius: 10, fontSize: 12.5, fontWeight: 700,
                color: "#fff", background: saving || selected.size === 0 ? "#F0A882" : "#FF6B35",
                border: "none", cursor: saving ? "wait" : "pointer",
              }}
            >
              {saving && <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} />}
              Crear pedido ({selected.size})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Tab principal ────────────────────────────────────────────────────────────

export function PresupuestoTab({ obraId, obraName }: { obraId: number; obraName: string }) {
  const [data, setData] = useState<PresupuestoResponse | null>(null);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [actingOrder, setActingOrder] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [pres, ords, sups] = await Promise.all([
        fetchPresupuesto(obraId),
        fetchPurchaseOrders(obraId),
        fetchSuppliers(),
      ]);
      setData(pres);
      setOrders(ords);
      setSuppliers(sups);
      setError(null);
    } catch {
      setError("No se pudo cargar el presupuesto.");
    } finally {
      setLoading(false);
    }
  }, [obraId]);

  useEffect(() => { load(); }, [load]);

  const groups = useMemo(() => {
    if (!data) return [];
    const map = new Map<number, { title: string; rows: PresupuestoRow[]; subtotal: number }>();
    for (const r of data.rows) {
      if (!map.has(r.task_id)) map.set(r.task_id, { title: r.task_title, rows: [], subtotal: 0 });
      const g = map.get(r.task_id)!;
      g.rows.push(r);
      g.subtotal += r.subtotal;
    }
    return Array.from(map.values());
  }, [data]);

  async function handleSend(order: PurchaseOrder, channel: "whatsapp" | "email") {
    setActingOrder(order.id);
    try {
      const updated = await sendPurchaseOrder(order.id, channel);
      setOrders(prev => prev.map(o => (o.id === updated.id ? updated : o)));
    } catch (e: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const detail = (e as any)?.response?.data?.detail;
      alert(typeof detail === "string" ? detail : "No se pudo enviar el pedido.");
    } finally {
      setActingOrder(null);
    }
  }

  async function handleReceive(order: PurchaseOrder) {
    setActingOrder(order.id);
    try {
      await receivePurchaseOrder(order.id);
      await load();
    } catch {
      alert("No se pudo marcar como recibido.");
    } finally {
      setActingOrder(null);
    }
  }

  if (loading) {
    return <p style={{ padding: 24, fontSize: 13, color: "#8E97A0", fontFamily: FONT }}>Cargando presupuesto…</p>;
  }
  if (error || !data) {
    return <p style={{ padding: 24, fontSize: 13, color: "#D03A3A", fontFamily: FONT }}>{error}</p>;
  }

  const pendientesCount = data.rows.filter(r => r.status === "pendiente").length;

  return (
    <div style={{ fontFamily: FONT, display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── KPIs ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
        {[
          { label: "Total estimado", value: data.total_estimado, color: "#1A2329", hint: "Todos los materiales con precio" },
          { label: "Comprometido (pedido)", value: data.total_pedido, color: "#B45309", hint: "Pedidos en curso" },
          { label: "Gasto real (recibido)", value: data.total_recibido, color: "#1F8A5B", hint: "Materiales ya recibidos" },
        ].map(kpi => (
          <div key={kpi.label} style={{ background: "#fff", border: "1px solid #ECE7DD", borderRadius: 14, padding: "14px 16px" }}>
            <p style={{ margin: 0, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#8E97A0" }}>{kpi.label}</p>
            <p style={{ margin: "6px 0 0", fontSize: 21, fontWeight: 800, color: kpi.color, fontVariantNumeric: "tabular-nums" }}>{money(kpi.value)}</p>
            <p style={{ margin: "2px 0 0", fontSize: 11, color: "#ADAAA4" }}>{kpi.hint}</p>
          </div>
        ))}
      </div>

      {/* ── Acciones ── */}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          onClick={async () => { setExporting(true); try { await exportPresupuestoExcel(obraId, obraName); } finally { setExporting(false); } }}
          disabled={exporting || data.rows.length === 0}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px",
            borderRadius: 10, fontSize: 12.5, fontWeight: 600, color: "#5B6770",
            background: "#fff", border: "1px solid #E6E7E5", cursor: "pointer",
            opacity: data.rows.length === 0 ? 0.5 : 1,
          }}
        >
          <Download style={{ width: 13, height: 13 }} />
          {exporting ? "Exportando…" : "Exportar Excel"}
        </button>
        <button
          onClick={() => setShowOrderModal(true)}
          disabled={pendientesCount === 0}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px",
            borderRadius: 10, fontSize: 12.5, fontWeight: 700, color: "#fff",
            background: pendientesCount === 0 ? "#F0A882" : "#FF6B35", border: "none",
            cursor: pendientesCount === 0 ? "not-allowed" : "pointer",
            boxShadow: pendientesCount === 0 ? "none" : "0 6px 14px -6px rgba(255,107,53,0.5)",
          }}
          title={pendientesCount === 0 ? "No hay materiales pendientes" : undefined}
        >
          <ShoppingCart style={{ width: 13, height: 13 }} />
          Generar pedido
        </button>
      </div>

      {/* ── Tabla por tarea ── */}
      <div style={{ background: "#fff", border: "1px solid #ECE7DD", borderRadius: 14, overflow: "hidden" }}>
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 90px 100px 110px 130px 92px",
          padding: "9px 14px", borderBottom: "1px solid #F0EBE2", background: "#FAF8F4",
        }}>
          {["Ítem", "Cantidad", "Precio unit.", "Subtotal", "Proveedor", "Estado"].map(h => (
            <span key={h} style={{ fontSize: 10, fontWeight: 700, color: "#94928D", letterSpacing: "0.09em", textTransform: "uppercase" }}>{h}</span>
          ))}
        </div>

        {groups.length === 0 && (
          <div style={{ padding: "36px 24px", textAlign: "center" }}>
            <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: "#3E4A52" }}>Todavía no hay materiales cargados</p>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "#8E97A0" }}>
              Agregalos desde el tab Tareas: editá una tarea y completá la sección Materiales.
            </p>
          </div>
        )}

        {groups.map(g => (
          <div key={g.title}>
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "7px 14px", background: "#F6F4EF", borderBottom: "1px solid #F0EBE2",
            }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#3E4A52" }}>{g.title}</span>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: "#5B6770", fontVariantNumeric: "tabular-nums" }}>{money(g.subtotal)}</span>
            </div>
            {g.rows.map((r, i) => (
              <div key={r.material_id} style={{
                display: "grid", gridTemplateColumns: "1fr 90px 100px 110px 130px 92px",
                alignItems: "center", padding: "8px 14px",
                borderBottom: "1px solid #F4F1EB",
                background: i % 2 === 1 ? "#FBFAF7" : "#fff",
              }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: "#1A2329", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.name}>{r.name}</span>
                <span style={{ fontSize: 12, color: "#5B6770", fontVariantNumeric: "tabular-nums" }}>{r.quantity != null ? `${r.quantity} ${r.unit ?? ""}` : "—"}</span>
                <span style={{ fontSize: 12, color: "#5B6770", fontVariantNumeric: "tabular-nums" }}>{money(r.unit_price)}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#1A2329", fontVariantNumeric: "tabular-nums" }}>{r.subtotal > 0 ? money(r.subtotal) : "—"}</span>
                <span style={{ fontSize: 12, color: r.supplier_name ? "#5B6770" : "#C4C9C6", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.supplier_name ?? "Sin proveedor"}</span>
                <span><Pill status={r.status} /></span>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* ── Pedidos ── */}
      {orders.length > 0 && (
        <div style={{ background: "#fff", border: "1px solid #ECE7DD", borderRadius: 14, overflow: "hidden" }}>
          <div style={{ padding: "10px 14px", borderBottom: "1px solid #F0EBE2", background: "#FAF8F4" }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: "#94928D", letterSpacing: "0.09em", textTransform: "uppercase" }}>
              Pedidos ({orders.length})
            </span>
          </div>
          {orders.map((o, i) => (
            <div key={o.id} style={{
              display: "flex", alignItems: "center", gap: 12, padding: "10px 14px",
              borderBottom: i < orders.length - 1 ? "1px solid #F4F1EB" : "none",
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: "#1A2329" }}>
                  Pedido #{o.id}
                  <span style={{ fontWeight: 400, color: "#8E97A0" }}> · {o.supplier_name ?? "sin proveedor"} · {o.items.length} ítem{o.items.length !== 1 ? "s" : ""}</span>
                </div>
                <div style={{ fontSize: 11, color: "#8E97A0", marginTop: 1 }}>
                  {new Date(o.created_at).toLocaleDateString("es-AR")} {o.total > 0 && <>· {money(o.total)}</>}
                  {o.notes && <> · {o.notes}</>}
                </div>
              </div>
              <Pill status={o.status} />
              {o.status !== "recibido" && (
                <div style={{ display: "flex", gap: 5 }}>
                  {o.status === "borrador" && o.supplier_phone && (
                    <button
                      onClick={() => handleSend(o, "whatsapp")}
                      disabled={actingOrder === o.id}
                      title="Enviar por WhatsApp"
                      style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 10px", borderRadius: 8, fontSize: 11.5, fontWeight: 600, color: "#136E47", background: "#E4F3EC", border: "none", cursor: "pointer" }}
                    >
                      <MessageCircle style={{ width: 12, height: 12 }} /> WhatsApp
                    </button>
                  )}
                  {o.status === "borrador" && o.supplier_email && (
                    <button
                      onClick={() => handleSend(o, "email")}
                      disabled={actingOrder === o.id}
                      title="Enviar por email"
                      style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 10px", borderRadius: 8, fontSize: 11.5, fontWeight: 600, color: "#2A62C9", background: "#EBF3FF", border: "none", cursor: "pointer" }}
                    >
                      <Mail style={{ width: 12, height: 12 }} /> Email
                    </button>
                  )}
                  <button
                    onClick={() => handleReceive(o)}
                    disabled={actingOrder === o.id}
                    title="Confirmar recepción en obra"
                    style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 10px", borderRadius: 8, fontSize: 11.5, fontWeight: 700, color: "#fff", background: "#1F8A5B", border: "none", cursor: "pointer" }}
                  >
                    {actingOrder === o.id
                      ? <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} />
                      : <PackageCheck style={{ width: 12, height: 12 }} />}
                    Recibido
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showOrderModal && data && (
        <OrderModal
          obraId={obraId}
          rows={data.rows}
          suppliers={suppliers}
          onClose={() => setShowOrderModal(false)}
          onCreated={() => { setShowOrderModal(false); load(); }}
        />
      )}
    </div>
  );
}
