import { apiClient } from "./client";
import type { Location } from "./types";

export async function fetchLocations(): Promise<Location[]> {
  const res = await apiClient.get<Location[]>("/locations");
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

export async function deleteLocation(id: string): Promise<void> {
  await apiClient.delete(`/locations/${id}`);
}
