import { useQuery } from "@tanstack/react-query";
import { AppShell } from "../components/AppShell";
import { useAuth } from "../context/AuthContext";
import { fetchDashboardSummary, fetchLowStock } from "../api/dashboard";
import type { MovementType } from "../api/types";

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });
}

const MOVEMENT_LABELS: Record<MovementType, string> = {
  RECEIVE: "Received",
  SALE: "Sold",
  TRANSFER_IN: "Transfer in",
  TRANSFER_OUT: "Transfer out",
  ADJUSTMENT: "Adjusted",
};

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="text-sm text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-gray-900">{value}</div>
    </div>
  );
}

export function DashboardPage() {
  const { user } = useAuth();

  const summaryQuery = useQuery({ queryKey: ["dashboard", "summary"], queryFn: fetchDashboardSummary });
  const lowStockQuery = useQuery({ queryKey: ["dashboard", "low-stock"], queryFn: fetchLowStock });

  return (
    <AppShell>
      <h1 className="text-2xl font-semibold text-gray-900">Welcome back, {user?.name}</h1>

      {summaryQuery.isError && (
        <p className="mt-4 text-sm text-red-600">Failed to load the dashboard.</p>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Total stock value"
          value={summaryQuery.data ? formatCents(summaryQuery.data.totalStockValueCents) : "—"}
        />
        <StatCard
          label="Active products"
          value={summaryQuery.data ? String(summaryQuery.data.activeProductCount) : "—"}
        />
        <StatCard
          label="Low stock alerts"
          value={summaryQuery.data ? String(summaryQuery.data.lowStockCount) : "—"}
        />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Low stock</h2>
          <div className="mt-3 overflow-hidden rounded-lg border border-gray-200 bg-white">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">Product</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-600">On hand</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-600">Reorder point</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {lowStockQuery.isLoading && (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-gray-500">Loading...</td>
                  </tr>
                )}
                {lowStockQuery.data?.items.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-gray-500">
                      Nothing is low on stock.
                    </td>
                  </tr>
                )}
                {lowStockQuery.data?.items.map((entry) => (
                  <tr key={entry.product.id}>
                    <td className="px-4 py-2">{entry.product.name}</td>
                    <td className="px-4 py-2 text-right">{entry.quantity}</td>
                    <td className="px-4 py-2 text-right">{entry.product.reorderPoint}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-gray-900">Recent activity</h2>
          <div className="mt-3 overflow-hidden rounded-lg border border-gray-200 bg-white">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">Product</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">Type</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-600">Qty</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {summaryQuery.isLoading && (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-gray-500">Loading...</td>
                  </tr>
                )}
                {summaryQuery.data?.recentMovements.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-gray-500">
                      No stock movements yet.
                    </td>
                  </tr>
                )}
                {summaryQuery.data?.recentMovements.map((movement) => (
                  <tr key={movement.id}>
                    <td className="px-4 py-2">{movement.product?.name ?? "—"}</td>
                    <td className="px-4 py-2">{MOVEMENT_LABELS[movement.type]}</td>
                    <td className="px-4 py-2 text-right">{movement.quantity > 0 ? `+${movement.quantity}` : movement.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
