// Physical counts for the demo organization (F15).
//
// Kept declarative and separate from the simulation in history.ts for the
// same reason catalog.ts is: "what does a plausible count look like" is a
// content decision, not a data-generation one.

export interface SeedStocktakeLine {
  sku: string;
  /**
   * Units the counter found, relative to what the ledger expected.
   *
   * `null` means the line was never counted — the state that has to survive
   * into the demo, because it is the one a screenshot of a half-finished
   * sheet is actually showing.
   */
  variance: number | null;
}

export interface SeedStocktake {
  locationName: string;
  status: "COMPLETED" | "OPEN";
  daysAgo: number;
  notes: string | null;
  lines: SeedStocktakeLine[];
}

/**
 * One finished count and one in progress, so the Stocktakes screen has
 * something in every tab and the movements table has a batch of
 * count-attributed adjustments to show.
 *
 * The variances are the shapes a real count produces: a little shrinkage on
 * fast-moving perishables, one line that matches exactly, one where stock
 * turns up that the system had written off, and one nobody got to.
 */
export const SEED_STOCKTAKES: SeedStocktake[] = [
  {
    locationName: "Storefront",
    status: "COMPLETED",
    daysAgo: 6,
    notes: "Monthly count — front of shop",
    lines: [
      { sku: "NG-1001", variance: -3 },
      { sku: "NG-3003", variance: -2 },
      { sku: "NG-2001", variance: 0 },
      { sku: "NG-5002", variance: 4 },
      { sku: "NG-4001", variance: null },
    ],
  },
  {
    locationName: "Back Room",
    status: "OPEN",
    daysAgo: 0,
    notes: "Back room cycle count — in progress",
    lines: [
      { sku: "NG-1002", variance: -1 },
      { sku: "NG-2003", variance: 0 },
      { sku: "NG-4002", variance: null },
      { sku: "NG-6001", variance: null },
    ],
  },
];
