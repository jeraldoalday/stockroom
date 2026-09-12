import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/asyncHandler";
import { requireAuth } from "../middleware/auth";
import { ApiError } from "../lib/errors";
import { requireStockableLocation } from "../lib/locations";
import { requireActiveProduct } from "../lib/products";
import { applyMovementDelta } from "../lib/inventory";
import { MAX_INT4 } from "../lib/validation";

const router = Router();
router.use(requireAuth);

// Unlike purchase orders (Owner-gated: supplier/PO management is an Owner
// task per the PRD persona model), sales orders are open to STAFF too —
// "fulfils sales orders" is explicitly a Staff responsibility.

const listQuerySchema = z.object({
  status: z.enum(["DRAFT", "FULFILLED", "CANCELLED"]).optional(),
  customerId: z.string().optional(),
  locationId: z.string().optional(),
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
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.locationId ? { locationId: query.locationId } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.salesOrder.findMany({
        where,
        include: { customer: true },
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.salesOrder.count({ where }),
    ]);

    res.json({ items, total, page: query.page, pageSize: query.pageSize });
  })
);

async function loadSalesOrderWithLines(organizationId: string, id: string) {
  const salesOrder = await prisma.salesOrder.findFirst({ where: { id, organizationId } });
  if (!salesOrder) {
    throw ApiError.notFound("Sales order not found");
  }
  const lines = await prisma.salesOrderLine.findMany({ where: { salesOrderId: salesOrder.id } });
  return { ...salesOrder, lines };
}

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const result = await loadSalesOrderWithLines(req.auth!.organizationId, req.params.id);
    res.json(result);
  })
);

const lineInputSchema = z.object({
  productId: z.string(),
  quantity: z.number().int().positive().max(MAX_INT4),
  unitPriceCents: z.number().int().min(0).max(MAX_INT4),
});

const createSchema = z.object({
  customerId: z.string().optional().nullable(),
  locationId: z.string(),
  notes: z.string().max(1000).optional(),
  lines: z.array(lineInputSchema).min(1),
});

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const organizationId = req.auth!.organizationId;

    await requireStockableLocation(organizationId, body.locationId);
    if (body.customerId) {
      const customer = await prisma.customer.findFirst({ where: { id: body.customerId, organizationId } });
      if (!customer) {
        throw ApiError.badRequest("customerId does not belong to this organization");
      }
    }
    for (const line of body.lines) {
      await requireActiveProduct(organizationId, line.productId, `productId ${line.productId}`);
    }

    const result = await prisma.$transaction(async (tx) => {
      const salesOrder = await tx.salesOrder.create({
        data: {
          organizationId,
          customerId: body.customerId ?? null,
          locationId: body.locationId,
          notes: body.notes,
          status: "DRAFT",
        },
      });
      const lines = [];
      for (const line of body.lines) {
        lines.push(
          await tx.salesOrderLine.create({
            data: {
              salesOrderId: salesOrder.id,
              productId: line.productId,
              quantity: line.quantity,
              unitPriceCents: line.unitPriceCents,
            },
          })
        );
      }
      return { ...salesOrder, lines };
    });

    res.status(201).json(result);
  })
);

const patchSchema = z.object({
  customerId: z.string().optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
});

// Shared by every route below that mutates a sales order's own fields or its
// lines: only a DRAFT can be edited, since FULFILLED has already moved stock
// and CANCELLED is done.
async function requireDraftSalesOrder(organizationId: string, id: string) {
  const salesOrder = await prisma.salesOrder.findFirst({ where: { id, organizationId } });
  if (!salesOrder) {
    throw ApiError.notFound("Sales order not found");
  }
  if (salesOrder.status !== "DRAFT") {
    throw ApiError.badRequest("Only a draft sales order can be edited");
  }
  return salesOrder;
}

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const body = patchSchema.parse(req.body);
    const organizationId = req.auth!.organizationId;

    const salesOrder = await requireDraftSalesOrder(organizationId, req.params.id);
    if (body.customerId) {
      const customer = await prisma.customer.findFirst({ where: { id: body.customerId, organizationId } });
      if (!customer) {
        throw ApiError.badRequest("customerId does not belong to this organization");
      }
    }

    const updated = await prisma.salesOrder.update({ where: { id: salesOrder.id }, data: body });
    res.json(updated);
  })
);

// Fixing a mis-keyed draft (wrong product, wrong quantity/price) previously
// meant cancelling the whole order and recreating it, since only the order's
// own customer/notes could be patched, not its lines. These three routes
// close that gap, ungated like every other sales-order route (fulfilling
// sales orders, and now editing a draft one, is Staff work).
const lineCreateSchema = z.object({
  productId: z.string(),
  quantity: z.number().int().positive().max(MAX_INT4),
  unitPriceCents: z.number().int().min(0).max(MAX_INT4),
});

router.post(
  "/:id/lines",
  asyncHandler(async (req, res) => {
    const body = lineCreateSchema.parse(req.body);
    const organizationId = req.auth!.organizationId;
    const salesOrder = await requireDraftSalesOrder(organizationId, req.params.id);

    await requireActiveProduct(organizationId, body.productId);

    await prisma.salesOrderLine.create({
      data: {
        salesOrderId: salesOrder.id,
        productId: body.productId,
        quantity: body.quantity,
        unitPriceCents: body.unitPriceCents,
      },
    });

    res.status(201).json(await loadSalesOrderWithLines(organizationId, salesOrder.id));
  })
);

const lineUpdateSchema = z.object({
  quantity: z.number().int().positive().max(MAX_INT4).optional(),
  unitPriceCents: z.number().int().min(0).max(MAX_INT4).optional(),
});

router.patch(
  "/:id/lines/:lineId",
  asyncHandler(async (req, res) => {
    const body = lineUpdateSchema.parse(req.body);
    const organizationId = req.auth!.organizationId;
    const salesOrder = await requireDraftSalesOrder(organizationId, req.params.id);

    const line = await prisma.salesOrderLine.findFirst({
      where: { id: req.params.lineId, salesOrderId: salesOrder.id },
    });
    if (!line) {
      throw ApiError.notFound("Sales order line not found");
    }

    await prisma.salesOrderLine.update({ where: { id: line.id }, data: body });
    res.json(await loadSalesOrderWithLines(organizationId, salesOrder.id));
  })
);

router.delete(
  "/:id/lines/:lineId",
  asyncHandler(async (req, res) => {
    const organizationId = req.auth!.organizationId;
    const salesOrder = await requireDraftSalesOrder(organizationId, req.params.id);

    const line = await prisma.salesOrderLine.findFirst({
      where: { id: req.params.lineId, salesOrderId: salesOrder.id },
    });
    if (!line) {
      throw ApiError.notFound("Sales order line not found");
    }
    // Mirrors createSchema's own `lines: z.array(...).min(1)` — an order
    // with zero lines isn't a smaller order, it's not an order.
    const lineCount = await prisma.salesOrderLine.count({ where: { salesOrderId: salesOrder.id } });
    if (lineCount <= 1) {
      throw ApiError.badRequest("A sales order must have at least one line");
    }

    await prisma.salesOrderLine.delete({ where: { id: line.id } });
    res.json(await loadSalesOrderWithLines(organizationId, salesOrder.id));
  })
);

router.post(
  "/:id/cancel",
  asyncHandler(async (req, res) => {
    const organizationId = req.auth!.organizationId;
    const salesOrder = await prisma.salesOrder.findFirst({ where: { id: req.params.id, organizationId } });
    if (!salesOrder) {
      throw ApiError.notFound("Sales order not found");
    }
    if (salesOrder.status !== "DRAFT") {
      throw ApiError.badRequest("Only a draft sales order can be cancelled");
    }

    const updated = await prisma.salesOrder.update({ where: { id: salesOrder.id }, data: { status: "CANCELLED" } });
    res.json(updated);
  })
);

// F7: fulfilling decrements stock and blocks an over-sell. Every line's
// availability is checked up front so a short line never leaves the order
// half-fulfilled.
router.post(
  "/:id/fulfill",
  asyncHandler(async (req, res) => {
    const organizationId = req.auth!.organizationId;
    const actorId = req.auth!.userId;

    const salesOrder = await prisma.salesOrder.findFirst({ where: { id: req.params.id, organizationId } });
    if (!salesOrder) {
      throw ApiError.notFound("Sales order not found");
    }
    if (salesOrder.status !== "DRAFT") {
      throw ApiError.badRequest("Only a draft sales order can be fulfilled");
    }

    const lines = await prisma.salesOrderLine.findMany({ where: { salesOrderId: salesOrder.id } });

    for (const line of lines) {
      const item = await prisma.inventoryItem.findFirst({
        where: { organizationId, productId: line.productId, locationId: salesOrder.locationId },
      });
      const available = item?.quantity ?? 0;
      if (available < line.quantity) {
        throw ApiError.badRequest(
          `Insufficient stock for product ${line.productId}: ${available} available, ${line.quantity} requested`
        );
      }
    }

    await prisma.$transaction(async (tx) => {
      for (const line of lines) {
        await applyMovementDelta(tx, {
          organizationId,
          productId: line.productId,
          locationId: salesOrder.locationId,
          delta: -line.quantity,
        });
        await tx.stockMovement.create({
          data: {
            organizationId,
            productId: line.productId,
            locationId: salesOrder.locationId,
            type: "SALE",
            quantity: -line.quantity,
            // Copied onto the movement rather than left to be joined back
            // from the line: the movement is the audit record, and the
            // price charged is part of what happened. It also means the
            // trend report reads one table instead of two.
            unitPriceCents: line.unitPriceCents,
            actorId,
            salesOrderId: salesOrder.id,
            reason: `Fulfilling SO ${salesOrder.id}`,
          },
        });
      }
      await tx.salesOrder.update({ where: { id: salesOrder.id }, data: { status: "FULFILLED" } });
    });

    const result = await loadSalesOrderWithLines(organizationId, salesOrder.id);
    res.json(result);
  })
);

export default router;
