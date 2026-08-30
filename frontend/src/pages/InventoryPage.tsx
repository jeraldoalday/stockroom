import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "../components/AppShell";
import { fetchInventory } from "../api/inventory";
import { Pagination } from "../components/Pagination";
import { fetchLocations } from "../api/locations";

const PAGE_SIZE = 50;

export function InventoryPage() {
  const [locationId, setLocationId] = useState("");
  const [page, setPage] = useState(1);

  const locationsQuery = useQuery({ queryKey: ["locations", "active"], queryFn: () => fetchLocations("active") });
  const inventoryQuery = useQuery({
    queryKey: ["inventory", locationId, page],
    queryFn: () => fetchInventory({ page, pageSize: PAGE_SIZE, ...(locationId ? { locationId } : {}) }),
    placeholderData: (previous) => previous,
  });

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Inventory</h1>
      </div>

      <select
        value={locationId}
        onChange={(e) => {
          setLocationId(e.target.value);
          setPage(1);
        }}
        className="mb-4 w-full max-w-xs rounded-md border border-gray-300 px-3 py-2 text-sm"
      >
        <option value="">All locations</option>
        {locationsQuery.data?.map((location) => (
          <option key={location.id} value={location.id}>
            {location.name}
          </option>
        ))}
      </select>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Product</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">SKU</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Location</th>
              <th className="px-4 py-2 text-right font-medium text-gray-600">On hand</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {inventoryQuery.isLoading && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-gray-500">Loading...</td>
              </tr>
            )}
            {inventoryQuery.isError && (
              <tr>
                <td colSpan={4} role="alert" className="px-4 py-6 text-center text-red-600">Failed to load inventory.</td>
              </tr>
            )}
            {inventoryQuery.data?.items.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-gray-500">
                  No stock recorded yet. Record a movement to get started.
                </td>
              </tr>
            )}
            {inventoryQuery.data?.items.map((item) => (
              <tr key={item.id}>
                <td className="px-4 py-2">{item.product?.name ?? "—"}</td>
                <td className="px-4 py-2 font-mono text-xs">{item.product?.sku ?? "—"}</td>
                <td className="px-4 py-2">{item.location?.name ?? "—"}</td>
                <td className="px-4 py-2 text-right">{item.quantity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination
        page={inventoryQuery.data?.page ?? page}
        pageSize={inventoryQuery.data?.pageSize ?? PAGE_SIZE}
        total={inventoryQuery.data?.total ?? 0}
        onPageChange={setPage}
        label="stock records"
      />
    </AppShell>
  );
}
