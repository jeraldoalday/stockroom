import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "../components/AppShell";
import { downloadExport, fetchReorderSuggestions, fetchTrend } from "../api/reports";
import type { ExportKind } from "../api/reports";
import { isApiError } from "../api/errors";

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });
}

const EXPORT_LABELS: Record<ExportKind, string> = {
  products: "Products",
  stock: "Stock on hand",
  movements: "Stock movements",
};

export function ReportsPage() {
  const [days, setDays] = useState<7 | 30>(7);
  const [exportingKind, setExportingKind] = useState<ExportKind | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const trendQuery = useQuery({ queryKey: ["reports", "trend", days], queryFn: () => fetchTrend(days) });
  const reorderQuery = useQuery({ queryKey: ["reports", "reorder-suggestions"], queryFn: fetchReorderSuggestions });

  const maxUnits = Math.max(1, ...(trendQuery.data?.series.map((p) => Math.max(p.unitsSold, p.unitsReceived)) ?? [1]));

  async function handleExport(kind: ExportKind) {
    setExportError(null);
    setExportingKind(kind);
    try {
      await downloadExport(kind, kind === "movements" ? { days } : undefined);
    } catch (err) {
      setExportError(isApiError(err) ? err.response?.data?.error ?? "Could not export CSV" : "Could not export CSV");
    } finally {
      setExportingKind(null);
    }
  }

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Reports</h1>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setDays(7)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${days === 7 ? "bg-brand-600 text-white" : "border border-gray-300 text-gray-700"}`}
          >
            7 days
          </button>
          <button
            type="button"
            onClick={() => setDays(30)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${days === 30 ? "bg-brand-600 text-white" : "border border-gray-300 text-gray-700"}`}
          >
            30 days
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-sm text-gray-500">Units sold</div>
          <div className="mt-1 text-2xl font-semibold text-gray-900">{trendQuery.data?.totals.unitsSold ?? "—"}</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-sm text-gray-500">Units received</div>
          <div className="mt-1 text-2xl font-semibold text-gray-900">{trendQuery.data?.totals.unitsReceived ?? "—"}</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-sm text-gray-500">Revenue (attributed)</div>
          <div className="mt-1 text-2xl font-semibold text-gray-900">
            {trendQuery.data ? formatCents(trendQuery.data.totals.revenueCents) : "—"}
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-gray-900">Daily sales vs. receiving</h2>
        {trendQuery.isLoading && <p className="mt-3 text-sm text-gray-500">Loading...</p>}
        {trendQuery.isError && <p className="mt-3 text-sm text-red-600">Failed to load the trend report.</p>}
        {trendQuery.data?.series.length === 0 && (
          <p className="mt-3 text-sm text-gray-500">No stock movements in the last {days} days.</p>
        )}
        {trendQuery.data && trendQuery.data.series.length > 0 && (
          <div className="mt-4 space-y-2">
            {trendQuery.data.series.map((point) => (
              <div key={point.date} className="flex items-center gap-3 text-sm">
                <span className="w-24 shrink-0 text-gray-500">{point.date}</span>
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <div className="h-2 rounded bg-brand-500" style={{ width: `${(point.unitsSold / maxUnits) * 100}%` }} />
                    <span className="text-xs text-gray-500">{point.unitsSold} sold</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-2 rounded bg-emerald-500" style={{ width: `${(point.unitsReceived / maxUnits) * 100}%` }} />
                    <span className="text-xs text-gray-500">{point.unitsReceived} received</span>
                  </div>
                </div>
                <span className="w-20 shrink-0 text-right text-gray-500">{formatCents(point.revenueCents)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-6 rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-gray-900">Reorder suggestions</h2>
        <p className="mt-1 text-sm text-gray-500">
          Products at or below their reorder point, ranked by how soon they'll run out based on the last{" "}
          {reorderQuery.data?.days ?? 30}-day average daily demand.
        </p>
        {reorderQuery.isLoading && <p className="mt-3 text-sm text-gray-500">Loading...</p>}
        {reorderQuery.isError && <p className="mt-3 text-sm text-red-600">Failed to load reorder suggestions.</p>}
        {reorderQuery.data?.items.length === 0 && (
          <p className="mt-3 text-sm text-gray-500">No products are at or below their reorder point.</p>
        )}
        {reorderQuery.data && reorderQuery.data.items.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="py-1.5 pr-4">Product</th>
                  <th className="py-1.5 pr-4">On hand</th>
                  <th className="py-1.5 pr-4">Avg daily demand</th>
                  <th className="py-1.5 pr-4">Days of stock left</th>
                  <th className="py-1.5 pr-4">Suggested reorder qty</th>
                </tr>
              </thead>
              <tbody>
                {reorderQuery.data.items.map((item) => (
                  <tr key={item.productId} className="border-t border-gray-100">
                    <td className="py-1.5 pr-4 text-gray-900">
                      {item.name} <span className="text-gray-400">({item.sku})</span>
                    </td>
                    <td className="py-1.5 pr-4 text-gray-700">{item.currentStock}</td>
                    <td className="py-1.5 pr-4 text-gray-700">{item.avgDailyDemand}</td>
                    <td className="py-1.5 pr-4 text-gray-700">
                      {item.daysOfStockRemaining ?? "—"}
                    </td>
                    <td className="py-1.5 pr-4 font-medium text-gray-900">{item.suggestedQty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-6 rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-gray-900">Export CSV</h2>
        {exportError && <p className="mt-2 text-sm text-red-600">{exportError}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          {(Object.keys(EXPORT_LABELS) as ExportKind[]).map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => handleExport(kind)}
              disabled={exportingKind === kind}
              className="rounded-md border border-brand-600 px-4 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-50"
            >
              {exportingKind === kind ? "Exporting..." : `Export ${EXPORT_LABELS[kind]}`}
            </button>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
