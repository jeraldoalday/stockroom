import express, { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/asyncHandler";
import { requireAuth } from "../middleware/auth";
import { ApiError } from "../lib/errors";
import { parseCsvRecords } from "../lib/csv";

const router = Router();
router.use(requireAuth);

const listQuerySchema = z.object({
  search: z.string().trim().min(1).max(200).optional(),
  categoryId: z.string().optional(),
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
      isActive: true,
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
  costCents: z.number().int().min(0).default(0),
  priceCents: z.number().int().min(0).default(0),
  reorderPoint: z.number().int().min(0).default(0),
  reorderQty: z.number().int().min(0).default(0),
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
  if (Number.isNaN(asDollars) || asDollars < 0) {
    errors.push({ row: rowNumber, message: `${field} must be a non-negative number` });
    return undefined;
  }
  return field === "cost" || field === "price" ? Math.round(asDollars * 100) : Math.round(asDollars);
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

      let categoryId: string | undefined;
      const categoryName = record.category?.trim();
      if (categoryName) {
        const cached = categoryCache.get(categoryName);
        if (cached) {
          categoryId = cached;
        } else {
          const category =
            (await prisma.category.findFirst({ where: { organizationId, name: categoryName } })) ??
            (await prisma.category.create({ data: { organizationId, name: categoryName } }));
          categoryId = category.id;
          categoryCache.set(categoryName, categoryId);
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

    await prisma.product.update({ where: { id: product.id }, data: { isActive: false } });
    res.status(204).send();
  })
);

export default router;
