import type { StockMovement } from "../api/types";

export interface MovementReason {
  /** A short tag for where the movement came from, or null for a plain one. */
  badge: string | null;
  /** The human-written reason, or null when there is nothing worth showing. */
  text: string | null;
}

/**
 * How a movement's Reason cell should read.
 *
 * The backend stamps every adjustment a completed stocktake posts with
 * `reason: "Stocktake <id>"`. That string is doing real work in the
 * database — it is what makes a hand-read of the movements table
 * intelligible — but shown verbatim in a table cell it is a wall of cuid
 * that tells the reader nothing and pushes the columns around. The id is
 * already on the row as `stocktakeId`, so the cell can say "Stock count"
 * and drop the redundant text entirely.
 *
 * Any other reason is passed through untouched: it was typed by a person
 * and this is not the place to second-guess it.
 */
export function movementReason(
  movement: Pick<StockMovement, "reason" | "stocktakeId">
): MovementReason {
  if (movement.stocktakeId) {
    const generated = movement.reason?.startsWith("Stocktake ") ?? false;
    // A reason the app generated is dropped; one somebody typed is kept
    // alongside the badge, since a count with a note on it is worth reading.
    return { badge: "Stock count", text: generated ? null : movement.reason ?? null };
  }
  return { badge: null, text: movement.reason ?? null };
}
