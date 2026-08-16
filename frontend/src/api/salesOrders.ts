import { apiClient } from "./client";
import type { SalesOrder, SalesOrderListResponse, SalesOrderStatus } from "./types";

export interface SalesOrderQuery {
  status?: SalesOrderStatus;
  customerId?: string;
  locationId?: string;
  page?: number;
}

export async function fetchSalesOrders(query?: SalesOrderQuery): Promise<SalesOrderListResponse> {
  const res = await apiClient.get<SalesOrderListResponse>("/sales-orders", { params: query });
  return res.data;
}

export async function fetchSalesOrder(id: string): Promise<SalesOrder> {
  const res = await apiClient.get<SalesOrder>(`/sales-orders/${id}`);
  return res.data;
}

export interface SalesOrderLineInput {
  productId: string;
  quantity: number;
  unitPriceCents: number;
}

export interface CreateSalesOrderPayload {
  customerId?: string | null;
  locationId: string;
  notes?: string;
  lines: SalesOrderLineInput[];
}

export async function createSalesOrder(payload: CreateSalesOrderPayload): Promise<SalesOrder> {
  const res = await apiClient.post<SalesOrder>("/sales-orders", payload);
  return res.data;
}

export async function cancelSalesOrder(id: string): Promise<SalesOrder> {
  const res = await apiClient.post<SalesOrder>(`/sales-orders/${id}/cancel`);
  return res.data;
}

export async function fulfillSalesOrder(id: string): Promise<SalesOrder> {
  const res = await apiClient.post<SalesOrder>(`/sales-orders/${id}/fulfill`);
  return res.data;
}
