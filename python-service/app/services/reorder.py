from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Connection

# F12: reorder-quantity suggestion from moving-average demand. Current
# stock and trailing units-sold are both aggregated per product in SQL
# (subqueries, not a JS/Python loop) so this stays cheap at the ~10k SKU
# scale the NFR targets, mirroring the SQL-aggregate note left on the
# trend/export queries in this same module.
_REORDER_SQL = text(
    """
    SELECT
        p."id" AS product_id,
        p."sku" AS sku,
        p."name" AS name,
        p."reorderPoint" AS reorder_point,
        p."reorderQty" AS reorder_qty,
        COALESCE(inv.total_qty, 0) AS current_stock,
        COALESCE(sales.units_sold, 0) AS units_sold
    FROM "products" p
    LEFT JOIN (
        SELECT "productId", SUM("quantity") AS total_qty
        FROM "inventory_items"
        WHERE "organizationId" = :organization_id
        GROUP BY "productId"
    ) inv ON inv."productId" = p."id"
    LEFT JOIN (
        -- SALE movements store a negative signed quantity (see
        -- stockMovements.routes.ts: `delta = type === 'SALE' ? -quantity :
        -- quantity`, persisted as-is), same convention the trend report's
        -- `-sm."quantity"` already relies on -- negate to get a positive
        -- units-sold count.
        SELECT "productId", SUM(-"quantity") AS units_sold
        FROM "stock_movements"
        WHERE "organizationId" = :organization_id
          AND "type" = 'SALE'
          AND "createdAt" >= :since
        GROUP BY "productId"
    ) sales ON sales."productId" = p."id"
    WHERE p."organizationId" = :organization_id
      AND p."isActive" = true
      AND COALESCE(inv.total_qty, 0) <= p."reorderPoint"
    ORDER BY p."name"
    """
)


def fetch_reorder_candidates(conn: Connection, organization_id: str, since) -> list[dict[str, Any]]:
    """Products at or below their reorder point, with trailing units sold.

    Filtering to already-low-stock products in SQL (rather than every active
    product) keeps this consistent with how the Node dashboard already
    defines "low stock" (F8: qty <= reorderPoint) and avoids shipping a
    moving-average number for products nobody needs to reorder yet.
    """
    result = conn.execute(_REORDER_SQL, {"organization_id": organization_id, "since": since})
    return [dict(row) for row in result.mappings().all()]
