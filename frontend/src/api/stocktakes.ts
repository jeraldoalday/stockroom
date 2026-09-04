import { apiClient } from "./client";
import type {
  Stocktake,
  StocktakeHistoryResponse,
  StocktakeListResponse,
  StocktakeScope,
  StocktakeStatus,
} from "./types";

export interface StocktakeQuery {
  status?: StocktakeStatus;
  locationId?: string;
  page?: number;
}

export async function fetchStocktakes(query?: StocktakeQuery): Promise<StocktakeListResponse> {
  const res = await apiClient.get<StocktakeListResponse>("/stocktakes", { params: query });
  return res.data;
}

export async function fetchStocktake(id: string): Promise<Stocktake> {
  const res = await apiClient.get<Stocktake>(`/stocktakes/${id}`);
  return res.data;
}

export interface CreateStocktakePayload {
  locationId: string;
  scope?: StocktakeScope;
  notes?: string;
}

export async function createStocktake(payload: CreateStocktakePayload): Promise<Stocktake> {
  const res = await apiClient.post<Stocktake>("/stocktakes", payload);
  return res.data;
}

/**
 * Records (or, with `null`, un-records) a counted figure for one line.
 *
 * `null` is not the same as `0`: it puts the line back to never-counted, so
 * completing the sheet leaves that product's stock untouched rather than
 * writing it down to empty.
 */
export async function countStocktakeLine(
  id: string,
  lineId: string,
  countedQty: number | null
): Promise<Stocktake> {
  const res = await apiClient.patch<Stocktake>(`/stocktakes/${id}/lines/${lineId}`, { countedQty });
  return res.data;
}

export async function addStocktakeLine(id: string, productId: string): Promise<Stocktake> {
  const res = await apiClient.post<Stocktake>(`/stocktakes/${id}/lines`, { productId });
  return res.data;
}

export async function completeStocktake(id: string): Promise<Stocktake> {
  const res = await apiClient.post<Stocktake>(`/stocktakes/${id}/complete`);
  return res.data;
}

export async function cancelStocktake(id: string): Promise<Stocktake> {
  const res = await apiClient.post<Stocktake>(`/stocktakes/${id}/cancel`);
  return res.data;
}

/** "When was this product last counted, and what did the count find" — used by ProductsPage's history panel. */
export async function fetchStocktakeHistory(productId: string, page = 1): Promise<StocktakeHistoryResponse> {
  const res = await apiClient.get<StocktakeHistoryResponse>("/stocktakes/history", { params: { productId, page } });
  return res.data;
}

// Same blob-download shape as api/reports.ts's downloadExport: the auth
// header can't ride on a plain <a href>, so the file is fetched through the
// normal axios instance and handed to the browser as a blob URL. The
// filename here comes from the server's Content-Disposition (built from the
// location and date, e.g. "stocktake-main-warehouse-2026-09-03.csv") rather
// than a fixed one, since "stocktake.csv" would collide across sheets.
export async function downloadStocktakeExport(id: string): Promise<void> {
  const res = await apiClient.get(`/stocktakes/${id}/export`, { responseType: "blob" });
  const disposition = String(res.headers["content-disposition"] ?? "");
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `stocktake-${id}.csv`;

  const url = window.URL.createObjectURL(new Blob([res.data]));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}
