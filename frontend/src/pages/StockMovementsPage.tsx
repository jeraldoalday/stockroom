import { useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "../components/AppShell";
import { fetchProducts } from "../api/products";
import { fetchLocations } from "../api/locations";
import { createStockMovement, fetchStockMovements, transferStock } from "../api/stockMovements";
import { isApiError } from "../api/errors";
import type { MovementType } from "../api/types";

const MOVEMENT_LABELS: Record<MovementType, string> = {
  RECEIVE: "Received",
  SALE: "Sold",
  TRANSFER_IN: "Transfer in",
  TRANSFER_OUT: "Transfer out",
  ADJUSTMENT: "Adjusted",
};

export function StockMovementsPage() {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"movement" | "transfer" | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [movementType, setMovementType] = useState<"RECEIVE" | "SALE" | "ADJUSTMENT">("RECEIVE");

  const productsQuery = useQuery({ queryKey: ["products", "all"], queryFn: () => fetchProducts({ pageSize: 100 }) });
  const locationsQuery = useQuery({ queryKey: ["locations"], queryFn: fetchLocations });
  const movementsQuery = useQuery({ queryKey: ["stock-movements"], queryFn: () => fetchStockMovements() });

  function invalidateAfterMovement() {
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
    movementMutation.mutate({
      productId: String(form.get("productId")),
      locationId: String(form.get("locationId")),
      type: movementType,
      quantity: Number(form.get("quantity")),
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
          {formError && <div className="col-span-2 text-sm text-red-600">{formError}</div>}
          <div>
            <label className="block text-sm font-medium text-gray-700">Type</label>
            <select
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
            <label className="block text-sm font-medium text-gray-700">
              Quantity {movementType === "ADJUSTMENT" ? "(signed delta)" : ""}
            </label>
            <input
              name="quantity"
              type="number"
              required
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Product</label>
            <select name="productId" required className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm">
              <option value="">Select a product...</option>
              {productsQuery.data?.items.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name} ({product.sku})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Location</label>
            <select name="locationId" required className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm">
              <option value="">Select a location...</option>
              {locationsQuery.data?.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700">
              Reason {movementType === "ADJUSTMENT" ? "(required)" : "(optional)"}
            </label>
            <input
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
          {formError && <div className="col-span-2 text-sm text-red-600">{formError}</div>}
          <div>
            <label className="block text-sm font-medium text-gray-700">Product</label>
            <select name="productId" required className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm">
              <option value="">Select a product...</option>
              {productsQuery.data?.items.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name} ({product.sku})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Quantity</label>
            <input
              name="quantity"
              type="number"
              min="1"
              required
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">From location</label>
            <select name="fromLocationId" required className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm">
              <option value="">Select a location...</option>
              {locationsQuery.data?.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">To location</label>
            <select name="toLocationId" required className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm">
              <option value="">Select a location...</option>
              {locationsQuery.data?.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700">Reason (optional)</label>
            <input name="reason" className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
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

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Date</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Product</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Location</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Type</th>
              <th className="px-4 py-2 text-right font-medium text-gray-600">Qty</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Reason</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {movementsQuery.isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-gray-500">Loading...</td>
              </tr>
            )}
            {movementsQuery.isError && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-red-600">Failed to load stock movements.</td>
              </tr>
            )}
            {movementsQuery.data?.items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-gray-500">No stock movements yet.</td>
              </tr>
            )}
            {movementsQuery.data?.items.map((movement) => (
              <tr key={movement.id}>
                <td className="px-4 py-2 text-gray-500">{new Date(movement.createdAt).toLocaleString()}</td>
                <td className="px-4 py-2">{movement.product?.name ?? "—"}</td>
                <td className="px-4 py-2">{movement.location?.name ?? "—"}</td>
                <td className="px-4 py-2">{MOVEMENT_LABELS[movement.type]}</td>
                <td className="px-4 py-2 text-right">{movement.quantity > 0 ? `+${movement.quantity}` : movement.quantity}</td>
                <td className="px-4 py-2 text-gray-500">{movement.reason ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
