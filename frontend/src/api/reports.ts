import { apiClient } from "./client";

export interface TrendPoint {
  date: string;
  unitsSold: number;
  unitsReceived: number;
  revenueCents: number;
}

export interface TrendTotals {
  unitsSold: number;
  unitsReceived: number;
  revenueCents: number;
}

export interface TrendResponse {
  days: number;
  series: TrendPoint[];
  totals: TrendTotals;
}

export async function fetchTrend(days: 7 | 30): Promise<TrendResponse> {
  const res = await apiClient.get<TrendResponse>("/reports/trend", { params: { days } });
  return res.data;
}

export interface ReorderSuggestion {
  productId: string;
  sku: string;
  name: string;
  currentStock: number;
  reorderPoint: number;
  reorderQty: number;
  avgDailyDemand: number;
  daysOfStockRemaining: number | null;
  suggestedQty: number;
}

export interface ReorderSuggestionsResponse {
  days: number;
  coverageDays: number;
  items: ReorderSuggestion[];
}

export async function fetchReorderSuggestions(): Promise<ReorderSuggestionsResponse> {
  const res = await apiClient.get<ReorderSuggestionsResponse>("/reports/reorder-suggestions");
  return res.data;
}

export interface DeadStockItem {
  productId: string;
  sku: string;
  name: string;
  quantityOnHand: number;
  costCents: number;
  tiedUpValueCents: number;
  /** Null when the product has never sold at all. */
  lastSoldAt: string | null;
  daysSinceLastSale: number | null;
}

export interface DeadStockResponse {
  days: number;
  items: DeadStockItem[];
  totals: { productCount: number; tiedUpValueCents: number };
}

// Owner-only server-side: every column is a cost figure, so there is no
// meaningful Staff view of this report.
export async function fetchDeadStock(days: number): Promise<DeadStockResponse> {
  const res = await apiClient.get<DeadStockResponse>("/reports/dead-stock", { params: { days } });
  return res.data;
}

export type ExportKind = "products" | "stock" | "movements";

// Downloads share the same axios instance (and its auth interceptor) as
// every other API call, then hand the browser the file as a blob URL —
// a plain <a href="/api/..."> wouldn't carry the Authorization header.
export async function downloadExport(kind: ExportKind, params?: { days?: number }): Promise<void> {
  const res = await apiClient.get(`/reports/export/${kind}`, { params, responseType: "blob" });
  const url = window.URL.createObjectURL(new Blob([res.data]));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${kind}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}
