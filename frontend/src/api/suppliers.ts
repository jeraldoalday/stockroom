import { apiClient } from "./client";
import type { Supplier, SupplierListResponse } from "./types";

export type SupplierStatusFilter = "active" | "archived" | "all";

export interface SupplierQuery {
  search?: string;
  status?: SupplierStatusFilter;
  page?: number;
  pageSize?: number;
}

export async function fetchSuppliers(query?: string | SupplierQuery): Promise<SupplierListResponse> {
  const params = typeof query === "string" ? (query ? { search: query } : undefined) : query;
  const res = await apiClient.get<SupplierListResponse>("/suppliers", { params });
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

// A soft delete server-side: order history points at the record, so it is
// archived rather than removed, and can be restored.
export async function archiveSupplier(id: string): Promise<void> {
  await apiClient.delete(`/suppliers/${id}`);
}

export async function restoreSupplier(id: string): Promise<Supplier> {
  const res = await apiClient.post<Supplier>(`/suppliers/${id}/restore`);
  return res.data;
}
