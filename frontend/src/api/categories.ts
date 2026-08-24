import { apiClient } from "./client";
import type { Category } from "./types";

export type CategoryStatusFilter = "active" | "archived" | "all";

// Defaults to active, which is what every picker (the product form's
// category select) wants: an archived category shouldn't be assignable to a
// new product.
export async function fetchCategories(status: CategoryStatusFilter = "active"): Promise<Category[]> {
  const res = await apiClient.get<Category[]>("/categories", { params: { status } });
  return res.data;
}

export async function createCategory(name: string): Promise<Category> {
  const res = await apiClient.post<Category>("/categories", { name });
  return res.data;
}

export async function renameCategory(id: string, name: string): Promise<Category> {
  const res = await apiClient.patch<Category>(`/categories/${id}`, { name });
  return res.data;
}

// A soft delete server-side: products can still point at the record, so it
// is archived rather than removed, and can be restored.
export async function archiveCategory(id: string): Promise<void> {
  await apiClient.delete(`/categories/${id}`);
}

export async function restoreCategory(id: string): Promise<Category> {
  const res = await apiClient.post<Category>(`/categories/${id}/restore`);
  return res.data;
}
