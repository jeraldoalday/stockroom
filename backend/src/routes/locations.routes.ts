import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/asyncHandler";
import { requireAuth } from "../middleware/auth";
import { ApiError } from "../lib/errors";

const router = Router();
router.use(requireAuth);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const locations = await prisma.location.findMany({
      where: { organizationId: req.auth!.organizationId },
      orderBy: { name: "asc" },
    });
    res.json(locations);
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const location = await prisma.location.findFirst({
      where: { id: req.params.id, organizationId: req.auth!.organizationId },
    });
    if (!location) {
      throw ApiError.notFound("Location not found");
    }
    res.json(location);
  })
);

// Stock on hand for every product at this location. Source of truth is
// StockMovement (Day 3); until movements exist this is an empty list.
router.get(
  "/:id/inventory",
  asyncHandler(async (req, res) => {
    const organizationId = req.auth!.organizationId;
    const location = await prisma.location.findFirst({
      where: { id: req.params.id, organizationId },
    });
    if (!location) {
      throw ApiError.notFound("Location not found");
    }

    const items = await prisma.inventoryItem.findMany({
      where: { organizationId, locationId: location.id },
      include: { product: true },
      orderBy: { updatedAt: "desc" },
    });
    res.json({ location, items });
  })
);

const locationSchema = z.object({
  name: z.string().min(1).max(120),
  address: z.string().max(500).optional(),
  isDefault: z.boolean().optional(),
});

// Every org must have exactly one default location; enforce it here rather
// than in the schema since Prisma has no partial-unique-index shorthand.
async function clearExistingDefault(
  tx: Prisma.TransactionClient,
  organizationId: string,
  exceptId?: string
) {
  const current = await tx.location.findFirst({
    where: { organizationId, isDefault: true, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
  });
  if (current) {
    await tx.location.update({ where: { id: current.id }, data: { isDefault: false } });
  }
}

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = locationSchema.parse(req.body);
    const organizationId = req.auth!.organizationId;

    const existing = await prisma.location.findFirst({
      where: { organizationId, name: body.name },
    });
    if (existing) {
      throw ApiError.conflict("A location with this name already exists");
    }

    const location = await prisma.$transaction(async (tx) => {
      if (body.isDefault) {
        await clearExistingDefault(tx, organizationId);
      }
      return tx.location.create({ data: { ...body, organizationId } });
    });
    res.status(201).json(location);
  })
);

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const body = locationSchema.partial().parse(req.body);
    const organizationId = req.auth!.organizationId;

    const location = await prisma.location.findFirst({
      where: { id: req.params.id, organizationId },
    });
    if (!location) {
      throw ApiError.notFound("Location not found");
    }

    if (body.name && body.name !== location.name) {
      const nameTaken = await prisma.location.findFirst({
        where: { organizationId, name: body.name, NOT: { id: location.id } },
      });
      if (nameTaken) {
        throw ApiError.conflict("A location with this name already exists");
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (body.isDefault) {
        await clearExistingDefault(tx, organizationId, location.id);
      }
      return tx.location.update({ where: { id: location.id }, data: body });
    });
    res.json(updated);
  })
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const organizationId = req.auth!.organizationId;
    const location = await prisma.location.findFirst({
      where: { id: req.params.id, organizationId },
    });
    if (!location) {
      throw ApiError.notFound("Location not found");
    }

    const totalLocations = await prisma.location.count({ where: { organizationId } });
    if (totalLocations <= 1) {
      throw ApiError.badRequest("An organization must have at least one location");
    }
    if (location.isDefault) {
      throw ApiError.badRequest("Set a different default location before deleting this one");
    }

    // An InventoryItem row is created the first time a product/location
    // pair is ever touched and is never removed — it just goes to zero. So
    // "has inventory records" was true forever once a location had been
    // used, even after it was emptied out, which made every working
    // location permanently undeletable behind a message that didn't say
    // why. What actually matters is whether stock would disappear.
    const stockedItems = await prisma.inventoryItem.count({
      where: { organizationId, locationId: location.id, quantity: { not: 0 } },
    });
    if (stockedItems > 0) {
      throw ApiError.conflict(
        "Cannot delete a location that still holds stock — transfer or adjust it to zero first"
      );
    }

    // Movements at this location are part of the immutable audit trail
    // (PRD section 7) and carry a foreign key to it, so the row genuinely
    // cannot go. Checked explicitly to give the same clear answer the
    // Supplier and Customer routes give, rather than letting the delete
    // fail at the database and surface as a generic constraint error.
    const movementCount = await prisma.stockMovement.count({
      where: { organizationId, locationId: location.id },
    });
    if (movementCount > 0) {
      throw ApiError.conflict("Cannot delete a location with stock movement history");
    }

    // The database now enforces this too (sales_orders.locationId is a
    // RESTRICT foreign key), so this check is no longer the only thing
    // standing between a delete and a set of orders pointing at a location
    // that no longer exists. It stays because the constraint violation
    // would surface as a generic 409 about a referenced record, and
    // naming the reason is the difference between a user knowing what to
    // do and filing a bug.
    const salesOrderCount = await prisma.salesOrder.count({
      where: { organizationId, locationId: location.id },
    });
    if (salesOrderCount > 0) {
      throw ApiError.conflict("Cannot delete a location that is referenced by a sales order");
    }

    // Only zeroed rows can remain by this point; they'd otherwise be
    // orphaned by the delete below.
    await prisma.$transaction(async (tx) => {
      await tx.inventoryItem.deleteMany({ where: { organizationId, locationId: location.id } });
      await tx.location.delete({ where: { id: location.id } });
    });
    res.status(204).send();
  })
);

export default router;
