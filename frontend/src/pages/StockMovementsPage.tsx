import { useId, useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "../components/AppShell";
import { fetchProducts } from "../api/products";
import { fetchLocations } from "../api/locations";
import { createStockMovement, fetchStockMovements, transferStock } from "../api/stockMovements";
import { isApiError } from "../api/errors";
import { Pagination } from "../components/Pagination";
import type { MovementType } from "../api/types";

const MOVEMENT_LABELS: Record<MovementType, string> = {
  RECEIVE: "Received",
  SALE: "Sold",
  TRANSFER_IN: "Transfer in",
  TRANSFER_OUT: "Transfer out",
  ADJUSTMENT: "Adjusted",
};

const PAGE_SIZE = 25;

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });
}

const MOVEMENT_TYPES = Object.keys(MOVEMENT_LABELS) as MovementType[];

export function StockMovementsPage() {
  // One stable prefix per mounted page, so every label points at its
  // own control even where two forms reuse a field name.
  const fieldId = useId();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"movement" | "transfer" | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [movementType, setMovementType] = useState<"RECEIVE" | "SALE" | "ADJUSTMENT">("RECEIVE");
  const [filters, setFilters] = useState<{ productId: string; locationId: string; type: string }>({
    productId: "",
    locationId: "",
    type: "",
  });
  const [page, setPage] = useState(1);

  // Any filter change has to reset the page: staying on page 4 while
  // narrowing to a filter with one page of results shows an empty table
  // and looks like the filter matched nothing.
  function updateFilter(key: keyof typeof filters, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  }

  const hasFilters = Boolean(filters.productId || filters.locationId || filters.type);

  const productsQuery = useQuery({ queryKey: ["products", "all"], queryFn: () => fetchProducts({ pageSize: 100 }) });
  const locationsQuery = useQuery({ queryKey: ["locations", "active"], queryFn: () => fetchLocations("active") });
  const movementsQuery = useQuery({
    queryKey: ["stock-movements", filters, page],
    queryFn: () =>
      fetchStockMovements({
        page,
        pageSize: PAGE_SIZE,
        ...(filters.productId ? { productId: filters.productId } : {}),
        ...(filters.locationId ? { locationId: filters.locationId } : {}),
        ...(filters.type ? { type: filters.type as MovementType } : {}),
      }),
    // Keeps the current page rendered while the next one loads, instead of
    // blanking the table on every page step.
    placeholderData: (previous) => previous,
  });

  function invalidateAfterMovement() {
    // Newest first, so a movement recorded while paged deeper is only
    // visible from page 1.
    setPage(1);
    queryClient.invalidateQueries({ queryKey: ["stock-movements"] });
    queryClient.invalidateQueries({ queryKey: ["inventory"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  }

  const movementMutation = useMutation({
    mutationFn: createStockMovement,
    onSuccess: () => {
      invalidateAfterMovement();
      setMode(null);
    },
    onError: (err) => {
      setFormError(isApiError(err) ? err.response?.data?.error ?? "Could not record movement" : "Could not record movement");
    },
  });

  const transferMutation = useMutation({
    mutationFn: transferStock,
    onSuccess: () => {
      invalidateAfterMovement();
      setMode(null);
    },
    onError: (err) => {
      setFormError(isApiError(err) ? err.response?.data?.error ?? "Could not transfer stock" : "Could not transfer stock");
    },
  });

  function handleMovementSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    const form = new FormData(e.currentTarget);
    // Only sent for a SALE: the API rejects a price on any other type,
    // since a "unit price" on a receipt or a write-off means nothing.
    const priceInput = String(form.get("unitPrice") || "");
    const unitPriceCents =
      movementType === "SALE" && priceInput !== "" ? Math.round(Number(priceInput) * 100) : undefined;

    movementMutation.mutate({
      productId: String(form.get("productId")),
      locationId: String(form.get("locationId")),
      type: movementType,
      quantity: Number(form.get("quantity")),
      ...(unitPriceCents !== undefined ? { unitPriceCents } : {}),
      reason: String(form.get("reason") || "") || undefined,
    });
  }

  function handleTransferSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    const form = new FormData(e.currentTarget);
    transferMutation.mutate({
      productId: String(form.get("productId")),
      fromLocationId: String(form.get("fromLocationId")),
      toLocationId: String(form.get("toLocationId")),
      quantity: Number(form.get("quantity")),
      reason: String(form.get("reason") || "") || undefined,
    });
  }

  function openMode(next: "movement" | "transfer") {
    setFormError(null);
    setMode((current) => (current === next ? null : next));
  }

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Stock Movements</h1>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => openMode("movement")}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            {mode === "movement" ? "Cancel" : "Record movement"}
          </button>
          <button
            type="button"
            onClick={() => openMode("transfer")}
            className="rounded-md border border-brand-600 px-4 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50"
          >
            {mode === "transfer" ? "Cancel" : "Transfer stock"}
          </button>
        </div>
      </div>

      {mode === "movement" && (
        <form onSubmit={handleMovementSubmit} className="mb-6 grid grid-cols-2 gap-4 rounded-lg border border-gray-200 bg-white p-4">
          {formError && <div role="alert" className="col-span-2 text-sm text-red-600">{formError}</div>}
          <div>
            <label htmlFor={`${fieldId}-type`} className="block text-sm font-medium text-gray-700">Type</label>
            <select
              id={`${fieldId}-type`}
              value={movementType}
              onChange={(e) => setMovementType(e.target.value as typeof movementType)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="RECEIVE">Receive</option>
              <option value="SALE">Sale</option>
              <option value="ADJUSTMENT">Adjustment</option>
            </select>
          </div>
          <div>
            <label htmlFor={`${fieldId}-quantity`} className="block text-sm font-medium text-gray-700">
              Quantity {movementType === "ADJUSTMENT" ? "(signed delta)" : ""}
            </label>
            <input
              id={`${fieldId}-quantity`}
              name="quantity"
              type="number"
              required
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor={`${fieldId}-productId`} className="block text-sm font-medium text-gray-700">Product</label>
            <select id={`${fieldId}-productId`} name="productId" required className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm">
              <option value="">Select a product...</option>
              {productsQuery.data?.items.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name} ({product.sku})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${fieldId}-locationId`} className="block text-sm font-medium text-gray-700">Location</label>
            <select id={`${fieldId}-locationId`} name="locationId" required className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm">
              <option value="">Select a location...</option>
              {locationsQuery.data?.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </div>
          {movementType === "SALE" && (
            <div className="col-span-2">
              <label htmlFor={`${fieldId}-unitPrice`} className="block text-sm font-medium text-gray-700">
                Unit price ($) <span className="text-gray-400">(optional)</span>
              </label>
              <input
                id={`${fieldId}-unitPrice`}
                name="unitPrice"
                type="number"
                step="0.01"
                min="0"
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
              <p className="mt-1 text-xs text-gray-500">
                What it sold for. Without this the sale still counts towards units sold, but
                contributes nothing to revenue on the trend report.
              </p>
            </div>
          )}
          <div className="col-span-2">
            <label htmlFor={`${fieldId}-reason`} className="block text-sm font-medium text-gray-700">
              Reason {movementType === "ADJUSTMENT" ? "(required)" : "(optional)"}
            </label>
            <input
              id={`${fieldId}-reason`}
              name="reason"
              required={movementType === "ADJUSTMENT"}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="col-span-2">
            <button
              type="submit"
              disabled={movementMutation.isPending}
              className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {movementMutation.isPending ? "Saving..." : "Record movement"}
            </button>
          </div>
        </form>
      )}

      {mode === "transfer" && (
        <form onSubmit={handleTransferSubmit} className="mb-6 grid grid-cols-2 gap-4 rounded-lg border border-gray-200 bg-white p-4">
          {formError && <div role="alert" className="col-span-2 text-sm text-red-600">{formError}</div>}
          <div>
            <label htmlFor={`${fieldId}-productId2`} className="block text-sm font-medium text-gray-700">Product</label>
            <select id={`${fieldId}-productId2`} name="productId" required className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm">
              <option value="">Select a product...</option>
              {productsQuery.data?.items.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name} ({product.sku})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${fieldId}-quantity2`} className="block text-sm font-medium text-gray-700">Quantity</label>
            <input
              id={`${fieldId}-quantity2`}
              name="quantity"
              type="number"
              min="1"
              required
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor={`${fieldId}-fromLocationId`} className="block text-sm font-medium text-gray-700">From location</label>
            <select id={`${fieldId}-fromLocationId`} name="fromLocationId" required className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm">
              <option value="">Select a location...</option>
              {locationsQuery.data?.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${fieldId}-toLocationId`} className="block text-sm font-medium text-gray-700">To location</label>
            <select id={`${fieldId}-toLocationId`} name="toLocationId" required className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm">
              <option value="">Select a location...</option>
              {locationsQuery.data?.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label htmlFor={`${fieldId}-reason2`} className="block text-sm font-medium text-gray-700">Reason (optional)</label>
            <input id={`${fieldId}-reason2`} name="reason" className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
          </div>
          <div className="col-span-2">
            <button
              type="submit"
              disabled={transferMutation.isPending}
              className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {transferMutation.isPending ? "Saving..." : "Transfer stock"}
            </button>
          </div>
        </form>
      )}

      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-3">
        <div>
          <label htmlFor={`${fieldId}-product`} className="block text-xs font-medium text-gray-500">Product</label>
          <select
            id={`${fieldId}-product`}
            value={filters.productId}
            onChange={(e) => updateFilter("productId", e.target.value)}
            className="mt-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          >
            <option value="">All products</option>
            {productsQuery.data?.items.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name} ({product.sku})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${fieldId}-location`} className="block text-xs font-medium text-gray-500">Location</label>
          <select
            id={`${fieldId}-location`}
            value={filters.locationId}
            onChange={(e) => updateFilter("locationId", e.target.value)}
            className="mt-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          >
            <option value="">All locations</option>
            {locationsQuery.data?.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${fieldId}-type2`} className="block text-xs font-medium text-gray-500">Type</label>
          <select
            id={`${fieldId}-type2`}
            value={filters.type}
            onChange={(e) => updateFilter("type", e.target.value)}
            className="mt-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          >
            <option value="">All types</option>
            {MOVEMENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {MOVEMENT_LABELS[type]}
              </option>
            ))}
          </select>
        </div>
        {hasFilters && (
          <button
            type="button"
            onClick={() => {
              setFilters({ productId: "", locationId: "", type: "" });
              setPage(1);
            }}
            className="pb-1.5 text-sm text-brand-600 hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-4 py-2 text-left font-medium text-gray-600">Date</th>
              <th scope="col" className="px-4 py-2 text-left font-medium text-gray-600">Product</th>
              <th scope="col" className="px-4 py-2 text-left font-medium text-gray-600">Location</th>
              <th scope="col" className="px-4 py-2 text-left font-medium text-gray-600">Type</th>
              <th scope="col" className="px-4 py-2 text-right font-medium text-gray-600">Qty</th>
              <th scope="col" className="px-4 py-2 text-right font-medium text-gray-600">Unit price</th>
              <th scope="col" className="px-4 py-2 text-left font-medium text-gray-600">Reason</th>
              <th scope="col" className="px-4 py-2 text-left font-medium text-gray-600">Recorded by</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {movementsQuery.isLoading && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-gray-500">Loading...</td>
              </tr>
            )}
            {movementsQuery.isError && (
              <tr>
                <td colSpan={8} role="alert" className="px-4 py-6 text-center text-red-600">Failed to load stock movements.</td>
              </tr>
            )}
            {movementsQuery.data?.items.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-gray-500">
                  {hasFilters ? "No stock movements match these filters." : "No stock movements yet."}
                </td>
              </tr>
            )}
            {movementsQuery.data?.items.map((movement) => (
              <tr key={movement.id}>
                <td className="px-4 py-2 text-gray-500">{new Date(movement.createdAt).toLocaleString()}</td>
                <td className="px-4 py-2">{movement.product?.name ?? "—"}</td>
                <td className="px-4 py-2">{movement.location?.name ?? "—"}</td>
                <td className="px-4 py-2">{MOVEMENT_LABELS[movement.type]}</td>
                <td className="px-4 py-2 text-right">{movement.quantity > 0 ? `+${movement.quantity}` : movement.quantity}</td>
                <td className="px-4 py-2 text-right text-gray-500">
                  {movement.unitPriceCents === null || movement.unitPriceCents === undefined
                    ? "—"
                    : formatCents(movement.unitPriceCents)}
                </td>
                <td className="px-4 py-2 text-gray-500">{movement.reason ?? "—"}</td>
                <td className="px-4 py-2 text-gray-500">{movement.actor?.name ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination
        page={movementsQuery.data?.page ?? page}
        pageSize={movementsQuery.data?.pageSize ?? PAGE_SIZE}
        total={movementsQuery.data?.total ?? 0}
        onPageChange={setPage}
        label="movements"
      />
    </AppShell>
  );
}
