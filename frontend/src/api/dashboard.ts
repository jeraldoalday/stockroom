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
