import { Prisma } from "@prisma/client";
import { ApiError } from "./errors";

// InventoryItem.quantity is a derived cache; it must only ever change here,
// inside the same transaction as the StockMovement row that explains the
// change. `delta` is the signed effect on quantity on hand.
export async function applyMovementDelta(
  tx: Prisma.TransactionClient,
  params: { organizationId: string; productId: string; locationId: string; delta: number }
) {
  const { organizationId, productId, locationId, delta } = params;
  const existing = await tx.inventoryItem.findFirst({ where: { productId, locationId } });
  const nextQuantity = (existing?.quantity ?? 0) + delta;
  if (nextQuantity < 0) {
    throw ApiError.badRequest("Insufficient stock at this location");
  }

  if (existing) {
    await tx.inventoryItem.update({ where: { id: existing.id }, data: { quantity: nextQuantity } });
  } else {
    await tx.inventoryItem.create({
      data: { organizationId, productId, locationId, quantity: nextQuantity },
    });
  }
  return nextQuantity;
}
