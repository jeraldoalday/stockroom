import { apiClient } from "./client";
import type { Customer, CustomerListResponse } from "./types";

export async function fetchCustomers(search?: string): Promise<CustomerListResponse> {
  const res = await apiClient.get<CustomerListResponse>("/customers", {
    params: search ? { search } : undefined,
  });
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
