import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/asyncHandler";
import { requireAuth, requireRole } from "../middleware/auth";
import { ApiError } from "../lib/errors";
import { requireStockableLocation } from "../lib/locations";
import { applyMovementDelta } from "../lib/inventory";

const router = Router();
router.use(requireAuth);

const listQuerySchema = z.object({
  status: z.enum(["DRAFT", "ORDERED", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"]).optional(),
  supplierId: z.string().optional(),
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
      ...(query.status ? { status: query.status } : {}),
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where,
        include: { supplier: true },
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.purchaseOrder.count({ where }),
    ]);

    res.json({ items, total, page: query.page, pageSize: query.pageSize });
  })
);

// The mock Prisma client used in tests doesn't resolve `include`, so lines
// are always fetched as a second query rather than nested — this also
// keeps the response shape identical against a real Postgres backend.
async function loadPurchaseOrderWithLines(organizationId: string, id: string) {
  const purchaseOrder = await prisma.purchaseOrder.findFirst({ where: { id, organizationId } });
  if (!purchaseOrder) {
    throw ApiError.notFound("Purchase order not found");
  }
  const lines = await prisma.purchaseOrderLine.findMany({ where: { purchaseOrderId: purchaseOrder.id } });
  return { ...purchaseOrder, lines };
}

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const result = await loadPurchaseOrderWithLines(req.auth!.organizationId, req.params.id);
    res.json(result);
  })
);

const lineInputSchema = z.object({
  productId: z.string(),
  quantityOrdered: z.number().int().positive(),
  unitCostCents: z.number().int().min(0),
});

const createSchema = z.object({
  supplierId: z.string(),
  notes: z.string().max(1000).optional(),
  lines: z.array(lineInputSchema).min(1),
});

// Supplier/PO management is an Owner responsibility per the persona model
// in the PRD; receiving stock is explicitly a Staff task (see below).
router.post(
  "/",
  requireRole("OWNER"),
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const organizationId = req.auth!.organizationId;

    const supplier = await prisma.supplier.findFirst({ where: { id: body.supplierId, organizationId } });
    if (!supplier) {
      throw ApiError.badRequest("supplierId does not belong to this organization");
    }
    for (const line of body.lines) {
      const product = await prisma.product.findFirst({ where: { id: line.productId, organizationId } });
      if (!product) {
        throw ApiError.badRequest(`productId ${line.productId} does not belong to this organization`);
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const purchaseOrder = await tx.purchaseOrder.create({
        data: { organizationId, supplierId: body.supplierId, notes: body.notes, status: "DRAFT" },
      });
      const lines = [];
      for (const line of body.lines) {
        lines.push(
          await tx.purchaseOrderLine.create({
            data: {
              purchaseOrderId: purchaseOrder.id,
              productId: line.productId,
              quantityOrdered: line.quantityOrdered,
              unitCostCents: line.unitCostCents,
            },
          })
        );
      }
      return { ...purchaseOrder, lines };
    });

    res.status(201).json(result);
  })
);

const patchSchema = z.object({
  supplierId: z.string().optional(),
  notes: z.string().max(1000).optional().nullable(),
});

router.patch(
  "/:id",
  requireRole("OWNER"),
  asyncHandler(async (req, res) => {
    const body = patchSchema.parse(req.body);
    const organizationId = req.auth!.organizationId;

    const purchaseOrder = await prisma.purchaseOrder.findFirst({ where: { id: req.params.id, organizationId } });
    if (!purchaseOrder) {
      throw ApiError.notFound("Purchase order not found");
    }
    if (purchaseOrder.status !== "DRAFT") {
      throw ApiError.badRequest("Only a draft purchase order can be edited");
    }
    if (body.supplierId) {
      const supplier = await prisma.supplier.findFirst({ where: { id: body.supplierId, organizationId } });
      if (!supplier) {
        throw ApiError.badRequest("supplierId does not belong to this organization");
      }
    }

    const updated = await prisma.purchaseOrder.update({ where: { id: purchaseOrder.id }, data: body });
    res.json(updated);
  })
);

router.post(
  "/:id/order",
  requireRole("OWNER"),
  asyncHandler(async (req, res) => {
    const organizationId = req.auth!.organizationId;
    const purchaseOrder = await prisma.purchaseOrder.findFirst({ where: { id: req.params.id, organizationId } });
    if (!purchaseOrder) {
      throw ApiError.notFound("Purchase order not found");
    }
    if (purchaseOrder.status !== "DRAFT") {
      throw ApiError.badRequest("Only a draft purchase order can be marked as ordered");
    }

    const updated = await prisma.purchaseOrder.update({
      where: { id: purchaseOrder.id },
      data: { status: "ORDERED" },
    });
    res.json(updated);
  })
);

router.post(
  "/:id/cancel",
  requireRole("OWNER"),
  asyncHandler(async (req, res) => {
    const organizationId = req.auth!.organizationId;
    const purchaseOrder = await prisma.purchaseOrder.findFirst({ where: { id: req.params.id, organizationId } });
    if (!purchaseOrder) {
      throw ApiError.notFound("Purchase order not found");
    }
    if (purchaseOrder.status !== "DRAFT" && purchaseOrder.status !== "ORDERED") {
      throw ApiError.badRequest("Only a draft or ordered purchase order can be cancelled");
    }

    const updated = await prisma.purchaseOrder.update({
      where: { id: purchaseOrder.id },
      data: { status: "CANCELLED" },
    });
    res.json(updated);
  })
);

const receiveSchema = z.object({
  locationId: z.string(),
  lines: z.array(z.object({ lineId: z.string(), quantity: z.number().int().positive() })).min(1),
});

// Receiving is a Staff task: it posts RECEIVE stock movements and advances
// the PO toward PARTIALLY_RECEIVED/RECEIVED, but never requires the Owner
// role that gates supplier/PO management above.
router.post(
  "/:id/receive",
  asyncHandler(async (req, res) => {
    const body = receiveSchema.parse(req.body);
    const organizationId = req.auth!.organizationId;
    const actorId = req.auth!.userId;

    const purchaseOrder = await prisma.purchaseOrder.findFirst({ where: { id: req.params.id, organizationId } });
    if (!purchaseOrder) {
      throw ApiError.notFound("Purchase order not found");
    }
    if (purchaseOrder.status !== "ORDERED" && purchaseOrder.status !== "PARTIALLY_RECEIVED") {
      throw ApiError.badRequest("Purchase order is not in a receivable state");
    }

    const location = await requireStockableLocation(organizationId, body.locationId);

    const existingLines = await prisma.purchaseOrderLine.findMany({
      where: { purchaseOrderId: purchaseOrder.id },
    });
    const lineById = new Map(existingLines.map((line) => [line.id, line]));

    for (const receipt of body.lines) {
      const line = lineById.get(receipt.lineId);
      if (!line) {
        throw ApiError.badRequest(`line ${receipt.lineId} does not belong to this purchase order`);
      }
      const remaining = line.quantityOrdered - line.quantityReceived;
      if (receipt.quantity > remaining) {
        throw ApiError.badRequest(
          `Cannot receive ${receipt.quantity} units for line ${line.id}; only ${remaining} remain`
        );
      }
    }

    await prisma.$transaction(async (tx) => {
      for (const receipt of body.lines) {
        const line = lineById.get(receipt.lineId)!;
        await applyMovementDelta(tx, {
          organizationId,
          productId: line.productId,
          locationId: location.id,
          delta: receipt.quantity,
        });
        await tx.stockMovement.create({
          data: {
            organizationId,
            productId: line.productId,
            locationId: location.id,
            type: "RECEIVE",
            quantity: receipt.quantity,
            actorId,
            purchaseOrderId: purchaseOrder.id,
            reason: `Receiving PO ${purchaseOrder.id}`,
          },
        });
        await tx.purchaseOrderLine.update({
          where: { id: line.id },
          data: { quantityReceived: line.quantityReceived + receipt.quantity },
        });
      }

      const freshLines = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: purchaseOrder.id } });
      const allReceived = freshLines.every((line) => line.quantityReceived >= line.quantityOrdered);
      const anyReceived = freshLines.some((line) => line.quantityReceived > 0);
      const status = allReceived ? "RECEIVED" : anyReceived ? "PARTIALLY_RECEIVED" : purchaseOrder.status;

      await tx.purchaseOrder.update({ where: { id: purchaseOrder.id }, data: { status } });
    });

    const result = await loadPurchaseOrderWithLines(organizationId, purchaseOrder.id);
    res.json(result);
  })
);

export default router;
