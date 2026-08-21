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

// PRD section 3, goal 5: "Give the owner a dashboard: stock value,
// low-stock items, top movers." The first two shipped on Day 6; this is the
// third. It answers "what is actually selling", which is the question that
// makes the reorder point and reorder quantity worth setting in the first
// place — without it the dashboard only ever reports problems, never what
// is going well.
const topMoversQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
  limit: z.coerce.number().int().min(1).max(50).default(5),
});

router.get(
  "/top-movers",
  asyncHandler(async (req, res) => {
    const query = topMoversQuerySchema.parse(req.query);
    const organizationId = req.auth!.organizationId;
    const since = new Date(Date.now() - query.days * 24 * 60 * 60 * 1000);

    // Aggregated in JS for the same reason loadStockByProduct is: Prisma's
    // groupBy isn't available against the in-memory client the route tests
    // run on. Same NFR caveat applies — fine to ~10k SKUs, and this reads a
    // bounded time window rather than the whole movement table.
    const movements = await prisma.stockMovement.findMany({
      where: { organizationId, type: "SALE", createdAt: { gte: since } },
    });

    const unitsByProduct = new Map<string, number>();
    for (const movement of movements) {
      // SALE movements are persisted with a negative signed quantity (see
      // stockMovements.routes.ts); negate to count units sold.
      unitsByProduct.set(movement.productId, (unitsByProduct.get(movement.productId) ?? 0) - movement.quantity);
    }

    const products = await prisma.product.findMany({ where: { organizationId } });
    const productsById = new Map(products.map((product) => [product.id, product]));

    const items = [...unitsByProduct.entries()]
      .flatMap(([productId, unitsSold]) => {
        const product = productsById.get(productId);
        if (!product || unitsSold <= 0) return [];
        return [
          {
            productId,
            sku: product.sku,
            name: product.name,
            isActive: product.isActive,
            unitsSold,
            // Units valued at the product's *current* list price, which is
            // not necessarily what was charged at the time. The trend
            // report is the one that reads actual sales-order line prices;
            // this is a dashboard-sized approximation and is named to say
            // so rather than pretending to be revenue.
            estimatedValueCents: unitsSold * product.priceCents,
          },
        ];
      })
      .sort((a, b) => b.unitsSold - a.unitsSold || a.name.localeCompare(b.name))
      .slice(0, query.limit);

    res.json({ days: query.days, items });
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
