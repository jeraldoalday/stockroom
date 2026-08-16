import { apiClient } from "./client";
import type { Category, Product, ProductListResponse } from "./types";

export interface ProductQuery {
  search?: string;
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
  categoryId?: string;
  costCents?: number;
  priceCents?: number;
  reorderPoint?: number;
  reorderQty?: number;
}

export async function createProduct(payload: CreateProductPayload): Promise<Product> {
  const res = await apiClient.post<Product>("/products", payload);
  return res.data;
}

export async function fetchCategories(): Promise<Category[]> {
  const res = await apiClient.get<Category[]>("/categories");
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
