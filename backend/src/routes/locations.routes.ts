import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/asyncHandler";
import { requireAuth } from "../middleware/auth";
import { ApiError } from "../lib/errors";

const router = Router();
router.use(requireAuth);

// Archived locations stay in the database because inventory rows, stock
// movements and sales orders all point at them; `status` decides whether the
// list shows them. Defaults to "active", so every existing caller — every
// location picker in the app — behaves exactly as it did.
const listQuerySchema = z.object({
  status: z.enum(["active", "archived", "all"]).default("active"),
});

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const query = listQuerySchema.parse(req.query);
    const locations = await prisma.location.findMany({
      where: {
        organizationId: req.auth!.organizationId,
        ...(query.status === "all" ? {} : { isActive: query.status === "active" }),
      },
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

    // The unique index covers archived rows too, so a clash has to name the
    // archived one — otherwise the user retypes the same name and gets the
    // same refusal with nothing on screen that explains it.
    const existing = await prisma.location.findFirst({
      where: { organizationId, name: body.name },
    });
    if (existing) {
      throw ApiError.conflict(
        existing.isActive
          ? "A location with this name already exists"
          : "An archived location already uses this name — restore or rename it"
      );
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

    // The default is where the app proposes to put stock, so it has to be
    // somewhere stock can go. Allowing an archived location to hold the
    // flag would leave every new movement defaulting to a place the API
    // then refuses.
    if (body.isDefault && !location.isActive) {
      throw ApiError.badRequest("Restore this location before making it the default");
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

// Archive, not delete. Deleting was refused outright once a location had
// any movement history or any sales order pointing at it — which is every
// location that has ever been used for anything. So the stockroom you have
// stopped using, the one you actually want out of the pickers, was the one
// the product insisted on keeping. Archiving always succeeds, keeps the
// history intact, and can be undone.
//
// Three things are still refused, because they would leave the app in a
// state a user cannot act on:
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
    if (!location.isActive) {
      throw ApiError.conflict("This location is already archived");
    }

    // 1. Somewhere has to be left to record stock into.
    const activeLocations = await prisma.location.count({
      where: { organizationId, isActive: true },
    });
    if (activeLocations <= 1) {
      throw ApiError.badRequest("An organization must have at least one active location");
    }

    // 2. The default is what every form proposes; archiving it would leave
    //    the app suggesting a location the API refuses.
    if (location.isDefault) {
      throw ApiError.badRequest("Set a different default location before archiving this one");
    }

    // 3. Stock left behind would still count towards the organization's
    //    valuation while being invisible in every picker — and because an
    //    archived location cannot be transferred out of either, it would be
    //    stranded there until someone restored the location. Emptying it
    //    first is the only order of operations that works, so the error
    //    says exactly that.
    const stockedItems = await prisma.inventoryItem.count({
      where: { organizationId, locationId: location.id, quantity: { not: 0 } },
    });
    if (stockedItems > 0) {
      throw ApiError.conflict(
        "Cannot archive a location that still holds stock — transfer or adjust it to zero first"
      );
    }

    await prisma.location.update({ where: { id: location.id }, data: { isActive: false } });
    res.status(204).send();
  })
);

router.post(
  "/:id/restore",
  asyncHandler(async (req, res) => {
    const organizationId = req.auth!.organizationId;
    const location = await prisma.location.findFirst({
      where: { id: req.params.id, organizationId },
    });
    if (!location) {
      throw ApiError.notFound("Location not found");
    }
    if (location.isActive) {
      throw ApiError.conflict("This location is not archived");
    }

    const restored = await prisma.location.update({
      where: { id: location.id },
      data: { isActive: true },
    });
    res.json(restored);
  })
);

export default router;
