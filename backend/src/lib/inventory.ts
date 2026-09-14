import { Prisma } from "@prisma/client";
import { ApiError } from "./errors";

// InventoryItem.quantity is a derived cache; it must only ever change here,
// inside the same transaction as the StockMovement row that explains the
// change. `delta` is the signed effect on quantity on hand.
//
// The guard against negative stock has to be enforced in the same
// statement that applies the delta, not read-then-write: reading the
// current quantity, checking it in application code, and writing the
// result back a moment later leaves a gap for two concurrent sales against
// the same low-stock item to both read the quantity before either commits,
// both decide there is enough, and both write — the second update
// overwriting the first's rather than compounding it, so the pair sells
// more than was ever on the shelf. `updateMany`'s WHERE clause is
// evaluated by Postgres against the row as it stands when the statement
// runs, so the guard and the write are one atomic operation, the same way
// `rateLimit.hitRateLimit`'s upsert closes the equivalent gap for a login
// counter.
export async function applyMovementDelta(
  tx: Prisma.TransactionClient,
  params: { organizationId: string; productId: string; locationId: string; delta: number }
) {
  const { organizationId, productId, locationId, delta } = params;

  const applied = await tx.inventoryItem.updateMany({
    where: { productId, locationId, quantity: { gte: -delta } },
    data: { quantity: { increment: delta } },
  });

  if (applied.count > 0) {
    const updated = await tx.inventoryItem.findFirst({ where: { productId, locationId } });
    if (!updated) throw new Error("inventory item vanished mid-transaction");
    return updated.quantity;
  }

  // Nothing matched the guard above, which means either this product has no
  // inventory row at this location yet, or it has one that doesn't hold
  // enough for this delta. The two are told apart by a plain lookup, since
  // the guard alone can't say which — and only the first can still succeed,
  // by creating the row outright.
  const existing = await tx.inventoryItem.findFirst({ where: { productId, locationId } });
  if (existing || delta < 0) {
    throw ApiError.badRequest("Insufficient stock at this location");
  }

  const created = await tx.inventoryItem.create({
    data: { organizationId, productId, locationId, quantity: delta },
  });
  return created.quantity;
}

// Sets InventoryItem.quantity to an absolute value rather than adjusting it
// by a delta. A stocktake is the one caller that needs this: completing one
// means making on-hand equal exactly what was physically counted, not
// applying some computed adjustment that only lands correctly if nothing
// else has touched the same row since it was read. An increment computed
// from an earlier read (`countedQty - onHandAtReadTime`) reopens the same
// read-then-write gap `applyMovementDelta` above was fixed for, just one
// level up: a concurrent movement against this exact product/location
// between that read and the write would make the increment land on top of
// a quantity it was never computed against. Writing the absolute figure
// instead needs no such guard — there is no "not enough stock" case for a
// count, so whatever the row holds when this statement runs, this is what
// it is set to, unconditionally and atomically.
export async function setInventoryQuantity(
  tx: Prisma.TransactionClient,
  params: { organizationId: string; productId: string; locationId: string; quantity: number }
) {
  const { organizationId, productId, locationId, quantity } = params;

  const updated = await tx.inventoryItem.updateMany({
    where: { productId, locationId },
    data: { quantity },
  });
  if (updated.count > 0) return quantity;

  // No row yet for this product/location — a stocktake can still be the
  // first thing to ever record stock there (an "all-products" sheet counts
  // products the ledger has never touched at this location).
  const created = await tx.inventoryItem.create({
    data: { organizationId, productId, locationId, quantity },
  });
  return created.quantity;
}
