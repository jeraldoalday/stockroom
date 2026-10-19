import { useId, useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "../components/AppShell";
import {
  archiveLocation,
  createLocation,
  fetchLocations,
  restoreLocation,
  updateLocation,
} from "../api/locations";
import type { LocationStatusFilter } from "../api/locations";
import { isApiError } from "../api/errors";
import { emptyListMessage } from "../components/emptyListMessage";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useConfirmation } from "../components/useConfirmation";
import type { Location } from "../api/types";

const STATUS_TABS: { value: LocationStatusFilter; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
  { value: "all", label: "All" },
];

function describeError(err: unknown, fallback: string): string {
  return isApiError(err) ? err.response?.data?.error ?? fallback : fallback;
}

export function LocationsPage() {
  // One stable prefix per mounted page, so every label points at its
  // own control even where two forms reuse a field name.
  const fieldId = useId();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<LocationStatusFilter>("active");
  // null = form closed; a Location = editing it; "new" = the create form.
  const [formTarget, setFormTarget] = useState<Location | "new" | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const editing = formTarget !== null && formTarget !== "new" ? formTarget : null;

  const locationsQuery = useQuery({
    queryKey: ["locations", status],
    queryFn: () => fetchLocations(status),
    placeholderData: (previous) => previous,
  });
  const pendingArchive = useConfirmation<Location>();

  function onSaved() {
    queryClient.invalidateQueries({ queryKey: ["locations"] });
    setFormTarget(null);
  }

  const createMutation = useMutation({
    mutationFn: createLocation,
    onSuccess: onSaved,
    onError: (err) => setFormError(describeError(err, "Could not create location")),
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, ...payload }: { id: string } & Parameters<typeof updateLocation>[1]) =>
      updateLocation(id, payload),
    onSuccess: onSaved,
    onError: (err) => setFormError(describeError(err, "Could not update location")),
  });

  const saving = createMutation.isPending || renameMutation.isPending;

  const setDefaultMutation = useMutation({
    mutationFn: (id: string) => updateLocation(id, { isDefault: true }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["locations"] }),
    onError: (err) => setRowError(describeError(err, "Could not update location")),
  });

  const archiveMutation = useMutation({
    mutationFn: archiveLocation,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["locations"] }),
    onError: (err) => setRowError(describeError(err, "Could not archive location")),
  });

  const restoreMutation = useMutation({
    mutationFn: restoreLocation,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["locations"] }),
    onError: (err) => setRowError(describeError(err, "Could not restore location")),
  });

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    const form = new FormData(e.currentTarget);
    const payload = {
      name: String(form.get("name")),
      address: String(form.get("address") || "") || undefined,
    };

    if (editing) {
      // isDefault is deliberately left out of an edit: it's managed by the
      // "Make default" action in the table, which only ever sends `true` —
      // sending an explicit `false` here for the current default could
      // clear it with nothing else proposed to take its place.
      renameMutation.mutate({ id: editing.id, ...payload });
    } else {
      createMutation.mutate({ ...payload, isDefault: form.get("isDefault") === "on" });
    }
  }

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Locations</h1>
        <button
          type="button"
          onClick={() => {
            setFormError(null);
            setFormTarget((current) => (current === null ? "new" : null));
          }}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          {formTarget !== null ? "Cancel" : "Add location"}
        </button>
      </div>

      {formTarget !== null && (
        <form
          // Remounts the form when switching between create and editing a
          // different location, so the uncontrolled inputs pick up new defaults.
          key={editing?.id ?? "new"}
          onSubmit={handleSubmit}
          className="mb-6 grid grid-cols-2 gap-4 rounded-lg border border-gray-200 bg-white p-4"
        >
          <div className="col-span-2 text-sm font-medium text-gray-900">
            {editing ? `Edit ${editing.name}` : "New location"}
          </div>
          {formError && <div role="alert" className="col-span-2 text-sm text-red-600">{formError}</div>}
          <div>
            <label htmlFor={`${fieldId}-name`} className="block text-sm font-medium text-gray-700">Name</label>
            <input
              id={`${fieldId}-name`}
              name="name"
              required
              defaultValue={editing?.name}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor={`${fieldId}-address`} className="block text-sm font-medium text-gray-700">Address</label>
            <input
              id={`${fieldId}-address`}
              name="address"
              defaultValue={editing?.address ?? ""}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          {!editing && (
            <div className="col-span-2 flex items-center gap-2">
              <input id="isDefault" name="isDefault" type="checkbox" className="rounded border-gray-300" />
              <label htmlFor="isDefault" className="text-sm text-gray-700">Set as default location</label>
            </div>
          )}
          <div className="col-span-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {saving ? "Saving..." : editing ? "Save changes" : "Save location"}
            </button>
          </div>
        </form>
      )}

      <div className="mb-4 flex w-fit gap-1 rounded-md border border-gray-200 bg-white p-1">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => {
              setRowError(null);
              setStatus(tab.value);
            }}
            className={`rounded px-3 py-1.5 text-sm font-medium ${
              status === tab.value ? "bg-brand-50 text-brand-700" : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {rowError && <div role="alert" className="mb-4 text-sm text-red-600">{rowError}</div>}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <caption className="sr-only">Locations</caption>
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-4 py-2 text-left font-medium text-gray-600">Name</th>
              <th scope="col" className="px-4 py-2 text-left font-medium text-gray-600">Address</th>
              <th scope="col" className="px-4 py-2 text-left font-medium text-gray-600">Default</th>
              <th scope="col" className="px-4 py-2 text-right font-medium text-gray-600">Actions</th>
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
                <td colSpan={4} role="alert" className="px-4 py-6 text-center text-red-600">Failed to load locations.</td>
              </tr>
            )}
            {locationsQuery.data?.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-gray-500">
                  {emptyListMessage({ noun: "locations", status })}
                </td>
              </tr>
            )}
            {locationsQuery.data?.map((location) => (
              <tr key={location.id} className={location.isActive ? undefined : "bg-gray-50"}>
                <td className="px-4 py-2">
                  {location.name}
                  {!location.isActive && (
                    <span className="ml-2 rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600">
                      Archived
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-gray-500">{location.address ?? "—"}</td>
                <td className="px-4 py-2">
                  {location.isDefault ? (
                    <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">Default</span>
                  ) : (
                    // An archived location can't be the default — the default
                    // is what every stock form proposes, and the API refuses
                    // to record stock against an archived one.
                    location.isActive && (
                      <button
                        type="button"
                        onClick={() => setDefaultMutation.mutate(location.id)}
                        className="text-xs text-brand-600 hover:underline"
                      >
                        Make default
                      </button>
                    )
                  )}
                </td>
                <td className="px-4 py-2 text-right">
                  {location.isActive ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setFormError(null);
                          setFormTarget(location);
                        }}
                        className="text-xs text-brand-600 hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRowError(null);
                          pendingArchive.request(location);
                        }}
                        className="ml-3 text-xs text-red-600 hover:underline"
                      >
                        Archive
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setRowError(null);
                        restoreMutation.mutate(location.id);
                      }}
                      className="text-xs text-brand-600 hover:underline"
                    >
                      Restore
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={pendingArchive.isOpen}
        title="Archive this location?"
        description={
          <>
            <strong>{pendingArchive.target?.name}</strong> will be hidden from every location
            picker and stop accepting stock. Its movement history is kept, and you can restore it
            from the Archived tab. A location that still holds stock, or that is the default, has
            to be emptied or replaced first.
          </>
        }
        confirmLabel="Archive location"
        busy={archiveMutation.isPending}
        onCancel={pendingArchive.cancel}
        onConfirm={() => pendingArchive.confirm((location) => archiveMutation.mutate(location.id))}
      />
    </AppShell>
  );
}
