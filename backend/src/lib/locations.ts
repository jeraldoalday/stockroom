import type { Location } from "@prisma/client";
import { prisma } from "./prisma";
import { ApiError } from "./errors";

/**
 * Resolves a location that is allowed to receive stock.
 *
 * Four routes take a locationId and write stock against it — movements,
 * transfers, purchase-order receipts and sales-order fulfilment — and each
 * had its own copy of "does this belong to the caller's organization".
 * Archiving adds a second condition to all four, and a condition that has
 * to hold in four places is one that will eventually be added to three.
 *
 * An archived location is refused rather than tolerated because a location
 * is a physical place: it is gone from every picker, so stock booked into
 * one is stock that shows in the valuation and in no list anybody looks at.
 * That is worse than the error.
 */
export async function requireStockableLocation(
  organizationId: string,
  locationId: string,
  field = "locationId"
): Promise<Location> {
  const location = await prisma.location.findFirst({ where: { id: locationId, organizationId } });
  if (!location) {
    throw ApiError.badRequest(`${field} does not belong to this organization`);
  }
  if (!location.isActive) {
    throw ApiError.badRequest(
      `${field} refers to an archived location — restore it before recording stock there`
    );
  }
  return location;
}
