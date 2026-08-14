import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/asyncHandler";
import { requireAuth } from "../middleware/auth";
import { ApiError } from "../lib/errors";

const router = Router();
router.use(requireAuth);

// Read-only stock query layer over InventoryItem. Rows only exist once the
// StockMovement engine (Day 3) has posted a movement for a product/location
// pair, so this is empty for a brand-new org.
const listQuerySchema = z.object({
  locationId: z.string().optional(),
  productId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const query = listQuerySchema.parse(req.query);
    const organizationId = req.auth!.organizationId;

    if (query.locationId) {
      const location = await prisma.location.findFirst({
        where: { id: query.locationId, organizationId },
      });
      if (!location) {
        throw ApiError.badRequest("locationId does not belong to this organization");
      }
    }
    if (query.productId) {
      const product = await prisma.product.findFirst({
        where: { id: query.productId, organizationId },
      });
      if (!product) {
        throw ApiError.badRequest("productId does not belong to this organization");
      }
    }

    const where = {
      organizationId,
      ...(query.locationId ? { locationId: query.locationId } : {}),
      ...(query.productId ? { productId: query.productId } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.inventoryItem.findMany({
        where,
        include: { product: true, location: true },
        orderBy: { updatedAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.inventoryItem.count({ where }),
    ]);

    res.json({ items, total, page: query.page, pageSize: query.pageSize });
  })
);

export default router;
