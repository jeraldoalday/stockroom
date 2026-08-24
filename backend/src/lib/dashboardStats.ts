import { prisma } from "./prisma";

// Both queries below join products to a per-product sum of inventory_items
// and compare that sum against reorderPoint — the low-stock predicate (F8)
// — entirely in the database. That comparison has no Prisma query-builder
// equivalent (there is no way to express "aggregate of one table compared
// to a column on another" without raw SQL), which is why every earlier pass
// at this dashboard read every active product into JS to do the comparison
// itself. See __mocks__/prisma.ts for the hand-written equivalent these
// queries run against in tests — it re-derives the same numbers from the
// in-memory tables rather than interpreting this SQL, so it has to be kept
// in step with any change here.

export interface StockSummary {
  activeProductCount: number;
  totalStockValueCents: number;
  lowStockCount: number;
}

// Marker comments (`-- dashboardStats.xxx`) aren't documentation here —
// __mocks__/prisma.ts dispatches on them to find the matching hand-written
// equivalent, the same way a real query planner would use the shape of the
// SQL itself.
export async function fetchStockSummary(organizationId: string): Promise<StockSummary> {
  const rows = await prisma.$queryRaw<
    { activeProductCount: bigint; totalStockValueCents: bigint; lowStockCount: bigint }[]
  >`
    -- dashboardStats.stockSummary
    SELECT
      COUNT(*)::bigint AS "activeProductCount",
      COALESCE(SUM(COALESCE(inv.total_qty, 0) * p."costCents"), 0)::bigint AS "totalStockValueCents",
      COUNT(*) FILTER (WHERE COALESCE(inv.total_qty, 0) <= p."reorderPoint")::bigint AS "lowStockCount"
    FROM "products" p
    LEFT JOIN (
      SELECT "productId", SUM("quantity") AS total_qty
      FROM "inventory_items"
      WHERE "organizationId" = ${organizationId}
      GROUP BY "productId"
    ) inv ON inv."productId" = p."id"
    WHERE p."organizationId" = ${organizationId} AND p."isActive" = true
  `;
  const row = rows[0];
  return {
    activeProductCount: Number(row?.activeProductCount ?? 0),
    totalStockValueCents: Number(row?.totalStockValueCents ?? 0),
    lowStockCount: Number(row?.lowStockCount ?? 0),
  };
}

export interface LowStockProduct {
  id: string;
  organizationId: string;
  categoryId: string | null;
  sku: string;
  name: string;
  description: string | null;
  costCents: number;
  priceCents: number;
  reorderPoint: number;
  reorderQty: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface LowStockRow {
  product: LowStockProduct;
  quantity: number;
}

interface RawLowStockRow extends LowStockProduct {
  quantity: bigint;
  totalCount: bigint;
}

// Pagination and the "total" figure both come from the same query via
// `COUNT(*) OVER()`, rather than a second round trip to count the full
// result set.
export async function fetchLowStockPage(
  organizationId: string,
  page: number,
  pageSize: number
): Promise<{ items: LowStockRow[]; total: number }> {
  const offset = (page - 1) * pageSize;
  const rows = await prisma.$queryRaw<RawLowStockRow[]>`
    -- dashboardStats.lowStockPage
    SELECT
      p."id", p."organizationId", p."categoryId", p."sku", p."name", p."description",
      p."costCents", p."priceCents", p."reorderPoint", p."reorderQty", p."isActive",
      p."createdAt", p."updatedAt",
      COALESCE(inv.total_qty, 0)::bigint AS "quantity",
      COUNT(*) OVER ()::bigint AS "totalCount"
    FROM "products" p
    LEFT JOIN (
      SELECT "productId", SUM("quantity") AS total_qty
      FROM "inventory_items"
      WHERE "organizationId" = ${organizationId}
      GROUP BY "productId"
    ) inv ON inv."productId" = p."id"
    WHERE p."organizationId" = ${organizationId}
      AND p."isActive" = true
      AND COALESCE(inv.total_qty, 0) <= p."reorderPoint"
    -- Ties broken by name so paging can't show the same product twice, or
    -- skip one, between two requests.
    ORDER BY "quantity" ASC, p."name" ASC
    LIMIT ${pageSize} OFFSET ${offset}
  `;

  const total = rows.length > 0 ? Number(rows[0].totalCount) : 0;
  const items = rows.map(({ quantity, totalCount: _totalCount, ...product }) => ({
    product,
    quantity: Number(quantity),
  }));

  return { items, total };
}
