import { Fragment, useId, useRef, useState } from "react";
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
  updateProduct,
} from "../api/products";
import type { ImportProductsResult, ProductStatusFilter } from "../api/products";
import { createCategory, fetchCategories } from "../api/categories";
import { fetchStocktakeHistory } from "../api/stocktakes";
import type { Product } from "../api/types";
import { isApiError } from "../api/errors";
import { emptyListMessage } from "../components/emptyListMessage";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useConfirmation } from "../components/useConfirmation";
import { useDebouncedValue } from "../components/useDebouncedValue";
import { Pagination } from "../components/Pagination";

const PAGE_SIZE = 25;

const STATUS_TABS: { value: ProductStatusFilter; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
  { value: "all", label: "All" },
];

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function centsToInput(cents: number | undefined): string | undefined {
  return cents === undefined ? undefined : (cents / 100).toFixed(2);
}

/**
 * "When was this last counted, and what did the count find" — answerable
 * from the stocktake data since Day 30, but nowhere on the product screen
 * until now. Only counted lines ever show up here (see /stocktakes/history
 * on the backend); a product that has never been on a finished count shows
 * the empty state below rather than an uncounted row that would say nothing.
 */
function ProductHistoryPanel({ productId }: { productId: string }) {
  const [page, setPage] = useState(1);
  const historyQuery = useQuery({
    queryKey: ["stocktake-history", productId, page],
    queryFn: () => fetchStocktakeHistory(productId, page),
  });

  if (historyQuery.isLoading) {
    return <div className="px-4 py-3 text-xs text-gray-500">Loading count history...</div>;
  }
  if (historyQuery.isError || !historyQuery.data) {
    return (
      <div role="alert" className="px-4 py-3 text-xs text-red-600">
        Failed to load count history.
      </div>
    );
  }

  const items = historyQuery.data.items;
  if (items.length === 0) {
    return (
      <div className="px-4 py-3 text-xs text-gray-500">
        This product has never been on a counted stocktake line.
      </div>
    );
  }

  return (
    <div className="space-y-3 px-4 py-3">
      <table className="min-w-full text-xs">
        <caption className="sr-only">Stocktake count history</caption>
        <thead>
          <tr className="text-gray-500">
            <th scope="col" className="py-1 text-left">Counted</th>
            <th scope="col" className="py-1 text-left">Location</th>
            <th scope="col" className="py-1 text-right">Expected</th>
            <th scope="col" className="py-1 text-right">Counted qty</th>
            <th scope="col" className="py-1 text-right">Applied</th>
            <th scope="col" className="py-1 text-left">Sheet status</th>
          </tr>
        </thead>
        <tbody>
          {items.map((entry) => (
            <tr key={entry.stocktakeId}>
              <td className="py-1">{entry.countedAt ? new Date(entry.countedAt).toLocaleDateString() : "—"}</td>
              <td className="py-1 text-gray-500">{entry.location?.name ?? "—"}</td>
              <td className="py-1 text-right text-gray-500">{entry.expectedQty}</td>
              <td className="py-1 text-right">{entry.countedQty}</td>
              <td className="py-1 text-right">
                {entry.appliedDelta === null ? (
                  <span className="text-gray-500">Not applied yet</span>
                ) : (
                  <span className={entry.appliedDelta === 0 ? "text-gray-500" : entry.appliedDelta > 0 ? "text-green-700" : "text-red-600"}>
                    {entry.appliedDelta > 0 ? "+" : ""}
                    {entry.appliedDelta}
                  </span>
                )}
              </td>
              <td className="py-1 text-gray-500">{entry.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pagination
        page={historyQuery.data.page}
        pageSize={historyQuery.data.pageSize}
        total={historyQuery.data.total}
        onPageChange={setPage}
        label="counts"
      />
    </div>
  );
}

export function ProductsPage() {
  // One stable prefix per mounted page, so every label points at its
  // own control even where two forms reuse a field name.
  const fieldId = useId();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isOwner = user?.role === "OWNER";
  const [search, setSearch] = useState("");
  // The box stays controlled by `search` so typing is instant; the query is
  // keyed on the settled value so a word is one request, not one per key.
  const debouncedSearch = useDebouncedValue(search);
  const [page, setPage] = useState(1);
  // null = form closed; a Product = editing it; "new" = the create form.
  const [formTarget, setFormTarget] = useState<Product | "new" | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [status, setStatus] = useState<ProductStatusFilter>("active");
  const [rowError, setRowError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportProductsResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [historyExpandedId, setHistoryExpandedId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const editing = formTarget !== null && formTarget !== "new" ? formTarget : null;

  const productsQuery = useQuery({
    queryKey: ["products", debouncedSearch, status, page],
    queryFn: () => fetchProducts({ search: debouncedSearch || undefined, status, page, pageSize: PAGE_SIZE }),
    // Keeps the current results on screen while the next search runs,
    // instead of blanking the table between keystrokes.
    placeholderData: (previous) => previous,
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

  const categoriesQuery = useQuery({
    queryKey: ["categories"],
    queryFn: () => fetchCategories(),
  });

  const createCategoryMutation = useMutation({
    mutationFn: createCategory,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      setNewCategoryName("");
      setCategoryError(null);
    },
    onError: (err) => {
      setCategoryError(isApiError(err) ? err.response?.data?.error ?? "Could not add category" : "Could not add category");
    },
  });

  function handleAddCategory() {
    const name = newCategoryName.trim();
    if (!name) return;
    createCategoryMutation.mutate(name);
  }

  function onSaved() {
    queryClient.invalidateQueries({ queryKey: ["products"] });
    // Product edits change stock value and low-stock thresholds, so the
    // dashboard and inventory views can go stale on a save too.
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["inventory"] });
    setFormTarget(null);
  }

  function onSaveError(err: unknown, fallback: string) {
    setFormError(isApiError(err) ? err.response?.data?.error ?? fallback : fallback);
  }

  const createMutation = useMutation({
    mutationFn: createProduct,
    onSuccess: onSaved,
    onError: (err) => onSaveError(err, "Could not create product"),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...payload }: { id: string } & Parameters<typeof updateProduct>[1]) =>
      updateProduct(id, payload),
    onSuccess: onSaved,
    onError: (err) => onSaveError(err, "Could not update product"),
  });

  const saving = createMutation.isPending || updateMutation.isPending;

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    const form = new FormData(e.currentTarget);
    const categoryId = String(form.get("categoryId") ?? "");
    const payload = {
      sku: String(form.get("sku")),
      name: String(form.get("name")),
      categoryId: categoryId || null,
      priceCents: Math.round(Number(form.get("price")) * 100) || 0,
      // The Cost input only renders for an Owner — a STAFF caller must not
      // send costCents at all (the API ignores it, but sending 0 would read
      // as an intentional wipe of a value they can't even see).
      ...(isOwner ? { costCents: Math.round(Number(form.get("cost")) * 100) || 0 } : {}),
      reorderPoint: Number(form.get("reorderPoint")) || 0,
      reorderQty: Number(form.get("reorderQty")) || 0,
    };

    if (editing) {
      updateMutation.mutate({ id: editing.id, ...payload });
    } else {
      createMutation.mutate(payload);
    }
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
            onClick={() => {
              setFormError(null);
              setFormTarget((current) => (current === null ? "new" : null));
            }}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            {formTarget !== null ? "Cancel" : "Add product"}
          </button>
        </div>
      </div>

      {importError && <div role="alert" className="mb-4 text-sm text-red-600">{importError}</div>}
      {importResult && (
        <div className="mb-4 rounded-md border border-gray-200 bg-white p-3 text-sm">
          <div className="text-gray-700">
            Imported: {importResult.created} created, {importResult.updated} updated
            {importResult.errors.length > 0 ? `, ${importResult.errors.length} row(s) skipped` : ""}.
          </div>
          {importResult.errors.length > 0 && (
            <ul role="alert" className="mt-2 list-disc pl-5 text-red-600">
              {importResult.errors.map((err) => (
                <li key={err.row}>Row {err.row}: {err.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {formTarget !== null && (
        <form
          // Remounts the form when switching between create and editing a
          // different product, so the uncontrolled inputs pick up new defaults.
          key={editing?.id ?? "new"}
          onSubmit={handleSubmit}
          className="mb-6 grid grid-cols-2 gap-4 rounded-lg border border-gray-200 bg-white p-4"
        >
          <div className="col-span-2 text-sm font-medium text-gray-900">
            {editing ? `Edit ${editing.sku}` : "New product"}
          </div>
          {formError && <div role="alert" className="col-span-2 text-sm text-red-600">{formError}</div>}
          <div>
            <label htmlFor={`${fieldId}-sku`} className="block text-sm font-medium text-gray-700">SKU</label>
            <input
              id={`${fieldId}-sku`}
              name="sku"
              required
              defaultValue={editing?.sku}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
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
            <label htmlFor={`${fieldId}-categoryId`} className="block text-sm font-medium text-gray-700">Category</label>
            <select
              id={`${fieldId}-categoryId`}
              name="categoryId"
              defaultValue={editing?.categoryId ?? ""}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">No category</option>
              {categoriesQuery.data?.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            <div className="mt-2 flex gap-2">
              <input
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="New category name"
                className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-xs"
              />
              <button
                type="button"
                onClick={handleAddCategory}
                disabled={createCategoryMutation.isPending || !newCategoryName.trim()}
                className="whitespace-nowrap rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Add
              </button>
            </div>
            {categoryError && <div role="alert" className="mt-1 text-xs text-red-600">{categoryError}</div>}
          </div>
          <div>
            <label htmlFor={`${fieldId}-price`} className="block text-sm font-medium text-gray-700">Price ($)</label>
            <input
              id={`${fieldId}-price`}
              name="price"
              type="number"
              step="0.01"
              min="0"
              defaultValue={centsToInput(editing?.priceCents)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          {isOwner && (
            <div>
              <label htmlFor={`${fieldId}-cost`} className="block text-sm font-medium text-gray-700">Cost ($)</label>
              <input
                id={`${fieldId}-cost`}
                name="cost"
                type="number"
                step="0.01"
                min="0"
                defaultValue={centsToInput(editing?.costCents)}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
          )}
          <div>
            <label htmlFor={`${fieldId}-reorderPoint`} className="block text-sm font-medium text-gray-700">Reorder point</label>
            <input
              id={`${fieldId}-reorderPoint`}
              name="reorderPoint"
              type="number"
              min="0"
              defaultValue={editing?.reorderPoint}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor={`${fieldId}-reorderQty`} className="block text-sm font-medium text-gray-700">Reorder quantity</label>
            <input
              id={`${fieldId}-reorderQty`}
              name="reorderQty"
              type="number"
              min="0"
              defaultValue={editing?.reorderQty}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="col-span-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {saving ? "Saving..." : editing ? "Save changes" : "Save product"}
            </button>
          </div>
        </form>
      )}

      {rowError && <div role="alert" className="mb-4 text-sm text-red-600">{rowError}</div>}

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
        placeholder="Search by name or SKU..."
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(1);
        }}
        className="mb-4 w-full max-w-sm rounded-md border border-gray-300 px-3 py-2 text-sm"
      />

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <caption className="sr-only">Products</caption>
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-4 py-2 text-left font-medium text-gray-600">SKU</th>
              <th scope="col" className="px-4 py-2 text-left font-medium text-gray-600">Name</th>
              <th scope="col" className="px-4 py-2 text-left font-medium text-gray-600">Category</th>
              <th scope="col" className="px-4 py-2 text-right font-medium text-gray-600">Price</th>
              <th scope="col" className="px-4 py-2 text-right font-medium text-gray-600">Reorder point</th>
              <th scope="col" className="px-4 py-2 text-right font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {productsQuery.isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-gray-500">Loading...</td>
              </tr>
            )}
            {productsQuery.isError && (
              <tr>
                <td colSpan={6} role="alert" className="px-4 py-6 text-center text-red-600">Failed to load products.</td>
              </tr>
            )}
            {productsQuery.data?.items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-gray-500">{emptyListMessage({ noun: "products", status, search: debouncedSearch })}</td>
              </tr>
            )}
            {productsQuery.data?.items.map((product) => (
              // A Fragment with a key, not `<>`: the shorthand cannot carry
              // one, and each row here expands into two sibling <tr>s.
              <Fragment key={product.id}>
                <tr className={product.isActive ? undefined : "bg-gray-50 text-gray-500"}>
                  <td className="px-4 py-2 font-mono text-xs">{product.sku}</td>
                  <td className="px-4 py-2">
                    {product.name}
                    {!product.isActive && (
                      <span className="ml-2 rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600">
                        Archived
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-gray-500">{product.category?.name ?? "—"}</td>
                  <td className="px-4 py-2 text-right">{formatCents(product.priceCents)}</td>
                  <td className="px-4 py-2 text-right">{product.reorderPoint}</td>
                  <td className="px-4 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => {
                        setFormError(null);
                        setFormTarget(product);
                      }}
                      className="text-xs text-brand-600 hover:underline"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setHistoryExpandedId((current) => (current === product.id ? null : product.id))
                      }
                      className="ml-3 text-xs text-brand-600 hover:underline"
                    >
                      {historyExpandedId === product.id ? "Hide history" : "Count history"}
                    </button>
                    {product.isActive ? (
                      <button
                        type="button"
                        onClick={() => {
                          setRowError(null);
                          pendingArchive.request(product);
                        }}
                        className="ml-3 text-xs text-red-600 hover:underline"
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
                        className="ml-3 text-xs text-brand-600 hover:underline"
                      >
                        Restore
                      </button>
                    )}
                  </td>
                </tr>
                {historyExpandedId === product.id && (
                  <tr>
                    <td colSpan={6} className="bg-gray-50 p-0">
                      <ProductHistoryPanel productId={product.id} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination
        page={productsQuery.data?.page ?? page}
        pageSize={productsQuery.data?.pageSize ?? PAGE_SIZE}
        total={productsQuery.data?.total ?? 0}
        onPageChange={setPage}
        label="products"
      />

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
