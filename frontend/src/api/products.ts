import { apiClient } from "./client";
import type { Product, ProductListResponse } from "./types";

export type ProductStatusFilter = "active" | "archived" | "all";

export interface ProductQuery {
  search?: string;
  status?: ProductStatusFilter;
  pageSize?: number;
}

export async function fetchProducts(query?: string | ProductQuery): Promise<ProductListResponse> {
  const params = typeof query === "string" ? (query ? { search: query } : undefined) : query;
  const res = await apiClient.get<ProductListResponse>("/products", { params });
  return res.data;
}

export interface CreateProductPayload {
  sku: string;
  name: string;
  categoryId?: string | null;
  costCents?: number;
  priceCents?: number;
  reorderPoint?: number;
  reorderQty?: number;
}

export async function createProduct(payload: CreateProductPayload): Promise<Product> {
  const res = await apiClient.post<Product>("/products", payload);
  return res.data;
}

export type UpdateProductPayload = Partial<CreateProductPayload>;

export async function updateProduct(id: string, payload: UpdateProductPayload): Promise<Product> {
  const res = await apiClient.patch<Product>(`/products/${id}`, payload);
  return res.data;
}

export interface ImportProductsResult {
  created: number;
  updated: number;
  errors: { row: number; message: string }[];
}

export async function importProductsCsv(csvText: string): Promise<ImportProductsResult> {
  const res = await apiClient.post<ImportProductsResult>("/products/import", csvText, {
    headers: { "Content-Type": "text/csv" },
  });
  return res.data;
}

// DELETE is a soft delete server-side (the SKU stays referenced by
// historical movements and order lines), so the UI calls it "archive"
// rather than "delete" — there is a way back.
export async function archiveProduct(id: string): Promise<void> {
  await apiClient.delete(`/products/${id}`);
}

export async function restoreProduct(id: string): Promise<Product> {
  const res = await apiClient.post<Product>(`/products/${id}/restore`);
  return res.data;
}
