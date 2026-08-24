import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/asyncHandler";
import { requireAuth } from "../middleware/auth";
import { fetchLowStockPage, fetchStockSummary } from "../lib/dashboardStats";

const router = Router();
router.use(requireAuth);

router.get(
  "/summary",
  asyncHandler(async (req, res) => {
    const organizationId = req.auth!.organizationId;

    const [summary, recentMovements] = await Promise.all([
      fetchStockSummary(organizationId),
      prisma.stockMovement.findMany({
        where: { organizationId },
        include: { product: true, location: true },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
    ]);

    res.json({ ...summary, recentMovements });
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

    // This is the endpoint that benefits most from aggregating in the
    // database. It reads a time window of sales, and the seeded demo alone
    // puts ~1,400 SALE movements in a 60-day one — every one of which used
    // to be fetched to produce five rows. Now the database returns one row
    // per product sold in the window.
    //
    // SALE movements are persisted with a negative signed quantity (see
    // stockMovements.routes.ts), so ascending order by the summed quantity
    // puts the biggest seller first and the limit can be applied before the
    // products are looked up at all.
    const groups = await prisma.stockMovement.groupBy({
      by: ["productId"],
      where: { organizationId, type: "SALE", createdAt: { gte: since } },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: "asc" } },
    });

    const ranked = groups
      .map((group) => ({ productId: group.productId, unitsSold: -(group._sum.quantity ?? 0) }))
      // A product whose sales net out to zero or below over the window —
      // every sale returned as an adjustment, say — is not a top mover.
      .filter((entry) => entry.unitsSold > 0)
      .slice(0, query.limit);

    // Only the products that made the cut are read, rather than the whole
    // catalogue. Archived products are included on purpose: something that
    // sold well and was then discontinued is exactly what an owner wants to
    // see, and the row carries isActive so the UI can say so.
    const products = await prisma.product.findMany({
      where: { organizationId, id: { in: ranked.map((entry) => entry.productId) } },
    });
    const productsById = new Map(products.map((product) => [product.id, product]));

    const items = ranked.flatMap((entry) => {
      const product = productsById.get(entry.productId);
      if (!product) return [];
      return [
        {
          productId: entry.productId,
          sku: product.sku,
          name: product.name,
          isActive: product.isActive,
          unitsSold: entry.unitsSold,
          // Units valued at the product's *current* list price, which is
          // not necessarily what was charged at the time. The trend report
          // is the one that reads actual sales-order line prices; this is a
          // dashboard-sized approximation and is named to say so rather
          // than pretending to be revenue.
          estimatedValueCents: entry.unitsSold * product.priceCents,
        },
      ];
    });

    // The database ordered by units sold; ties come back in whatever order
    // the plan produced, so they are settled by name here to keep the list
    // stable between identical requests.
    items.sort((a, b) => b.unitsSold - a.unitsSold || a.name.localeCompare(b.name));

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

    const { items, total } = await fetchLowStockPage(organizationId, query.page, query.pageSize);

    res.json({ items, total, page: query.page, pageSize: query.pageSize });
  })
);

export default router;
