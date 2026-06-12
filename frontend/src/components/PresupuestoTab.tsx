import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Loader2, Mail, MessageCircle, PackageCheck, Plus, ShoppingCart, X } from "lucide-react";
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
import { createMaterial } from "../api/taskMaterials";
import type { Supplier, Task } from "../types";

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
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "#6B7580" }}>Seleccioná los materiales pendientes a pedir</p>
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 8, border: "1px solid #E6E7E5", background: "#fff", cursor: "pointer", color: "#6B7580", display: "flex", alignItems: "center", justifyContent: "center" }}>
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
              <p style={{ margin: 0, padding: "10px 12px", fontSize: 12.5, color: "#6B7580" }}>
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
                  <span style={{ fontWeight: 400, color: "#6B7580" }}> · {r.task_title}</span>
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

// ─── Modal: agregar ítem (material) eligiendo la tarea ────────────────────────

function AddMaterialModal({ tasks, suppliers, onClose, onAdded }: {
  tasks: Task[];
  suppliers: Supplier[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const [taskId, setTaskId]     = useState<string>(tasks[0] ? String(tasks[0].id) : "");
  const [name, setName]         = useState("");
  const [qty, setQty]           = useState("");
  const [unit, setUnit]         = useState("");
  const [price, setPrice]       = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [addAnother, setAddAnother] = useState(true);

  async function handleSave() {
    if (!taskId) { setError("Elegí a qué tarea pertenece el material."); return; }
    if (!name.trim()) { setError("Ingresá el nombre del material."); return; }
    setSaving(true);
    setError(null);
    try {
      await createMaterial(Number(taskId), {
        name: name.trim(),
        quantity: qty ? Number(qty) : null,
        unit: unit.trim() || null,
        unit_price: price ? Number(price) : null,
        supplier_id: supplierId ? Number(supplierId) : null,
      });
      onAdded();
      if (addAnother) {
        setName(""); setQty(""); setUnit(""); setPrice("");
      } else {
        onClose();
      }
    } catch {
      setError("No se pudo agregar el material.");
    } finally {
      setSaving(false);
    }
  }

  const inp: React.CSSProperties = {
    width: "100%", boxSizing: "border-box", padding: "8px 10px", fontSize: 13,
    border: "1px solid #E6E7E5", borderRadius: 10, fontFamily: FONT, color: "#1A2329", outline: "none",
  };
  const lbl: React.CSSProperties = {
    display: "block", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase",
    letterSpacing: "0.08em", color: "#5B6770", marginBottom: 5,
  };

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
            <p style={{ margin: 0, fontSize: 13, color: "#C97D0E", fontWeight: 600 }}>
              Esta obra todavía no tiene tareas. Creá una tarea primero en el tab Tareas.
            </p>
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
                <div>
                  <label style={lbl}>Cantidad</label>
                  <input style={inp} type="number" min="0" placeholder="50" value={qty} onChange={e => setQty(e.target.value)} />
                </div>
                <div>
                  <label style={lbl}>Unidad</label>
                  <input style={inp} placeholder="bolsas" value={unit} onChange={e => setUnit(e.target.value)} />
                </div>
                <div>
                  <label style={lbl}>$ unit.</label>
                  <input style={inp} type="number" min="0" placeholder="8000" value={price} onChange={e => setPrice(e.target.value)} />
                </div>
              </div>
              <div>
                <label style={lbl}>Proveedor (opcional)</label>
                <select value={supplierId} onChange={e => setSupplierId(e.target.value)} style={{ ...inp, cursor: "pointer" }}>
                  <option value="">Sin proveedor</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}{s.category ? ` · ${s.category}` : ""}</option>)}
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
              <button onClick={onClose} disabled={saving} style={{ padding: "8px 14px", borderRadius: 10, fontSize: 12.5, fontWeight: 600, color: "#5B6770", background: "#fff", border: "1px solid #E6E7E5", cursor: "pointer" }}>
                Cerrar
              </button>
              <button onClick={handleSave} disabled={saving || !name.trim()} style={{
                display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 10,
                fontSize: 12.5, fontWeight: 700, color: "#fff",
                background: saving || !name.trim() ? "#F0A882" : "#FF6B35", border: "none",
                cursor: saving ? "wait" : "pointer",
              }}>
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

// ─── Tab principal ────────────────────────────────────────────────────────────

export function PresupuestoTab({ obraId, obraName, tasks = [] }: { obraId: number; obraName: string; tasks?: Task[] }) {
  const [data, setData] = useState<PresupuestoResponse | null>(null);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [showAddMaterial, setShowAddMaterial] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [actingOrder, setActingOrder] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

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
    setActionError(null);
    try {
      const updated = await sendPurchaseOrder(order.id, channel);
      setOrders(prev => prev.map(o => (o.id === updated.id ? updated : o)));
    } catch (e: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const detail = (e as any)?.response?.data?.detail;
      setActionError(typeof detail === "string" ? detail : "No se pudo enviar el pedido.");
    } finally {
      setActingOrder(null);
    }
  }

  async function handleReceive(order: PurchaseOrder) {
    setActingOrder(order.id);
    setActionError(null);
    try {
      await receivePurchaseOrder(order.id);
      await load();
    } catch {
      setActionError("No se pudo marcar como recibido.");
    } finally {
      setActingOrder(null);
    }
  }

  if (loading) {
    return <p style={{ padding: 24, fontSize: 13, color: "#6B7580", fontFamily: FONT }}>Cargando presupuesto…</p>;
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
            <p style={{ margin: 0, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#6B7580" }}>{kpi.label}</p>
            <p style={{ margin: "6px 0 0", fontSize: 21, fontWeight: 800, color: kpi.color, fontVariantNumeric: "tabular-nums" }}>{money(kpi.value)}</p>
            <p style={{ margin: "2px 0 0", fontSize: 11, color: "#7D7973" }}>{kpi.hint}</p>
          </div>
        ))}
      </div>

      {/* ── Acciones ── */}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          onClick={() => setShowAddMaterial(true)}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px",
            borderRadius: 10, fontSize: 12.5, fontWeight: 600, color: "#1A2329",
            background: "#fff", border: "1px solid #E6E7E5", cursor: "pointer", marginRight: "auto",
          }}
        >
          <Plus style={{ width: 13, height: 13 }} />
          Agregar ítem
        </button>
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
            borderRadius: 10, fontSize: 12.5, fontWeight: 700,
            background: pendientesCount === 0 ? "#E6E7E5" : "#FF6B35", border: "none",
            color: pendientesCount === 0 ? "#8E97A0" : "#fff",
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
            <span key={h} style={{ fontSize: 10, fontWeight: 700, color: "#6B7580", letterSpacing: "0.09em", textTransform: "uppercase" }}>{h}</span>
          ))}
        </div>

        {groups.length === 0 && (
          <div style={{ padding: "40px 24px", textAlign: "center" }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: "#FFF0E8", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
              <ShoppingCart style={{ width: 20, height: 20, color: "#E76A2D" }} />
            </div>
            <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: "#3E4A52" }}>Todavía no hay materiales cargados</p>
            <p style={{ margin: "4px 0 14px", fontSize: 12, color: "#6B7580" }}>
              Empezá agregando un ítem y elegí a qué tarea de la obra pertenece.
            </p>
            <button
              onClick={() => setShowAddMaterial(true)}
              disabled={tasks.length === 0}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 18px",
                borderRadius: 10, fontSize: 13, fontWeight: 700, color: "#fff",
                background: tasks.length === 0 ? "#F0A882" : "#FF6B35", border: "none",
                cursor: tasks.length === 0 ? "not-allowed" : "pointer",
                boxShadow: tasks.length === 0 ? "none" : "0 6px 14px -6px rgba(255,107,53,0.5)",
              }}
              title={tasks.length === 0 ? "Creá una tarea primero en el tab Tareas" : undefined}
            >
              <Plus style={{ width: 14, height: 14 }} />
              Agregar primer ítem
            </button>
            {tasks.length === 0 && (
              <p style={{ margin: "10px 0 0", fontSize: 11.5, color: "#C97D0E" }}>
                Necesitás al menos una tarea en la obra. Creala en el tab Tareas.
              </p>
            )}
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

      {/* ── Error de acción sobre pedidos ── */}
      {actionError && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#FCE5E5", border: "1px solid #F0B0B0", borderRadius: 11, padding: "9px 12px" }}>
          <span style={{ fontSize: 12.5, color: "#A82B2B", fontWeight: 600, flex: 1 }}>{actionError}</span>
          <button onClick={() => setActionError(null)} style={{ border: "none", background: "none", cursor: "pointer", color: "#A82B2B", fontSize: 14, fontWeight: 700, padding: 0 }} aria-label="Cerrar error">×</button>
        </div>
      )}

      {/* ── Pedidos ── */}
      {orders.length > 0 && (
        <div style={{ background: "#fff", border: "1px solid #ECE7DD", borderRadius: 14, overflow: "hidden" }}>
          <div style={{ padding: "10px 14px", borderBottom: "1px solid #F0EBE2", background: "#FAF8F4" }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: "#6B7580", letterSpacing: "0.09em", textTransform: "uppercase" }}>
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
                  <span style={{ fontWeight: 400, color: "#6B7580" }}> · {o.supplier_name ?? "sin proveedor"} · {o.items.length} ítem{o.items.length !== 1 ? "s" : ""}</span>
                </div>
                <div style={{ fontSize: 11, color: "#6B7580", marginTop: 1 }}>
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

      {showAddMaterial && (
        <AddMaterialModal
          tasks={tasks}
          suppliers={suppliers}
          onClose={() => setShowAddMaterial(false)}
          onAdded={load}
        />
      )}
    </div>
  );
}
