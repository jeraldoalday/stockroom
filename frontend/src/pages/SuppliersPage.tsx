import { useId, useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "../components/AppShell";
import { archiveSupplier, createSupplier, fetchSuppliers, restoreSupplier } from "../api/suppliers";
import { isApiError } from "../api/errors";
import { emptyListMessage } from "../components/emptyListMessage";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useConfirmation } from "../components/useConfirmation";
import { useDebouncedValue } from "../components/useDebouncedValue";
import { Pagination } from "../components/Pagination";
import type { Supplier } from "../api/types";
import type { SupplierStatusFilter } from "../api/suppliers";

const PAGE_SIZE = 25;

const STATUS_TABS: { value: SupplierStatusFilter; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
  { value: "all", label: "All" },
];

export function SuppliersPage() {
  // One stable prefix per mounted page, so every label points at its
  // own control even where two forms reuse a field name.
  const fieldId = useId();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  // Controlled by `search` for instant typing, keyed on the settled value
  // so a typed word costs one request rather than one per keystroke.
  const debouncedSearch = useDebouncedValue(search);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<SupplierStatusFilter>("active");
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const suppliersQuery = useQuery({
    queryKey: ["suppliers", debouncedSearch, status, page],
    queryFn: () => fetchSuppliers({ page, pageSize: PAGE_SIZE, status, ...(debouncedSearch ? { search: debouncedSearch } : {}) }),
    placeholderData: (previous) => previous,
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

  const pendingArchive = useConfirmation<Supplier>();

  const archiveMutation = useMutation({
    mutationFn: archiveSupplier,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["suppliers"] }),
    onError: (err) => {
      setRowError(isApiError(err) ? err.response?.data?.error ?? "Could not archive supplier" : "Could not archive supplier");
    },
  });

  const restoreMutation = useMutation({
    mutationFn: restoreSupplier,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["suppliers"] }),
    onError: (err) => {
      setRowError(isApiError(err) ? err.response?.data?.error ?? "Could not restore supplier" : "Could not restore supplier");
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
            <label htmlFor={`${fieldId}-name`} className="block text-sm font-medium text-gray-700">Name</label>
            <input id={`${fieldId}-name`} name="name" required className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label htmlFor={`${fieldId}-email`} className="block text-sm font-medium text-gray-700">Email</label>
            <input id={`${fieldId}-email`} name="email" type="email" className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label htmlFor={`${fieldId}-phone`} className="block text-sm font-medium text-gray-700">Phone</label>
            <input id={`${fieldId}-phone`} name="phone" className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
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

      <div className="mb-4 flex gap-1 rounded-md border border-gray-200 bg-white p-1 w-fit">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => {
              setRowError(null);
              setStatus(tab.value);
              setPage(1);
            }}
            className={`rounded px-3 py-1.5 text-sm font-medium ${
              status === tab.value ? "bg-brand-50 text-brand-700" : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <input
        placeholder="Search by name..."
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(1);
        }}
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
                <td colSpan={4} className="px-4 py-6 text-center text-gray-500">{emptyListMessage({ noun: "suppliers", status, search: debouncedSearch })}</td>
              </tr>
            )}
            {suppliersQuery.data?.items.map((supplier) => (
              <tr key={supplier.id} className={supplier.isActive ? undefined : "bg-gray-50 text-gray-500"}>
                <td className="px-4 py-2">
                  {supplier.name}
                  {!supplier.isActive && (
                    <span className="ml-2 rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600">
                      Archived
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-gray-500">{supplier.email ?? "—"}</td>
                <td className="px-4 py-2 text-gray-500">{supplier.phone ?? "—"}</td>
                <td className="px-4 py-2 text-right">
                  {supplier.isActive ? (
                    <button
                      type="button"
                      onClick={() => {
                        setRowError(null);
                        pendingArchive.request(supplier);
                      }}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Archive
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setRowError(null);
                        restoreMutation.mutate(supplier.id);
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

      <Pagination
        page={suppliersQuery.data?.page ?? page}
        pageSize={suppliersQuery.data?.pageSize ?? PAGE_SIZE}
        total={suppliersQuery.data?.total ?? 0}
        onPageChange={setPage}
        label="suppliers"
      />

      <ConfirmDialog
        open={pendingArchive.isOpen}
        title="Archive this supplier?"
        description={
          <>
            <strong>{pendingArchive.target?.name}</strong> will be hidden from lists and from
            the new-order dropdowns. Their purchase orders are kept, and you can restore them
            from the Archived tab at any time.
          </>
        }
        confirmLabel="Archive supplier"
        busy={archiveMutation.isPending}
        onCancel={pendingArchive.cancel}
        onConfirm={() => pendingArchive.confirm((supplier) => archiveMutation.mutate(supplier.id))}
      />
    </AppShell>
  );
}
