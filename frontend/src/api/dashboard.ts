import { apiClient } from "./client";
import type { DashboardSummary, LowStockResponse } from "./types";

export async function fetchDashboardSummary(): Promise<DashboardSummary> {
  const res = await apiClient.get<DashboardSummary>("/dashboard/summary");
  return res.data;
}

export async function fetchLowStock(): Promise<LowStockResponse> {
  const res = await apiClient.get<LowStockResponse>("/dashboard/low-stock");
  return res.data;
}

export interface TopMover {
  productId: string;
  sku: string;
  name: string;
  isActive: boolean;
  unitsSold: number;
  /** Units valued at the product's current list price — an approximation,
   * not booked revenue. The trend report on the Reports screen reads the
   * prices actually charged on sales order lines. */
  estimatedValueCents: number;
}

export interface TopMoversResponse {
  days: number;
  items: TopMover[];
}

export async function fetchTopMovers(days = 30, limit = 5): Promise<TopMoversResponse> {
  const res = await apiClient.get<TopMoversResponse>("/dashboard/top-movers", {
    params: { days, limit },
  });
  return res.data;
}
