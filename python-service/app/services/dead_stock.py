from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Connection

# Dead stock: goods on the shelf that nobody has bought for a while.
#
# The product already answers "what am I about to run out of" (F8 low stock,
# F12 reorder suggestions) and "what is selling" (top movers). Nothing
# answered the opposite question, which for a small shop is the expensive
# one: stock that was bought once and has sat there since is working capital
# on a shelf, and it is invisible precisely because nothing about it ever
# moves or triggers an alert.
#
# Aggregated entirely in SQL for the same reason every other report in this
# module is: the alternative reads every movement row for the window to
# discover that a product has none.
_DEAD_STOCK_SQL = text(
    """
    SELECT
        p."id" AS product_id,
        p."sku" AS sku,
        p."name" AS name,
        p."costCents" AS cost_cents,
        COALESCE(inv.total_qty, 0) AS quantity_on_hand,
        sales.last_sold_at AS last_sold_at,
        COALESCE(recent.units_sold, 0) AS units_sold_in_window
    FROM "products" p
    LEFT JOIN (
        SELECT "productId", SUM("quantity") AS total_qty
        FROM "inventory_items"
        WHERE "organizationId" = :organization_id
        GROUP BY "productId"
    ) inv ON inv."productId" = p."id"
    LEFT JOIN (
        -- Every sale ever, not just the window: "last sold 8 months ago" is
        -- the number that makes the case, and "never sold" has to be
        -- distinguishable from it.
        SELECT "productId", MAX("createdAt") AS last_sold_at
        FROM "stock_movements"
        WHERE "organizationId" = :organization_id
          AND "type" = 'SALE'
        GROUP BY "productId"
    ) sales ON sales."productId" = p."id"
    LEFT JOIN (
        -- SALE movements store a negative signed quantity (see
        -- stockMovements.routes.ts), so negate for a units-sold count. Any
        -- sale at all inside the window disqualifies a product.
        SELECT "productId", SUM(-"quantity") AS units_sold
        FROM "stock_movements"
        WHERE "organizationId" = :organization_id
          AND "type" = 'SALE'
          AND "createdAt" >= :since
        GROUP BY "productId"
    ) recent ON recent."productId" = p."id"
    WHERE p."organizationId" = :organization_id
      AND p."isActive" = true
      -- Stock on hand is the whole point: a discontinued product with none
      -- left is not tying up anything, and listing it would bury the rows
      -- that are.
      AND COALESCE(inv.total_qty, 0) > 0
      AND COALESCE(recent.units_sold, 0) <= 0
    ORDER BY COALESCE(inv.total_qty, 0) * p."costCents" DESC, p."name"
    """
)


def fetch_dead_stock(conn: Connection, organization_id: str, since) -> list[dict[str, Any]]:
    """Active products holding stock that has not sold since `since`.

    Ordered by the capital each one is holding, largest first, because that
    is the order anyone would act on them in.
    """
    result = conn.execute(_DEAD_STOCK_SQL, {"organization_id": organization_id, "since": since})
    return [dict(row) for row in result.mappings().all()]
