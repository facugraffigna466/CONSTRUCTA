import { useEffect, useState } from "react";
import { Package, Plus, Trash2, Loader2 } from "lucide-react";
import { createMaterial, deleteMaterial, fetchMaterials, updateMaterial } from "../api/taskMaterials";
import { fetchSuppliers } from "../api/suppliers";
import type { MaterialStatus, Supplier, TaskMaterial } from "../types";

const STATUS_META: Record<MaterialStatus, { label: string; bg: string; color: string }> = {
  pendiente: { label: "Pendiente", bg: "#EBF3FF", color: "#2A62C9" },
  pedido:    { label: "Pedido",    bg: "#FFFBEB", color: "#B45309" },
  recibido:  { label: "Recibido",  bg: "#E4F3EC", color: "#136E47" },
};

const cellInput: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "6px 8px",
  fontSize: 12, fontFamily: "'Plus Jakarta Sans', sans-serif",
  color: "#1A2329", background: "#fff",
  border: "1px solid #E6E7E5", borderRadius: 8, outline: "none",
};

/** Tabla inline de materiales de una tarea (solo en modo edición). */
export function TaskMaterialsSection({ taskId }: { taskId: number }) {
  const [materials, setMaterials] = useState<TaskMaterial[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // Fila nueva
  const [nName, setNName]       = useState("");
  const [nQty, setNQty]         = useState("");
  const [nUnit, setNUnit]       = useState("");
  const [nPrice, setNPrice]     = useState("");
  const [nSupplier, setNSupplier] = useState("");
  const [saving, setSaving]     = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchMaterials(taskId), fetchSuppliers()])
      .then(([mats, sups]) => { if (!cancelled) { setMaterials(mats); setSuppliers(sups); } })
      .catch(() => { if (!cancelled) setError("No se pudieron cargar los materiales."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [taskId]);

  async function handleAdd() {
    if (!nName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const created = await createMaterial(taskId, {
        name: nName.trim(),
        quantity: nQty ? Number(nQty) : null,
        unit: nUnit.trim() || null,
        unit_price: nPrice ? Number(nPrice) : null,
        supplier_id: nSupplier ? Number(nSupplier) : null,
      });
      setMaterials(prev => [...prev, created]);
      setNName(""); setNQty(""); setNUnit(""); setNPrice(""); setNSupplier("");
      setAdding(false);
    } catch {
      setError("No se pudo agregar el material.");
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(m: TaskMaterial, status: MaterialStatus) {
    try {
      const updated = await updateMaterial(taskId, m.id, { status });
      setMaterials(prev => prev.map(x => (x.id === m.id ? updated : x)));
    } catch { /* mantener estado anterior */ }
  }

  async function handleDelete(m: TaskMaterial) {
    try {
      await deleteMaterial(taskId, m.id);
      setMaterials(prev => prev.filter(x => x.id !== m.id));
    } catch { /* noop */ }
  }

  const total = materials.reduce((acc, m) => acc + (m.quantity ?? 0) * (m.unit_price ?? 0), 0);

  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
        <Package style={{ width: 13, height: 13, color: "#5B6770" }} />
        <span style={{
          fontSize: 10.5, fontWeight: 700, letterSpacing: "0.09em",
          textTransform: "uppercase", color: "#5B6770",
        }}>
          Materiales
        </span>
        {materials.length > 0 && (
          <span style={{ fontSize: 11, color: "#8E97A0" }}>
            · {materials.length} ítem{materials.length !== 1 ? "s" : ""}
            {total > 0 && <> · ${total.toLocaleString("es-AR", { maximumFractionDigits: 2 })}</>}
          </span>
        )}
      </div>

      {loading ? (
        <p style={{ margin: 0, fontSize: 12, color: "#8E97A0" }}>Cargando materiales…</p>
      ) : (
        <div style={{ border: "1px solid #EFECE6", borderRadius: 10, overflow: "hidden" }}>
          {materials.length === 0 && !adding && (
            <p style={{ margin: 0, padding: "10px 12px", fontSize: 12, color: "#8E97A0" }}>
              Sin materiales cargados para esta tarea.
            </p>
          )}

          {materials.map((m, i) => (
            <div key={m.id} style={{
              display: "grid",
              gridTemplateColumns: "1fr 76px 90px 96px 26px",
              alignItems: "center", gap: 6,
              padding: "7px 10px",
              borderBottom: "1px solid #F4F1EB",
              background: i % 2 === 1 ? "#FBFAF7" : "#fff",
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: "#1A2329", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={m.name}>
                  {m.name}
                </div>
                <div style={{ fontSize: 10.5, color: "#8E97A0" }}>
                  {m.supplier_name ?? "Sin proveedor"}
                </div>
              </div>
              <span style={{ fontSize: 11.5, color: "#5B6770", fontVariantNumeric: "tabular-nums", textAlign: "right" }}>
                {m.quantity != null ? `${m.quantity} ${m.unit ?? ""}` : "—"}
              </span>
              <span style={{ fontSize: 11.5, color: "#5B6770", fontVariantNumeric: "tabular-nums", textAlign: "right" }}>
                {m.unit_price != null ? `$${(m.quantity ?? 0) * m.unit_price > 0 ? ((m.quantity ?? 0) * m.unit_price).toLocaleString("es-AR", { maximumFractionDigits: 0 }) : m.unit_price}` : "—"}
              </span>
              <select
                value={m.status}
                onChange={e => handleStatusChange(m, e.target.value as MaterialStatus)}
                style={{
                  fontSize: 10.5, fontWeight: 700, padding: "3px 6px", borderRadius: 99,
                  background: STATUS_META[m.status].bg, color: STATUS_META[m.status].color,
                  border: "none", cursor: "pointer", appearance: "none", textAlign: "center",
                  fontFamily: "'Plus Jakarta Sans', sans-serif",
                }}
              >
                <option value="pendiente">Pendiente</option>
                <option value="pedido">Pedido</option>
                <option value="recibido">Recibido</option>
              </select>
              <button
                type="button"
                onClick={() => handleDelete(m)}
                title="Eliminar material"
                style={{
                  width: 24, height: 24, borderRadius: 7, border: "none",
                  background: "transparent", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", color: "#ADAAA4",
                }}
                onMouseEnter={e => { e.currentTarget.style.background = "#FCE5E5"; e.currentTarget.style.color = "#D03A3A"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#ADAAA4"; }}
              >
                <Trash2 style={{ width: 12, height: 12 }} />
              </button>
            </div>
          ))}

          {adding ? (
            <div style={{ padding: "8px 10px", background: "#FFF8F3", display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 60px 60px 80px", gap: 6 }}>
                <input style={cellInput} placeholder="Material (ej: Cemento)" value={nName} onChange={e => setNName(e.target.value)} autoFocus />
                <input style={cellInput} placeholder="Cant." type="number" min="0" value={nQty} onChange={e => setNQty(e.target.value)} />
                <input style={cellInput} placeholder="Unidad" value={nUnit} onChange={e => setNUnit(e.target.value)} />
                <input style={cellInput} placeholder="$ unit." type="number" min="0" value={nPrice} onChange={e => setNPrice(e.target.value)} />
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <select style={{ ...cellInput, flex: 1, cursor: "pointer" }} value={nSupplier} onChange={e => setNSupplier(e.target.value)}>
                  <option value="">Sin proveedor</option>
                  {suppliers.map(s => (
                    <option key={s.id} value={s.id}>{s.name}{s.category ? ` · ${s.category}` : ""}</option>
                  ))}
                </select>
                <button type="button" onClick={() => setAdding(false)} disabled={saving} style={{
                  padding: "6px 10px", borderRadius: 8, fontSize: 11.5, fontWeight: 600,
                  color: "#8E97A0", background: "#fff", border: "1px solid #E6E7E5", cursor: "pointer",
                }}>
                  Cancelar
                </button>
                <button type="button" onClick={handleAdd} disabled={saving || !nName.trim()} style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  padding: "6px 12px", borderRadius: 8, fontSize: 11.5, fontWeight: 700,
                  color: "#fff", background: saving || !nName.trim() ? "#F0A882" : "#FF6B35",
                  border: "none", cursor: saving ? "wait" : "pointer",
                }}>
                  {saving && <Loader2 style={{ width: 11, height: 11, animation: "spin 1s linear infinite" }} />}
                  Agregar
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              style={{
                width: "100%", padding: "7px 12px", background: "transparent", border: "none",
                display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 600,
                color: "#8E97A0", cursor: "pointer", textAlign: "left",
              }}
              onMouseEnter={e => { e.currentTarget.style.color = "#FF6B35"; }}
              onMouseLeave={e => { e.currentTarget.style.color = "#8E97A0"; }}
            >
              <Plus style={{ width: 11, height: 11 }} />
              Agregar material
            </button>
          )}
        </div>
      )}

      {error && <p style={{ margin: "6px 0 0", fontSize: 11.5, color: "#D03A3A" }}>{error}</p>}
    </div>
  );
}
