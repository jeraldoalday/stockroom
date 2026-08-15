import { apiClient } from "./client";
import type { Supplier, SupplierListResponse } from "./types";

export async function fetchSuppliers(search?: string): Promise<SupplierListResponse> {
  const res = await apiClient.get<SupplierListResponse>("/suppliers", {
    params: search ? { search } : undefined,
  });
  return res.data;
}

export interface SupplierPayload {
  name: string;
  email?: string | null;
  phone?: string | null;
}

export async function createSupplier(payload: SupplierPayload): Promise<Supplier> {
  const res = await apiClient.post<Supplier>("/suppliers", payload);
  return res.data;
}

export async function updateSupplier(id: string, payload: Partial<SupplierPayload>): Promise<Supplier> {
  const res = await apiClient.patch<Supplier>(`/suppliers/${id}`, payload);
  return res.data;
}

export async function deleteSupplier(id: string): Promise<void> {
  await apiClient.delete(`/suppliers/${id}`);
}
