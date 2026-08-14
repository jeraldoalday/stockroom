import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/asyncHandler";
import { requireAuth } from "../middleware/auth";

const router = Router();
router.use(requireAuth);

// A product's stock is spread across locations; "low stock" (F8) and
// "total stock value" (F9) both need the sum across all locations, which
// the mock Prisma client can't groupBy — so both endpoints fetch products
// and inventory items and aggregate in JS. Fine at the SKU counts this
// product targets (up to ~10k per NFR); move to a SQL aggregate query if
// that stops being true.
async function loadStockByProduct(organizationId: string) {
  const [products, inventoryItems] = await Promise.all([
    prisma.product.findMany({ where: { organizationId, isActive: true } }),
    prisma.inventoryItem.findMany({ where: { organizationId } }),
  ]);

  const quantityByProduct = new Map<string, number>();
  for (const item of inventoryItems) {
    quantityByProduct.set(item.productId, (quantityByProduct.get(item.productId) ?? 0) + item.quantity);
  }

  return products.map((product) => ({
    product,
    quantity: quantityByProduct.get(product.id) ?? 0,
  }));
}

router.get(
  "/summary",
  asyncHandler(async (req, res) => {
    const organizationId = req.auth!.organizationId;

    const [stock, recentMovements] = await Promise.all([
      loadStockByProduct(organizationId),
      prisma.stockMovement.findMany({
        where: { organizationId },
        include: { product: true, location: true },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
    ]);

    const totalStockValueCents = stock.reduce(
      (sum, entry) => sum + entry.quantity * entry.product.costCents,
      0
    );
    const lowStockCount = stock.filter((entry) => entry.quantity <= entry.product.reorderPoint).length;

    res.json({
      totalStockValueCents,
      activeProductCount: stock.length,
      lowStockCount,
      recentMovements,
    });
  })
);

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

router.get(
  "/low-stock",
  asyncHandler(async (req, res) => {
    const query = paginationSchema.parse(req.query);
    const organizationId = req.auth!.organizationId;

    const stock = await loadStockByProduct(organizationId);
    const lowStock = stock
      .filter((entry) => entry.quantity <= entry.product.reorderPoint)
      .sort((a, b) => a.quantity - b.quantity);

    const total = lowStock.length;
    const start = (query.page - 1) * query.pageSize;
    const items = lowStock.slice(start, start + query.pageSize);

    res.json({ items, total, page: query.page, pageSize: query.pageSize });
  })
);

export default router;
