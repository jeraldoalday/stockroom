import type { Prisma, StocktakeLine } from "@prisma/client";
import { prisma } from "./prisma";
import { ApiError } from "./errors";
import { setInventoryQuantity } from "./inventory";

/**
 * What goes on the count sheet.
 *
 * "with-stock" is the everyday cycle count: walk the aisle and verify the
 * things the ledger says are there. "all-products" is the one that finds
 * the opposite error — stock sitting on a shelf that the system believes
 * is empty, which a with-stock sheet can never surface because the product
 * never appears on it.
 */
export type StocktakeScope = "with-stock" | "all-products";

export interface PlannedLine {
  productId: string;
  expectedQty: number;
}

/**
 * Snapshots what the system believes is at `locationId` right now.
 *
 * Archived products are excluded from both scopes: they are gone from
 * every picker, so putting them on a sheet asks a counter to go and find
 * something the business has already decided it no longer sells. A product
 * archived while still holding stock is a different problem, and one the
 * Products screen is the right place to catch.
 */
export async function planStocktakeLines(
  organizationId: string,
  locationId: string,
  scope: StocktakeScope
): Promise<PlannedLine[]> {
  const [items, products] = await Promise.all([
    prisma.inventoryItem.findMany({ where: { organizationId, locationId } }),
    prisma.product.findMany({ where: { organizationId, isActive: true }, orderBy: { name: "asc" } }),
  ]);

  const quantityByProduct = new Map(items.map((item) => [item.productId, item.quantity]));

  if (scope === "all-products") {
    return products.map((product) => ({
      productId: product.id,
      expectedQty: quantityByProduct.get(product.id) ?? 0,
    }));
  }

  return products
    .filter((product) => (quantityByProduct.get(product.id) ?? 0) > 0)
    .map((product) => ({
      productId: product.id,
      expectedQty: quantityByProduct.get(product.id) ?? 0,
    }));
}

export interface StocktakeVariance {
  lineId: string;
  productId: string;
  expectedQty: number;
  countedQty: number;
  /** What the counter found, against the sheet they were given. */
  variance: number;
  /** The signed correction actually posted to stock. */
  appliedDelta: number;
}

export interface StocktakeSummary {
  /** Lines with a figure entered. Uncounted lines are left alone entirely. */
  countedLines: number;
  /** Counted lines whose figure disagreed with live stock. */
  adjustedLines: number;
  /** Sum of every positive correction — stock the count found. */
  unitsFound: number;
  /** Sum of every negative correction, as a positive number — shrinkage. */
  unitsLost: number;
  variances: StocktakeVariance[];
}

/**
 * Posts a completed count to stock.
 *
 * The correction is measured against *live* stock, not against the line's
 * `expectedQty` snapshot. Those two are usually identical, and differ only
 * when something moved while the count was open — a sale rung up mid-count,
 * a delivery received into the same room. Adjusting by the snapshot
 * variance would then double-count that movement: the sale would come off
 * the shelf twice. Setting on-hand to what the counter actually saw is both
 * the conventional behaviour and the one that stays correct under
 * concurrent movement, at the cost of overwriting anything that legitimately
 * happened between the physical count and its submission — which is why
 * both figures are kept, `variance` (counted vs. the sheet) and
 * `appliedDelta` (what was really posted), rather than collapsing them into
 * one number that hides the discrepancy.
 *
 * Runs inside the caller's transaction so a half-applied count is
 * impossible: either every adjustment lands with the status change, or none
 * of them do.
 *
 * The write below sets on-hand to `line.countedQty` directly
 * (`setInventoryQuantity`) rather than applying `appliedDelta` as an
 * increment. `onHand` is read a moment before this, so an increment
 * computed from it would land on top of whatever the row holds when the
 * write actually runs — correct only if nothing else touched this exact
 * product/location between the two, which a concurrent movement elsewhere
 * in the app could violate. Writing the absolute count instead makes the
 * end state right regardless: on-hand becomes exactly what was counted, not
 * "what was counted, adjusted by a number that assumed nothing else
 * happened." `appliedDelta` is still computed from that same read and used
 * for the movement/summary — the number that explains the change is only
 * as fresh as the read it came from, but the on-hand value itself no longer
 * depends on that read being current.
 */
export async function applyStocktake(
  tx: Prisma.TransactionClient,
  params: {
    organizationId: string;
    locationId: string;
    stocktakeId: string;
    actorId: string;
    lines: StocktakeLine[];
  }
): Promise<StocktakeSummary> {
  const { organizationId, locationId, stocktakeId, actorId, lines } = params;

  const summary: StocktakeSummary = {
    countedLines: 0,
    adjustedLines: 0,
    unitsFound: 0,
    unitsLost: 0,
    variances: [],
  };

  for (const line of lines) {
    if (line.countedQty === null || line.countedQty === undefined) continue;
    summary.countedLines += 1;

    const item = await tx.inventoryItem.findFirst({ where: { productId: line.productId, locationId } });
    const onHand = item?.quantity ?? 0;
    const appliedDelta = line.countedQty - onHand;

    summary.variances.push({
      lineId: line.id,
      productId: line.productId,
      expectedQty: line.expectedQty,
      countedQty: line.countedQty,
      variance: line.countedQty - line.expectedQty,
      appliedDelta,
    });

    // Recorded even when zero, so "counted, agreed" is distinguishable from
    // "never counted" on the finished sheet.
    await tx.stocktakeLine.update({ where: { id: line.id }, data: { appliedDelta } });

    if (appliedDelta === 0) continue;
    summary.adjustedLines += 1;
    if (appliedDelta > 0) summary.unitsFound += appliedDelta;
    else summary.unitsLost += -appliedDelta;

    await setInventoryQuantity(tx, {
      organizationId,
      productId: line.productId,
      locationId,
      quantity: line.countedQty,
    });
    await tx.stockMovement.create({
      data: {
        organizationId,
        productId: line.productId,
        locationId,
        type: "ADJUSTMENT",
        quantity: appliedDelta,
        actorId,
        stocktakeId,
        // F5 requires a reason on every manual adjustment. "Stocktake" is
        // the honest one here, and the stocktakeId above is what makes the
        // whole batch traceable back to the sheet it came from.
        reason: `Stocktake ${stocktakeId}`,
      },
    });
  }

  return summary;
}

/**
 * Loads a stocktake the caller is allowed to see, or throws 404.
 *
 * Every route below /stocktakes/:id starts this way, and the tenant filter
 * belongs in the same query that finds the row — not in a check afterwards,
 * which is the shape that eventually gets forgotten on one route.
 */
export async function requireStocktake(organizationId: string, id: string) {
  const stocktake = await prisma.stocktake.findFirst({ where: { id, organizationId } });
  if (!stocktake) {
    throw ApiError.notFound("Stocktake not found");
  }
  return stocktake;
}

/** Refuses anything but an in-progress count, with a message that says why. */
export function assertOpen(status: string, action: string): void {
  if (status !== "OPEN") {
    throw ApiError.badRequest(`Only an open stocktake can be ${action}`);
  }
}
