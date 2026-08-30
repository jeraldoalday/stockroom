import { useId, useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "../components/AppShell";
import { useAuth } from "../context/AuthContext";
import { fetchSuppliers } from "../api/suppliers";
import { fetchProducts } from "../api/products";
import { fetchLocations } from "../api/locations";
import { isApiError } from "../api/errors";
import {
  cancelPurchaseOrder,
  createPurchaseOrder,
  fetchPurchaseOrder,
  fetchPurchaseOrders,
  markPurchaseOrderOrdered,
  receivePurchaseOrder,
} from "../api/purchaseOrders";
import type { PurchaseOrderLineInput } from "../api/purchaseOrders";
import type { Product, PurchaseOrder, PurchaseOrderStatus } from "../api/types";

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });
}

const STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  DRAFT: "Draft",
  ORDERED: "Ordered",
  PARTIALLY_RECEIVED: "Partially received",
  RECEIVED: "Received",
  CANCELLED: "Cancelled",
};

const emptyLine: PurchaseOrderLineInput = { productId: "", quantityOrdered: 1, unitCostCents: 0 };

interface RowProps {
  order: PurchaseOrder;
  isOwner: boolean;
  products: Product[];
  locations: { id: string; name: string }[];
  expanded: boolean;
  receiving: boolean;
  onToggleExpand: () => void;
  onToggleReceive: () => void;
  onOrder: (id: string) => void;
  onCancel: (id: string) => void;
  onReceiveSubmit: (id: string, locationId: string, lines: { lineId: string; quantity: number }[]) => void;
  receivePending: boolean;
}

function PurchaseOrderRow({
  order,
  isOwner,
  products,
  locations,
  expanded,
  receiving,
  onToggleExpand,
  onToggleReceive,
  onOrder,
  onCancel,
  onReceiveSubmit,
  receivePending,
}: RowProps) {
  // Per row, not per page: the receiving form is rendered once for
  // every order, so a shared prefix would put the same id on each.
  const fieldId = useId();
  const detailQuery = useQuery({
    queryKey: ["purchase-orders", order.id],
    queryFn: () => fetchPurchaseOrder(order.id),
    enabled: expanded || receiving,
  });

  function productName(productId: string) {
    return products.find((p) => p.id === productId)?.name ?? productId;
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const lines = detailQuery.data?.lines ?? [];
    const form = new FormData(e.currentTarget);
    const receiveLines = lines
      .map((line) => ({ lineId: line.id, quantity: Number(form.get(`qty-${line.id}`)) || 0 }))
      .filter((line) => line.quantity > 0);
    onReceiveSubmit(order.id, String(form.get("locationId")), receiveLines);
  }

  return (
    <>
      <tr>
        <td className="px-4 py-2">{order.supplier?.name ?? "—"}</td>
        <td className="px-4 py-2">{STATUS_LABELS[order.status]}</td>
        <td className="px-4 py-2 text-gray-500">{new Date(order.createdAt).toLocaleDateString()}</td>
        <td className="px-4 py-2 text-right space-x-3">
          <button type="button" onClick={onToggleExpand} className="text-xs text-brand-600 hover:underline">
            {expanded ? "Hide" : "View"}
          </button>
          {isOwner && order.status === "DRAFT" && (
            <button type="button" onClick={() => onOrder(order.id)} className="text-xs text-brand-600 hover:underline">
              Mark as ordered
            </button>
          )}
          {isOwner && (order.status === "DRAFT" || order.status === "ORDERED") && (
            <button type="button" onClick={() => onCancel(order.id)} className="text-xs text-red-600 hover:underline">
              Cancel
            </button>
          )}
          {(order.status === "ORDERED" || order.status === "PARTIALLY_RECEIVED") && (
            <button type="button" onClick={onToggleReceive} className="text-xs text-brand-600 hover:underline">
              {receiving ? "Cancel receipt" : "Receive"}
            </button>
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
                    <th scope="col" className="py-1 text-right">Ordered</th>
                    <th scope="col" className="py-1 text-right">Received</th>
                    {isOwner && <th scope="col" className="py-1 text-right">Unit cost</th>}
                  </tr>
                </thead>
                <tbody>
                  {detailQuery.data.lines?.map((line) => (
                    <tr key={line.id}>
                      <td className="py-1">{productName(line.productId)}</td>
                      <td className="py-1 text-right">{line.quantityOrdered}</td>
                      <td className="py-1 text-right">{line.quantityReceived}</td>
                      {isOwner && <td className="py-1 text-right">{formatCents(line.unitCostCents ?? 0)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {detailQuery.data?.notes && <div className="mt-2 text-xs text-gray-500">Notes: {detailQuery.data.notes}</div>}
          </td>
        </tr>
      )}
      {receiving && (
        <tr>
          <td colSpan={4} className="bg-white px-4 py-3">
            {detailQuery.isLoading && <div className="text-xs text-gray-500">Loading...</div>}
            {detailQuery.data?.lines && (
              <form onSubmit={handleSubmit} className="space-y-2">
                <label htmlFor={`${fieldId}-locationId`} className="block text-xs font-medium text-gray-700">Receiving location</label>
                <select id={`${fieldId}-locationId`} name="locationId" required className="w-full max-w-xs rounded-md border border-gray-300 px-3 py-2 text-sm">
                  <option value="">Select a location...</option>
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>{location.name}</option>
                  ))}
                </select>
                <div className="space-y-1">
                  {detailQuery.data.lines
                    .filter((line) => line.quantityReceived < line.quantityOrdered)
                    .map((line) => {
                      const remaining = line.quantityOrdered - line.quantityReceived;
                      return (
                        <div key={line.id} className="flex items-center gap-2 text-sm">
                          <span className="w-48">{productName(line.productId)}</span>
                          <input
                            name={`qty-${line.id}`}
                            type="number"
                            min="0"
                            max={remaining}
                            defaultValue={remaining}
                            className="w-24 rounded-md border border-gray-300 px-2 py-1 text-sm"
                          />
                          <span className="text-xs text-gray-500">of {remaining} remaining</span>
                        </div>
                      );
                    })}
                </div>
                <button
                  type="submit"
                  disabled={receivePending}
                  className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                >
                  {receivePending ? "Saving..." : "Confirm receipt"}
                </button>
              </form>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export function PurchaseOrdersPage() {
  // One stable prefix per mounted page, so every label points at its
  // own control even where two forms reuse a field name.
  const fieldId = useId();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isOwner = user?.role === "OWNER";

  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [receivingId, setReceivingId] = useState<string | null>(null);
  const [lines, setLines] = useState<PurchaseOrderLineInput[]>([{ ...emptyLine }]);

  const ordersQuery = useQuery({ queryKey: ["purchase-orders"], queryFn: () => fetchPurchaseOrders() });
  const suppliersQuery = useQuery({ queryKey: ["suppliers", "all"], queryFn: () => fetchSuppliers() });
  const productsQuery = useQuery({ queryKey: ["products", "all"], queryFn: () => fetchProducts({ pageSize: 100 }) });
  const locationsQuery = useQuery({ queryKey: ["locations", "active"], queryFn: () => fetchLocations("active") });

  function invalidate(id?: string) {
    queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
    queryClient.invalidateQueries({ queryKey: ["inventory"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["stock-movements"] });
    if (id) queryClient.invalidateQueries({ queryKey: ["purchase-orders", id] });
  }

  const createMutation = useMutation({
    mutationFn: createPurchaseOrder,
    onSuccess: () => {
      invalidate();
      setShowForm(false);
      setLines([{ ...emptyLine }]);
    },
    onError: (err) => {
      setFormError(isApiError(err) ? err.response?.data?.error ?? "Could not create purchase order" : "Could not create purchase order");
    },
  });

  const orderMutation = useMutation({
    mutationFn: markPurchaseOrderOrdered,
    onSuccess: (data) => invalidate(data.id),
    onError: (err) => {
      setRowError(isApiError(err) ? err.response?.data?.error ?? "Could not update purchase order" : "Could not update purchase order");
    },
  });

  const cancelMutation = useMutation({
    mutationFn: cancelPurchaseOrder,
    onSuccess: (data) => invalidate(data.id),
    onError: (err) => {
      setRowError(isApiError(err) ? err.response?.data?.error ?? "Could not cancel purchase order" : "Could not cancel purchase order");
    },
  });

  const receiveMutation = useMutation({
    mutationFn: ({ id, locationId, lines: receiveLines }: { id: string; locationId: string; lines: { lineId: string; quantity: number }[] }) =>
      receivePurchaseOrder(id, { locationId, lines: receiveLines }),
    onSuccess: (data) => {
      invalidate(data.id);
      setReceivingId(null);
    },
    onError: (err) => {
      setRowError(isApiError(err) ? err.response?.data?.error ?? "Could not receive stock" : "Could not receive stock");
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
    createMutation.mutate({
      supplierId: String(form.get("supplierId")),
      notes: String(form.get("notes") || "") || undefined,
      lines: validLines,
    });
  }

  function handleReceiveSubmit(id: string, locationId: string, receiveLines: { lineId: string; quantity: number }[]) {
    setRowError(null);
    if (!locationId) {
      setRowError("Select a receiving location");
      return;
    }
    if (receiveLines.length === 0) {
      setRowError("Enter at least one quantity to receive");
      return;
    }
    receiveMutation.mutate({ id, locationId, lines: receiveLines });
  }

  function updateLine(index: number, patch: Partial<PurchaseOrderLineInput>) {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Purchase Orders</h1>
        {isOwner && (
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            {showForm ? "Cancel" : "New purchase order"}
          </button>
        )}
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="mb-6 space-y-4 rounded-lg border border-gray-200 bg-white p-4">
          {formError && <div role="alert" className="text-sm text-red-600">{formError}</div>}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor={`${fieldId}-supplierId`} className="block text-sm font-medium text-gray-700">Supplier</label>
              <select id={`${fieldId}-supplierId`} name="supplierId" required className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm">
                <option value="">Select a supplier...</option>
                {suppliersQuery.data?.items.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
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
                  value={line.quantityOrdered}
                  onChange={(e) => updateLine(index, { quantityOrdered: Number(e.target.value) || 1 })}
                  className="col-span-2 rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Unit cost ($)"
                  value={line.unitCostCents / 100}
                  onChange={(e) => updateLine(index, { unitCostCents: Math.round(Number(e.target.value) * 100) || 0 })}
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
            {createMutation.isPending ? "Saving..." : "Create purchase order"}
          </button>
        </form>
      )}

      {rowError && <div role="alert" className="mb-4 text-sm text-red-600">{rowError}</div>}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-4 py-2 text-left font-medium text-gray-600">Supplier</th>
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
              <tr><td colSpan={4} role="alert" className="px-4 py-6 text-center text-red-600">Failed to load purchase orders.</td></tr>
            )}
            {ordersQuery.data?.items.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-500">No purchase orders yet.</td></tr>
            )}
            {ordersQuery.data?.items.map((order) => (
              <PurchaseOrderRow
                key={order.id}
                order={order}
                isOwner={isOwner}
                products={productsQuery.data?.items ?? []}
                locations={locationsQuery.data ?? []}
                expanded={expandedId === order.id}
                receiving={receivingId === order.id}
                onToggleExpand={() => setExpandedId((current) => (current === order.id ? null : order.id))}
                onToggleReceive={() => {
                  setRowError(null);
                  setReceivingId((current) => (current === order.id ? null : order.id));
                }}
                onOrder={(id) => orderMutation.mutate(id)}
                onCancel={(id) => cancelMutation.mutate(id)}
                onReceiveSubmit={handleReceiveSubmit}
                receivePending={receiveMutation.isPending}
              />
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
