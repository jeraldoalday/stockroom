import { apiClient } from "./client";
import type { Customer, CustomerListResponse } from "./types";

export interface CustomerQuery {
  search?: string;
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

export async function deleteCustomer(id: string): Promise<void> {
  await apiClient.delete(`/customers/${id}`);
}
