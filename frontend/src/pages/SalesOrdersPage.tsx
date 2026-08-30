import { useId, useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "../components/AppShell";
import { fetchCustomers } from "../api/customers";
import { fetchProducts } from "../api/products";
import { fetchLocations } from "../api/locations";
import { isApiError } from "../api/errors";
import { cancelSalesOrder, createSalesOrder, fetchSalesOrder, fetchSalesOrders, fulfillSalesOrder } from "../api/salesOrders";
import type { SalesOrderLineInput } from "../api/salesOrders";
import type { Product, SalesOrder, SalesOrderStatus } from "../api/types";

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });
}

const STATUS_LABELS: Record<SalesOrderStatus, string> = {
  DRAFT: "Draft",
  FULFILLED: "Fulfilled",
  CANCELLED: "Cancelled",
};

const emptyLine: SalesOrderLineInput = { productId: "", quantity: 1, unitPriceCents: 0 };

interface RowProps {
  order: SalesOrder;
  products: Product[];
  expanded: boolean;
  onToggleExpand: () => void;
  onCancel: (id: string) => void;
  onFulfill: (id: string) => void;
}

function SalesOrderRow({ order, products, expanded, onToggleExpand, onCancel, onFulfill }: RowProps) {
  const detailQuery = useQuery({
    queryKey: ["sales-orders", order.id],
    queryFn: () => fetchSalesOrder(order.id),
    enabled: expanded,
  });

  function productName(productId: string) {
    return products.find((p) => p.id === productId)?.name ?? productId;
  }

  return (
    <>
      <tr>
        <td className="px-4 py-2">{order.customer?.name ?? "Walk-in"}</td>
        <td className="px-4 py-2">{STATUS_LABELS[order.status]}</td>
        <td className="px-4 py-2 text-gray-500">{new Date(order.createdAt).toLocaleDateString()}</td>
        <td className="px-4 py-2 text-right space-x-3">
          <button type="button" onClick={onToggleExpand} className="text-xs text-brand-600 hover:underline">
            {expanded ? "Hide" : "View"}
          </button>
          {order.status === "DRAFT" && (
            <>
              <button type="button" onClick={() => onFulfill(order.id)} className="text-xs text-brand-600 hover:underline">
                Fulfill
              </button>
              <button type="button" onClick={() => onCancel(order.id)} className="text-xs text-red-600 hover:underline">
                Cancel
              </button>
            </>
          )}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={4} className="bg-gray-50 px-4 py-3">
            {detailQuery.isLoading && <div className="text-xs text-gray-500">Loading...</div>}
            {detailQuery.data && (
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="text-gray-500">
                    <th scope="col" className="py-1 text-left">Product</th>
                    <th scope="col" className="py-1 text-right">Quantity</th>
                    <th scope="col" className="py-1 text-right">Unit price</th>
                  </tr>
                </thead>
                <tbody>
                  {detailQuery.data.lines?.map((line) => (
                    <tr key={line.id}>
                      <td className="py-1">{productName(line.productId)}</td>
                      <td className="py-1 text-right">{line.quantity}</td>
                      <td className="py-1 text-right">{formatCents(line.unitPriceCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {detailQuery.data?.notes && <div className="mt-2 text-xs text-gray-500">Notes: {detailQuery.data.notes}</div>}
          </td>
        </tr>
      )}
    </>
  );
}

export function SalesOrdersPage() {
  // One stable prefix per mounted page, so every label points at its
  // own control even where two forms reuse a field name.
  const fieldId = useId();
  const queryClient = useQueryClient();

  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [lines, setLines] = useState<SalesOrderLineInput[]>([{ ...emptyLine }]);

  const ordersQuery = useQuery({ queryKey: ["sales-orders"], queryFn: () => fetchSalesOrders() });
  const customersQuery = useQuery({ queryKey: ["customers", "all"], queryFn: () => fetchCustomers() });
  const productsQuery = useQuery({ queryKey: ["products", "all"], queryFn: () => fetchProducts({ pageSize: 100 }) });
  const locationsQuery = useQuery({ queryKey: ["locations", "active"], queryFn: () => fetchLocations("active") });

  function invalidate(id?: string) {
    queryClient.invalidateQueries({ queryKey: ["sales-orders"] });
    queryClient.invalidateQueries({ queryKey: ["inventory"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["stock-movements"] });
    if (id) queryClient.invalidateQueries({ queryKey: ["sales-orders", id] });
  }

  const createMutation = useMutation({
    mutationFn: createSalesOrder,
    onSuccess: () => {
      invalidate();
      setShowForm(false);
      setLines([{ ...emptyLine }]);
    },
    onError: (err) => {
      setFormError(isApiError(err) ? err.response?.data?.error ?? "Could not create sales order" : "Could not create sales order");
    },
  });

  const cancelMutation = useMutation({
    mutationFn: cancelSalesOrder,
    onSuccess: (data) => invalidate(data.id),
    onError: (err) => {
      setRowError(isApiError(err) ? err.response?.data?.error ?? "Could not cancel sales order" : "Could not cancel sales order");
    },
  });

  const fulfillMutation = useMutation({
    mutationFn: fulfillSalesOrder,
    onSuccess: (data) => invalidate(data.id),
    onError: (err) => {
      setRowError(isApiError(err) ? err.response?.data?.error ?? "Could not fulfill sales order" : "Could not fulfill sales order");
    },
  });

  function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    const form = new FormData(e.currentTarget);
    const validLines = lines.filter((line) => line.productId);
    if (validLines.length === 0) {
      setFormError("Add at least one line item");
      return;
    }
    const customerId = String(form.get("customerId") || "");
    createMutation.mutate({
      customerId: customerId || null,
      locationId: String(form.get("locationId")),
      notes: String(form.get("notes") || "") || undefined,
      lines: validLines,
    });
  }

  function updateLine(index: number, patch: Partial<SalesOrderLineInput>) {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Sales Orders</h1>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          {showForm ? "Cancel" : "New sales order"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="mb-6 space-y-4 rounded-lg border border-gray-200 bg-white p-4">
          {formError && <div role="alert" className="text-sm text-red-600">{formError}</div>}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label htmlFor={`${fieldId}-customerId`} className="block text-sm font-medium text-gray-700">Customer (optional)</label>
              <select id={`${fieldId}-customerId`} name="customerId" className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm">
                <option value="">Walk-in</option>
                {customersQuery.data?.items.map((customer) => (
                  <option key={customer.id} value={customer.id}>{customer.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`${fieldId}-locationId`} className="block text-sm font-medium text-gray-700">Location</label>
              <select id={`${fieldId}-locationId`} name="locationId" required className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm">
                <option value="">Select a location...</option>
                {locationsQuery.data?.map((location) => (
                  <option key={location.id} value={location.id}>{location.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`${fieldId}-notes`} className="block text-sm font-medium text-gray-700">Notes (optional)</label>
              <input id={`${fieldId}-notes`} name="notes" className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium text-gray-700">Line items</div>
            {lines.map((line, index) => (
              <div key={index} className="grid grid-cols-12 gap-2">
                <select
                  value={line.productId}
                  onChange={(e) => updateLine(index, { productId: e.target.value })}
                  className="col-span-6 rounded-md border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="">Select a product...</option>
                  {productsQuery.data?.items.map((product) => (
                    <option key={product.id} value={product.id}>{product.name} ({product.sku})</option>
                  ))}
                </select>
                <input
                  type="number"
                  min="1"
                  placeholder="Qty"
                  value={line.quantity}
                  onChange={(e) => updateLine(index, { quantity: Number(e.target.value) || 1 })}
                  className="col-span-2 rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Unit price ($)"
                  value={line.unitPriceCents / 100}
                  onChange={(e) => updateLine(index, { unitPriceCents: Math.round(Number(e.target.value) * 100) || 0 })}
                  className="col-span-3 rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
                  disabled={lines.length === 1}
                  className="col-span-1 text-xs text-red-600 hover:underline disabled:opacity-30"
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setLines((current) => [...current, { ...emptyLine }])}
              className="text-xs text-brand-600 hover:underline"
            >
              + Add line
            </button>
          </div>

          <button
            type="submit"
            disabled={createMutation.isPending}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {createMutation.isPending ? "Saving..." : "Create sales order"}
          </button>
        </form>
      )}

      {rowError && <div role="alert" className="mb-4 text-sm text-red-600">{rowError}</div>}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-4 py-2 text-left font-medium text-gray-600">Customer</th>
              <th scope="col" className="px-4 py-2 text-left font-medium text-gray-600">Status</th>
              <th scope="col" className="px-4 py-2 text-left font-medium text-gray-600">Created</th>
              <th scope="col" className="px-4 py-2 text-right font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {ordersQuery.isLoading && (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-500">Loading...</td></tr>
            )}
            {ordersQuery.isError && (
              <tr><td colSpan={4} role="alert" className="px-4 py-6 text-center text-red-600">Failed to load sales orders.</td></tr>
            )}
            {ordersQuery.data?.items.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-500">No sales orders yet.</td></tr>
            )}
            {ordersQuery.data?.items.map((order) => (
              <SalesOrderRow
                key={order.id}
                order={order}
                products={productsQuery.data?.items ?? []}
                expanded={expandedId === order.id}
                onToggleExpand={() => setExpandedId((current) => (current === order.id ? null : order.id))}
                onCancel={(id) => cancelMutation.mutate(id)}
                onFulfill={(id) => fulfillMutation.mutate(id)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
