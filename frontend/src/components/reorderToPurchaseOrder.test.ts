import { describe, expect, it } from "vitest";
import { toPurchaseOrderPrefillLines } from "./reorderToPurchaseOrder";
import type { ReorderSuggestion } from "../api/reports";

function suggestion(overrides: Partial<ReorderSuggestion> = {}): ReorderSuggestion {
  return {
    productId: "p1",
    sku: "WID-1",
    name: "Widget",
    currentStock: 2,
    reorderPoint: 5,
    reorderQty: 10,
    avgDailyDemand: 1.5,
    daysOfStockRemaining: 1.3,
    suggestedQty: 19,
    ...overrides,
  };
}

describe("toPurchaseOrderPrefillLines", () => {
  it("carries the product id and suggested quantity into a purchase-order line", () => {
    expect(toPurchaseOrderPrefillLines([suggestion()])).toEqual([
      { productId: "p1", quantityOrdered: 19, unitCostCents: 0 },
    ]);
  });

  it("maps one line per selected suggestion, in order", () => {
    const lines = toPurchaseOrderPrefillLines([
      suggestion({ productId: "p1", suggestedQty: 19 }),
      suggestion({ productId: "p2", suggestedQty: 4 }),
    ]);
    expect(lines.map((l) => l.productId)).toEqual(["p1", "p2"]);
  });

  it("floors a zero suggestion at 1, since the order form's own quantity input requires at least one", () => {
    expect(toPurchaseOrderPrefillLines([suggestion({ suggestedQty: 0 })])[0].quantityOrdered).toBe(1);
  });

  it("returns an empty array for an empty selection", () => {
    expect(toPurchaseOrderPrefillLines([])).toEqual([]);
  });
});
