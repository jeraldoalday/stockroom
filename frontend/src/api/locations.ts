import { apiClient } from "./client";
import type { Location } from "./types";

export type LocationStatusFilter = "active" | "archived" | "all";

// Defaults to active, which is what every picker in the app wants: an
// archived location cannot receive stock, so offering one would only ever
// produce a rejected form.
export async function fetchLocations(status: LocationStatusFilter = "active"): Promise<Location[]> {
  const res = await apiClient.get<Location[]>("/locations", { params: { status } });
  return res.data;
}

export interface LocationPayload {
  name: string;
  address?: string;
  isDefault?: boolean;
}

export async function createLocation(payload: LocationPayload): Promise<Location> {
  const res = await apiClient.post<Location>("/locations", payload);
  return res.data;
}

export async function updateLocation(id: string, payload: Partial<LocationPayload>): Promise<Location> {
  const res = await apiClient.patch<Location>(`/locations/${id}`, payload);
  return res.data;
}

// A soft delete server-side: inventory rows, movements and sales orders all
// point at the location, so it is archived rather than removed.
export async function archiveLocation(id: string): Promise<void> {
  await apiClient.delete(`/locations/${id}`);
}

export async function restoreLocation(id: string): Promise<Location> {
  const res = await apiClient.post<Location>(`/locations/${id}/restore`);
  return res.data;
}
