import { apiClient } from "./client";

// ── Presupuesto ───────────────────────────────────────────────────────────────

export interface PresupuestoRow {
  task_id: number;
  task_title: string;
  material_id: number;
  name: string;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  subtotal: number;
  status: "pendiente" | "pedido" | "recibido";
  supplier_id: number | null;
  supplier_name: string | null;
  responsible_id: number | null;
  responsible_name: string | null;
  created_by: number | null;
  created_by_name: string | null;
}

export interface PresupuestoResponse {
  rows: PresupuestoRow[];
  total_estimado: number;
  total_pedido: number;
  total_recibido: number;
}

export async function fetchPresupuesto(obraId: number): Promise<PresupuestoResponse> {
  const { data } = await apiClient.get<PresupuestoResponse>(`/obras/${obraId}/presupuesto`);
  return data;
}

export async function exportPresupuestoExcel(obraId: number, obraName?: string): Promise<void> {
  const response = await apiClient.get(`/exports/obras/${obraId}/presupuesto-excel`, {
    responseType: "blob",
  });
  const url = URL.createObjectURL(new Blob([response.data]));
  const link = document.createElement("a");
  link.href = url;
  link.download = obraName
    ? `${obraName.replace(/[^a-z0-9áéíóúñü\s-]/gi, "").trim()}_presupuesto.xlsx`
    : `obra_${obraId}_presupuesto.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ── Pedidos ───────────────────────────────────────────────────────────────────

export interface PurchaseOrderItem {
  id: number;
  material_id: number | null;
  name: string;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
}

export interface PurchaseOrder {
  id: number;
  obra_id: number;
  supplier_id: number | null;
  supplier_name: string | null;
  supplier_phone: string | null;
  supplier_email: string | null;
  created_by: number | null;
  status: "borrador" | "enviado" | "recibido";
  notes: string | null;
  created_at: string;
  sent_at: string | null;
  received_at: string | null;
  items: PurchaseOrderItem[];
  total: number;
}

export async function fetchPurchaseOrders(obraId: number): Promise<PurchaseOrder[]> {
  const { data } = await apiClient.get<PurchaseOrder[]>(`/obras/${obraId}/purchase-orders`);
  return data;
}

export async function createPurchaseOrder(
  obraId: number,
  payload: { supplier_id: number | null; material_ids: number[]; notes?: string | null },
): Promise<PurchaseOrder> {
  const { data } = await apiClient.post<PurchaseOrder>(`/obras/${obraId}/purchase-orders`, payload);
  return data;
}

export async function sendPurchaseOrder(orderId: number, channel: "whatsapp" | "email"): Promise<PurchaseOrder> {
  const { data } = await apiClient.post<PurchaseOrder>(`/purchase-orders/${orderId}/send`, { channel });
  return data;
}

export async function receivePurchaseOrder(orderId: number): Promise<PurchaseOrder> {
  const { data } = await apiClient.post<PurchaseOrder>(`/purchase-orders/${orderId}/receive`);
  return data;
}
