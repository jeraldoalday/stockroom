import { apiClient } from "./client";
import type { MovementType, StockMovement, StockMovementListResponse } from "./types";

export interface StockMovementQuery {
  productId?: string;
  locationId?: string;
  type?: MovementType;
  page?: number;
}

export async function fetchStockMovements(query?: StockMovementQuery): Promise<StockMovementListResponse> {
  const res = await apiClient.get<StockMovementListResponse>("/stock-movements", { params: query });
  return res.data;
}

export interface CreateMovementPayload {
  productId: string;
  locationId: string;
  type: "RECEIVE" | "SALE" | "ADJUSTMENT";
  quantity: number;
  reason?: string;
}

export async function createStockMovement(payload: CreateMovementPayload): Promise<StockMovement> {
  const res = await apiClient.post<StockMovement>("/stock-movements", payload);
  return res.data;
}

export interface TransferPayload {
  productId: string;
  fromLocationId: string;
  toLocationId: string;
  quantity: number;
  reason?: string;
}

export async function transferStock(payload: TransferPayload): Promise<{ out: StockMovement; in: StockMovement }> {
  const res = await apiClient.post<{ out: StockMovement; in: StockMovement }>("/stock-movements/transfer", payload);
  return res.data;
}
