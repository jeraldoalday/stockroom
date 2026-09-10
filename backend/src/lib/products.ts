import type { Product } from "@prisma/client";
import { prisma } from "./prisma";
import { ApiError } from "./errors";

/**
 * Resolves a product that is allowed to appear on a new write: a stock
 * movement, a transfer, a purchase/sales order line, or a stocktake line.
 *
 * Archiving a product is blocked while it sits on an open purchase or sales
 * order (see products.routes.ts), but nothing stopped a *new* reference to
 * an already-archived product — every write path here re-validated "does
 * this belong to the caller's organization" on its own and never asked
 * whether the product was still active. An archived SKU is gone from every
 * picker and every default list, so stock quietly moving against it, or a
 * brand-new order line naming it, is the same "reappears where no list
 * shows it" problem archiving exists to prevent — just reached from the
 * other direction.
 *
 * Reads (history, the raw inventory list, an existing order already on the
 * books) intentionally do not use this — an archived product's past is
 * still real and still worth showing.
 */
export async function requireActiveProduct(
  organizationId: string,
  productId: string,
  field = "productId"
): Promise<Product> {
  const product = await prisma.product.findFirst({ where: { id: productId, organizationId } });
  if (!product) {
    throw ApiError.badRequest(`${field} does not belong to this organization`);
  }
  if (!product.isActive) {
    throw ApiError.badRequest(`${field} refers to an archived product — restore it before using it here`);
  }
  return product;
}
