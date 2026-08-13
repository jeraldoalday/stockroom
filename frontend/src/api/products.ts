import { apiClient } from "./client";
import type { Category, Product, ProductListResponse } from "./types";

export async function fetchProducts(search?: string): Promise<ProductListResponse> {
  const res = await apiClient.get<ProductListResponse>("/products", {
    params: search ? { search } : undefined,
  });
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
