import { useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "../components/AppShell";
import { createSupplier, deleteSupplier, fetchSuppliers } from "../api/suppliers";
import { isApiError } from "../api/errors";

export function SuppliersPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const suppliersQuery = useQuery({
    queryKey: ["suppliers", search],
    queryFn: () => fetchSuppliers(search || undefined),
  });

  const createMutation = useMutation({
    mutationFn: createSupplier,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      setShowForm(false);
    },
    onError: (err) => {
      setFormError(isApiError(err) ? err.response?.data?.error ?? "Could not create supplier" : "Could not create supplier");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteSupplier,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["suppliers"] }),
    onError: (err) => {
      setRowError(isApiError(err) ? err.response?.data?.error ?? "Could not delete supplier" : "Could not delete supplier");
    },
  });

  function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    const form = new FormData(e.currentTarget);
    createMutation.mutate({
      name: String(form.get("name")),
      email: String(form.get("email") || "") || undefined,
      phone: String(form.get("phone") || "") || undefined,
    });
  }

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Suppliers</h1>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          {showForm ? "Cancel" : "Add supplier"}
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
            <label className="block text-sm font-medium text-gray-700">Email</label>
            <input name="email" type="email" className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Phone</label>
            <input name="phone" className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
          </div>
          <div className="col-span-2">
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {createMutation.isPending ? "Saving..." : "Save supplier"}
            </button>
          </div>
        </form>
      )}

      <input
        placeholder="Search by name..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-4 w-full max-w-sm rounded-md border border-gray-300 px-3 py-2 text-sm"
      />

      {rowError && <div className="mb-4 text-sm text-red-600">{rowError}</div>}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Name</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Email</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Phone</th>
              <th className="px-4 py-2 text-right font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {suppliersQuery.isLoading && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-gray-500">Loading...</td>
              </tr>
            )}
            {suppliersQuery.isError && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-red-600">Failed to load suppliers.</td>
              </tr>
            )}
            {suppliersQuery.data?.items.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-gray-500">No suppliers yet.</td>
              </tr>
            )}
            {suppliersQuery.data?.items.map((supplier) => (
              <tr key={supplier.id}>
                <td className="px-4 py-2">{supplier.name}</td>
                <td className="px-4 py-2 text-gray-500">{supplier.email ?? "—"}</td>
                <td className="px-4 py-2 text-gray-500">{supplier.phone ?? "—"}</td>
                <td className="px-4 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`Delete supplier "${supplier.name}"? This cannot be undone.`)) {
                        deleteMutation.mutate(supplier.id);
                      }
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
    </AppShell>
  );
}
