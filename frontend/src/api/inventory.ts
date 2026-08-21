import { apiClient } from "./client";
import type { InventoryListResponse } from "./types";

export interface InventoryQuery {
  locationId?: string;
  productId?: string;
  page?: number;
  pageSize?: number;
}

export async function fetchInventory(query?: InventoryQuery): Promise<InventoryListResponse> {
  const res = await apiClient.get<InventoryListResponse>("/inventory", { params: query });
  return res.data;
}
