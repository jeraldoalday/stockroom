import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/asyncHandler";
import { requireAuth } from "../middleware/auth";
import { ApiError } from "../lib/errors";

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

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = productSchema.parse(req.body);
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

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const body = productSchema.partial().parse(req.body);
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
