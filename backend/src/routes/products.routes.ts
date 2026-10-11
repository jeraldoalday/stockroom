import express, { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/asyncHandler";
import { requireAuth } from "../middleware/auth";
import { ApiError } from "../lib/errors";
import { parseCsvRecords } from "../lib/csv";
import { MAX_INT4 } from "../lib/validation";

const router = Router();
router.use(requireAuth);

// DELETE archives a product rather than removing it (its SKU is referenced
// by historical movements and order lines), so "archived" is a state the
// catalogue has to be able to show — otherwise a product archived by
// mistake is unreachable forever, with its SKU still taken.
const listQuerySchema = z.object({
  search: z.string().trim().min(1).max(200).optional(),
  categoryId: z.string().optional(),
  status: z.enum(["active", "archived", "all"]).default("active"),
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
      ...(query.status === "all" ? {} : { isActive: query.status === "active" }),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: "insensitive" as const } },
              { sku: { contains: query.search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: { category: true },
        orderBy: { name: "asc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.product.count({ where }),
    ]);

    res.json({ items, total, page: query.page, pageSize: query.pageSize });
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const organizationId = req.auth!.organizationId;
    const product = await prisma.product.findFirst({
      where: { id: req.params.id, organizationId },
      include: { category: true, inventoryItems: { include: { location: true } } },
    });
    if (!product) {
      throw ApiError.notFound("Product not found");
    }
    res.json(product);
  })
);

const productSchema = z.object({
  sku: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  categoryId: z.string().optional().nullable(),
  costCents: z.number().int().min(0).max(MAX_INT4).default(0),
  priceCents: z.number().int().min(0).max(MAX_INT4).default(0),
  reorderPoint: z.number().int().min(0).max(MAX_INT4).default(0),
  reorderQty: z.number().int().min(0).max(MAX_INT4).default(0),
});

async function assertCategoryBelongsToOrg(categoryId: string | null | undefined, organizationId: string) {
  if (!categoryId) return;
  const category = await prisma.category.findFirst({ where: { id: categoryId, organizationId } });
  if (!category) {
    throw ApiError.badRequest("categoryId does not belong to this organization");
  }
}

// STAFF has "no access to cost/margin data by default" (PRD §4) — reads are
// covered by the global redaction in requireAuth, but a write also has to
// ignore any costCents a STAFF caller supplies rather than let them set a
// field they can't see back.
function stripCostForStaff<T extends { costCents?: number }>(body: T, role: string): T {
  if (role !== "STAFF") return body;
  const { costCents: _costCents, ...rest } = body;
  return rest as T;
}

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = stripCostForStaff(productSchema.parse(req.body), req.auth!.role);
    const organizationId = req.auth!.organizationId;

    await assertCategoryBelongsToOrg(body.categoryId, organizationId);

    const existing = await prisma.product.findFirst({
      where: { organizationId, sku: body.sku },
    });
    if (existing) {
      throw ApiError.conflict("A product with this SKU already exists");
    }

    const product = await prisma.product.create({
      data: { ...body, organizationId },
    });
    res.status(201).json(product);
  })
);

interface ImportRowError {
  row: number;
  message: string;
}

function parseNonNegativeInt(value: string, field: string, rowNumber: number, errors: ImportRowError[]): number | undefined {
  if (!value) return undefined;
  const asDollars = Number(value);
  if (!Number.isFinite(asDollars) || asDollars < 0) {
    errors.push({ row: rowNumber, message: `${field} must be a non-negative number` });
    return undefined;
  }
  const result = field === "cost" || field === "price" ? Math.round(asDollars * 100) : Math.round(asDollars);
  // Without this, a stray digit or bad formula result in one cell overflows
  // the destination `Int` column and crashes the whole import mid-way
  // (see MAX_INT4's comment) instead of being recorded as one bad row among
  // otherwise-independent ones.
  if (result > MAX_INT4) {
    errors.push({ row: rowNumber, message: `${field} is too large` });
    return undefined;
  }
  return result;
}

// F10: CSV import of products. Runs through the Node API (not the Python
// service) because it writes — the Python service is read-only by design
// (PRD §8), so any operation that mutates tenant data has to go through
// the API that owns the tenant boundary. Rows are processed independently:
// a bad row is recorded in `errors` and skipped rather than aborting the
// whole import, since a shop's spreadsheet export is rarely perfectly clean.
router.post(
  "/import",
  express.text({ type: ["text/csv", "text/plain"], limit: "2mb" }),
  asyncHandler(async (req, res) => {
    const organizationId = req.auth!.organizationId;
    const isStaff = req.auth!.role === "STAFF";
    const csvText = typeof req.body === "string" ? req.body : "";
    if (!csvText.trim()) {
      throw ApiError.badRequest("Request body must be CSV text (Content-Type: text/csv)");
    }

    const records = parseCsvRecords(csvText);
    const errors: ImportRowError[] = [];
    const categoryCache = new Map<string, string>();
    let created = 0;
    let updated = 0;

    for (let index = 0; index < records.length; index += 1) {
      const rowNumber = index + 2; // +1 for the header row, +1 for 1-based counting
      const record = records[index];
      const sku = record.sku?.trim();
      const name = record.name?.trim();

      if (!sku || sku.length > 64) {
        errors.push({ row: rowNumber, message: "sku is required (max 64 chars)" });
        continue;
      }
      if (!name || name.length > 200) {
        errors.push({ row: rowNumber, message: "name is required (max 200 chars)" });
        continue;
      }

      const rowErrorsBefore = errors.length;
      // A STAFF import silently keeps whatever cost the product already has
      // (or 0 on create) instead of erroring on a cost column it can't set —
      // same "no access to cost data" rule as the create/update routes.
      const costCents = isStaff ? undefined : parseNonNegativeInt(record.cost, "cost", rowNumber, errors);
      const priceCents = parseNonNegativeInt(record.price, "price", rowNumber, errors);
      const reorderPoint = parseNonNegativeInt(record.reorderPoint, "reorderPoint", rowNumber, errors);
      const reorderQty = parseNonNegativeInt(record.reorderQty, "reorderQty", rowNumber, errors);
      if (errors.length > rowErrorsBefore) continue;

      // Every check-then-write below (category lookup-or-create, product
      // lookup-or-create/update) is racing whatever else is touching this
      // org right now — another import running at the same time, or a
      // plain create/rename from the UI — the same gap products.routes.ts's
      // own POST / and categories.routes.ts's own POST / are exposed to.
      // There, a race surfaces as a 409 for that one request; here, letting
      // it throw would abort every row still queued behind this one, which
      // contradicts this route's whole premise that rows are independent
      // (see the comment above `router.post("/import"`). Catching the
      // unique-constraint violation and recording it against this row only
      // keeps that promise.
      try {
        let categoryId: string | undefined;
        const categoryName = record.category?.trim();
        if (categoryName) {
          // Case-insensitive, same as categories.routes.ts's own create/rename
          // checks — the `@@unique([organizationId, name])` index is
          // case-sensitive at the database, so a plain-equals lookup here
          // would happily create a second "produce" alongside an existing
          // "Produce" the moment a CSV export happened to capitalize it
          // differently, splitting one category into two that every picker
          // then shows as duplicates. The cache key is lowercased too, so two
          // rows spelling a brand-new category differently within the same
          // import share one row instead of racing each other to create it.
          const cacheKey = categoryName.toLowerCase();
          const cached = categoryCache.get(cacheKey);
          if (cached) {
            categoryId = cached;
          } else {
            const category =
              (await prisma.category.findFirst({
                where: { organizationId, name: { equals: categoryName, mode: "insensitive" } },
              })) ?? (await prisma.category.create({ data: { organizationId, name: categoryName } }));
            categoryId = category.id;
            categoryCache.set(cacheKey, categoryId);
          }
        }

        const existing = await prisma.product.findFirst({ where: { organizationId, sku } });
        if (existing) {
          await prisma.product.update({
            where: { id: existing.id },
            data: {
              name,
              ...(record.description ? { description: record.description } : {}),
              ...(categoryId ? { categoryId } : {}),
              ...(costCents !== undefined ? { costCents } : {}),
              ...(priceCents !== undefined ? { priceCents } : {}),
              ...(reorderPoint !== undefined ? { reorderPoint } : {}),
              ...(reorderQty !== undefined ? { reorderQty } : {}),
            },
          });
          updated += 1;
        } else {
          await prisma.product.create({
            data: {
              organizationId,
              sku,
              name,
              description: record.description || undefined,
              categoryId,
              costCents: costCents ?? 0,
              priceCents: priceCents ?? 0,
              reorderPoint: reorderPoint ?? 0,
              reorderQty: reorderQty ?? 0,
            },
          });
          created += 1;
        }
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          errors.push({
            row: rowNumber,
            message: "This row conflicts with a category or SKU created concurrently elsewhere — re-import it",
          });
          continue;
        }
        throw err;
      }
    }

    res.json({ created, updated, errors });
  })
);

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const body = stripCostForStaff(productSchema.partial().parse(req.body), req.auth!.role);
    const organizationId = req.auth!.organizationId;

    const product = await prisma.product.findFirst({
      where: { id: req.params.id, organizationId },
    });
    if (!product) {
      throw ApiError.notFound("Product not found");
    }

    if (body.categoryId !== undefined) {
      await assertCategoryBelongsToOrg(body.categoryId, organizationId);
    }

    if (body.sku && body.sku !== product.sku) {
      const skuTaken = await prisma.product.findFirst({
        where: { organizationId, sku: body.sku, NOT: { id: product.id } },
      });
      if (skuTaken) {
        throw ApiError.conflict("A product with this SKU already exists");
      }
    }

    const updated = await prisma.product.update({
      where: { id: product.id },
      data: body,
    });
    res.json(updated);
  })
);

// Soft delete: products are referenced by historical stock movements and
// order lines, so a hard delete would corrupt the audit trail.
//
// Archiving is blocked while the product sits on an order that hasn't
// finished yet. Receiving against an ORDERED purchase order, or fulfilling
// a DRAFT sales order, posts stock movements for a product the catalogue
// says is gone — the order would still work, which is worse than it
// failing, because the stock silently reappears under an archived SKU that
// no list shows. Finished orders (RECEIVED/FULFILLED/CANCELLED) are history
// and don't block anything.
const OPEN_PURCHASE_ORDER_STATUSES = ["DRAFT", "ORDERED", "PARTIALLY_RECEIVED"] as const;

async function countOpenOrderLines(organizationId: string, productId: string) {
  const [purchaseOrders, salesOrders] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where: { organizationId, status: { in: [...OPEN_PURCHASE_ORDER_STATUSES] } },
    }),
    prisma.salesOrder.findMany({ where: { organizationId, status: "DRAFT" } }),
  ]);

  const [purchaseLines, salesLines] = await Promise.all([
    purchaseOrders.length
      ? prisma.purchaseOrderLine.count({
          where: { productId, purchaseOrderId: { in: purchaseOrders.map((order) => order.id) } },
        })
      : Promise.resolve(0),
    salesOrders.length
      ? prisma.salesOrderLine.count({
          where: { productId, salesOrderId: { in: salesOrders.map((order) => order.id) } },
        })
      : Promise.resolve(0),
  ]);

  return purchaseLines + salesLines;
}

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const organizationId = req.auth!.organizationId;
    const product = await prisma.product.findFirst({
      where: { id: req.params.id, organizationId },
    });
    if (!product) {
      throw ApiError.notFound("Product not found");
    }
    if (!product.isActive) {
      throw ApiError.conflict("This product is already archived");
    }

    const openLines = await countOpenOrderLines(organizationId, product.id);
    if (openLines > 0) {
      throw ApiError.conflict("Cannot archive a product that is on an open purchase or sales order");
    }

    await prisma.product.update({ where: { id: product.id }, data: { isActive: false } });
    res.status(204).send();
  })
);

// The counterpart to the archive above. There is no SKU conflict to resolve
// on the way back in: the unique index is on (organizationId, sku)
// regardless of isActive, so an archived product never freed its SKU for
// anyone else to take.
router.post(
  "/:id/restore",
  asyncHandler(async (req, res) => {
    const organizationId = req.auth!.organizationId;
    const product = await prisma.product.findFirst({
      where: { id: req.params.id, organizationId },
    });
    if (!product) {
      throw ApiError.notFound("Product not found");
    }
    if (product.isActive) {
      throw ApiError.conflict("This product is not archived");
    }

    const restored = await prisma.product.update({
      where: { id: product.id },
      data: { isActive: true },
    });
    res.json(restored);
  })
);

export default router;
