import { apiClient } from "./client";
import type { Customer, CustomerListResponse } from "./types";

export type CustomerStatusFilter = "active" | "archived" | "all";

export interface CustomerQuery {
  search?: string;
  status?: CustomerStatusFilter;
  page?: number;
  pageSize?: number;
}

export async function fetchCustomers(query?: string | CustomerQuery): Promise<CustomerListResponse> {
  const params = typeof query === "string" ? (query ? { search: query } : undefined) : query;
  const res = await apiClient.get<CustomerListResponse>("/customers", { params });
  return res.data;
}

export interface CustomerPayload {
  name: string;
  email?: string | null;
  phone?: string | null;
}

export async function createCustomer(payload: CustomerPayload): Promise<Customer> {
  const res = await apiClient.post<Customer>("/customers", payload);
  return res.data;
}

export async function updateCustomer(id: string, payload: Partial<CustomerPayload>): Promise<Customer> {
  const res = await apiClient.patch<Customer>(`/customers/${id}`, payload);
  return res.data;
}

// A soft delete server-side: order history points at the record, so it is
// archived rather than removed, and can be restored.
export async function archiveCustomer(id: string): Promise<void> {
  await apiClient.delete(`/customers/${id}`);
}

export async function restoreCustomer(id: string): Promise<Customer> {
  const res = await apiClient.post<Customer>(`/customers/${id}/restore`);
  return res.data;
}
