import { SEED_PRODUCTS } from "./catalog";
import type { SeedProduct } from "./catalog";

// Generates the demo org's trading history as a plain data structure, with
// no database access at all. Two reasons for the split:
//
//  * The reports this data exists to demonstrate (the 7/30-day trend, the
//    moving-average reorder suggestion) are only interesting if the history
//    is internally consistent — stock that goes out must have come in
//    first. That's a simulation, and a simulation is worth testing on its
//    own rather than inferring from whatever ends up in Postgres.
//  * It keeps the seed deterministic. A demo that shows different numbers
//    every run makes a scripted walkthrough impossible to write.

/**
 * mulberry32 — a small, fast PRNG. Seeded from a constant so every run of
 * the seed produces byte-identical history; `Math.random()` would make the
 * demo script's numbers unquotable.
 */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PlannedMovement {
  sku: string;
  locationName: string;
  type: "RECEIVE" | "SALE" | "ADJUSTMENT";
  /** Signed, exactly as StockMovement.quantity is persisted. */
  quantity: number;
  reason?: string;
  daysAgo: number;
}

export interface PlannedHistory {
  movements: PlannedMovement[];
  /** Final quantity on hand, keyed by `${sku}::${locationName}`. */
  quantities: Map<string, number>;
}

export const DEFAULT_HISTORY_DAYS = 60;

const SELLING_LOCATION = "Storefront";
const BACKUP_LOCATION = "Back Room";

/**
 * SKUs deliberately allowed to run down by the end of the window.
 *
 * Without this the simulation restocks everything on schedule and finishes
 * with no product at or below its reorder point — which leaves the
 * dashboard's low-stock panel (F8) and the reorder-quantity report (F12)
 * showing nothing at all. Those are two of the features the demo data
 * exists to demonstrate, so the data has to contain the situation they
 * describe. They're chosen across three categories so the low-stock list
 * doesn't look like one supplier having a bad week.
 */
const RUNNING_LOW_SKUS = new Set(["NG-2004", "NG-4001", "NG-6003", "NG-5004"]);

/** How many days before "now" the products above stop being replenished. */
const RUN_DOWN_DAYS = 10;

function stockKey(sku: string, locationName: string) {
  return `${sku}::${locationName}`;
}

/**
 * Weekday multiplier for demand. A grocery's Saturday is not its Tuesday,
 * and a flat rate produces a trend chart that's a straight line — which
 * demonstrates nothing about a trend report.
 * Index 0 is Sunday, matching `Date.getUTCDay()`.
 */
const WEEKDAY_DEMAND = [1.3, 0.7, 0.8, 0.9, 1.0, 1.25, 1.5];

function demandFor(product: SeedProduct, dayOfWeek: number, random: () => number): number {
  const base = product.dailyDemand * WEEKDAY_DEMAND[dayOfWeek];
  // ±35% noise, so the moving average has something to average.
  const noisy = base * (0.65 + random() * 0.7);
  return Math.max(0, Math.round(noisy));
}

/**
 * Simulates `days` of trading, ending `endingDaysAgo` days before "now".
 *
 * Invariants the simulation guarantees, because the movement engine
 * enforces them too and a seed that violated them would fail to load:
 *  - stock is received before it is sold;
 *  - no location's quantity on hand ever goes negative;
 *  - the final `quantities` map equals the sum of the movement deltas.
 */
export function planHistory(options: { days?: number; seed?: number } = {}): PlannedHistory {
  const days = options.days ?? DEFAULT_HISTORY_DAYS;
  const random = createRandom(options.seed ?? 20260821);

  const movements: PlannedMovement[] = [];
  const quantities = new Map<string, number>();

  function adjust(sku: string, locationName: string, delta: number) {
    const key = stockKey(sku, locationName);
    quantities.set(key, (quantities.get(key) ?? 0) + delta);
  }

  function quantityAt(sku: string, locationName: string) {
    return quantities.get(stockKey(sku, locationName)) ?? 0;
  }

  // Opening stock, one day before the trading window starts, so day one of
  // the window already has something to sell.
  for (const product of SEED_PRODUCTS) {
    const opening = product.reorderQty * 2;
    movements.push({
      sku: product.sku,
      locationName: SELLING_LOCATION,
      type: "RECEIVE",
      quantity: opening,
      reason: "Opening stock",
      daysAgo: days + 1,
    });
    adjust(product.sku, SELLING_LOCATION, opening);

    // A reserve in the back room, so transfers and multi-location stock
    // views have something to show. The products being run down get none:
    // stock on hand is summed across locations, so a back-room reserve
    // would keep them above their reorder point no matter what the
    // storefront does.
    const reserve = RUNNING_LOW_SKUS.has(product.sku) ? 0 : product.reorderQty;
    // No movement at all rather than a zero-quantity one: the API rejects
    // a movement of zero outright ("quantity must not be zero"), and a row
    // that records nothing happening has no place in an audit trail.
    if (reserve > 0) {
      movements.push({
        sku: product.sku,
        locationName: BACKUP_LOCATION,
        type: "RECEIVE",
        quantity: reserve,
        reason: "Opening stock",
        daysAgo: days + 1,
      });
      adjust(product.sku, BACKUP_LOCATION, reserve);
    }
  }

  for (let daysAgo = days; daysAgo >= 1; daysAgo -= 1) {
    const dayOfWeek = (((days - daysAgo) % 7) + 7) % 7;

    for (const product of SEED_PRODUCTS) {
      // Replenish before selling when the shelf has dropped to its reorder
      // point — this is what the reorder-point data is *for*, and it keeps
      // the simulation from simply running every SKU down to zero.
      const onHand = quantityAt(product.sku, SELLING_LOCATION);
      const replenishmentStopped = RUNNING_LOW_SKUS.has(product.sku) && daysAgo <= RUN_DOWN_DAYS;
      if (onHand <= product.reorderPoint && !replenishmentStopped && random() < 0.6) {
        movements.push({
          sku: product.sku,
          locationName: SELLING_LOCATION,
          type: "RECEIVE",
          quantity: product.reorderQty,
          reason: "Supplier delivery",
          daysAgo,
        });
        adjust(product.sku, SELLING_LOCATION, product.reorderQty);
      }

      const wanted = demandFor(product, dayOfWeek, random);
      // Never sell more than is on the shelf: the movement engine rejects
      // it outright ("Insufficient stock at this location"), so a seed that
      // planned it would simply fail to load.
      const sold = Math.min(wanted, quantityAt(product.sku, SELLING_LOCATION));
      if (sold > 0) {
        movements.push({
          sku: product.sku,
          locationName: SELLING_LOCATION,
          type: "SALE",
          quantity: -sold,
          daysAgo,
        });
        adjust(product.sku, SELLING_LOCATION, -sold);
      }
    }

    // Occasional shrinkage, so the audit trail has adjustments in it and
    // the "reason is required for an adjustment" rule has examples.
    if (random() < 0.25) {
      const product = SEED_PRODUCTS[Math.floor(random() * SEED_PRODUCTS.length)];
      const available = quantityAt(product.sku, SELLING_LOCATION);
      const loss = Math.min(available, 1 + Math.floor(random() * 3));
      if (loss > 0) {
        movements.push({
          sku: product.sku,
          locationName: SELLING_LOCATION,
          type: "ADJUSTMENT",
          quantity: -loss,
          reason: random() < 0.5 ? "Damaged in handling" : "Expired — written off",
          daysAgo,
        });
        adjust(product.sku, SELLING_LOCATION, -loss);
      }
    }
  }

  // Newest last is the natural order to write them in; createdAt is what
  // actually orders them for readers.
  movements.sort((a, b) => b.daysAgo - a.daysAgo);

  return { movements, quantities };
}

/** Resolves a `daysAgo` offset against a fixed "now" so a seeded run is
 * reproducible for a given clock. */
export function dateDaysAgo(now: Date, daysAgo: number): Date {
  return new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
}

/** Exported for the tests that assert the demo actually contains the
 * low-stock situation the dashboard and reorder report are meant to show. */
export function runningLowSkus(): string[] {
  return [...RUNNING_LOW_SKUS];
}

export function productBySku(sku: string): SeedProduct {
  const product = SEED_PRODUCTS.find((candidate) => candidate.sku === sku);
  if (!product) {
    throw new Error(`Unknown seed SKU: ${sku}`);
  }
  return product;
}
