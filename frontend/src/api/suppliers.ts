import { apiClient } from "./client";
import type { Supplier } from "../types";

export interface SupplierCreate {
  name: string;
  email?: string | null;
  phone?: string | null;
  category?: string | null;
  notes?: string | null;
}

export interface SupplierUpdate {
  name?: string;
  email?: string | null;
  phone?: string | null;
  category?: string | null;
  notes?: string | null;
  is_active?: boolean;
}

export async function fetchSuppliers(): Promise<Supplier[]> {
  const res = await apiClient.get<Supplier[]>("/suppliers");
  return res.data;
}

export async function createSupplier(data: SupplierCreate): Promise<Supplier> {
  const res = await apiClient.post<Supplier>("/suppliers", data);
  return res.data;
}

export async function updateSupplier(id: number, data: SupplierUpdate): Promise<Supplier> {
  const res = await apiClient.patch<Supplier>(`/suppliers/${id}`, data);
  return res.data;
}

export async function deleteSupplier(id: number): Promise<void> {
  await apiClient.delete(`/suppliers/${id}`);
}
