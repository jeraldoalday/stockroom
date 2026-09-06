import { apiClient } from "./client";
import type { PurchaseOrder, PurchaseOrderListResponse, PurchaseOrderStatus } from "./types";

export interface PurchaseOrderQuery {
  status?: PurchaseOrderStatus;
  supplierId?: string;
  page?: number;
}

export async function fetchPurchaseOrders(query?: PurchaseOrderQuery): Promise<PurchaseOrderListResponse> {
  const res = await apiClient.get<PurchaseOrderListResponse>("/purchase-orders", { params: query });
  return res.data;
}

export async function fetchPurchaseOrder(id: string): Promise<PurchaseOrder> {
  const res = await apiClient.get<PurchaseOrder>(`/purchase-orders/${id}`);
  return res.data;
}

export interface PurchaseOrderLineInput {
  productId: string;
  quantityOrdered: number;
  unitCostCents: number;
}

export interface CreatePurchaseOrderPayload {
  supplierId: string;
  notes?: string;
  lines: PurchaseOrderLineInput[];
}

export async function createPurchaseOrder(payload: CreatePurchaseOrderPayload): Promise<PurchaseOrder> {
  const res = await apiClient.post<PurchaseOrder>("/purchase-orders", payload);
  return res.data;
}

export async function markPurchaseOrderOrdered(id: string): Promise<PurchaseOrder> {
  const res = await apiClient.post<PurchaseOrder>(`/purchase-orders/${id}/order`);
  return res.data;
}

export async function cancelPurchaseOrder(id: string): Promise<PurchaseOrder> {
  const res = await apiClient.post<PurchaseOrder>(`/purchase-orders/${id}/cancel`);
  return res.data;
}

export interface ReceivePurchaseOrderPayload {
  locationId: string;
  lines: { lineId: string; quantity: number }[];
}

export async function receivePurchaseOrder(id: string, payload: ReceivePurchaseOrderPayload): Promise<PurchaseOrder> {
  const res = await apiClient.post<PurchaseOrder>(`/purchase-orders/${id}/receive`, payload);
  return res.data;
}

export async function addPurchaseOrderLine(id: string, payload: PurchaseOrderLineInput): Promise<PurchaseOrder> {
  const res = await apiClient.post<PurchaseOrder>(`/purchase-orders/${id}/lines`, payload);
  return res.data;
}

export async function updatePurchaseOrderLine(
  id: string,
  lineId: string,
  payload: Partial<Pick<PurchaseOrderLineInput, "quantityOrdered" | "unitCostCents">>
): Promise<PurchaseOrder> {
  const res = await apiClient.patch<PurchaseOrder>(`/purchase-orders/${id}/lines/${lineId}`, payload);
  return res.data;
}

export async function removePurchaseOrderLine(id: string, lineId: string): Promise<PurchaseOrder> {
  const res = await apiClient.delete<PurchaseOrder>(`/purchase-orders/${id}/lines/${lineId}`);
  return res.data;
}
