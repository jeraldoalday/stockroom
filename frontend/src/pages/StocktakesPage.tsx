import { Fragment, useId, useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "../components/AppShell";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Pagination } from "../components/Pagination";
import { useConfirmation } from "../components/useConfirmation";
import { useAuth } from "../context/AuthContext";
import { isApiError } from "../api/errors";
import { fetchLocations } from "../api/locations";
import { fetchProducts } from "../api/products";
import {
  addStocktakeLine,
  cancelStocktake,
  completeStocktake,
  countStocktakeLine,
  createStocktake,
  fetchStocktake,
  fetchStocktakes,
} from "../api/stocktakes";
import type { Stocktake, StocktakeLine, StocktakeStatus, StocktakeSummary } from "../api/types";

const STATUS_LABELS: Record<StocktakeStatus, string> = {
  OPEN: "Counting",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

const STATUS_TABS: { value: StocktakeStatus | "all"; label: string }[] = [
  { value: "OPEN", label: "In progress" },
  { value: "COMPLETED", label: "Completed" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "all", label: "All" },
];

function errorMessage(err: unknown, fallback: string): string {
  return isApiError(err) ? err.response?.data?.error ?? fallback : fallback;
}

/**
 * The variance a line represents, and how to describe it.
 *
 * An open line shows what the counter is about to change; a completed one
 * shows what was actually posted, which can differ if stock moved while the
 * count was open (see lib/stocktake.ts on the backend).
 */
function lineVariance(line: StocktakeLine): number | null {
  if (line.appliedDelta !== null) return line.appliedDelta;
  if (line.countedQty === null) return null;
  return line.countedQty - line.expectedQty;
}

function VarianceCell({ line }: { line: StocktakeLine }) {
  const variance = lineVariance(line);
  if (variance === null) {
    return <span className="text-gray-400">Not counted</span>;
  }
  if (variance === 0) {
    return <span className="text-gray-500">Matches</span>;
  }
  return (
    <span className={variance > 0 ? "text-green-700" : "text-red-600"}>
      {variance > 0 ? "+" : ""}
      {variance}
    </span>
  );
}

function SummaryBanner({ summary }: { summary: StocktakeSummary }) {
  return (
    <div role="status" className="mb-4 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">
      Count applied: {summary.countedLines} line{summary.countedLines === 1 ? "" : "s"} counted,{" "}
      {summary.adjustedLines} corrected. Found {summary.unitsFound} unit
      {summary.unitsFound === 1 ? "" : "s"}, lost {summary.unitsLost}.
    </div>
  );
}

interface SheetProps {
  stocktakeId: string;
  isOwner: boolean;
  onError: (message: string) => void;
  onCompleted: (summary: StocktakeSummary) => void;
}

/** The count sheet itself: one editable row per product. */
function StocktakeSheet({ stocktakeId, isOwner, onError, onCompleted }: SheetProps) {
  const fieldId = useId();
  const queryClient = useQueryClient();
  const [addingProductId, setAddingProductId] = useState("");

  const detailQuery = useQuery({
    queryKey: ["stocktakes", stocktakeId],
    queryFn: () => fetchStocktake(stocktakeId),
  });
  const productsQuery = useQuery({
    queryKey: ["products", "all"],
    queryFn: () => fetchProducts({ pageSize: 100 }),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["stocktakes"] });
    queryClient.invalidateQueries({ queryKey: ["inventory"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["stock-movements"] });
  }

  const countMutation = useMutation({
    mutationFn: ({ lineId, countedQty }: { lineId: string; countedQty: number | null }) =>
      countStocktakeLine(stocktakeId, lineId, countedQty),
    onSuccess: invalidate,
    onError: (err) => onError(errorMessage(err, "Could not record that count")),
  });

  const addLineMutation = useMutation({
    mutationFn: (productId: string) => addStocktakeLine(stocktakeId, productId),
    onSuccess: () => {
      invalidate();
      setAddingProductId("");
    },
    onError: (err) => onError(errorMessage(err, "Could not add that product")),
  });

  const completeMutation = useMutation({
    mutationFn: () => completeStocktake(stocktakeId),
    onSuccess: (data) => {
      invalidate();
      if (data.summary) onCompleted(data.summary);
    },
    onError: (err) => onError(errorMessage(err, "Could not complete this count")),
  });

  if (detailQuery.isLoading) {
    return <div className="px-4 py-3 text-xs text-gray-500">Loading count sheet...</div>;
  }
  if (detailQuery.isError || !detailQuery.data) {
    return (
      <div role="alert" className="px-4 py-3 text-xs text-red-600">
        Failed to load this count sheet.
      </div>
    );
  }

  const sheet = detailQuery.data;
  const lines = sheet.lines ?? [];
  const isOpen = sheet.status === "OPEN";
  // Products that could still be added — anything not already on the sheet.
  const onSheet = new Set(lines.map((line) => line.productId));
  const addable = (productsQuery.data?.items ?? []).filter((product) => !onSheet.has(product.id));

  function handleCount(line: StocktakeLine, raw: string) {
    const trimmed = raw.trim();
    if (trimmed === "") {
      // Blanking the box is how a counter undoes a figure typed by
      // mistake, and it must not be read as "counted zero".
      if (line.countedQty !== null) countMutation.mutate({ lineId: line.id, countedQty: null });
      return;
    }
    const value = Number(trimmed);
    if (!Number.isInteger(value) || value < 0) {
      onError("A count has to be a whole number of units, zero or more");
      return;
    }
    if (value === line.countedQty) return;
    countMutation.mutate({ lineId: line.id, countedQty: value });
  }

  function handleAddLine(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!addingProductId) return;
    addLineMutation.mutate(addingProductId);
  }

  return (
    <div className="space-y-3 px-4 py-3">
      <table className="min-w-full text-xs">
        <thead>
          <tr className="text-gray-500">
            <th scope="col" className="py-1 text-left">Product</th>
            <th scope="col" className="py-1 text-right">Expected</th>
            <th scope="col" className="py-1 text-right">Counted</th>
            <th scope="col" className="py-1 text-right">Variance</th>
            <th scope="col" className="py-1 text-left">Counted by</th>
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 && (
            <tr>
              <td colSpan={5} className="py-3 text-center text-gray-500">
                Nothing on this sheet. Add a product below to record what is actually there.
              </td>
            </tr>
          )}
          {lines.map((line) => (
            <tr key={line.id}>
              <td className="py-1">
                {line.product?.name ?? line.productId}
                {line.product?.sku && <span className="ml-1 text-gray-400">({line.product.sku})</span>}
              </td>
              <td className="py-1 text-right text-gray-500">{line.expectedQty}</td>
              <td className="py-1 text-right">
                {isOpen ? (
                  <>
                    <label htmlFor={`${fieldId}-${line.id}`} className="sr-only">
                      Counted quantity for {line.product?.name ?? line.productId}
                    </label>
                    <input
                      id={`${fieldId}-${line.id}`}
                      type="number"
                      min="0"
                      defaultValue={line.countedQty ?? ""}
                      onBlur={(e) => handleCount(line, e.target.value)}
                      className="w-20 rounded-md border border-gray-300 px-2 py-1 text-right text-xs"
                    />
                  </>
                ) : (
                  <span>{line.countedQty ?? "—"}</span>
                )}
              </td>
              <td className="py-1 text-right">
                <VarianceCell line={line} />
              </td>
              <td className="py-1 text-gray-500">{line.countedBy?.name ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {isOpen && (
        <form onSubmit={handleAddLine} className="flex items-end gap-2">
          <div>
            <label htmlFor={`${fieldId}-add`} className="block text-xs font-medium text-gray-700">
              Found something not on the sheet?
            </label>
            <select
              id={`${fieldId}-add`}
              value={addingProductId}
              onChange={(e) => setAddingProductId(e.target.value)}
              className="mt-1 w-72 rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">Select a product...</option>
              {addable.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name} ({product.sku})
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={!addingProductId || addLineMutation.isPending}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          >
            Add to sheet
          </button>
        </form>
      )}

      {isOpen && isOwner && (
        <div className="flex items-center gap-3 border-t border-gray-200 pt-3">
          <button
            type="button"
            onClick={() => completeMutation.mutate()}
            disabled={sheet.countedCount === 0 || completeMutation.isPending}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {completeMutation.isPending ? "Applying..." : "Complete count and adjust stock"}
          </button>
          <span className="text-xs text-gray-500">
            {sheet.countedCount} of {sheet.lineCount} counted
            {sheet.countedCount === 0 && " — count at least one line first"}
          </span>
        </div>
      )}
      {isOpen && !isOwner && (
        <p className="border-t border-gray-200 pt-3 text-xs text-gray-500">
          {sheet.countedCount} of {sheet.lineCount} counted. An Owner applies the count once you are done.
        </p>
      )}
    </div>
  );
}

export function StocktakesPage() {
  const fieldId = useId();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isOwner = user?.role === "OWNER";

  const [status, setStatus] = useState<StocktakeStatus | "all">("OPEN");
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [summary, setSummary] = useState<StocktakeSummary | null>(null);
  const cancelConfirmation = useConfirmation<Stocktake>();

  const listQuery = useQuery({
    queryKey: ["stocktakes", { status, page }],
    queryFn: () => fetchStocktakes({ status: status === "all" ? undefined : status, page }),
  });
  const locationsQuery = useQuery({ queryKey: ["locations", "active"], queryFn: () => fetchLocations("active") });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["stocktakes"] });
  }

  const createMutation = useMutation({
    mutationFn: createStocktake,
    onSuccess: (data) => {
      invalidate();
      setShowForm(false);
      setSummary(null);
      // Straight into the new sheet: the next thing anybody wants to do
      // after starting a count is start counting.
      setStatus("OPEN");
      setExpandedId(data.id);
    },
    onError: (err) => setFormError(errorMessage(err, "Could not start this count")),
  });

  const cancelMutation = useMutation({
    mutationFn: cancelStocktake,
    onSuccess: invalidate,
    onError: (err) => setRowError(errorMessage(err, "Could not cancel this count")),
  });

  function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    const form = new FormData(e.currentTarget);
    const locationId = String(form.get("locationId") || "");
    if (!locationId) {
      setFormError("Select the location you are counting");
      return;
    }
    createMutation.mutate({
      locationId,
      scope: form.get("scope") === "all-products" ? "all-products" : "with-stock",
      notes: String(form.get("notes") || "") || undefined,
    });
  }

  const items = listQuery.data?.items ?? [];

  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Stocktakes</h1>
          <p className="mt-1 text-sm text-gray-500">
            Count what is really on the shelf, and correct the ledger to match.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setFormError(null);
            setShowForm((v) => !v);
          }}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          {showForm ? "Cancel" : "Start a count"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="mb-6 space-y-4 rounded-lg border border-gray-200 bg-white p-4">
          {formError && (
            <div role="alert" className="text-sm text-red-600">
              {formError}
            </div>
          )}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label htmlFor={`${fieldId}-locationId`} className="block text-sm font-medium text-gray-700">
                Location
              </label>
              <select
                id={`${fieldId}-locationId`}
                name="locationId"
                required
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">Select a location...</option>
                {locationsQuery.data?.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`${fieldId}-scope`} className="block text-sm font-medium text-gray-700">
                Count sheet
              </label>
              <select
                id={`${fieldId}-scope`}
                name="scope"
                defaultValue="with-stock"
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="with-stock">Products with stock here</option>
                <option value="all-products">Every active product</option>
              </select>
              <p className="mt-1 text-xs text-gray-500">
                Count every product to find stock the system thinks you do not have.
              </p>
            </div>
            <div>
              <label htmlFor={`${fieldId}-notes`} className="block text-sm font-medium text-gray-700">
                Notes (optional)
              </label>
              <input
                id={`${fieldId}-notes`}
                name="notes"
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {createMutation.isPending ? "Starting..." : "Start counting"}
          </button>
        </form>
      )}

      <div className="mb-4 flex gap-2">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => {
              setStatus(tab.value);
              setPage(1);
            }}
            aria-pressed={status === tab.value}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              status === tab.value ? "bg-brand-50 text-brand-700" : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {summary && <SummaryBanner summary={summary} />}
      {rowError && (
        <div role="alert" className="mb-4 text-sm text-red-600">
          {rowError}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-4 py-2 text-left font-medium text-gray-600">Location</th>
              <th scope="col" className="px-4 py-2 text-left font-medium text-gray-600">Status</th>
              <th scope="col" className="px-4 py-2 text-left font-medium text-gray-600">Progress</th>
              <th scope="col" className="px-4 py-2 text-left font-medium text-gray-600">Started</th>
              <th scope="col" className="px-4 py-2 text-right font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {listQuery.isLoading && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-500">Loading...</td>
              </tr>
            )}
            {listQuery.isError && (
              <tr>
                <td colSpan={5} role="alert" className="px-4 py-6 text-center text-red-600">
                  Failed to load stocktakes.
                </td>
              </tr>
            )}
            {listQuery.data && items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-500">
                  {status === "OPEN"
                    ? "No counts in progress. Start one to check a location against the ledger."
                    : `No ${STATUS_LABELS[status as StocktakeStatus]?.toLowerCase() ?? ""} counts.`}
                </td>
              </tr>
            )}
            {items.map((stocktake) => (
              // A Fragment with a key, not `<>`: the shorthand cannot carry
              // one, and each row here expands into two sibling <tr>s.
              <Fragment key={stocktake.id}>
                <tr>
                  <td className="px-4 py-2">{stocktake.location?.name ?? "—"}</td>
                  <td className="px-4 py-2">{STATUS_LABELS[stocktake.status]}</td>
                  <td className="px-4 py-2 text-gray-500">
                    {stocktake.countedCount} of {stocktake.lineCount} counted
                  </td>
                  <td className="px-4 py-2 text-gray-500">
                    {new Date(stocktake.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-2 text-right space-x-3">
                    <button
                      type="button"
                      onClick={() => {
                        setRowError(null);
                        setExpandedId((current) => (current === stocktake.id ? null : stocktake.id));
                      }}
                      className="text-xs text-brand-600 hover:underline"
                    >
                      {expandedId === stocktake.id ? "Hide sheet" : "Open sheet"}
                    </button>
                    {isOwner && stocktake.status === "OPEN" && (
                      <button
                        type="button"
                        onClick={() => cancelConfirmation.request(stocktake)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
                {expandedId === stocktake.id && (
                  <tr>
                    <td colSpan={5} className="bg-gray-50 p-0">
                      <StocktakeSheet
                        stocktakeId={stocktake.id}
                        isOwner={isOwner}
                        onError={setRowError}
                        onCompleted={setSummary}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {listQuery.data && (
        <Pagination
          page={listQuery.data.page}
          pageSize={listQuery.data.pageSize}
          total={listQuery.data.total}
          onPageChange={setPage}
          label="stocktakes"
        />
      )}

      <ConfirmDialog
        open={cancelConfirmation.isOpen}
        title="Cancel this count?"
        description={
          <>
            The sheet for{" "}
            <strong>{cancelConfirmation.target?.location?.name ?? "this location"}</strong> will be closed
            without changing any stock. Figures already written down are kept on the record.
          </>
        }
        confirmLabel="Cancel count"
        cancelLabel="Keep counting"
        busy={cancelMutation.isPending}
        onCancel={cancelConfirmation.cancel}
        onConfirm={() => cancelConfirmation.confirm((target) => cancelMutation.mutate(target.id))}
      />
    </AppShell>
  );
}
