import { useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "../components/AppShell";
import { useAuth } from "../context/AuthContext";
import {
  archiveProduct,
  createProduct,
  fetchProducts,
  importProductsCsv,
  restoreProduct,
} from "../api/products";
import type { ImportProductsResult, ProductStatusFilter } from "../api/products";
import { isApiError } from "../api/errors";
import { ConfirmDialog, useConfirmation } from "../components/ConfirmDialog";
import type { Product } from "../api/types";

const STATUS_TABS: { value: ProductStatusFilter; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
  { value: "all", label: "All" },
];

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });
}

export function ProductsPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isOwner = user?.role === "OWNER";
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ProductStatusFilter>("active");
  const [rowError, setRowError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportProductsResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const productsQuery = useQuery({
    queryKey: ["products", search, status],
    queryFn: () => fetchProducts({ search: search || undefined, status }),
  });

  const pendingArchive = useConfirmation<Product>();

  function rowErrorFrom(err: unknown, fallback: string) {
    return isApiError(err) ? err.response?.data?.error ?? fallback : fallback;
  }

  const archiveMutation = useMutation({
    mutationFn: archiveProduct,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["products"] }),
    onError: (err) => setRowError(rowErrorFrom(err, "Could not archive product")),
  });

  const restoreMutation = useMutation({
    mutationFn: restoreProduct,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["products"] }),
    onError: (err) => setRowError(rowErrorFrom(err, "Could not restore product")),
  });

  const createMutation = useMutation({
    mutationFn: createProduct,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      setShowForm(false);
    },
    onError: (err) => {
      setFormError(isApiError(err) ? err.response?.data?.error ?? "Could not create product" : "Could not create product");
    },
  });

  function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    const form = new FormData(e.currentTarget);
    createMutation.mutate({
      sku: String(form.get("sku")),
      name: String(form.get("name")),
      priceCents: Math.round(Number(form.get("price")) * 100) || 0,
      costCents: Math.round(Number(form.get("cost")) * 100) || 0,
      reorderPoint: Number(form.get("reorderPoint")) || 0,
    });
  }

  async function handleImport(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError(null);
    setImportResult(null);
    setImporting(true);
    try {
      const text = await file.text();
      const result = await importProductsCsv(text);
      setImportResult(result);
      queryClient.invalidateQueries({ queryKey: ["products"] });
    } catch (err) {
      setImportError(isApiError(err) ? err.response?.data?.error ?? "Could not import CSV" : "Could not import CSV");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Products</h1>
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={handleImport}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="rounded-md border border-brand-600 px-4 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-50"
          >
            {importing ? "Importing..." : "Import CSV"}
          </button>
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            {showForm ? "Cancel" : "Add product"}
          </button>
        </div>
      </div>

      {importError && <div className="mb-4 text-sm text-red-600">{importError}</div>}
      {importResult && (
        <div className="mb-4 rounded-md border border-gray-200 bg-white p-3 text-sm">
          <div className="text-gray-700">
            Imported: {importResult.created} created, {importResult.updated} updated
            {importResult.errors.length > 0 ? `, ${importResult.errors.length} row(s) skipped` : ""}.
          </div>
          {importResult.errors.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-red-600">
              {importResult.errors.map((err) => (
                <li key={err.row}>Row {err.row}: {err.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {showForm && (
        <form onSubmit={handleCreate} className="mb-6 grid grid-cols-2 gap-4 rounded-lg border border-gray-200 bg-white p-4">
          {formError && <div className="col-span-2 text-sm text-red-600">{formError}</div>}
          <div>
            <label className="block text-sm font-medium text-gray-700">SKU</label>
            <input name="sku" required className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Name</label>
            <input name="name" required className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Price ($)</label>
            <input name="price" type="number" step="0.01" min="0" className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
          </div>
          {isOwner && (
            <div>
              <label className="block text-sm font-medium text-gray-700">Cost ($)</label>
              <input name="cost" type="number" step="0.01" min="0" className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700">Reorder point</label>
            <input name="reorderPoint" type="number" min="0" className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
          </div>
          <div className="col-span-2">
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {createMutation.isPending ? "Saving..." : "Save product"}
            </button>
          </div>
        </form>
      )}

      {rowError && <div className="mb-4 text-sm text-red-600">{rowError}</div>}

      <div className="mb-4 flex gap-1 rounded-md border border-gray-200 bg-white p-1 w-fit">
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

      <input
        placeholder="Search by name or SKU..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-4 w-full max-w-sm rounded-md border border-gray-300 px-3 py-2 text-sm"
      />

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-gray-600">SKU</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Name</th>
              <th className="px-4 py-2 text-right font-medium text-gray-600">Price</th>
              <th className="px-4 py-2 text-right font-medium text-gray-600">Reorder point</th>
              <th className="px-4 py-2 text-right font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {productsQuery.isLoading && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-500">Loading...</td>
              </tr>
            )}
            {productsQuery.isError && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-red-600">Failed to load products.</td>
              </tr>
            )}
            {productsQuery.data?.items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-500">No products yet.</td>
              </tr>
            )}
            {productsQuery.data?.items.map((product) => (
              <tr key={product.id} className={product.isActive ? undefined : "bg-gray-50 text-gray-500"}>
                <td className="px-4 py-2 font-mono text-xs">{product.sku}</td>
                <td className="px-4 py-2">
                  {product.name}
                  {!product.isActive && (
                    <span className="ml-2 rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600">
                      Archived
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-right">{formatCents(product.priceCents)}</td>
                <td className="px-4 py-2 text-right">{product.reorderPoint}</td>
                <td className="px-4 py-2 text-right">
                  {product.isActive ? (
                    <button
                      type="button"
                      onClick={() => {
                        setRowError(null);
                        pendingArchive.request(product);
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
                        restoreMutation.mutate(product.id);
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
        title="Archive this product?"
        description={
          <>
            <strong>{pendingArchive.target?.name}</strong> ({pendingArchive.target?.sku}) will be
            hidden from the catalogue, orders and reports. Its stock movement history is kept, and
            you can restore it from the Archived tab at any time. Products on an open purchase or
            sales order can't be archived.
          </>
        }
        confirmLabel="Archive product"
        busy={archiveMutation.isPending}
        onCancel={pendingArchive.cancel}
        onConfirm={() => pendingArchive.confirm((product) => archiveMutation.mutate(product.id))}
      />
    </AppShell>
  );
}
