import { useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "../components/AppShell";
import { createLocation, deleteLocation, fetchLocations, updateLocation } from "../api/locations";
import { isApiError } from "../api/errors";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useConfirmation } from "../components/useConfirmation";
import type { Location } from "../api/types";

export function LocationsPage() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const locationsQuery = useQuery({ queryKey: ["locations"], queryFn: fetchLocations });
  const pendingDelete = useConfirmation<Location>();

  const createMutation = useMutation({
    mutationFn: createLocation,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["locations"] });
      setShowForm(false);
    },
    onError: (err) => {
      setFormError(isApiError(err) ? err.response?.data?.error ?? "Could not create location" : "Could not create location");
    },
  });

  const setDefaultMutation = useMutation({
    mutationFn: (id: string) => updateLocation(id, { isDefault: true }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["locations"] }),
    onError: (err) => {
      setRowError(isApiError(err) ? err.response?.data?.error ?? "Could not update location" : "Could not update location");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteLocation,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["locations"] }),
    onError: (err) => {
      setRowError(isApiError(err) ? err.response?.data?.error ?? "Could not delete location" : "Could not delete location");
    },
  });

  function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    const form = new FormData(e.currentTarget);
    createMutation.mutate({
      name: String(form.get("name")),
      address: String(form.get("address") || "") || undefined,
      isDefault: form.get("isDefault") === "on",
    });
  }

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Locations</h1>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          {showForm ? "Cancel" : "Add location"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="mb-6 grid grid-cols-2 gap-4 rounded-lg border border-gray-200 bg-white p-4">
          {formError && <div className="col-span-2 text-sm text-red-600">{formError}</div>}
          <div>
            <label className="block text-sm font-medium text-gray-700">Name</label>
            <input name="name" required className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Address</label>
            <input name="address" className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
          </div>
          <div className="col-span-2 flex items-center gap-2">
            <input id="isDefault" name="isDefault" type="checkbox" className="rounded border-gray-300" />
            <label htmlFor="isDefault" className="text-sm text-gray-700">Set as default location</label>
          </div>
          <div className="col-span-2">
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {createMutation.isPending ? "Saving..." : "Save location"}
            </button>
          </div>
        </form>
      )}

      {rowError && <div className="mb-4 text-sm text-red-600">{rowError}</div>}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Name</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Address</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Default</th>
              <th className="px-4 py-2 text-right font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {locationsQuery.isLoading && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-gray-500">Loading...</td>
              </tr>
            )}
            {locationsQuery.isError && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-red-600">Failed to load locations.</td>
              </tr>
            )}
            {locationsQuery.data?.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-gray-500">No locations yet.</td>
              </tr>
            )}
            {locationsQuery.data?.map((location) => (
              <tr key={location.id}>
                <td className="px-4 py-2">{location.name}</td>
                <td className="px-4 py-2 text-gray-500">{location.address ?? "—"}</td>
                <td className="px-4 py-2">
                  {location.isDefault ? (
                    <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">Default</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setDefaultMutation.mutate(location.id)}
                      className="text-xs text-brand-600 hover:underline"
                    >
                      Make default
                    </button>
                  )}
                </td>
                <td className="px-4 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => {
                      setRowError(null);
                      pendingDelete.request(location);
                    }}
                    className="text-xs text-red-600 hover:underline"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={pendingDelete.isOpen}
        title="Delete this location?"
        description={
          <>
            <strong>{pendingDelete.target?.name}</strong> will be removed permanently. Locations
            that still hold stock, or that are set as the default, can't be deleted.
          </>
        }
        confirmLabel="Delete location"
        busy={deleteMutation.isPending}
        onCancel={pendingDelete.cancel}
        onConfirm={() => pendingDelete.confirm((location) => deleteMutation.mutate(location.id))}
      />
    </AppShell>
  );
}
