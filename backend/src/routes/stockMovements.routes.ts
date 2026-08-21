import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/asyncHandler";
import { requireAuth } from "../middleware/auth";
import { ApiError } from "../lib/errors";
import { applyMovementDelta } from "../lib/inventory";
import { PUBLIC_USER_SELECT } from "../lib/rbac";

const router = Router();
router.use(requireAuth);

async function assertProductAndLocation(organizationId: string, productId: string, locationId: string) {
  const [product, location] = await Promise.all([
    prisma.product.findFirst({ where: { id: productId, organizationId } }),
    prisma.location.findFirst({ where: { id: locationId, organizationId } }),
  ]);
  if (!product) throw ApiError.badRequest("productId does not belong to this organization");
  if (!location) throw ApiError.badRequest("locationId does not belong to this organization");
  return { product, location };
}

const listQuerySchema = z.object({
  productId: z.string().optional(),
  locationId: z.string().optional(),
  type: z.enum(["RECEIVE", "SALE", "TRANSFER_IN", "TRANSFER_OUT", "ADJUSTMENT"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const query = listQuerySchema.parse(req.query);
    const organizationId = req.auth!.organizationId;

    const where = {
      organizationId,
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.locationId ? { locationId: query.locationId } : {}),
      ...(query.type ? { type: query.type } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.stockMovement.findMany({
        where,
        // `actor: true` would pull the whole User row — password hash
        // included — into the response; only the fields the audit trail
        // actually displays are selected.
        include: { product: true, location: true, actor: { select: PUBLIC_USER_SELECT } },
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.stockMovement.count({ where }),
    ]);

    res.json({ items, total, page: query.page, pageSize: query.pageSize });
  })
);

const movementSchema = z.object({
  productId: z.string(),
  locationId: z.string(),
  type: z.enum(["RECEIVE", "SALE", "ADJUSTMENT"]),
  quantity: z
    .number()
    .int()
    .refine((v) => v !== 0, "quantity must not be zero"),
  reason: z.string().min(1).max(500).optional(),
});

// RECEIVE and SALE record a magnitude; ADJUSTMENT records the exact signed
// delta (F5: manual adjustments always carry a reason).
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = movementSchema.parse(req.body);
    const organizationId = req.auth!.organizationId;
    const actorId = req.auth!.userId;

    if (body.type === "ADJUSTMENT" && !body.reason) {
      throw ApiError.badRequest("reason is required for a manual adjustment");
    }
    if (body.type !== "ADJUSTMENT" && body.quantity < 0) {
      throw ApiError.badRequest("quantity must be positive for this movement type");
    }

    await assertProductAndLocation(organizationId, body.productId, body.locationId);
    const delta = body.type === "SALE" ? -body.quantity : body.quantity;

    const movement = await prisma.$transaction(async (tx) => {
      await applyMovementDelta(tx, {
        organizationId,
        productId: body.productId,
        locationId: body.locationId,
        delta,
      });
      return tx.stockMovement.create({
        data: {
          organizationId,
          productId: body.productId,
          locationId: body.locationId,
          type: body.type,
          quantity: delta,
          reason: body.reason,
          actorId,
        },
      });
    });

    res.status(201).json(movement);
  })
);

const transferSchema = z.object({
  productId: z.string(),
  fromLocationId: z.string(),
  toLocationId: z.string(),
  quantity: z.number().int().positive(),
  reason: z.string().max(500).optional(),
});

router.post(
  "/transfer",
  asyncHandler(async (req, res) => {
    const body = transferSchema.parse(req.body);
    const organizationId = req.auth!.organizationId;
    const actorId = req.auth!.userId;

    if (body.fromLocationId === body.toLocationId) {
      throw ApiError.badRequest("fromLocationId and toLocationId must differ");
    }

    await assertProductAndLocation(organizationId, body.productId, body.fromLocationId);
    await assertProductAndLocation(organizationId, body.productId, body.toLocationId);

    const [outMovement, inMovement] = await prisma.$transaction(async (tx) => {
      await applyMovementDelta(tx, {
        organizationId,
        productId: body.productId,
        locationId: body.fromLocationId,
        delta: -body.quantity,
      });
      const out = await tx.stockMovement.create({
        data: {
          organizationId,
          productId: body.productId,
          locationId: body.fromLocationId,
          type: "TRANSFER_OUT",
          quantity: -body.quantity,
          reason: body.reason,
          actorId,
        },
      });

      await applyMovementDelta(tx, {
        organizationId,
        productId: body.productId,
        locationId: body.toLocationId,
        delta: body.quantity,
      });
      const inbound = await tx.stockMovement.create({
        data: {
          organizationId,
          productId: body.productId,
          locationId: body.toLocationId,
          type: "TRANSFER_IN",
          quantity: body.quantity,
          reason: body.reason,
          actorId,
        },
      });

      return [out, inbound];
    });

    res.status(201).json({ out: outMovement, in: inMovement });
  })
);

export default router;
