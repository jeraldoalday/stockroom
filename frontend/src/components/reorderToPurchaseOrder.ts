import type { ReorderSuggestion } from "../api/reports";
import type { PurchaseOrderLineInput } from "../api/purchaseOrders";

/**
 * Turns a set of selected reorder suggestions into purchase-order lines.
 *
 * The reorder report and the purchase-order form agree on a product's
 * identity but not on quantity rules: `suggestedQty` is floored at 0 (a
 * product with no configured reorder quantity and no demand yet suggests
 * buying nothing), while the order form's own quantity input requires at
 * least 1. Rather than have the form silently reject a line built from a
 * suggestion, the floor is raised here, at the one place a suggestion
 * becomes an order line.
 *
 * Unit cost is left at 0 — the reorder report doesn't carry a cost figure
 * (it's a demand/coverage report, not a pricing one), so there's nothing
 * honest to prefill it with; the Owner fills it in on the form same as any
 * other new line.
 */
export function toPurchaseOrderPrefillLines(selected: ReorderSuggestion[]): PurchaseOrderLineInput[] {
  return selected.map((item) => ({
    productId: item.productId,
    quantityOrdered: Math.max(item.suggestedQty, 1),
    unitCostCents: 0,
  }));
}
